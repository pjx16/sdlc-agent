import type { ClaudeMdMode, ModelAlias, StageName } from '@sdlc/shared';

export type WorkspaceAccess = 'rw' | 'ro' | 'none';

/** Workspace mounting per stage. kbBuild and kbUpdate may only change `kbDir`. */
export const STAGE_WORKSPACE: Record<StageName, WorkspaceAccess> = {
  orchestrate: 'none', featureMap: 'ro', kbBuild: 'rw', solutionDesign: 'ro', bugInvestigation: 'ro', technicalDesign: 'ro', tests: 'rw', implement: 'rw', fix: 'rw',
  prReview: 'ro', qualityReview: 'ro', securityReview: 'ro', kbUpdate: 'rw', ciTriage: 'none', assist: 'ro', repoProfile: 'ro', onboardAdvise: 'none', jiraConnector: 'none',
};

/** `stage.json`, read by run-stage. `attempt` and `round` are extra, for the test stub and diagnostics. */
export interface StageJson {
  model: string;
  maxTurns: number;
  disallowedTools: string[];
  /** Continue this CLI session (the assistant keeps one conversation per support ticket). */
  resumeSession?: string;
  /** Extended thinking budget in tokens; set only at the orchestrator's decision points. */
  thinkingTokens?: number;
  /** The Jira connector stage: run-stage loads the claude.ai connectors (no --strict-mcp-config) and this connector is the one to use. */
  connector?: { serverName: string };
  attempt: number;
  round: number;
}

export interface StageConfigInput {
  stage: StageName;
  /** Alias from the project's stage settings (haiku, sonnet, opus). */
  modelAlias: ModelAlias;
  /** GlobalSettings.modelAliases: what each alias resolves to. */
  modelAliases: Record<ModelAlias, string>;
  maxTurns: number;
  attempt?: number;
  round?: number;
  resumeSession?: string;
  thinkingTokens?: number;
  /** The claude.ai connector the Jira connector stage uses. */
  connectorServer?: string;
}

const ALWAYS_DISALLOWED = ['WebFetch', 'WebSearch'];
const READ_ONLY_EXTRA = ['Edit', 'Write', 'NotebookEdit'];
/** The Jira connector only calls the connector's tools: nothing local, no subagents. */
const CONNECTOR_EXTRA = ['Bash', 'Read', 'Glob', 'Grep', 'Task', 'Agent'];

export function buildStageJson(input: StageConfigInput): StageJson {
  const disallowed = [...ALWAYS_DISALLOWED];
  // Only a stage with a read-write workspace may edit files; a read-only or workspace-less stage has nothing it may change.
  if (STAGE_WORKSPACE[input.stage] !== 'rw') disallowed.push(...READ_ONLY_EXTRA);
  if (input.stage === 'jiraConnector') disallowed.push(...CONNECTOR_EXTRA);

  const json: StageJson = {
    model: input.modelAliases[input.modelAlias],
    maxTurns: input.maxTurns,
    disallowedTools: disallowed,
    attempt: input.attempt ?? 1,
    round: input.round ?? 0,
    ...(input.resumeSession ? { resumeSession: input.resumeSession } : {}),
    ...(input.thinkingTokens ? { thinkingTokens: input.thinkingTokens } : {}),
    ...(input.stage === 'jiraConnector' ? { connector: { serverName: input.connectorServer ?? 'Atlassian' } } : {}),
  };
  return json;
}

const OUR_CLAUDE_MD_MODES: readonly ClaudeMdMode[] = ['ours', 'both'];

/** `system.md` includes our default CLAUDE.md in modes ours and both. */
export const includesOurClaudeMd = (mode: ClaudeMdMode): boolean => OUR_CLAUDE_MD_MODES.includes(mode);

/** Only mode `ours` hides the repository's own CLAUDE.md (an empty file is bind-mounted over it). */
export const hidesRepoClaudeMd = (mode: ClaudeMdMode): boolean => mode === 'ours';

export const CLAUDE_MD_FILES = ['CLAUDE.md', 'CLAUDE.local.md'] as const;
