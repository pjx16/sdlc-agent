import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CredentialView } from '@sdlc/shared';
import { describe, expect, it } from 'vitest';
import { FormProvider } from '@/components/form';
import { initialSettingsValues } from '@/lib/settings-form';
import type { GlobalSettingsView } from '@/lib/types';
import { BudgetsSection, timeZoneChoices } from './budgets-section';
import { ConnectionsSummary } from './connections-summary';
import { SourcesSection } from './sources-section';

const settings = {
  budgetDailyCredits: 10, budgetWeeklyCredits: null, budgetMonthlyCredits: 150, budgetWarnPct: 80, timezone: 'UTC', pollIntervalSec: 120, stageTimeoutMin: 20,
  verifyTimeoutSec: 600, onboardingTimeoutMin: 15, githubIssueOnCreate: 'ask', workspaceRetentionDays: 7, logRetentionDays: 30, assistantTokenCap: 200000,
  stageDefaults: {}, modelAliases: { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' }, intakeGithubEnabled: true, intakeJiraEnabled: false, intakePasteEnabled: true,
} as unknown as GlobalSettingsView;

function inForm(ui: React.ReactNode, over: { errors?: Record<string, string>; dirty?: string[]; values?: Record<string, unknown> } = {}) {
  const calls: [string, unknown][] = [];
  render(<FormProvider value={{ values: { ...initialSettingsValues(settings), ...over.values }, errors: over.errors ?? {}, set: (p, v) => calls.push([p, v]), dirty: over.dirty }}>{ui}</FormProvider>);
  return calls;
}

const cred = (key: CredentialView['key'], over: Partial<CredentialView> = {}): CredentialView => ({ key, source: 'db', hint: 'abcd', verifiedAt: null, verifyError: null, updatedAt: null, ...over });

describe('ConnectionsSummary', () => {
  it('shows each connection with its state, and a link to manage them on the setup page', () => {
    render(<ConnectionsSummary credentials={[cred('github_token', { verifiedAt: '2026-11-20T10:00:00Z' }), cred('anthropic_api_key', { verifiedAt: '2026-11-21T09:30:00Z' })]} bot={null} />);
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText(/Personal token · verified/)).toBeInTheDocument();
    expect(screen.getByText(/API key · verified/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/setup/connections');
  });

  it('says Not set for what is missing', () => {
    render(<ConnectionsSummary credentials={[cred('github_token', { source: 'unset', hint: null }), cred('anthropic_api_key', { source: 'unset', hint: null })]} bot={null} />);
    expect(screen.getAllByText('Not set')).toHaveLength(2);
  });

  it('says saved-not-tested, and a refusal with its reason', () => {
    render(<ConnectionsSummary credentials={[cred('github_token'), cred('anthropic_api_key', { verifyError: 'Anthropic rejected the API key' })]} bot={null} />);
    expect(screen.getByText('Personal token saved, not tested yet')).toBeInTheDocument();
    expect(screen.getByText('API key: Anthropic rejected the API key')).toBeInTheDocument();
  });

  it('counts GitHub as connected through the bot alone, or through both', () => {
    const bot = { connected: true, installations: [{ id: 1, account: 'acme' }, { id: 2, account: '' }] };
    const { rerender } = render(<ConnectionsSummary credentials={[cred('github_token', { source: 'unset', hint: null }), cred('anthropic_api_key')]} bot={bot} />);
    expect(screen.getByText('sdlc-agent-bot · installed for acme, installation 2')).toBeInTheDocument();
    expect(screen.queryByText('Not set')).not.toBeInTheDocument();
    rerender(<ConnectionsSummary credentials={[cred('github_token', { verifiedAt: '2026-11-20T10:00:00Z' }), cred('anthropic_api_key')]} bot={bot} />);
    expect(screen.getByText(/Personal token · verified/)).toBeInTheDocument();
    expect(screen.getByText(/sdlc-agent-bot · installed/)).toBeInTheDocument();
  });

  it('copes with no data at all', () => {
    render(<ConnectionsSummary credentials={[]} bot={null} />);
    expect(screen.getAllByText('Not set')).toHaveLength(2);
  });
});

describe('BudgetsSection', () => {
  it('has the three budgets side by side, with $ and the warning in percent', () => {
    inForm(<BudgetsSection />);
    expect(screen.getByLabelText('Daily')).toHaveValue('10');
    expect(screen.getByLabelText('Weekly')).toHaveValue('');
    expect(screen.getByLabelText('Monthly')).toHaveValue('150');
    expect(screen.getAllByText('$')).toHaveLength(3);
    expect(screen.getByLabelText('Warn at')).toHaveValue('80');
    expect(screen.getByText('% of a budget')).toBeInTheDocument();
    expect(screen.getByText('Monday to Sunday.')).toBeInTheDocument();
  });

  it('the time zone is typed with suggestions from the list the browser has, and saved as typed', async () => {
    const calls = inForm(<BudgetsSection />);
    const zone = screen.getByLabelText('Timezone');
    expect(zone).toHaveValue('UTC');
    expect(zone).toHaveAttribute('list', 'timezone-list');
    const options = [...document.querySelectorAll('#timezone-list option')].map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain('Asia/Kolkata');
    expect(options).toContain('Europe/Paris');
    await userEvent.type(zone, 'X');
    expect(calls).toEqual([['timezone', 'UTCX']]);
  });

  it('shows an error for the time zone, and marks changed fields', () => {
    inForm(<BudgetsSection />, { errors: { timezone: 'must be an IANA timezone like Asia/Kolkata' }, dirty: ['budgetDailyCredits'] });
    expect(screen.getByText('must be an IANA timezone like Asia/Kolkata')).toBeInTheDocument();
    expect(screen.getByLabelText('Timezone')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Daily')).toHaveClass('border-accent');
    expect(screen.getByLabelText('Monthly')).not.toHaveClass('border-accent');
  });
});

describe('timeZoneChoices', () => {
  it('adds the modern name the browser lists under an older one, once, and sorted', () => {
    const list = timeZoneChoices(['Asia/Calcutta', 'Europe/Paris', 'Africa/Abidjan']);
    expect(list).toContain('Asia/Calcutta');
    expect(list).toContain('Asia/Kolkata');
    expect(list.filter((z) => z === 'UTC')).toHaveLength(1);
    expect(list).toEqual([...list].sort());
  });
  it('does not repeat a name the browser already has', () => {
    expect(timeZoneChoices(['Asia/Kolkata', 'UTC']).filter((z) => z === 'Asia/Kolkata')).toHaveLength(1);
  });
  it('still offers the modern names when the browser has no list', () => {
    expect(timeZoneChoices(null)).toEqual(expect.arrayContaining(['UTC', 'Asia/Kolkata']));
  });
});

describe('SourcesSection', () => {
  it('one switch per source, as saved, and nothing is sent until Save: a click only changes the form', async () => {
    const calls = inForm(<SourcesSection intakePaused={false} />);
    expect(screen.getByRole('checkbox', { name: /^GitHub/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^Jira/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^Pasted tickets/ })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: /^Pasted tickets/ }));
    expect(calls).toEqual([['intakePasteEnabled', false]]);
  });

  it('says when the whole intake is paused', () => {
    inForm(<SourcesSection intakePaused />);
    expect(screen.getByText(/Intake is paused as a whole/)).toBeInTheDocument();
  });

  it('chooses what to do about a GitHub issue for a new ticket: ask, always or never', async () => {
    const calls = inForm(<SourcesSection intakePaused={false} />);
    const choice = screen.getByLabelText('GitHub issue for a new ticket');
    expect(within(choice).getAllByRole('option').map((o) => o.textContent)).toEqual(['Ask me each time', 'Always create one', 'Never']);
    expect(choice).toHaveValue('ask');
    await userEvent.selectOptions(choice, 'always');
    expect(calls).toEqual([['githubIssueOnCreate', 'always']]);
  });
});
