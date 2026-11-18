import { describe, expect, it } from 'vitest';
import { isAllowedHost } from './host-allowlist';

describe('isAllowedHost (scan finding L1)', () => {
  it('allows loopback names, with or without a port', () => {
    for (const h of ['localhost', 'localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST']) expect(isAllowedHost(h, ''), h).toBe(true);
  });
  it('refuses any other name, and a missing header', () => {
    for (const h of ['evil.example', 'evil.example:3000', 'localhost.evil.example', '10.0.0.5:3000', '', null]) expect(isAllowedHost(h, ''), String(h)).toBe(false);
  });
  it('allows names from ALLOWED_HOSTS', () => {
    expect(isAllowedHost('sdlc.example.com', 'sdlc.example.com, other.example')).toBe(true);
    expect(isAllowedHost('other.example:443', 'sdlc.example.com, other.example')).toBe(true);
    expect(isAllowedHost('evil.example', 'sdlc.example.com')).toBe(false);
  });
});
