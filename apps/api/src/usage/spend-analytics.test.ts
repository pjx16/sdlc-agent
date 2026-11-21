import { describe, expect, it } from 'vitest';
import { bucketSpend, bucketStarts, monthProjection, periodBurn, ticketCosts } from './spend-analytics';

const run = (iso: string, costUsd: number) => ({ startedAt: new Date(iso), costUsd });

describe('bucketSpend', () => {
  it('buckets by local hour, with a running total', () => {
    const from = new Date('2026-11-21T18:30:00Z'); // midnight in Kolkata
    const to = new Date('2026-11-21T21:30:00Z');
    const b = bucketSpend([run('2026-11-21T18:45:00Z', 1), run('2026-11-21T19:10:00Z', 0.5), run('2026-11-21T19:20:00Z', 0.25), run('2026-11-21T22:00:00Z', 9)], from, to, 'hour', 'Asia/Kolkata');
    expect(b).toEqual([
      { at: '2026-11-21T18:30:00.000Z', credits: 1.75, cumulative: 1.75 },
      { at: '2026-11-21T19:30:00.000Z', credits: 0, cumulative: 1.75 },
      { at: '2026-11-21T20:30:00.000Z', credits: 0, cumulative: 1.75 },
    ]);
  });

  it('local days follow the timezone, including a 25-hour day', () => {
    const starts = bucketStarts(new Date('2026-10-31T04:00:00Z'), new Date('2026-11-03T05:00:00Z'), 'day', 'America/New_York');
    expect(starts.map((d) => d.toISOString())).toEqual(['2026-10-31T04:00:00.000Z', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z']);
  });
});

describe('periodBurn', () => {
  it('projects the period end at the rate so far, and when the budget is reached', () => {
    const now = new Date('2026-11-21T06:00:00Z'); // a quarter of the UTC day
    const b = periodBurn([run('2026-11-21T01:00:00Z', 2), run('2026-11-20T23:00:00Z', 50)], 'daily', 6, now, 'UTC');
    expect(b).toMatchObject({ unit: 'hour', spent: 2, projectedAtEnd: 8, reachesBudgetAt: '2026-11-21T18:00:00.000Z', start: '2026-11-21T00:00:00.000Z' });
    expect(b.buckets).toHaveLength(24);
    expect(periodBurn([], 'monthly', 100, now, 'UTC')).toMatchObject({ unit: 'day', spent: 0, projectedAtEnd: null, reachesBudgetAt: null });
    expect(periodBurn([run('2026-11-21T01:00:00Z', 7)], 'daily', 6, now, 'UTC').reachesBudgetAt).toBe(now.toISOString());
  });
});

describe('monthProjection', () => {
  const now = new Date('2026-11-21T00:00:00Z'); // 10 days left in November
  it('adds the 7-day average for each day left', () => {
    expect(monthProjection({ monthToDate: 40, last7Days: 14, budget: 100, now, timeZone: 'UTC' })).toEqual({ monthToDate: 40, avgDaily: 2, daysLeft: 10, projected: 60, budget: 100, reachesBudgetAt: null });
  });
  it('says when the budget is reached this month, or that it already is', () => {
    expect(monthProjection({ monthToDate: 40, last7Days: 70, budget: 100, now, timeZone: 'UTC' }).reachesBudgetAt).toBe('2026-11-27T00:00:00.000Z');
    expect(monthProjection({ monthToDate: 120, last7Days: 0, budget: 100, now, timeZone: 'UTC' }).reachesBudgetAt).toBe(now.toISOString());
  });
});

describe('ticketCosts', () => {
  it('averages per kind and lists the most expensive first', () => {
    const t = (id: string, kind: string, credits: number) => ({ id, key: id, title: id, kind, credits });
    expect(ticketCosts([t('A', 'feature', 4), t('B', 'feature', 2), t('C', 'bug', 1)])).toEqual({
      tickets: 3,
      avgCredits: 2.33,
      byKind: [{ kind: 'feature', tickets: 2, avgCredits: 3 }, { kind: 'bug', tickets: 1, avgCredits: 1 }],
      top: [t('A', 'feature', 4), t('B', 'feature', 2), t('C', 'bug', 1)],
    });
    expect(ticketCosts([])).toEqual({ tickets: 0, avgCredits: null, byKind: [], top: [] });
  });
});
