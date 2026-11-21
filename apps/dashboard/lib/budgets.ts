import type { BudgetPeriodName, SystemView } from './types';

/** 1 credit = 1 USD of Anthropic credit balance. Shown as credits, so no currency is implied. */
export const formatCredits = (n: number | null): string => (n === null ? '—' : `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} credits`);

export const PERIOD_LABEL: Record<BudgetPeriodName, string> = { daily: 'Today', weekly: 'This week', monthly: 'This month' };
export const PERIOD_NOUN: Record<BudgetPeriodName, string> = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' };

export interface BudgetWarning {
  text: string;
}

/**
 * The heads-up banner: a budget is at or above the warning level but not used up yet. It pauses nothing; the pipeline stops only
 * when a budget is used up (then the pause banner speaks).
 */
export function budgetWarning(system: SystemView | null): BudgetWarning | null {
  const spend = system?.spend;
  if (!spend || system.settings.pipelinePaused) return null;
  const near = spend.periods.filter((p) => p.pct !== null && p.pct >= spend.warnPct && p.pct < 100);
  if (near.length === 0) return null;
  return { text: `Spend is nearing a budget: ${near.map((p) => `${PERIOD_NOUN[p.period]} ${Math.round(p.pct as number)}% (${formatCredits(p.spent)} of ${formatCredits(p.budget)})`).join(', ')}.` };
}

/** The approval banner shows until the budgets were approved or "no limits" was chosen. */
export const needsBudgetApproval = (system: SystemView | null): boolean => Boolean(system && system.settings.budgetsApprovedAt === null);

/** The browser's IANA timezone, or UTC when it cannot tell. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
