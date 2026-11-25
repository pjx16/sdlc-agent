import { z } from 'zod';
import { MODEL_ALIASES, TICKET_STATUSES, type StageName } from './enums';

const modelAlias = z.enum(MODEL_ALIASES);

/** `{ enabled, model, maxTurns }` with the section 7 defaults for that stage. */
function stage(model: (typeof MODEL_ALIASES)[number], maxTurns: number) {
  return z
    .object({
      enabled: z.boolean().default(true),
      model: modelAlias.default(model),
      maxTurns: z.number({ error: 'must be a number' }).int('must be a whole number').min(1, 'must be at least 1').max(200, 'must be at most 200').default(maxTurns),
    })
    .prefault({});
}

const implementStage = z
  .object({
    enabled: z.literal(true, { error: 'The implement stage cannot be disabled' }).default(true),
    model: modelAlias.default('sonnet'),
    maxTurns: z.number({ error: 'must be a number' }).int().min(1, 'must be at least 1').max(200, 'must be at most 200').default(40),
  })
  .prefault({});

const count = (def: number, min: number, max: number) =>
  z.number({ error: 'must be a number' }).int('must be a whole number').min(min, `must be at least ${min}`).max(max, `must be at most ${max}`).default(def);

const statusMapShape = Object.fromEntries(
  TICKET_STATUSES.map((s) => [s, z.string().trim().min(1).nullable().default(null)]),
) as Record<(typeof TICKET_STATUSES)[number], z.ZodDefault<z.ZodNullable<z.ZodString>>>;

const regexString = z.string().min(1).refine((p) => {
  try {
    new RegExp(p);
    return true;
  } catch {
    return false;
  }
}, 'must be a valid regular expression');

