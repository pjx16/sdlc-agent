import { describe, expect, it } from 'vitest';
import { budgetPauseReason, budgetPeriod, evaluateBudgets, isValidTimeZone } from './budgets';

const iso = (d: Date) => d.toISOString();

describe('budgetPeriod', () => {
  it('counts the day, the week (from Monday) and the month in the given timezone', () => {
    // Saturday 22 Nov 2026, 01:00 in Kolkata (UTC+5:30) is still Friday 21 Nov in UTC.
    const now = new Date('2026-11-21T19:30:00Z');
    expect(budgetPeriod('daily', now, 'Asia/Kolkata')).toEqual({ start: new Date('2026-11-21T18:30:00Z'), end: new Date('2026-11-22T18:30:00Z') });
    expect(budgetPeriod('weekly', now, 'Asia/Kolkata')).toEqual({ start: new Date('2026-11-15T18:30:00Z'), end: new Date('2026-11-22T18:30:00Z') });
    expect(budgetPeriod('monthly', now, 'Asia/Kolkata')).toEqual({ start: new Date('2026-10-31T18:30:00Z'), end: new Date('2026-11-30T18:30:00Z') });
    expect(iso(budgetPeriod('daily', now, 'UTC').start)).toBe('2026-11-21T00:00:00.000Z');
  });

  it('rolls over the year and handles a DST change', () => {
    expect(budgetPeriod('monthly', new Date('2026-12-15T12:00:00Z'), 'UTC').end).toEqual(new Date('2027-01-01T00:00:00Z'));
    // New York leaves DST on 1 Nov 2026: the day is 25 hours long.
    const day = budgetPeriod('daily', new Date('2026-11-01T12:00:00Z'), 'America/New_York');
    expect(day).toEqual({ start: new Date('2026-11-01T04:00:00Z'), end: new Date('2026-11-02T05:00:00Z') });
  });

  it('a Sunday belongs to the week that started on Monday', () => {
    expect(budgetPeriod('weekly', new Date('2026-11-22T12:00:00Z'), 'UTC').start).toEqual(new Date('2026-11-16T00:00:00Z'));
    expect(budgetPeriod('weekly', new Date('2026-11-23T00:00:00Z'), 'UTC').start).toEqual(new Date('2026-11-23T00:00:00Z'));
  });
});

describe('evaluateBudgets', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const base = { now, timeZone: 'UTC', warnPct: 80 };

  it('reaches a budget at 100%, warns from the warning level, and ignores periods with no budget', () => {
    const d = evaluateBudgets({ ...base, spend: { daily: 10, weekly: 41, monthly: 60 }, budgets: { daily: 10, weekly: 50, monthly: null } });
    expect(d.reached.map((s) => s.period)).toEqual(['daily']);
    expect(d.warnings.map((s) => s.period)).toEqual(['weekly']);
    expect(d.statuses[2]).toMatchObject({ period: 'monthly', pct: null });
    expect(d.resumeAt).toEqual(new Date('2026-11-22T00:00:00Z'));
  });

  it('resumes only when every used-up budget has reset', () => {
    const d = evaluateBudgets({ ...base, spend: { daily: 12, weekly: 12, monthly: 200 }, budgets: { daily: 10, weekly: null, monthly: 150 } });
    expect(d.resumeAt).toEqual(new Date('2026-12-01T00:00:00Z'));
    expect(budgetPauseReason(d.reached)).toBe('The daily budget of 10 credits is used up (12 spent); The monthly budget of 150 credits is used up (200 spent)');
  });

  it('with no budgets nothing is reached', () => {
    const d = evaluateBudgets({ ...base, spend: { daily: 999, weekly: 999, monthly: 999 }, budgets: { daily: null, weekly: null, monthly: null } });
    expect(d).toMatchObject({ reached: [], warnings: [], resumeAt: null });
  });
});

it('isValidTimeZone', () => {
  expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
  expect(isValidTimeZone('Mars/Base')).toBe(false);
});
