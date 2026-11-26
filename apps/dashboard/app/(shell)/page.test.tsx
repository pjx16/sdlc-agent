import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage, { metadata } from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/' }));
const apiGet = vi.fn();
vi.mock('@/lib/server-api', () => ({ apiGet: (path: string) => apiGet(path) }));

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockImplementation(async (path: string) => (path === '/tickets' ? [] : path === '/projects' ? projects : path === '/setup/status' ? { ready: setupReady } : null)); // the rest is not there yet: the page copes
  projects = [];
  setupReady = true;
});
let projects: unknown[] = [];
let setupReady = true;

const show = async (searchParams: { range?: string } = {}) => render(await DashboardPage({ searchParams: Promise.resolve(searchParams) }));

const hero = () => screen.getByRole('region', { name: 'Get started' });

describe('the Dashboard page', () => {
  it('has the tab title Dashboard, and no page title: no h1 at all', async () => {
    await show();
    expect(metadata.title).toBe('Dashboard');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('opens its numbers with an Overview heading, with the range switch beside it', async () => {
    await show({ range: '30d' });
    const heading = screen.getByRole('heading', { level: 2, name: 'Overview' });
    const row = heading.parentElement as HTMLElement;
    expect(within(row).getByRole('link', { name: '30d' })).toHaveAttribute('aria-current', 'true');
    expect(within(row).getByRole('link', { name: '24h' })).toHaveAttribute('href', '/?range=24h&groupBy=stage');
  });

  it('starts with the get-started band, above the Overview section', async () => {
    await show();
    const band = hero();
    const overview = screen.getByRole('heading', { level: 2, name: 'Overview' });
    expect(band.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the band follows the projects and the setup', async () => {
    const none = await show();
    expect(hero()).toHaveAttribute('data-state', 'no-project');
    none.unmount();
    projects = [{ id: 'p1', name: 'Billing', enabled: true, onboardingStatus: 'confirmed', createdAt: '2026-11-01T00:00:00Z', repoUrl: 'https://github.com/a/b', settings: { github: { mode: 'off', statusMap: {} } } }];
    const ready = await show();
    expect(hero()).toHaveAttribute('data-state', 'ready');
    ready.unmount();
    setupReady = false;
    await show();
    expect(hero()).toHaveAttribute('data-state', 'setup');
  });
});
