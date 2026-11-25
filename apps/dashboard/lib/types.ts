import type { OnboardingProgress, OnboardingProposal, OnboardingStatus, ProjectInput, ProjectSettings } from '@sdlc/shared';

/** A project as returned by the API. */
export type ProjectView = Omit<ProjectInput, 'settings' | 'jiraProjectKey' | 'jiraJql' | 'githubAuth'> & {
  /** token: the personal token from Settings. bot: sdlc-agent-bot through the token broker. Missing means token. */
  githubAuth?: 'token' | 'bot';
  jiraProjectKey?: string;
  jiraJql?: string;
  id: string;
  mirrorStatus: 'pending' | 'ok' | 'failed';
  mirrorError: string | null;
  onboardingStatus?: OnboardingStatus;
  onboardingError?: string | null;
  nextLocalNumber: number;
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
};

/** GlobalSettings as returned by GET /system and PATCH /system/settings. */
export interface GlobalSettingsView {
  /** Spend budgets in credits (1 credit = 1 USD of Anthropic credit balance); null means no limit. */
  budgetDailyCredits: number | null;
  budgetWeeklyCredits: number | null;
  budgetMonthlyCredits: number | null;
  budgetWarnPct: number;
  /** IANA timezone the budget days, weeks and months are counted in. */
  timezone: string;
  pollIntervalSec: number;
  stageTimeoutMin: number;
  verifyTimeoutSec: number;
  workspaceRetentionDays: number;
  logRetentionDays: number;
  assistantTokenCap: number;
  stageDefaults: Record<string, { model: 'haiku' | 'sonnet' | 'opus'; maxTurns: number }>;
  modelAliases: { haiku: string; sonnet: string; opus: string };
  pipelinePaused: boolean;
  pausedReason: string | null;
  pausedCode?: string | null;
  resetsAt: string | null;
  usageIgnoredUntil: string | null;
  /** Null until the budgets are approved (or "no limits" is chosen): the dashboard asks. */
  budgetsApprovedAt: string | null;
  intakePaused: boolean;
  intakeJiraEnabled?: boolean;
  intakeGithubEnabled?: boolean;
  intakePasteEnabled?: boolean;
}

export type BudgetPeriodName = 'daily' | 'weekly' | 'monthly';

export interface BudgetPeriodView {
  period: BudgetPeriodName;
  spent: number;
  budget: number | null;
  pct: number | null;
  resetsAt: string;
}

/** GET /system → spend: the current day, week and month against the budgets. */
export interface SpendView {
  timezone: string;
  warnPct: number;
  periods: BudgetPeriodView[];
  /** What the approval banner suggests, from the last 30 days of spend (or defaults with none). */
  suggested: Record<BudgetPeriodName, number>;
}

export interface SpendBucketView {
  at: string;
  credits: number;
  cumulative: number;
}

export interface PeriodBurnView {
  period: BudgetPeriodName;
  unit: 'hour' | 'day';
  start: string;
  end: string;
  budget: number | null;
  spent: number;
  projectedAtEnd: number | null;
  reachesBudgetAt: string | null;
  buckets: SpendBucketView[];
}

export interface MonthProjectionView {
  monthToDate: number;
  avgDaily: number;
  daysLeft: number;
  projected: number;
  budget: number | null;
  reachesBudgetAt: string | null;
}

/** GET /usage/spend */
export interface SpendOverviewView {
  timezone: string;
  warnPct: number;
  periods: BudgetPeriodView[];
  projection: MonthProjectionView;
  burn: Record<BudgetPeriodName, PeriodBurnView>;
}

/** GET /usage/tickets: credits per ticket finished in the last `days` days. */
export interface TicketCostsView {
  days: number;
  tickets: number;
  avgCredits: number | null;
  byKind: { kind: string; tickets: number; avgCredits: number }[];
  top: { id: string; key: string; title: string; kind: string; credits: number }[];
}

export interface IntakeStatusView {
  mode: 'rest' | 'mcp' | 'connector';
  at: string | null;
  projects: number;
  waiting: number;
  created: number;
  seen: number;
  error: string | null;
  skipped: string | null;
}

/** What the worker last reported; `online` comes from its heartbeat. */
export interface WorkerStatusView {
  online: boolean;
  state: 'idle' | 'busy' | 'stalled' | 'offline';
  phase: string;
  phaseDetail: string | null;
  phaseSince: string | null;
  startedAt: string | null;
  pid: number | null;
  version: string | null;
  restartingRepeatedly: boolean;
  heartbeatAt: string;
  tickOutcome: string;
  tickDetail: string | null;
  agentImageError?: string | null;
  intake: IntakeStatusView[];
}

