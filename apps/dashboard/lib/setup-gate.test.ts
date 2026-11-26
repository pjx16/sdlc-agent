import { describe, expect, it } from 'vitest';
import { SETUP_PATH, setupRedirect } from './setup-gate';

describe('setupRedirect', () => {
  it('sends every page to the setup while it is not done', () => {
    for (const path of ['/', '/tickets', '/tickets/abc', '/projects/new', '/settings', '/guidelines', '/inbox', '/usage']) expect(setupRedirect(path, { ready: false }), path).toBe(SETUP_PATH);
  });

  it('lets the setup pages themselves through, so the redirect cannot loop', () => {
    for (const path of ['/setup', '/setup/connections', '/setup/jira']) expect(setupRedirect(path, { ready: false }), path).toBeNull();
  });

  it('is not fooled by a page that only starts like the setup', () => {
    expect(setupRedirect('/setup-notes', { ready: false })).toBe(SETUP_PATH);
    expect(setupRedirect('/tickets/setup/x', { ready: false })).toBe(SETUP_PATH);
  });

  it('sends nobody once the setup is done', () => {
    for (const path of ['/', '/tickets', '/setup/connections']) expect(setupRedirect(path, { ready: true })).toBeNull();
  });

  it('sends nobody when the status could not be read: an API that is down is not a reason to shut the door', () => {
    expect(setupRedirect('/', null)).toBeNull();
  });

  it('an unknown path (no header) is treated as an ordinary page', () => {
    expect(setupRedirect('', { ready: false })).toBe(SETUP_PATH);
  });
});
