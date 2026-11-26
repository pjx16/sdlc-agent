import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage, { metadata } from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/' }));
const apiGet = vi.fn();
vi.mock('@/lib/server-api', () => ({ apiGet: (path: string) => apiGet(path) }));

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockImplementation(async (path: string) => (path === '/tickets' ? [] : null)); // the rest is not there yet: the page copes
});

const show = async (searchParams: { range?: string } = {}) => render(await DashboardPage({ searchParams: Promise.resolve(searchParams) }));

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
});
