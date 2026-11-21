import { describe, expect, it } from 'vitest';
import { budgetWarning, formatCredits, needsBudgetApproval } from './budgets';
import type { SystemView } from './types';

const system = (periods: { period: 'daily' | 'weekly' | 'monthly'; spent: number; budget: number | null; pct: number | null }[], over: Record<string, unknown> = {}) =>
  ({ settings: { pipelinePaused: false, budgetsApprovedAt: '2026-11-01T00:00:00Z', ...over }, spend: { timezone: 'UTC', warnPct: 80, periods: periods.map((p) => ({ ...p, resetsAt: '2026-11-22T00:00:00Z' })), suggested: { daily: 10, weekly: 50, monthly: 150 } } }) as unknown as SystemView;

describe('budgetWarning', () => {
  it('stays quiet under the warning level and without budgets', () => {
    expect(budgetWarning(system([{ period: 'daily', spent: 7, budget: 10, pct: 70 }, { period: 'weekly', spent: 90, budget: null, pct: null }]))).toBeNull();
  });
  it('warns from the warning level until the budget is used up, with the numbers', () => {
    expect(budgetWarning(system([{ period: 'daily', spent: 8.2, budget: 10, pct: 82 }, { period: 'weekly', spent: 41, budget: 50, pct: 82 }]))?.text).toBe(
      'Spend is nearing a budget: daily 82% (8.20 credits of 10.00 credits), weekly 82% (41.00 credits of 50.00 credits).',
    );
    expect(budgetWarning(system([{ period: 'daily', spent: 10, budget: 10, pct: 100 }]))).toBeNull();
  });
  it('says nothing while paused, or without data', () => {
    expect(budgetWarning(system([{ period: 'daily', spent: 9, budget: 10, pct: 90 }], { pipelinePaused: true }))).toBeNull();
    expect(budgetWarning(null)).toBeNull();
  });
});

it('formatCredits and needsBudgetApproval', () => {
  expect(formatCredits(1234.5)).toBe('1,234.50 credits');
  expect(formatCredits(null)).toBe('—');
  expect(needsBudgetApproval(system([], { budgetsApprovedAt: null }))).toBe(true);
  expect(needsBudgetApproval(system([]))).toBe(false);
  expect(needsBudgetApproval(null)).toBe(false);
});
