import type { StageName } from './enums';

/**
 * The agents: one job each. Each agent's prompt is a base (`guidelines/agents/base/<name>.md`: goal, steps, rules) plus an
 * overlay for where it runs (`guidelines/agents/pipeline/<name>.md`: inputs and output). The pipeline and the generated
 * `.claude/agents/` files are both assembled from them, so they never drift. A stage key says which agent runs; the
 * documentor serves two keys.
 */
export interface AgentSpec {
  /** The agent's name and the name of its prompt files (`guidelines/agents/<base|pipeline>/<name>.md`). */
  name: string;
  /** The stage keys it runs as. */
  stages: readonly StageName[];
  /** One sentence: its one job. Used as the description of its `.claude/agents` file. */
  job: string;
  /** What the workspace is for this agent. */
  workspace: 'none' | 'read-only' | 'writes';
  model: 'haiku' | 'sonnet' | 'opus';
  /**
   * Whether the agent ships in the `sdlc-subagents` Claude Code plugin, for anyone to call from their own session. Agents
   * that only make sense inside the pipeline (they choose pipeline moves, map Jira, or answer support tickets) never ship.
   */
  plugin: boolean;
  /** The workspace in the plugin, when it differs: there the agent can look things up itself (a CI log with `gh`). */
  pluginWorkspace?: AgentSpec['workspace'];
}

export const AGENTS: readonly AgentSpec[] = [
  { name: 'assistant', stages: ['assist'], job: 'Answer the developer’s questions about one support ticket and draft a response.', workspace: 'read-only', model: 'sonnet', plugin: false },
  { name: 'repo-profiler', stages: ['repoProfile'], job: 'Propose the stack, the install, typecheck and test commands, the KB folder and the test-file pattern of a repository.', workspace: 'read-only', model: 'sonnet', plugin: false },
  { name: 'onboarding-advisor', stages: ['onboardAdvise'], job: 'Propose how a project connects to its tracker: the Jira status mapping, approval statuses, issue-type routing and intake label, or the GitHub Projects board columns, approval columns and intake column (or recommend sdlc-agent\'s default columns).', workspace: 'none', model: 'haiku', plugin: false },
  { name: 'feature-mapper', stages: ['featureMap'], job: 'Match a ticket to an existing knowledge-base feature key, or say it is new.', workspace: 'read-only', model: 'haiku', plugin: false },
  { name: 'documentor', stages: ['kbBuild', 'kbUpdate'], job: 'Create or refresh one feature doc in the knowledge base.', workspace: 'writes', model: 'sonnet', plugin: true },
  { name: 'solution-architect', stages: ['solutionDesign'], job: 'Design a feature: goal, approach, acceptance criteria and what is out of scope.', workspace: 'read-only', model: 'opus', plugin: true },
  { name: 'bug-investigator', stages: ['bugInvestigation'], job: 'Find the root cause of a bug with file and line evidence, and write the acceptance criteria for the fix.', workspace: 'read-only', model: 'opus', plugin: true },
  { name: 'technical-architect', stages: ['technicalDesign'], job: 'Turn an approved plan into files, an order of work and subtasks with acceptance criteria.', workspace: 'read-only', model: 'sonnet', plugin: true },
  { name: 'test-writer', stages: ['tests'], job: 'Write failing tests for one subtask.', workspace: 'writes', model: 'sonnet', plugin: true },
  { name: 'coder', stages: ['implement'], job: 'Make one subtask’s tests pass with the smallest correct change.', workspace: 'writes', model: 'sonnet', plugin: true },
  { name: 'fixer', stages: ['fix'], job: 'Remove one named failure: failing tests, review findings or a CI failure.', workspace: 'writes', model: 'sonnet', plugin: true },
  { name: 'pr-reviewer', stages: ['prReview'], job: 'Review a diff for correctness, and whether every acceptance criterion is met and tested.', workspace: 'read-only', model: 'sonnet', plugin: true },
  { name: 'quality-reviewer', stages: ['qualityReview'], job: 'Review a diff for readability and the repository’s standards.', workspace: 'read-only', model: 'haiku', plugin: true },
  { name: 'security-reviewer', stages: ['securityReview'], job: 'Review a diff for security problems only.', workspace: 'read-only', model: 'sonnet', plugin: true },
  { name: 'orchestrator', stages: ['orchestrate'], job: 'Choose one of the legal moves for a ticket at a decision point, and say why.', workspace: 'none', model: 'haiku', plugin: false },
  { name: 'jira-connector', stages: ['jiraConnector'], job: 'Do one Jira operation through the claude.ai Jira connector and return the result as JSON.', workspace: 'none', model: 'haiku', plugin: false },
  { name: 'ci-triager', stages: ['ciTriage'], job: 'Classify a failed CI run as a code problem, a flaky test or an infrastructure problem.', workspace: 'none', model: 'haiku', plugin: true, pluginWorkspace: 'read-only' },
];

/** The prompt file (without `.md`) of a stage: the agent that runs it. */
export function promptFileOf(stage: StageName): string {
  const agent = AGENTS.find((a) => a.stages.includes(stage));
  if (!agent) throw new Error(`No agent runs the stage "${stage}"`);
  return agent.name;
}

export const AGENT_TOOLS: Record<AgentSpec['workspace'], string> = { none: 'Read', 'read-only': 'Read, Grep, Glob, Bash', writes: 'Read, Grep, Glob, Bash, Edit, Write' };

/** The text from `heading` up to the next `## ` heading, and the text around it. Both sections searched here hold no code fences. */
function cutSection(text: string, heading: string, file: string): { before: string; section: string; after: string } {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`${file} has no "${heading}" section`);
  const next = text.indexOf('\n## ', start + 1);
  const end = next < 0 ? text.length : next;
  return { before: text.slice(0, start), section: text.slice(start + 1, end).trimEnd(), after: text.slice(end) };
}

/**
 * One agent's prompt: the base with the overlay's `## Inputs` section placed right after the base's `## Goal`, and the
 * overlay's other sections at the end. The overlay says where the agent runs (the pipeline, or a Claude Code plugin).
 */
export function assembleAgentPrompt(base: string, overlay: string): string {
  const goal = cutSection(`\n${base.trim()}\n`, '## Goal', 'the base');
  const inputs = cutSection(`\n${overlay.trim()}\n`, '## Inputs', 'the overlay');
  const rest = [inputs.before, inputs.after].map((s) => s.trim()).filter(Boolean).join('\n\n');
  return [`${goal.before.trim()}\n\n${goal.section}`, inputs.section, goal.after.trim(), rest].filter(Boolean).join('\n\n') + '\n';
}

/** A `.claude/agents/sdlc-<name>.md` file, generated from the agent's assembled pipeline prompt. */
export function renderAgentFile(agent: AgentSpec, prompt: string): string {
  return [
    '---',
    `name: sdlc-${agent.name}`,
    `description: SDLC agent: ${agent.job}`,
    `tools: ${AGENT_TOOLS[agent.workspace]}`,
    `model: ${agent.model}`,
    '---',
    '',
    'Follow the rules in `guidelines/agents/shared-rules.md` and `guidelines/default-CLAUDE.md` (if present in this repo) and the stack guideline in `guidelines/stacks/` that matches the project.',
    '',
    prompt.trimEnd(),
    '',
  ].join('\n');
}
