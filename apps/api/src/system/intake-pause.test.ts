import { describe, expect, it } from 'vitest';
import { isIntakePaused } from './intake-pause';

describe('isIntakePaused', () => {
  it('is true for every source when the master switch is on', () => {
    const s = { intakePaused: true, pausedIntakeSources: [] };
    expect(isIntakePaused(s, 'jira')).toBe(true);
    expect(isIntakePaused(s, 'paste')).toBe(true);
  });
  it('is true only for listed sources when the master switch is off', () => {
    const s = { intakePaused: false, pausedIntakeSources: ['jira' as const] };
    expect(isIntakePaused(s, 'jira')).toBe(true);
    expect(isIntakePaused(s, 'paste')).toBe(false);
  });
  it('is false for every source by default', () => {
    const s = { intakePaused: false, pausedIntakeSources: [] };
    expect(isIntakePaused(s, 'jira')).toBe(false);
    expect(isIntakePaused(s, 'paste')).toBe(false);
  });
});
