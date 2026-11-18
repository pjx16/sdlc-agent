import { describe, expect, it } from 'vitest';
import { HOST_SESSION_COOKIE, SESSION_COOKIE, pickSessionCookie } from './constants';

describe('pickSessionCookie (scan finding L3)', () => {
  it('finds the session under either name, preferring the __Host- one', () => {
    expect(pickSessionCookie((n) => ({ [SESSION_COOKIE]: 'a' })[n])).toEqual({ name: SESSION_COOKIE, value: 'a' });
    expect(pickSessionCookie((n) => ({ [HOST_SESSION_COOKIE]: 'b', [SESSION_COOKIE]: 'a' })[n])).toEqual({ name: HOST_SESSION_COOKIE, value: 'b' });
    expect(pickSessionCookie(() => undefined)).toBeNull();
  });
});