export interface RecentEvent {
  id: string;
  at: string;
  type: string;
  message: string;
  ticketId: string | null;
  ticketKey: string | null;
}

export interface SystemView {
  settings: GlobalSettingsView;
  worker?: WorkerStatusView | null;
  recentEvents?: RecentEvent[];
  inboxBadge?: number;
  inboxFyi?: number;
  onboarding?: { projectId: string; name: string; status: 'profiling' | 'proposed' }[];
  runningStage: { id: string; stage: string; model: string; projectId: string; ticketId: string | null; startedAt: string | null } | null;
  spend: SpendView;
}

export interface UsageSummaryView {
  /** Tokens (input + output + cache write) and credits per stage and model, last 30 days, most credits first. */
  rows: { stage: string; model: string; tokens: number; credits: number; runs: number }[];
}

export interface TicketListItem {
  id: string;
  projectId: string;
  projectName: string;
  key: string;
  source: 'jira' | 'paste' | 'github';
  type: 'story' | 'bug' | 'tech';
  title: string;
  status: string;
  holdReason: string | null;
  holdFromStatus: string | null;
  updatedAt: string;
}

export interface TransitionView {
  id: string;
  at: string;
  fromStatus: string;
  toStatus: string;
  actor: string;
  reason: string | null;
  stageRunId: string | null;
  kind?: string;
  note?: string | null;
  jiraStatusApplied: string | null;
  jiraSyncResult: 'none' | 'applied' | 'failed';
  jiraSyncError: string | null;
}

export interface TicketEventView {
  id: string;
  at: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  type: string;
  message: string;
  errorCode: string | null;
  stageRunId: string | null;
  subtaskId: string | null;
}

export interface OperationsView {
  worker: { state: 'idle' | 'busy' | 'stalled' | 'offline' | 'unknown'; phase: string | null; phaseDetail: string | null; phaseSince: string | null; uptimeSec: number | null; restarts24h: number; queueDepth: number };
  stuck: { id: string; key: string; status: string; since: string; minutes: number; why: string }[];
  failures: Record<'last24h' | 'last7d', { byStage: { stage: string; runs: number; failed: number; rate: number; byCode: Record<string, number> }[]; byCode: { code: string; count: number }[] }>;
  load: { stage: string; runs: number; retries: number; loops: number; avgDurationSec: number; avgTokens: number; avgCostUsd: number }[];
  integrations: { source: string; total: number; errors: number; rate: number }[];
  recentErrors: { id: string; at: string; source: string; message: string; errorCode: string | null; ticketId: string | null; ticketKey: string | null }[];
  orchestrator: { decisions: number; fallbacks: number; fallbackRate: number; costUsd: number; inputTokens: number; outputTokens: number };
}

export interface ModelUsageView {
  from: string;
  to: string;
  models: {
    model: string; runs: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; tokenShare: number; costShare: number;
    byStage: { stage: string; runs: number; tokens: number; costUsd: number }[];
    perDay: { day: string; tokens: number; costUsd: number; runs: number }[];
  }[];
}

export interface RunView {
  id: string;
  stage: string;
  model: string;
  attempt: number;
  round: number;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd: number;
  numTurns: number;
  error: string | null;
  errorCode?: string | null;
  errorSource?: string | null;
  retryAt?: string | null;
  /** Set when a rerun made the run obsolete: it is kept and shown greyed out. */
  supersededAt?: string | null;
  /** auto | user | orchestrator */
  trigger?: string;
  startSha?: string | null;
  endSha?: string | null;
}

export interface TicketDetail extends TicketListItem {
  body: string;
  featureKey: string | null;
  /** KB docs attached to the ticket; every stage keeps them in its context. */
  kbAttachments?: string[];
  externalKey: string | null;
  branch: string | null;
  prUrl: string | null;
  createdAt: string;
  stageRuns: RunView[];
}

export interface TicketWithPlan extends TicketDetail {
  planMarkdown: string | null;
}

export interface GuidelineNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: GuidelineNode[];
}

export interface SubtaskRow {
  id: string;
  seq: number;
  title: string;
  description: string;
  status: string;
  fixRounds: number;
  acceptanceCriteria: string[];
  files: string[];
  dependsOn: number[];
}

