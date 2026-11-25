import { z } from 'zod';
import { isValidTimeZone } from './budgets';
import { MODEL_ALIASES, STAGE_NAMES } from './enums';
import { ProjectSettingsSchema } from './project-settings';

/** A budget in credits (1 credit = 1 USD of Anthropic credit balance); null means no limit. */
const credits = () => z.number({ error: 'must be a number' }).positive('must be more than 0').max(1_000_000, 'must be at most 1000000').nullable().default(null);

const int = (def: number, min: number, max: number) =>
  z.number({ error: 'must be a number' }).int('must be a whole number').min(min, `must be at least ${min}`).max(max, `must be at most ${max}`).default(def);

/** The model and turn limit a new project starts with for each stage. A project can override them under Advanced. */
const builtInStages = ProjectSettingsSchema.parse({}).stages;
const stageDefault = (stage: (typeof STAGE_NAMES)[number]) =>
  z
    .object({
      model: z.enum(MODEL_ALIASES),
      maxTurns: z.number({ error: 'must be a number' }).int('must be a whole number').min(1, 'must be at least 1').max(200, 'must be at most 200'),
    })
    .prefault({ model: builtInStages[stage].model, maxTurns: builtInStages[stage].maxTurns });

/** The user-editable part of GlobalSettings (pause state and budget-gate bookkeeping have their own endpoints). */
export const GlobalSettingsSchema = z.object({
  budgetDailyCredits: credits(),
  budgetWeeklyCredits: credits(),
  budgetMonthlyCredits: credits(),
  /** The dashboard warns when a budget is this far used. */
  budgetWarnPct: int(80, 1, 100),
  /** Which sources the intake takes tickets from. The intake switch pauses all of them; these switch one off. */
  intakeJiraEnabled: z.boolean({ error: 'must be true or false' }).default(true),
  intakeGithubEnabled: z.boolean({ error: 'must be true or false' }).default(true),
  intakePasteEnabled: z.boolean({ error: 'must be true or false' }).default(true),
  /** Budget days, weeks (from Monday) and months are counted in this IANA timezone. */
  timezone: z.string().trim().refine(isValidTimeZone, 'must be an IANA timezone like Asia/Kolkata').default('UTC'),
  pollIntervalSec: int(120, 5, 3600),
  stageTimeoutMin: int(20, 1, 240),
  verifyTimeoutSec: int(600, 10, 7200),
  workspaceRetentionDays: int(7, 1, 365),
  logRetentionDays: int(30, 1, 3650),
  /** Tokens (input and output) one assistant conversation may use before it stops. */
  assistantTokenCap: int(200_000, 1000, 10_000_000),
  stageDefaults: z.object(Object.fromEntries(STAGE_NAMES.map((s) => [s, stageDefault(s)])) as Record<(typeof STAGE_NAMES)[number], ReturnType<typeof stageDefault>>).prefault({}),
  modelAliases: z
    .object(Object.fromEntries(MODEL_ALIASES.map((m) => [m, z.string().trim().min(1, 'required').default(m)])) as Record<(typeof MODEL_ALIASES)[number], z.ZodDefault<z.ZodString>>)
    .prefault({}),
});

export type GlobalSettingsInput = z.infer<typeof GlobalSettingsSchema>;
export const DEFAULT_GLOBAL_SETTINGS: GlobalSettingsInput = GlobalSettingsSchema.parse({});
