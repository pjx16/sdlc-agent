import { z } from 'zod';
import { TICKET_KINDS, type TicketKind } from './onboarding';

export const TICKET_TYPES = ['story', 'bug', 'tech'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

/** Feature keys name KB docs: lower-case letters, digits, dot, dash and underscore. */
const featureKey = z
  .string()
  .trim()
  .max(64, 'must be at most 64 characters')
  .refine((v) => v === '' || /^[a-z0-9][a-z0-9._-]*$/.test(v), 'use lower-case letters, digits, dot, dash or underscore')
  .optional()
  .transform((v) => (v === '' ? undefined : v));

/** Most KB docs that can be attached to one ticket, and how many lines of them a stage is given in all. */
export const KB_ATTACHMENT_MAX = 5;
export const KB_ATTACHMENT_MAX_LINES = 600;

/** A KB doc named by its path inside the project's KB folder: relative, markdown, nothing that climbs out. */
export const KbAttachmentPath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => p.endsWith('.md') && !p.startsWith('/') && !p.includes('\0') && !p.includes('\\') && !p.split('/').some((part) => part === '..' || part === '.' || part === ''), 'must be a relative path to a .md file inside the KB folder');

/** What the worker keeps of a repository's KB for the API: the docs a ticket can attach. */
export interface KbCatalog {
  docs: { path: string; title: string }[];
  updatedAt: string;
}

/** Body of POST /tickets. */
/** Strict: an unknown field (a typo such as `description` for `body`) is an error, not silently dropped. */
export const PasteTicketSchema = z.strictObject({
  projectId: z.string({ error: 'required' }).min(1, 'required'),
  title: z.string({ error: 'required' }).trim().min(1, 'required').max(200, 'must be at most 200 characters'),
  body: z.string().max(100_000, 'must be at most 100000 characters').default(''),
  type: z.enum(TICKET_TYPES, { error: 'must be one of story, bug, tech' }).optional(),
  /** What the ticket is. Takes the place of `type`; when only `type` is sent, the kind follows it. */
  kind: z.enum(TICKET_KINDS, { error: 'must be one of feature, bug, chore' }).optional(),
  featureKey,
  /** KB docs to keep in the context of every stage of the ticket (paths inside the project's KB folder). */
  kbAttachments: z.array(KbAttachmentPath, { error: 'must be a list of KB doc paths' }).max(KB_ATTACHMENT_MAX, `at most ${KB_ATTACHMENT_MAX} docs`).default([]),
});
export type PasteTicketInput = z.infer<typeof PasteTicketSchema>;

/** What the person fills in when they create a ticket in the dashboard, in fields instead of one block of text. */
export const TicketDraftSchema = z
  .strictObject({
    projectId: z.string({ error: 'required' }).min(1, 'required'),
    kind: z.enum(TICKET_KINDS, { error: 'must be one of feature, bug, chore' }),
    title: z.string({ error: 'required' }).trim().min(1, 'required').max(200, 'must be at most 200 characters'),
    problem: z.string({ error: 'required' }).trim().min(1, 'required').max(20_000, 'must be at most 20000 characters'),
    /** Required for a bug: what should have happened. */
    expected: z.string().trim().max(20_000, 'must be at most 20000 characters').optional(),
    /** For a bug: how to see it. */
    steps: z.string().trim().max(20_000, 'must be at most 20000 characters').optional(),
    criteria: z
      .array(z.string({ error: 'must be text' }).trim().min(1, 'must not be empty').max(1000, 'must be at most 1000 characters'), { error: 'must be a list' })
      .min(1, 'add at least one acceptance criterion')
      .max(50, 'at most 50 criteria'),
    notes: z.string().trim().max(20_000, 'must be at most 20000 characters').optional(),
    featureKey,
    kbAttachments: z.array(KbAttachmentPath, { error: 'must be a list of KB doc paths' }).max(KB_ATTACHMENT_MAX, `at most ${KB_ATTACHMENT_MAX} docs`).default([]),
    /** Also put it on GitHub: as a new issue, or by linking an issue that already exists (its number). */
    github: z
      .strictObject({
        create: z.boolean({ error: 'must be true or false' }),
        link: z.number({ error: 'must be an issue number' }).int('must be an issue number').positive('must be an issue number').optional(),
      })
      .optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'bug' && !d.expected) ctx.addIssue({ code: 'custom', path: ['expected'], message: 'required for a bug' });
  });
