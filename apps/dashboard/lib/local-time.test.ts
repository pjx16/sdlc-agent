import { afterEach, describe, expect, it } from 'vitest';
import { formatLocal, formatLocalShort, formatUtcShort } from './local-time';

describe('local time', () => {
  afterEach(() => {
    process.env.TZ = 'UTC';
  });

  it('formats a moment in the time zone of the machine it runs on', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(formatLocal('2026-11-14T11:53:00.000Z')).toMatch(/^2026-11-14 17:23 /);
    expect(formatLocalShort('2026-11-14T11:53:00.000Z')).toBe('11-14 17:23');
  });

  it('crosses midnight with the offset', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatLocalShort('2026-11-14T03:30:00.000Z')).toBe('11-13 19:30');
  });

  it('keeps the UTC form for the server render, and a dash for no value', () => {
    expect(formatUtcShort('2026-11-14T11:53:00.000Z')).toBe('11-14 11:53');
    expect(formatLocal(null)).toBe('—');
    expect(formatLocal('nonsense')).toBe('—');
  });
});
