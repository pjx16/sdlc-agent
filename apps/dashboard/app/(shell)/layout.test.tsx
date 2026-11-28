import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShellLayout from './layout';

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
let pathname: string | null;
let session: boolean;
let status: { ready: boolean } | null | Error;
vi.mock('next/headers', () => ({ headers: async () => ({ get: (name: string) => (name === 'x-pathname' ? pathname : null) }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock('@/lib/session', () => ({ hasValidSession: async () => session }));
vi.mock('@/lib/server-api', () => ({
  apiGet: async (path: string) => {
    if (path !== '/setup/status') return null;
    if (status instanceof Error) throw status;
    return status;
  },
}));
vi.mock('@/components/shell', () => ({ Shell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div> }));

beforeEach(() => {
  pathname = '/';
  session = true;
  status = { ready: true };
});

const run = async () => render(await ShellLayout({ children: <p>the page</p> }));
const redirectsTo = async () => {
  try {
    await run();
    return null;
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
};

describe('the shell layout and the setup gate', () => {
  it('a fresh install is sent from any page to the setup screen', async () => {
    status = { ready: false };
    for (const path of ['/', '/tickets', '/settings']) {
      pathname = path;
      expect(await redirectsTo(), path).toBe('/setup/connections');
    }
  });

  it('the setup screen itself is shown, not redirected again', async () => {
    status = { ready: false };
    pathname = '/setup/connections';
    await run();
    expect(screen.getByTestId('shell')).toHaveTextContent('the page');
  });

  it('after the setup every page opens', async () => {
    pathname = '/tickets';
    await run();
    expect(screen.getByText('the page')).toBeInTheDocument();
  });

  it('with no session it goes to the login first, whatever the setup says', async () => {
    session = false;
    status = { ready: false };
    expect(await redirectsTo()).toBe('/login');
  });

  it('when the status cannot be read the page opens (the API being down is not a reason to lock the dashboard)', async () => {
    status = new Error('API down');
    await run();
    expect(screen.getByText('the page')).toBeInTheDocument();
    status = null;
    await run();
  });

  it('with no pathname header it still gates', async () => {
    status = { ready: false };
    pathname = null;
    expect(await redirectsTo()).toBe('/setup/connections');
  });
});
