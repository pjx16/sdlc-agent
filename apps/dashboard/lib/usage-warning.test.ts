import { describe, expect, it } from 'vitest';
import { usageWarning } from './usage-warning';
import type { SystemView } from './types';

const NOW = Date.parse('2026-11-14T13:30:00Z');
const sys = (u: Partial<NonNullable<SystemView['usage']>> | null, paused = false): SystemView =>
  ({ settings: { pipelinePaused: paused, usageThresholdPct: 90, usageThresholdWeeklyPct: 80 }, usage: u && { at: '', fiveHourPct: 40, sevenDayPct: 50, status: 'allowed', resetsAt: '2026-11-15T11:00:00Z', source: 'event', ...u } }) as unknown as SystemView;

describe('usageWarning', () => {
  it('stays quiet while usage is well under the thresholds', () => {
    expect(usageWarning(sys({}), NOW)).toBeNull();
  });
  it('warns within 10 points of a threshold and says where it pauses', () => {
    expect(usageWarning(sys({ sevenDayPct: 76 }), NOW)?.text).toContain('weekly usage 76% (pauses at 80%)');
    expect(usageWarning(sys({ fiveHourPct: 85 }), NOW)?.text).toContain('5-hour usage 85% (pauses at 90%)');
  });
  it('shows Claude\'s own warning with the numbers', () => {
    expect(usageWarning(sys({ status: 'allowed_warning', sevenDayPct: 60 }), NOW)?.text).toContain('Claude warns that usage is getting high');
  });
  it('says nothing while paused (the pause banner speaks), or when the window has already reset, or without data', () => {
    expect(usageWarning(sys({ sevenDayPct: 76 }, true), NOW)).toBeNull();
    expect(usageWarning(sys({ sevenDayPct: 76, resetsAt: '2026-11-14T10:00:00Z' }), NOW)).toBeNull();
    expect(usageWarning(sys(null), NOW)).toBeNull();
  });
});
