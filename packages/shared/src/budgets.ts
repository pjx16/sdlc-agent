/**
 * Spend budgets. The pipeline runs on an Anthropic API key and is billed per token, so the owner sets how many credits
 * (1 credit = 1 USD of Anthropic credit balance) it may spend per calendar day, week (Monday to Sunday) and month.
 * Periods are counted in the timezone from Settings, so "today" is the owner's day.
 */

export const BUDGET_PERIODS = ['daily', 'weekly', 'monthly'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export type BudgetAmounts = Record<BudgetPeriod, number | null>;
export type SpendAmounts = Record<BudgetPeriod, number>;

/** Suggested budgets for a new install with no spend history. */
export const DEFAULT_SUGGESTED_BUDGETS: Record<BudgetPeriod, number> = { daily: 10, weekly: 50, monthly: 150 };

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock date and time in `timeZone` at `at`. */
function wallClock(at: Date, timeZone: string): { y: number; m: number; d: number; h: number; min: number; s: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), h: Number(get('hour')) % 24, min: Number(get('minute')), s: Number(get('second')), weekday };
}

/** How far `timeZone` is ahead of UTC at `at`, in milliseconds. */
function offsetMs(at: Date, timeZone: string): number {
  const w = wallClock(at, timeZone);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant of local midnight on a calendar date in `timeZone` (Date.UTC normalises an overflowing day or month). */
function localMidnight(y: number, m: number, d: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetMs(new Date(guess), timeZone);
  // Around a DST change the offset at midnight can differ from the offset at the guess: correct once.
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/** When the current period started, and when the next one starts. */
export function budgetPeriod(period: BudgetPeriod, now: Date, timeZone: string): { start: Date; end: Date } {
  const w = wallClock(now, timeZone);
  if (period === 'daily') return { start: localMidnight(w.y, w.m, w.d, timeZone), end: localMidnight(w.y, w.m, w.d + 1, timeZone) };
  if (period === 'weekly') return { start: localMidnight(w.y, w.m, w.d - w.weekday, timeZone), end: localMidnight(w.y, w.m, w.d - w.weekday + 7, timeZone) };
  return { start: localMidnight(w.y, w.m, 1, timeZone), end: localMidnight(w.y, w.m + 1, 1, timeZone) };
}

export interface BudgetStatus {
  period: BudgetPeriod;
  spent: number;
  budget: number | null;
  /** spent / budget x 100, or null with no budget. */
  pct: number | null;
  resetsAt: Date;
}

export interface BudgetDecision {
  statuses: BudgetStatus[];
  /** The budgets that are used up. */
  reached: BudgetStatus[];
  /** Budgets at or above the warning level that are not used up yet. */
  warnings: BudgetStatus[];
  /** When every used-up budget has reset: the latest reset among them, or null when none is reached. */
  resumeAt: Date | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function evaluateBudgets(i: { spend: SpendAmounts; budgets: BudgetAmounts; warnPct: number; now: Date; timeZone: string }): BudgetDecision {
  const statuses = BUDGET_PERIODS.map((period): BudgetStatus => {
    const budget = i.budgets[period];
    const spent = round2(i.spend[period]);
    return { period, spent, budget, pct: budget ? round2((spent / budget) * 100) : null, resetsAt: budgetPeriod(period, i.now, i.timeZone).end };
  });
  const reached = statuses.filter((s) => s.budget !== null && s.spent >= s.budget);
  const warnings = statuses.filter((s) => s.pct !== null && s.pct >= i.warnPct && !reached.includes(s));
  const resumeAt = reached.length ? new Date(Math.max(...reached.map((s) => s.resetsAt.getTime()))) : null;
  return { statuses, reached, warnings, resumeAt };
}

/** The pause reason for the used-up budgets, in plain words. */
export function budgetPauseReason(reached: BudgetStatus[]): string {
  return reached.map((s) => `The ${s.period} budget of ${s.budget} credits is used up (${s.spent} spent)`).join('; ');
}
