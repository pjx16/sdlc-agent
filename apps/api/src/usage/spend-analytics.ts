import { budgetPeriod, type BudgetPeriod } from '@sdlc/shared';

/** Pure calculations behind the usage page, in credits (1 credit = 1 USD of Anthropic credit balance). No database here. */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CostedRun {
  startedAt: Date;
  costUsd: number;
}

export interface SpendBucket {
  /** Start of the bucket (local hour or local day of the timezone). */
  at: string;
  credits: number;
  /** Credits from the start of the range up to the end of this bucket. */
  cumulative: number;
}

/** How far `timeZone` is ahead of UTC at `at`, in milliseconds. */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')) - Math.floor(at.getTime() / 1000) * 1000;
}

/** Bucket starts from `from` to `to`: local hours, or local days (which can be 23 or 25 hours long around a DST change). */
export function bucketStarts(from: Date, to: Date, unit: 'hour' | 'day', timeZone: string): Date[] {
  const starts: Date[] = [];
  if (unit === 'hour') {
    const off = offsetMs(from, timeZone);
    let t = Math.floor((from.getTime() + off) / HOUR_MS) * HOUR_MS - off;
    for (; t < to.getTime(); t += HOUR_MS) starts.push(new Date(t));
    return starts;
  }
  let t = budgetPeriod('daily', from, timeZone).start;
  while (t.getTime() < to.getTime()) {
    starts.push(t);
    // Midday of the day keeps clear of the DST hour when finding the next local midnight.
    t = budgetPeriod('daily', new Date(t.getTime() + DAY_MS / 2), timeZone).end;
  }
  return starts;
}

/** Credits per local hour or day between `from` and `to`, with a running total. */
export function bucketSpend(runs: CostedRun[], from: Date, to: Date, unit: 'hour' | 'day', timeZone: string): SpendBucket[] {
  const starts = bucketStarts(from, to, unit, timeZone);
  const sums = starts.map(() => 0);
  for (const r of runs) {
    const t = r.startedAt.getTime();
    if (t < from.getTime() || t >= to.getTime()) continue;
    let i = starts.length - 1;
    while (i > 0 && (starts[i] as Date).getTime() > t) i--;
    sums[i] = (sums[i] ?? 0) + r.costUsd;
  }
  let total = 0;
  return starts.map((s, i) => {
    total += sums[i] ?? 0;
    return { at: s.toISOString(), credits: round2(sums[i] ?? 0), cumulative: round2(total) };
  });
}

export interface PeriodBurn {
  period: BudgetPeriod;
  unit: 'hour' | 'day';
  start: string;
  end: string;
  budget: number | null;
  spent: number;
  /** At the average rate of the period so far, what the period ends at. Null before any spend. */
  projectedAtEnd: number | null;
  /** At that rate, when the budget is used up within the period (now if it already is); null when it is not. */
  reachesBudgetAt: string | null;
  buckets: SpendBucket[];
}

/** The current day (by hour), week or month (by day): spend so far, and where it is heading. */
export function periodBurn(runs: CostedRun[], period: BudgetPeriod, budget: number | null, now: Date, timeZone: string): PeriodBurn {
  const { start, end } = budgetPeriod(period, now, timeZone);
  const unit = period === 'daily' ? 'hour' : 'day';
  const buckets = bucketSpend(runs, start, end, unit, timeZone);
  const spent = round2(runs.filter((r) => r.startedAt >= start && r.startedAt < end).reduce((n, r) => n + r.costUsd, 0));
  const elapsed = Math.max(now.getTime() - start.getTime(), 1);
  const ratePerMs = spent / elapsed;
  const projectedAtEnd = spent > 0 ? round2(ratePerMs * (end.getTime() - start.getTime())) : null;
  let reachesBudgetAt: string | null = null;
  if (budget !== null && spent >= budget) reachesBudgetAt = now.toISOString();
  else if (budget !== null && ratePerMs > 0) {
    const at = now.getTime() + (budget - spent) / ratePerMs;
    if (at < end.getTime()) reachesBudgetAt = new Date(at).toISOString();
  }
  return { period, unit, start: start.toISOString(), end: end.toISOString(), budget, spent, projectedAtEnd, reachesBudgetAt, buckets };
}

export interface MonthProjection {
  monthToDate: number;
  /** Average credits per day over the last 7 days. */
  avgDaily: number;
  daysLeft: number;
  /** Month to date plus the 7-day average for every day left. */
  projected: number;
  budget: number | null;
  /** When the monthly budget is used up at the 7-day average (now if it already is), or null when not this month. */
  reachesBudgetAt: string | null;
}

export function monthProjection(i: { monthToDate: number; last7Days: number; budget: number | null; now: Date; timeZone: string }): MonthProjection {
  const { end } = budgetPeriod('monthly', i.now, i.timeZone);
  const avgDaily = i.last7Days / 7;
  const daysLeft = Math.max(0, (end.getTime() - i.now.getTime()) / DAY_MS);
  let reachesBudgetAt: string | null = null;
  if (i.budget !== null && i.monthToDate >= i.budget) reachesBudgetAt = i.now.toISOString();
  else if (i.budget !== null && avgDaily > 0) {
    const at = i.now.getTime() + ((i.budget - i.monthToDate) / avgDaily) * DAY_MS;
    if (at < end.getTime()) reachesBudgetAt = new Date(at).toISOString();
  }
  return { monthToDate: round2(i.monthToDate), avgDaily: round2(avgDaily), daysLeft: Math.round(daysLeft * 10) / 10, projected: round2(i.monthToDate + avgDaily * daysLeft), budget: i.budget, reachesBudgetAt };
}

export interface TicketCost {
  id: string;
  key: string;
  title: string;
  kind: string;
  credits: number;
}

export interface TicketCosts {
  tickets: number;
  avgCredits: number | null;
  byKind: { kind: string; tickets: number; avgCredits: number }[];
  /** The five most expensive. */
  top: TicketCost[];
}

/** Average credits per finished ticket, overall and per kind (feature, bug, chore), and the most expensive ones. */
export function ticketCosts(tickets: TicketCost[]): TicketCosts {
  const kinds = new Map<string, number[]>();
  for (const t of tickets) kinds.set(t.kind, [...(kinds.get(t.kind) ?? []), t.credits]);
  const avg = (xs: number[]) => round2(xs.reduce((n, x) => n + x, 0) / xs.length);
  return {
    tickets: tickets.length,
    avgCredits: tickets.length ? avg(tickets.map((t) => t.credits)) : null,
    byKind: [...kinds.entries()].map(([kind, xs]) => ({ kind, tickets: xs.length, avgCredits: avg(xs) })).sort((a, b) => b.avgCredits - a.avgCredits),
    top: [...tickets].sort((a, b) => b.credits - a.credits).slice(0, 5).map((t) => ({ ...t, credits: round2(t.credits) })),
  };
}
