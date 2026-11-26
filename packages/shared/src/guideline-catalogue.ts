import { AGENTS, type AgentSpec } from './agents';
import { FORMATS, formatPath } from './formats';

/**
 * The guideline files a person may see and change, and how they are shown. Everything else under `guidelines/` stays out of the dashboard
 * and out of the API: the files that build the Claude Code plugin, the default CLAUDE.md, and the per-stack guides.
 *
 * An agent has two files. Its **behaviour** (`agents/base/<name>.md`: goal, steps, rules) is what a person tunes. Its **pipeline part**
 * (`agents/pipeline/<name>.md`: inputs and output) is how the pipeline reads the agent's answer, so it can be read but not edited.
 */
export type GuidelineKind = 'agent' | 'format' | 'standard';

export interface GuidelineItem {
  /** Unique across the catalogue: `agent:coder`, `format:plan`, `standard:shared-rules`. */
  id: string;
  kind: GuidelineKind;
  label: string;
  /** One sentence, for the card. */
  description: string;
  /** The file a person edits, from the guidelines folder. */
  editable: string;
  /** The file that is shown but not editable (an agent's inputs and output). */
  readonly?: string;
  /** An agent's default model. */
  model?: AgentSpec['model'];
  /** For an agent: where it comes in the pipeline, one sentence. */
  position?: string;
  /** Small changes that a person might make, each one a line that can be added to the rules with one click. */
  tweaks: string[];
}

/** The agents in the order a ticket meets them; any other agent follows, by name. */
const AGENT_ORDER = [
  'feature-mapper', 'solution-architect', 'bug-investigator', 'technical-architect', 'test-writer', 'coder', 'fixer', 'pr-reviewer', 'quality-reviewer',
  'security-reviewer', 'documentor', 'ci-triager', 'orchestrator', 'repo-profiler', 'onboarding-advisor', 'assistant',
] as const;

const LABELS: Record<string, string> = { 'pr-reviewer': 'PR reviewer', 'ci-triager': 'CI triager' };
const labelOf = (name: string): string => LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');

const POSITION: Record<string, string> = {
  'feature-mapper': 'First: matches the ticket to a feature in the knowledge base.',
  'solution-architect': 'Plans a feature, before you approve the plan.',
  'bug-investigator': 'Finds the cause of a bug, before you approve the plan.',
  'technical-architect': 'After you approve the plan: splits it into subtasks.',
  'test-writer': 'For each subtask: writes the failing tests first.',
  coder: 'For each subtask: after the tests, before the review.',
  fixer: 'When a test, a review finding or CI fails.',
  'pr-reviewer': 'After the code: checks it against the acceptance criteria.',
  'quality-reviewer': 'After the code: checks readability and the repository’s standards.',
  'security-reviewer': 'After the code, when it touches risky paths.',
  documentor: 'Writes and refreshes the feature docs in the knowledge base.',
  'ci-triager': 'When CI fails: says what kind of failure it is.',
  orchestrator: 'When a step is stuck: chooses what to try next.',
  'repo-profiler': 'When a project is added: works out its commands.',
  'onboarding-advisor': 'When a project is added: proposes how it maps to its tracker.',
  assistant: 'Answers your questions in the inbox.',
};

/** A few one-line changes per agent. They are suggestions only, shown as chips, and cost nothing to try. */
const TWEAKS: Record<string, string[]> = {
  coder: ['Prefer small, pure functions.', 'Add JSDoc to every exported function.', 'Never add a new dependency without asking.', 'Log errors with the repository’s own logger.'],
  'test-writer': ['Name each test after the behaviour it checks.', 'Cover the empty and the error case of every function.', 'Prefer a few clear tests to many small ones.'],
  fixer: ['Fix the cause, not the symptom, and say which it was.', 'Keep each fix as small as possible.'],
  'pr-reviewer': ['Be strict about missing tests.', 'Say what is good as well as what is wrong.', 'Flag any behaviour change that no criterion asks for.'],
  'quality-reviewer': ['Flag functions longer than 40 lines.', 'Prefer early returns to deep nesting.', 'Point out names that do not say what the thing is.'],
  'security-reviewer': ['Treat every new input from outside as hostile until it is validated.', 'Flag any secret that is logged.'],
  'solution-architect': ['Always list what is out of scope.', 'Prefer the smallest change that meets the criteria.', 'Name the files that will change.'],
  'bug-investigator': ['Always give the file and line of the cause.', 'Say how you reproduced it.'],
  'technical-architect': ['Keep subtasks small enough to review in one sitting.', 'Order the subtasks so each one leaves the tests green.'],
  documentor: ['Write for someone new to the project.', 'Keep each doc under 200 lines.'],
};

/** What each shared document is for. */
const STANDARDS: GuidelineItem[] = [
  { id: 'standard:shared-rules', kind: 'standard', label: 'Shared rules', description: 'The rules every agent follows.', editable: 'agents/shared-rules.md', tweaks: [] },
  { id: 'standard:review-checklist', kind: 'standard', label: 'Review checklist', description: 'What a review looks at, in order.', editable: 'review-checklist.md', tweaks: [] },
  { id: 'standard:kb-doc-template', kind: 'standard', label: 'KB doc template', description: 'The shape of a feature doc in the knowledge base.', editable: 'kb-doc-template.md', tweaks: [] },
];

const agentIndex = (name: string): number => {
  const i = (AGENT_ORDER as readonly string[]).indexOf(name);
  return i < 0 ? AGENT_ORDER.length : i;
};

/** Every agent in `AGENTS` is here, so a new agent shows up in the dashboard with no further work. */
const AGENT_ITEMS: GuidelineItem[] = [...AGENTS]
  .sort((a, b) => agentIndex(a.name) - agentIndex(b.name) || a.name.localeCompare(b.name))
  .map((a) => ({
    id: `agent:${a.name}`,
    kind: 'agent' as const,
    label: labelOf(a.name),
    description: a.job,
    editable: `agents/base/${a.name}.md`,
    readonly: `agents/pipeline/${a.name}.md`,
    model: a.model,
    position: POSITION[a.name],
    tweaks: TWEAKS[a.name] ?? [],
  }));

const FORMAT_ITEMS: GuidelineItem[] = FORMATS.map((f) => ({ id: `format:${f.name}`, kind: 'format' as const, label: f.title, description: f.description, editable: formatPath(f.name), tweaks: [] }));

export const GUIDELINE_CATALOGUE: readonly GuidelineItem[] = [...AGENT_ITEMS, ...FORMAT_ITEMS, ...STANDARDS];

/** The files a person may change. */
export const EDITABLE_GUIDELINES: ReadonlySet<string> = new Set(GUIDELINE_CATALOGUE.map((i) => i.editable));

/** The files a person may read: the editable ones, and the pipeline part of each agent. */
export const READABLE_GUIDELINES: ReadonlySet<string> = new Set([...EDITABLE_GUIDELINES, ...GUIDELINE_CATALOGUE.flatMap((i) => (i.readonly ? [i.readonly] : []))]);

/** The groups the page shows, in order. */
export const GUIDELINE_GROUPS: readonly { kind: GuidelineKind; title: string }[] = [
  { kind: 'agent', title: 'Agents' },
  { kind: 'format', title: 'How things are written' },
  { kind: 'standard', title: 'Standards' },
];