export type TicketDraft = z.infer<typeof TicketDraftSchema>;

/** The sections a ticket is written in, with the heading each one has by default. */
const SECTION_HEADINGS = {
  problem: 'Problem',
  expected: 'Expected behaviour',
  steps: 'Steps to reproduce',
  criteria: 'Acceptance criteria',
  notes: 'Notes',
} as const;
type SectionId = keyof typeof SECTION_HEADINGS;
const DEFAULT_ORDER: SectionId[] = ['problem', 'expected', 'steps', 'criteria', 'notes'];

/** The `##` headings of a ticket template (the team's `formats/ticket.md`), as the sections they stand for, in the template's order. */
function templateOrder(template: string): SectionId[] {
  const byHeading = new Map<string, SectionId>(Object.entries(SECTION_HEADINGS).map(([id, heading]) => [heading.toLowerCase(), id as SectionId]));
  const order: SectionId[] = [];
  for (const line of template.split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)?.[1];
    const id = heading ? byHeading.get(heading.toLowerCase()) : undefined;
    if (id && !order.includes(id)) order.push(id);
  }
  return order;
}

/**
 * A ticket's text from its fields: one `##` section each, empty optional ones left out, the criteria as a task list. The dashboard's live
 * preview and the API both call this, so what is shown is exactly what is stored. A `template` (the team's ticket format) sets the order
 * of the sections it names; the others follow in the default order.
 */
export function buildTicketMarkdown(draft: Pick<TicketDraft, 'kind' | 'problem' | 'expected' | 'steps' | 'criteria' | 'notes'>, template?: string): string {
  const text: Record<SectionId, string | null> = {
    problem: draft.problem.trim() || null,
    expected: draft.expected?.trim() || null,
    steps: draft.kind === 'bug' ? draft.steps?.trim() || null : null,
    criteria: draft.criteria.map((c) => c.trim()).filter(Boolean).map((c) => `- [ ] ${c}`).join('\n') || null,
    notes: draft.notes?.trim() || null,
  };
  const named = template ? templateOrder(template) : [];
  const order = [...named, ...DEFAULT_ORDER.filter((id) => !named.includes(id))];
  return order
    .filter((id) => text[id] !== null)
    .map((id) => `## ${SECTION_HEADINGS[id]}\n${text[id]}`)
    .join('\n\n');
}

/** Where a ticket's GitHub issue stands: not asked for, waiting for the worker, made (or linked), or failed (the pipeline goes on without it). */
export const GITHUB_ISSUE_STATES = ['none', 'pending', 'created', 'failed'] as const;
export type GithubIssueState = (typeof GITHUB_ISSUE_STATES)[number];

/** The old type and the new kind say the same thing in two vocabularies (story is a feature, tech is a chore). */
export const kindOfType = (type: TicketType): TicketKind => (type === 'bug' ? 'bug' : type === 'tech' ? 'chore' : 'feature');
export const typeOfKind = (kind: TicketKind): TicketType => (kind === 'bug' ? 'bug' : kind === 'chore' ? 'tech' : 'story');

/** Jira issue types map to ticket types (F3): "bug" is bug; "story" or "user story" is story; everything else is tech. */
export function mapJiraIssueType(name: string | null | undefined): TicketType {
  const n = (name ?? '').trim().toLowerCase();
  if (n === 'bug') return 'bug';
  if (n === 'story' || n === 'user story') return 'story';
  return 'tech';
}

/** A Jira key as accepted from MCP intake (F3): `^[A-Z][A-Z0-9]+-[0-9]+$`. */
export const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]+-[0-9]+$/;
