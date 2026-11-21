import { describe, expect, it } from 'vitest';
import { suggestBudgets } from './system-settings.service';

describe('suggestBudgets', () => {
  it('suggests 1.5 times an average day, rounded up; a week is five such days and a month twenty', () => {
    expect(suggestBudgets(3.2)).toEqual({ daily: 5, weekly: 25, monthly: 100 });
    expect(suggestBudgets(0.1)).toEqual({ daily: 1, weekly: 5, monthly: 20 });
  });
  it('falls back to the defaults with no spend', () => {
    expect(suggestBudgets(0)).toEqual({ daily: 10, weekly: 50, monthly: 150 });
  });
});