export interface TicketFull extends TicketWithPlan {
  /** The plan as committed to the repository (a GitHub link), once it is on the ticket's branch. */
  planFileUrl?: string | null;
  breakdownDraft: import('@sdlc/shared').SubtaskDraft[] | null;
  subtasks: SubtaskRow[];
  maxSubtasks: number;
  /** Changed lines of the branch against the base, and the project's limits for it. */
  prDiffLines?: number | null;
  prSoftLines?: number;
  prHardLines?: number;
}

export type SupportKindView = 'approval' | 'question' | 'open_question' | 'hold' | 'ci_infra' | 'onboarding' | 'credential' | 'pr_ready';
export type InboxGroupView = 'blocking' | 'approvals' | 'questions' | 'fyi';

export interface OpenQuestionView {
  id: string;
  title: string;
  body: string;
  defaultAnswer: string | null;
  response: string | null;
}

export interface SupportTicketView {
  id: string;
  kind: SupportKindView;
  title: string;
  body: string;
  priority: 'blocking' | 'normal' | 'fyi';
  status: 'open' | 'answered' | 'resolved' | 'dismissed';
  group: InboxGroupView;
  projectId: string | null;
  ticketId: string | null;
  ticketKey: string | null;
  ticketTitle: string | null;
  ticketPrUrl?: string | null;
  stage: string;
  defaultAnswer: string | null;
  response: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
  actions: string[];
  /** On a plan approval: the questions to answer before approving. */
  openQuestions?: OpenQuestionView[];
}

export interface AssistantView {
  canSend: boolean;
  blockedReason: string | null;
  pending: boolean;
  tokens: number;
  tokenCap: number;
  capReached: boolean;
  messages: {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    at: string;
    draft: { kind: 'answer' | 'plan_edit' | 'rerun_note'; text: string; appliedAt: string | null; diff: string | null } | null;
  }[];
}

export interface OnboardingView {
  status: OnboardingStatus;
  error: string | null;
  proposal: OnboardingProposal | null;
  progress?: OnboardingProgress | null;
}

export interface DryRunView {
  jql: string;
  count: number;
  tickets: { key: string; summary: string; issueType: string }[];
  note: string | null;
}

export interface MoveView {
  kind: 'advance' | 'rerun' | 'hold' | 'resume' | 'fail' | 'retry' | 'approve' | 'reject';
  to: string;
  label: string;
}

export interface ArtifactView {
  id: string;
  stage: string;
  version: number;
  data: unknown;
  stale: boolean;
  supersededAt: string | null;
  stageRunId: string | null;
  createdAt: string;
}

export interface DecisionView {
  id: string;
  at: string;
  point: string;
  question: string;
  options: { kind: string; to: string; label: string }[];
  chosen: string;
  reason: string;
  fallbackUsed: boolean;
  model: string | null;
  costUsd: number;
}

export interface InboxCountsView {
  badge: number;
  groups: Record<InboxGroupView, number>;
}

export type MetricsRange = '24h' | '7d' | '30d';

export interface MetricsSummary {
  range: MetricsRange;
  ticketsDone: number;
  firstPassRate: number | null;
  /** Credits spent today, in the timezone from Settings. */
  creditsToday: number;
  queueLength: number;
}

/** GET /metrics/usage: credits per local hour (24h) or day (7d, 30d), and the pauses in range. */
export interface MetricsUsage {
  range: MetricsRange;
  timezone: string;
  unit: 'hour' | 'day';
  series: SpendBucketView[];
  pauses: { at: string; message: string }[];
}

export interface MetricsTokens {
  range: MetricsRange;
  groupBy: 'stage' | 'model';
  keys: string[];
  days: { day: string; total: number; groups: Record<string, number> }[];
}

export interface MetricsMerged {
  range: MetricsRange;
  days: { day: string; merged: number; additions: number; deletions: number }[];
  totals: { merged: number; additions: number; deletions: number; withoutLineData: number };
}

export interface MetricsQuality {
  range: MetricsRange;
  firstPassRate: number | null;
  avgFixRounds: number | null;
  avgReviewRounds: number | null;
  findingsBySeverity: { severity: string; count: number }[];
}

export interface MetricsDurations {
  range: MetricsRange;
  stages: { stage: string; runs: number; medianSeconds: number }[];
}

export interface StateCount {
  status: string;
  count: number;
}

/** GET /tickets/:id/hold: what happened to a held or failed ticket. */
export interface HoldInfo {
  status: string;
  holdReason: string | null;
  holdFromStatus: string | null;
  note: string | null;
  at: string | null;
  failedRun: { id: string; stage: string; attempt: number; round: number; error: string | null } | null;
  subtask: { seq: number; title: string; status: string; fixRounds: number } | null;
  canRedoTests: boolean;
}
