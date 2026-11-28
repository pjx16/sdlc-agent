import { describe, expect, it } from 'vitest';
import { JIRA_KEY_PATTERN, PasteTicketSchema, TicketDraftSchema, buildTicketMarkdown, kindOfType, mapJiraIssueType, typeOfKind } from './ticket';
import { zodFields } from './zod-utils';

describe('PasteTicketSchema', () => {
  it('accepts a minimal ticket and applies defaults', () => {
    expect(PasteTicketSchema.parse({ projectId: 'p1', title: '  Add a thing  ' })).toEqual({ projectId: 'p1', title: 'Add a thing', body: '', type: undefined, kind: undefined, featureKey: undefined, kbAttachments: [] });
  });
  it('limits the attached KB docs: relative .md paths inside the KB folder, at most five', () => {
    const ok = (kbAttachments: unknown) => PasteTicketSchema.safeParse({ projectId: 'p1', title: 't', kbAttachments }).success;
    expect(ok(['auth.md', 'billing/overview.md'])).toBe(true);
    expect(ok(['../x.md'])).toBe(false);
    expect(ok(['/etc/x.md'])).toBe(false);
    expect(ok(['a/./b.md'])).toBe(false);
    expect(ok(['a\\b.md'])).toBe(false);
    expect(ok(['notes.txt'])).toBe(false);
    expect(ok(Array.from({ length: 6 }, (_, i) => `d${i}.md`))).toBe(false);
  });
  it('keeps type, body and feature key', () => {
    expect(PasteTicketSchema.parse({ projectId: 'p1', title: 't', body: 'b', type: 'bug', featureKey: 'billing-export' })).toMatchObject({ type: 'bug', body: 'b', featureKey: 'billing-export' });
  });
  it('treats a blank feature key as absent', () => {
    expect(PasteTicketSchema.parse({ projectId: 'p1', title: 't', featureKey: '  ' }).featureKey).toBeUndefined();
  });
  it('rejects an unknown field by name instead of dropping it', () => {
    const r = PasteTicketSchema.safeParse({ projectId: 'p', title: 'T', description: 'typo for body' });
    expect(r.success).toBe(false);
    if (!r.success) expect(zodFields(r.error)).toEqual({ description: 'unknown field' });
  });
  it('reports field-level errors', () => {
    const f = zodFields(PasteTicketSchema.safeParse({ title: '', type: 'epic', featureKey: 'Not Valid' }).error!);
    expect(Object.keys(f).sort()).toEqual(['featureKey', 'projectId', 'title', 'type']);
    expect(f.type).toBe('must be one of story, bug, tech');
    expect(zodFields(PasteTicketSchema.safeParse({ projectId: 'p', title: 'x'.repeat(201) }).error!).title).toBe('must be at most 200 characters');
  });
});

describe('mapJiraIssueType (F3)', () => {
  it('maps bug, story and user story case-insensitively, and everything else to tech', () => {
    expect(mapJiraIssueType('Bug')).toBe('bug');
    expect(mapJiraIssueType(' BUG ')).toBe('bug');
    expect(mapJiraIssueType('Story')).toBe('story');
    expect(mapJiraIssueType('User Story')).toBe('story');
    for (const other of ['Task', 'Epic', 'Sub-task', 'Improvement', '', undefined, null]) expect(mapJiraIssueType(other), String(other)).toBe('tech');
  });
});

describe('JIRA_KEY_PATTERN', () => {
  it('accepts real keys and rejects anything else', () => {
    for (const ok of ['ABC-1', 'SAM1-10', 'A1B-999']) expect(JIRA_KEY_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['abc-1', 'A-1', 'ABC-', 'ABC-1x', '1ABC-1', 'ABC 1', 'ABC-1\nINJECT', '']) expect(JIRA_KEY_PATTERN.test(bad), bad).toBe(false);
  });
});

describe('ticket kind', () => {
  it('accepts a kind and refuses anything else', () => {
    expect(PasteTicketSchema.parse({ projectId: 'p', title: 't', kind: 'chore' }).kind).toBe('chore');
    expect(PasteTicketSchema.safeParse({ projectId: 'p', title: 't', kind: 'epic' }).success).toBe(false);
  });
  it('kind and type say the same thing both ways', () => {
    expect((['story', 'bug', 'tech'] as const).map(kindOfType)).toEqual(['feature', 'bug', 'chore']);
    expect((['feature', 'bug', 'chore'] as const).map(typeOfKind)).toEqual(['story', 'bug', 'tech']);
  });
});

