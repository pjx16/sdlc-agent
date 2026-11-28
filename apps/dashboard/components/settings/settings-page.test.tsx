import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STAGE_NAMES } from '@sdlc/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAVE_QUESTION } from '@/lib/use-unsaved-guard';
import type { GlobalSettingsView } from '@/lib/types';
import { SettingsPageClient } from './settings-page-client';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.restoreAllMocks());

const settings: GlobalSettingsView = {
  budgetDailyCredits: 10, budgetWeeklyCredits: null, budgetMonthlyCredits: 150, budgetWarnPct: 80, timezone: 'UTC', pollIntervalSec: 120, stageTimeoutMin: 20,
  verifyTimeoutSec: 600, onboardingTimeoutMin: 15, githubIssueOnCreate: 'ask', workspaceRetentionDays: 7, logRetentionDays: 30, assistantTokenCap: 200000,
  stageDefaults: Object.fromEntries(STAGE_NAMES.map((st) => [st, { model: 'sonnet' as const, maxTurns: 10 }])),
  modelAliases: { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' },
  pipelinePaused: false, pausedReason: null, resetsAt: null, usageIgnoredUntil: null, budgetsApprovedAt: null, intakePaused: false,
  intakeGithubEnabled: true, intakeJiraEnabled: true, intakePasteEnabled: true,
};
const show = (over: Partial<GlobalSettingsView> = {}) =>
  render(<SettingsPageClient settings={{ ...settings, ...over }} connections={<p>connections here</p>} account={<form aria-label="Change password"><button>Change it</button></form>} />);
const save = () => screen.getByRole('button', { name: 'Save' });
const discard = () => screen.getByRole('button', { name: 'Discard' });
const body = () => JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));

