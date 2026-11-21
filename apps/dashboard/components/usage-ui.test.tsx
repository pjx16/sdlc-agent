import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemView } from '@/lib/types';
import { PauseBanner } from './pause-banner';
import { pipelineLabel } from './shell';
import { BudgetApprovalBanner } from './budget-approval-banner';
import { BudgetOverview } from './budget-overview';
import { TicketCosts } from './ticket-costs';
import { TokensTable } from './usage-tables';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/server-api', () => ({ apiGet: vi.fn() }));
const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  refresh.mockReset();
});

const system = (over: Record<string, unknown> = {}, running: SystemView['runningStage'] = null) =>
  ({ settings: { pipelinePaused: false, ...over }, runningStage: running }) as unknown as SystemView;

describe('pipelineLabel', () => {
  it('says Paused, Running <stage> or Idle', () => {
    expect(pipelineLabel(system({ pipelinePaused: true }))).toEqual({ text: 'Paused', tone: 'amber' });
    expect(pipelineLabel(system({}, { id: 'r', stage: 'plan', model: 'm', projectId: 'p', ticketId: 't', startedAt: null }))).toEqual({ text: 'Running plan', tone: 'green' });
    expect(pipelineLabel(system())).toEqual({ text: 'Idle', tone: 'grey' });
    expect(pipelineLabel(null).text).toBe('Unknown');
  });
});

describe('PauseBanner (F14)', () => {
  it('a used-up budget shows the reason and when it resumes, with Resume and Ignore', () => {
    render(<PauseBanner code="SPEND_BUDGET_REACHED" reason="The daily budget of 10 credits is used up (10.4 spent)" resetsAt="2026-11-12T13:00:00Z" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Pipeline paused.');
    expect(alert).toHaveTextContent('The daily budget of 10 credits is used up');
    expect(alert).toHaveTextContent('Resumes by itself 2026-11-12 13:00 UTC');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ignore budgets until then' })).toBeInTheDocument();
  });

  it('a manual pause or a low credit balance offers only Resume', () => {
    render(<PauseBanner reason="manual" resetsAt={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Paused by you.');
    expect(screen.queryByRole('button', { name: /Ignore/ })).not.toBeInTheDocument();
  });

  it('says to add credits when the balance is too low', () => {
    render(<PauseBanner code="CLAUDE_CREDITS" reason="The Anthropic credit balance is too low." resetsAt={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Add credits in the Anthropic Console');
    expect(screen.queryByRole('button', { name: /Ignore/ })).not.toBeInTheDocument();
  });

  it('Resume and Ignore call the API and refresh', async () => {
    fetchMock.mockResolvedValue(reply({}));
    render(<PauseBanner code="SPEND_BUDGET_REACHED" reason="x" resetsAt={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Ignore budgets until then' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/system/resume', '/api/system/usage/ignore']);
  });

  it('shows the server message on an error', async () => {
    fetchMock.mockResolvedValue(reply({ message: 'The pipeline is not paused' }, 409));
    render(<PauseBanner reason="x" resetsAt={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(await screen.findByText('The pipeline is not paused')).toBeInTheDocument();
  });
});

describe('BudgetApprovalBanner', () => {
  it('approves the suggested budgets with the browser timezone', async () => {
    fetchMock.mockResolvedValue(reply({}));
    render(<BudgetApprovalBanner suggested={{ daily: 5, weekly: 25, monthly: 100 }} />);
    expect(screen.getByRole('region', { name: 'Set spending limits' })).toHaveTextContent('Daily 5');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/system/settings');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, budgetDailyCredits: 5, budgetWeeklyCredits: 25, budgetMonthlyCredits: 100 });
  });

  it('can edit the values first, or choose no limits', async () => {
    fetchMock.mockResolvedValue(reply({}));
    render(<BudgetApprovalBanner suggested={{ daily: 5, weekly: 25, monthly: 100 }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.clear(screen.getByLabelText('Daily budget (credits)'));
    await userEvent.type(screen.getByLabelText('Daily budget (credits)'), '8');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'No limits' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(String((c as [string, RequestInit])[1].body)));
    expect(bodies[0]).toMatchObject({ budgetDailyCredits: 8, budgetWeeklyCredits: 25 });
    expect(bodies[1]).toMatchObject({ budgetDailyCredits: null, budgetWeeklyCredits: null, budgetMonthlyCredits: null });
  });

  it('shows field errors from the server', async () => {
    fetchMock.mockResolvedValue(reply({ fields: { budgetDailyCredits: 'must be more than 0' } }, 400));
    render(<BudgetApprovalBanner suggested={{ daily: 5, weekly: 25, monthly: 100 }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Daily: must be more than 0')).toBeInTheDocument();
  });
});

describe('Usage page parts', () => {
  const period = (p: 'daily' | 'weekly' | 'monthly', spent: number, budget: number | null) => ({ period: p, spent, budget, pct: budget ? (spent / budget) * 100 : null, resetsAt: '2026-11-22T00:00:00Z' });

  it('shows each budget with its meter, and the month projection', () => {
    render(
      <BudgetOverview
        periods={[period('daily', 8.5, 10), period('weekly', 20, null), period('monthly', 40, 100)]}
        warnPct={80}
        projection={{ monthToDate: 40, avgDaily: 7, daysLeft: 9, projected: 103, budget: 100, reachesBudgetAt: '2026-11-29T12:00:00Z' }}
      />,
    );
    expect(screen.getByTestId('budget-daily')).toHaveTextContent('8.50 credits');
    expect(screen.getByRole('meter', { name: 'Today: 85% of the budget' })).toBeInTheDocument();
    expect(screen.getByTestId('budget-weekly')).toHaveTextContent('No budget set');
    expect(screen.getByTestId('month-projection')).toHaveTextContent('103.00 credits');
    expect(screen.getByTestId('month-projection')).toHaveTextContent('Reaches the monthly budget 2026-11-29 12:00 UTC');
  });

  it('shows the cost per ticket, or says none was finished', () => {
    const { rerender } = render(<TicketCosts data={{ days: 30, tickets: 2, avgCredits: 3, byKind: [{ kind: 'feature', tickets: 2, avgCredits: 3 }], top: [{ id: 't1', key: 'P-1', title: 'Export', kind: 'feature', credits: 4 }] }} />);
    expect(screen.getByText('3.00 credits')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /P-1/ })).toHaveAttribute('href', '/tickets/t1');
    rerender(<TicketCosts data={{ days: 30, tickets: 0, avgCredits: null, byKind: [], top: [] }} />);
    expect(screen.getByText(/No ticket was finished/)).toBeInTheDocument();
  });

  it('shows tokens and credits by stage and model, and explains an empty table', () => {
    const { rerender } = render(<TokensTable rows={[{ stage: 'plan', model: 'opus', tokens: 12345, credits: 1.5, runs: 3 }]} />);
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('1.50')).toBeInTheDocument();
    rerender(<TokensTable rows={[]} />);
    expect(screen.getByText(/No stage has run/)).toBeInTheDocument();
  });
});