describe('TicketDraftSchema', () => {
  const draft = { projectId: 'p1', kind: 'feature', title: '  Add CSV export ', problem: ' Finance cannot export. ', criteria: [' Exports every row '] };

  it('trims, and applies defaults', () => {
    expect(TicketDraftSchema.parse(draft)).toEqual({ projectId: 'p1', kind: 'feature', title: 'Add CSV export', problem: 'Finance cannot export.', criteria: ['Exports every row'], kbAttachments: [], featureKey: undefined });
  });
  it('needs a problem and at least one criterion, with a message for each', () => {
    expect(zodFields(TicketDraftSchema.safeParse({ ...draft, problem: ' ', criteria: [] }).error!)).toEqual({ problem: 'required', criteria: 'add at least one acceptance criterion' });
  });
  it('refuses an empty criterion by its position', () => {
    expect(zodFields(TicketDraftSchema.safeParse({ ...draft, criteria: ['ok', '  '] }).error!)).toEqual({ 'criteria.1': 'must not be empty' });
  });
  it('needs expected behaviour for a bug, but not for a feature or a chore', () => {
    expect(zodFields(TicketDraftSchema.safeParse({ ...draft, kind: 'bug' }).error!)).toEqual({ expected: 'required for a bug' });
    expect(TicketDraftSchema.safeParse({ ...draft, kind: 'bug', expected: 'It exports.' }).success).toBe(true);
    expect(TicketDraftSchema.safeParse({ ...draft, kind: 'chore' }).success).toBe(true);
  });
  it('takes the GitHub choice: create, or link an issue by its number', () => {
    expect(TicketDraftSchema.parse({ ...draft, github: { create: true } }).github).toEqual({ create: true });
    expect(TicketDraftSchema.parse({ ...draft, github: { create: false, link: 42 } }).github).toEqual({ create: false, link: 42 });
    expect(zodFields(TicketDraftSchema.safeParse({ ...draft, github: { create: true, link: 0 } }).error!)).toEqual({ 'github.link': 'must be an issue number' });
  });
  it('rejects an unknown field and the same KB docs rules as a pasted ticket', () => {
    expect(TicketDraftSchema.safeParse({ ...draft, body: 'x' }).success).toBe(false);
    expect(TicketDraftSchema.safeParse({ ...draft, kbAttachments: ['../x.md'] }).success).toBe(false);
  });
});

describe('buildTicketMarkdown', () => {
  const base = { kind: 'feature', problem: 'Finance cannot export.', expected: 'A CSV with every row.', criteria: ['Exports every row', 'Opens in Excel'], notes: 'See the March thread.' } as const;

  it('writes one section each, with the criteria as a task list', () => {
    expect(buildTicketMarkdown(base)).toBe(
      ['## Problem', 'Finance cannot export.', '', '## Expected behaviour', 'A CSV with every row.', '', '## Acceptance criteria', '- [ ] Exports every row', '- [ ] Opens in Excel', '', '## Notes', 'See the March thread.'].join('\n'),
    );
  });
  it('leaves out empty optional sections', () => {
    expect(buildTicketMarkdown({ kind: 'chore', problem: 'Bump the lockfile.', criteria: ['CI is green'] })).toBe(['## Problem', 'Bump the lockfile.', '', '## Acceptance criteria', '- [ ] CI is green'].join('\n'));
    expect(buildTicketMarkdown({ ...base, expected: '  ', notes: '' })).not.toMatch(/Expected behaviour|Notes/);
  });
  it('a bug gets its steps to reproduce, between the expected behaviour and the criteria', () => {
    const md = buildTicketMarkdown({ ...base, kind: 'bug', steps: '1. Open Reports\n2. Click Export' });
    expect(md).toContain('## Steps to reproduce\n1. Open Reports\n2. Click Export');
    expect(md.indexOf('Expected behaviour')).toBeLessThan(md.indexOf('Steps to reproduce'));
    expect(md.indexOf('Steps to reproduce')).toBeLessThan(md.indexOf('Acceptance criteria'));
  });
  it('steps are only for a bug', () => {
    expect(buildTicketMarkdown({ ...base, kind: 'feature', steps: 'ignored' })).not.toContain('Steps to reproduce');
  });
  it('follows the order of the sections in the team template, with the rest after them', () => {
    const template = '## Acceptance criteria\n- [ ]\n\n## Problem\nWhat is wrong?\n';
    const md = buildTicketMarkdown(base, template);
    expect([...md.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(['Acceptance criteria', 'Problem', 'Expected behaviour', 'Notes']);
  });
  it('ignores template headings it does not know, and matches the known ones without regard to case', () => {
    const md = buildTicketMarkdown(base, '## Risks\n\n## NOTES\n\n## problem\n');
    expect([...md.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(['Notes', 'Problem', 'Expected behaviour', 'Acceptance criteria']);
  });
  it('is pure: the same input gives the same text', () => {
    expect(buildTicketMarkdown(base, '## Problem')).toBe(buildTicketMarkdown(base, '## Problem'));
  });
});