describe('the settings page', () => {
  it('is one page: the connections, the budgets, the ticket sources and the account first, and Advanced last and closed', () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const order = [screen.getByText('connections here'), screen.getByRole('heading', { name: 'Budgets' }), screen.getByRole('heading', { name: 'Ticket sources' }), screen.getByRole('form', { name: 'Change password' }), screen.getByText('Advanced')];
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((screen.getByText('Advanced').closest('details') as HTMLDetailsElement).open).toBe(false);
  });

  it('has Reset, Discard and Save in the header, which stays in view', () => {
    show();
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('sticky', 'top-0');
    expect(within(header).getAllByRole('button').map((b) => b.textContent)).toEqual(['Reset', 'Discard', 'Save']);
  });

  it('Save and Discard are off until something changes, and off again after a save', async () => {
    fetchMock.mockResolvedValue(reply({ ...settings, budgetDailyCredits: 12 }));
    show();
    expect(save()).toBeDisabled();
    expect(discard()).toBeDisabled();
    expect(screen.getByText('Everything is saved.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Daily'));
    await userEvent.type(screen.getByLabelText('Daily'), '12');
    expect(save()).toBeEnabled();
    expect(discard()).toBeEnabled();
    expect(screen.getByText('● 1 unsaved change')).toBeInTheDocument();
    await userEvent.click(save());
    expect(await screen.findByText('Saved. Changes apply from the next stage run.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(refresh).toHaveBeenCalled();
  });

  it('Save sends only what changed, as numbers', async () => {
    fetchMock.mockResolvedValue(reply({ ...settings, budgetDailyCredits: 12.5, timezone: 'Asia/Kolkata' }));
    show();
    await userEvent.clear(screen.getByLabelText('Daily'));
    await userEvent.type(screen.getByLabelText('Daily'), '12.5');
    await userEvent.clear(screen.getByLabelText('Timezone'));
    await userEvent.type(screen.getByLabelText('Timezone'), 'Asia/Kolkata');
    expect(screen.getByText('● 2 unsaved changes')).toBeInTheDocument();
    await userEvent.click(save());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/system/settings');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('PATCH');
    expect(body()).toEqual({ budgetDailyCredits: 12.5, timezone: 'Asia/Kolkata' });
  });

  it('the ticket sources are saved by Save, not at the click', async () => {
    fetchMock.mockResolvedValue(reply({ ...settings, intakeJiraEnabled: false }));
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: /^Jira/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(save());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(body()).toEqual({ intakeJiraEnabled: false });
  });

  it('a change is marked with an accent edge, and Discard takes it back', async () => {
    show();
    await userEvent.type(screen.getByLabelText('Weekly'), '40');
    expect(screen.getByLabelText('Weekly')).toHaveClass('border-accent');
    await userEvent.click(discard());
    expect(screen.getByLabelText('Weekly')).toHaveValue('');
    expect(screen.getByLabelText('Weekly')).not.toHaveClass('border-accent');
    expect(save()).toBeDisabled();
  });

  describe('Reset', () => {
    it('asks first, and does nothing when the person says no', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      show();
      await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Connections, ticket sources and the password are not affected'));
      expect(screen.getByLabelText('Daily')).toHaveValue('10');
      expect(save()).toBeDisabled();
    });

    it('puts the defaults on the screen without saving: Save turns on, nothing is sent', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      show();
      await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
      expect(screen.getByLabelText('Daily')).toHaveValue(''); // the default is no limit
      expect(save()).toBeEnabled();
      expect(fetchMock).not.toHaveBeenCalled();
      await userEvent.click(discard());
      expect(screen.getByLabelText('Daily')).toHaveValue('10');
    });

    it('leaves the ticket sources as they are', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      show({ intakePasteEnabled: false });
      await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
      expect(screen.getByRole('checkbox', { name: /^Pasted tickets/ })).not.toBeChecked();
    });
  });

  describe('a refused save', () => {
    it('shows the message in the header and the error at the field, and stays unsaved', async () => {
      fetchMock.mockResolvedValue(reply({ fields: { budgetWarnPct: 'must be at least 1' } }, 400));
      show();
      await userEvent.clear(screen.getByLabelText('Warn at'));
      await userEvent.type(screen.getByLabelText('Warn at'), '0');
      await userEvent.click(save());
      expect(await screen.findByText('must be at least 1')).toBeInTheDocument();
      expect(screen.getByText('Some fields need attention.')).toBeInTheDocument();
      expect(save()).toBeEnabled();
      expect(screen.queryByText(/Saved\./)).not.toBeInTheDocument();
    });

    it('opens Advanced when the error is in it', async () => {
      fetchMock.mockResolvedValue(reply({ fields: { pollIntervalSec: 'must be at least 5' } }, 400));
      show();
      await userEvent.click(screen.getByText('Advanced'));
      await userEvent.clear(screen.getByLabelText('Poll interval'));
      await userEvent.type(screen.getByLabelText('Poll interval'), '1');
      await userEvent.click(screen.getByText('Advanced')); // closed again
      expect((screen.getByText('Advanced').closest('details') as HTMLDetailsElement).open).toBe(false);
      await userEvent.click(save());
      await waitFor(() => expect((screen.getByText('Advanced').closest('details') as HTMLDetailsElement).open).toBe(true));
      expect(screen.getByText('must be at least 5')).toBeInTheDocument();
    });
  });

  describe('leaving with changes', () => {
    it('Cmd+S and Ctrl+S save when there is something to save, and are only swallowed otherwise', async () => {
      fetchMock.mockResolvedValue(reply({ ...settings, budgetDailyCredits: 11 }));
      show();
      const idle = fireEvent.keyDown(window, { key: 's', ctrlKey: true });
      expect(idle).toBe(false); // the browser's own Save page dialog is not opened
      expect(fetchMock).not.toHaveBeenCalled();
      await userEvent.clear(screen.getByLabelText('Daily'));
      await userEvent.type(screen.getByLabelText('Daily'), '11');
      fireEvent.keyDown(window, { key: 'S', metaKey: true });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    });

    it('asks before closing the tab, only while something is unsaved', async () => {
      show();
      const quiet = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(quiet);
      expect(quiet.defaultPrevented).toBe(false);
      await userEvent.type(screen.getByLabelText('Weekly'), '5');
      const asks = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(asks);
      expect(asks.defaultPrevented).toBe(true);
    });

    it('asks before following a link that leaves the page, and stays when the person says no', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      render(
        <>
          <a href="/tickets">Tickets</a>
          <SettingsPageClient settings={settings} connections={null} account={null} />
        </>,
      );
      await userEvent.type(screen.getByLabelText('Weekly'), '5');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      act(() => void screen.getByRole('link', { name: 'Tickets' }).dispatchEvent(click));
      expect(confirm).toHaveBeenCalledWith(LEAVE_QUESTION);
      expect(click.defaultPrevented).toBe(true);
      confirm.mockReturnValue(true);
      const go = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      act(() => void screen.getByRole('link', { name: 'Tickets' }).dispatchEvent(go));
      expect(go.defaultPrevented).toBe(false);
    });

    it('does not ask for a link that opens elsewhere, goes to the same page, or when nothing changed', async () => {
      window.history.pushState({}, '', '/settings'); // jsdom starts at /
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      render(
        <>
          <a href="/tickets" target="_blank">New tab</a>
          <a href="/settings">Here</a>
          <a href="https://example.com">Elsewhere</a>
          <SettingsPageClient settings={settings} connections={null} account={null} />
        </>,
      );
      await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' })); // nothing changed yet
      expect(confirm).not.toHaveBeenCalled();
      await userEvent.type(screen.getByLabelText('Weekly'), '5');
      await userEvent.click(screen.getByRole('link', { name: 'New tab' }));
      await userEvent.click(screen.getByRole('link', { name: 'Here' }));
      expect(confirm).not.toHaveBeenCalled();
    });

    it('stops guarding once the changes are saved', async () => {
      fetchMock.mockResolvedValue(reply({ ...settings, budgetWeeklyCredits: 5 }));
      show();
      await userEvent.type(screen.getByLabelText('Weekly'), '5');
      await userEvent.click(save());
      await screen.findByText('Saved. Changes apply from the next stage run.');
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
