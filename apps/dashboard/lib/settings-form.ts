import { STAGE_NAMES } from '@sdlc/shared';
import { stringifyNumbers, toNumber, type FormValues } from './form';
import type { GlobalSettingsView } from './types';

const BUDGET_PATHS = ['budgetDailyCredits', 'budgetWeeklyCredits', 'budgetMonthlyCredits'] as const;
const NUMERIC_PATHS = [
  ...BUDGET_PATHS, 'budgetWarnPct', 'pollIntervalSec',
  'stageTimeoutMin', 'verifyTimeoutSec', 'onboardingTimeoutMin', 'workspaceRetentionDays', 'logRetentionDays', 'assistantTokenCap',
] as const;

/** Where tickets come from, and what to do about a GitHub issue: choices about how the install is used, which a reset to defaults leaves alone. */
export const KEPT_BY_RESET = ['intakeGithubEnabled', 'intakeJiraEnabled', 'intakePasteEnabled', 'githubIssueOnCreate', 'githubDefaultAuth'] as const;

/** The part of the settings that the form edits (so the defaults, which have no pause state, can fill it as well). */
export type SettingsFields = Pick<
  GlobalSettingsView,
  'budgetDailyCredits' | 'budgetWeeklyCredits' | 'budgetMonthlyCredits' | 'budgetWarnPct' | 'timezone' | 'pollIntervalSec' | 'stageTimeoutMin' | 'verifyTimeoutSec' | 'onboardingTimeoutMin' | 'workspaceRetentionDays' | 'logRetentionDays' | 'assistantTokenCap' | 'stageDefaults' | 'modelAliases' | 'githubIssueOnCreate' | 'githubDefaultAuth'
> &
  Partial<Pick<GlobalSettingsView, 'intakeJiraEnabled' | 'intakeGithubEnabled' | 'intakePasteEnabled'>>;

export function initialSettingsValues(s: SettingsFields): FormValues {
  return {
    ...stringifyNumbers({
      budgetWarnPct: s.budgetWarnPct,
      pollIntervalSec: s.pollIntervalSec,
      stageTimeoutMin: s.stageTimeoutMin,
      verifyTimeoutSec: s.verifyTimeoutSec,
      onboardingTimeoutMin: s.onboardingTimeoutMin,
      workspaceRetentionDays: s.workspaceRetentionDays,
      logRetentionDays: s.logRetentionDays,
      assistantTokenCap: s.assistantTokenCap,
    }),
    ...Object.fromEntries(BUDGET_PATHS.map((k) => [k, s[k] === null ? '' : String(s[k])])),
    timezone: s.timezone,
    intakeGithubEnabled: s.intakeGithubEnabled ?? true,
    intakeJiraEnabled: s.intakeJiraEnabled ?? true,
    intakePasteEnabled: s.intakePasteEnabled ?? true,
    githubIssueOnCreate: s.githubIssueOnCreate ?? 'ask',
    githubDefaultAuth: s.githubDefaultAuth ?? 'token',
    modelAliases: { ...s.modelAliases },
    stageDefaults: Object.fromEntries(STAGE_NAMES.map((st) => [st, { model: s.stageDefaults?.[st]?.model ?? 'sonnet', maxTurns: String(s.stageDefaults?.[st]?.maxTurns ?? '') }])),
  };
}

/**
 * The body of PATCH /system/settings. An empty budget means "no limit" (null); other empty numbers stay null so the API reports them.
 * With `keys` only those top-level settings are sent, so saving never rewrites what the person did not change.
 */
export function toSettingsPayload(values: FormValues, keys?: readonly string[]): Record<string, unknown> {
  const out: Record<string, any> = { ...values }; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const key of NUMERIC_PATHS) out[key] = toNumber(values[key]);
  const defaults = (values.stageDefaults ?? {}) as Record<string, { model: string; maxTurns: string }>;
  out.stageDefaults = Object.fromEntries(Object.entries(defaults).map(([stage, d]) => [stage, { model: d.model, maxTurns: toNumber(d.maxTurns) }]));
  return keys ? Object.fromEntries(Object.entries(out).filter(([k]) => keys.includes(k))) : out;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The dotted paths of the values that differ (`budgetDailyCredits`, `stageDefaults.plan.model`). */
export function diffPaths(a: unknown, b: unknown, prefix = ''): string[] {
  if (isObject(a) && isObject(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
  return a === b ? [] : [prefix];
}
