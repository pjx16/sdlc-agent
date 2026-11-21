/** How a project reaches GitHub: with the personal token saved in Settings, or as the sdlc-agent GitHub App's bot through the token broker. */
export const GITHUB_AUTHS = ['token', 'bot'] as const;
export type GithubAuth = (typeof GITHUB_AUTHS)[number];

export const PROJECT_STACKS = ['ts_node', 'nestjs', 'nextjs'] as const;
export type ProjectStack = (typeof PROJECT_STACKS)[number];

export const CLAUDE_MD_MODES = ['ours', 'theirs', 'both'] as const;
export type ClaudeMdMode = (typeof CLAUDE_MD_MODES)[number];

/**
 * How a project reaches Jira. `rest` and `mcp` are plain code and cost no Claude tokens; `connector` has a Claude agent drive the Jira
 * connector added in claude.ai, for organisations that allow nothing else, and costs Claude tokens on every Jira call.
 */
export const JIRA_MODES = ['rest', 'mcp', 'connector', 'off'] as const;
export type JiraMode = (typeof JIRA_MODES)[number];

export interface JiraModeInfo {
  label: string;
  description: string;
  /** Every Jira call runs a Claude agent. */
  usesClaudeTokens: boolean;
  recommended: boolean;
}

export const JIRA_MODE_INFO: Record<JiraMode, JiraModeInfo> = {
  rest: { label: 'REST API', description: 'Jira Cloud REST API with an API token. No Claude tokens.', usesClaudeTokens: false, recommended: true },
  mcp: { label: 'Atlassian Rovo MCP', description: 'The Atlassian Rovo MCP server, called by code. Sign in with OAuth or a scoped API token. No Claude tokens.', usesClaudeTokens: false, recommended: false },
  connector: { label: 'Claude Jira connector', description: 'A Claude agent drives the Jira connector added in claude.ai. Uses Claude tokens on every Jira call; for organisations that allow nothing else.', usesClaudeTokens: true, recommended: false },
  off: { label: 'Off', description: 'No Jira: tickets are pasted in the dashboard.', usesClaudeTokens: false, recommended: false },
};

/** True when the project talks to Jira at all. */
export const jiraOn = (mode: string): mode is Exclude<JiraMode, 'off'> => mode === 'rest' || mode === 'mcp' || mode === 'connector';

export const MIRROR_STATUSES = ['pending', 'ok', 'failed'] as const;
export type MirrorStatus = (typeof MIRROR_STATUSES)[number];

export const TICKET_STATUSES = [
  'NEW', 'KB', 'PLANNING', 'AWAITING_PLAN_APPROVAL', 'BREAKDOWN', 'AWAITING_BREAKDOWN_APPROVAL',
  'IN_PROGRESS', 'REVIEW', 'KB_UPDATE', 'AWAITING_CI', 'IN_HUMAN_REVIEW', 'DONE', 'ON_HOLD', 'FAILED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STAGE_NAMES = [
  'kbBuild', 'featureMap', 'solutionDesign', 'bugInvestigation', 'technicalDesign', 'tests', 'implement', 'fix',
  'prReview', 'qualityReview', 'securityReview', 'kbUpdate', 'ciTriage', 'orchestrate', 'assist', 'repoProfile', 'onboardAdvise', 'jiraConnector',
] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export const MODEL_ALIASES = ['haiku', 'sonnet', 'opus'] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];