export const ProjectSettingsSchema = z.object({
  stages: z
    .object({
      kbBuild: stage('sonnet', 30),
      featureMap: stage('haiku', 8),
      solutionDesign: stage('opus', 15),
      bugInvestigation: stage('opus', 15),
      technicalDesign: stage('sonnet', 10),
      tests: stage('sonnet', 25),
      implement: implementStage,
      fix: stage('sonnet', 15),
      prReview: stage('sonnet', 10),
      qualityReview: stage('haiku', 8),
      securityReview: stage('sonnet', 10),
      kbUpdate: stage('sonnet', 15),
      ciTriage: stage('haiku', 5),
      orchestrate: stage('haiku', 6),
      assist: stage('sonnet', 8),
      repoProfile: stage('sonnet', 25),
      onboardAdvise: stage('haiku', 5),
      jiraConnector: stage('haiku', 8),
    })
    .prefault({}),
  // The plan is the only approval gate: it lists the subtasks, so there is no breakdown gate (settings saved earlier that ask for one are ignored).
  gates: z.object({ plan: z.boolean().default(true), breakdown: z.boolean().default(false) }).prefault({}).transform((g) => ({ plan: g.plan, breakdown: false })),
  // When a step gets stuck, the orchestrator tries to recover a few times before a person is called.
  recovery: z.object({ enabled: z.boolean().default(true), maxAttempts: z.number().int().min(0).max(10).default(3) }).prefault({}),
  intake: z
    .object({
      paste: z.boolean().default(true),
    })
    .prefault({}),
  jiraWriteBack: z
    .object({
      comments: z.boolean().default(true),
      transitions: z.boolean().default(true),
      createSubtasks: z.boolean().default(true),
    })
    .prefault({}),
  jiraSubtaskTypeName: z.string().trim().min(1, 'required').default('Sub-task'),
  /**
   * Connector mode only. `serverName` is the connector's name as Claude Code lists it (`mcp__claude_ai_<serverName>__*`). Each poll runs a
   * Claude agent, so connector projects are polled every `pollIntervalMin` minutes instead of on every worker tick.
   */
  jiraConnector: z
    .object({
      serverName: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be letters, digits, _ or -').default('Atlassian'),
      pollIntervalMin: count(15, 5, 1440),
    })
    .prefault({}),
  /**
   * GitHub as a ticket source. `projects`: the issues on a GitHub Project (v2) board whose Status is `intakeStatus` (recommended: the board
   * shows the pipeline's progress). `issues`: the repository's open issues that carry `label`. Progress is written back: a status column
   * in `projects` mode (`statusMap` maps pipeline states to column names), `sdlc:<state>` labels in `issues` mode.
   */
  github: z
    .object({
      mode: z.enum(['off', 'issues', 'projects']).default('off'),
      label: z.string().trim().min(1, 'required').regex(/^\S+$/, 'must not contain spaces').default('sdlc-agent'),
      project: z.object({ owner: z.string().trim().min(1, 'required'), number: z.number({ error: 'must be a number' }).int().positive() }).nullable().default(null),
      statusField: z.string().trim().min(1, 'required').default('Status'),
      intakeStatus: z.string().trim().min(1, 'required').default('Todo'),
      statusMap: z.record(z.string(), z.string().nullable()).default({}),
    })
    .prefault({}),
  /** What each Jira issue type becomes: feature, bug, chore, or ignore. */
  jiraIssueTypeRouting: z.record(z.string(), z.enum(['feature', 'bug', 'chore', 'ignore'])).default({}),
  /** Where plans are published. Null: plans go to Jira comments. */
  confluence: z.object({ spaceKey: z.string().min(1), parentPageId: z.string().nullable().default(null) }).nullable().default(null),
  jiraStatusMap: z.object(statusMapShape).prefault({}),
  jiraApprovalStatuses: z
    .object({ plan: z.string().trim().min(1).optional(), breakdown: z.string().trim().min(1).optional() })
    .prefault({}),
  pr: z
    .object({
      earlyDraft: z.boolean().default(true),
      ciFixRound: z.boolean().default(true),
      ciTimeoutMin: count(30, 1, 480),
    })
    .prefault({}),
  /** How many times each back-edge may go round for one ticket. Fix and review rounds keep their limits under `limits`. */
  /** Paths and diff lines that bring in the security reviewer: regular expressions, case-insensitive. Empty: the built-in list. */
  securityRiskPatterns: z.array(z.string().min(1).refine((p) => { try { new RegExp(p); return true; } catch { return false; } }, 'must be a valid regular expression')).default([]),
  loopLimits: z
    .object({
      ciFix: count(1, 0, 10),
      userRerun: count(5, 1, 50),
      orchestratorReplan: count(1, 0, 10),
    })
    .prefault({}),
  limits: z
    .object({
      maxSubtasks: count(8, 1, 50),
      maxTestFixRounds: count(2, 0, 10),
      maxReviewRounds: count(2, 0, 10),
      kbDocMaxLines: count(300, 50, 5000),
      reviewMaxDiffLines: count(4000, 100, 100_000),
      // Reviewable pull requests: changed lines (added + deleted, without lockfiles and generated files). Past the soft limit the pipeline
      // records it and tells Jira; past the hard limit it also comments on the PR with a per-commit breakdown and asks you to look.
      prSoftLines: count(600, 50, 100_000),
      prHardLines: count(1500, 50, 100_000),
    })
    .prefault({}),
  verify: z
    .object({
      redInvalidPatterns: z.array(regexString).default(['Cannot find module', 'SyntaxError', 'error TS[0-9]+']),
    })
    .prefault({}),
});

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/** All defaults, as stored when a project is created without explicit settings. */
export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = ProjectSettingsSchema.parse({});

export interface Warning {
  /** Dotted field path the warning belongs to, for display next to the control. */
  field: string;
  message: string;
}

const STAGE_OFF_EFFECTS: Partial<Record<StageName, string>> = {
  solutionDesign: 'A feature ticket skips planning: the ticket body becomes the plan.',
  bugInvestigation: 'A bug ticket skips the investigation: the ticket body becomes the plan.',
  technicalDesign:
    'The ticket runs as one subtask whose description is the plan. Acceptance criteria come from an "Acceptance criteria" section of the ticket if present.',
  tests: 'The coder works from the acceptance criteria alone, and verify-green runs the existing tests and the typecheck only.',
  kbBuild: 'Tickets with no KB doc are planned without one.',
  featureMap: 'The ticket is not matched to a feature: a ticket with no key of its own gets a new feature doc.',
  kbUpdate: 'The KB-update step is skipped.',
  prReview: 'The correctness review is skipped.',
  qualityReview: 'The readability and standards review is skipped.',
  securityReview: 'The security review never runs, even for changes that touch risky code.',
  ciTriage: 'Every CI failure is treated as a code failure.',
  orchestrate: 'Every choice between several moves uses the default move.',
};

/** Stage-dependency warnings shown when a dependent stage is disabled (F2). */
export function stageWarnings(settings: ProjectSettings): Warning[] {
  const warnings: Warning[] = [];
  for (const [name, effect] of Object.entries(STAGE_OFF_EFFECTS)) {
    if (!settings.stages[name as StageName].enabled) warnings.push({ field: `settings.stages.${name}.enabled`, message: effect });
  }
  return warnings;
}
