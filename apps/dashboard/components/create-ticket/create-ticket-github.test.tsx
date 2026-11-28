import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubIssueChip } from '@/components/github-issue-chip';
import { githubTarget, repoOf } from '@/lib/github-repo';
import type { TicketFormData } from '@/lib/ticket-form-data';
import type { ProjectView } from '@/lib/types';
import { CreateTicketButton } from './create-ticket-button';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh }) }));

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  fetchMock.mockReset();
  push.mockReset();
  refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.restoreAllMocks());

const ISSUES = { mode: 'issues', statusMap: {} };
const BOARD = { mode: 'projects', project: { owner: 'acme', number: 3 }, statusMap: { NEW: 'Backlog', PLANNING: 'Planning' } };
const project = (github: object = ISSUES, over: Partial<ProjectView> = {}) =>
  ({ id: 'p1', name: 'Billing', repoUrl: 'https://github.com/acme/billing', enabled: true, mirrorStatus: 'ok', onboardingStatus: 'confirmed', settings: { github }, ...over }) as unknown as ProjectView;
const data = (over: Partial<TicketFormData> = {}): TicketFormData => ({ projects: [project()], template: '', githubIssueOnCreate: 'ask', ...over });

/** Replies by URL: the search, the settings, and the ticket. */
function server(opts: { search?: unknown[]; searchStatus?: number; settingsStatus?: number } = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/github/issues/search')) return reply(opts.search ?? [], opts.searchStatus ?? 200);
    if (url === '/api/system/settings') return reply(opts.settingsStatus && opts.settingsStatus >= 400 ? { message: 'disk full' } : JSON.parse(String(init?.body)), opts.settingsStatus ?? 200);
    return reply({ id: 'new-1' }, 201);
  });
}
const ticketPosts = () => fetchMock.mock.calls.filter(([u]) => u === '/api/tickets').map(([, init]) => JSON.parse(String((init as RequestInit).body)));
const calledUrls = () => fetchMock.mock.calls.map(([u]) => String(u));

async function openAndFill(d: TicketFormData) {
  render(<CreateTicketButton data={d} />);
  await userEvent.click(screen.getByRole('button', { name: 'New ticket' }));
  const dialog = screen.getByRole('dialog', { name: 'New ticket' });
  await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Add CSV export');
  await userEvent.type(within(dialog).getByLabelText(/^Problem/), 'Finance cannot export.');
  await userEvent.type(within(dialog).getByLabelText('Criterion 1'), 'Exports every row');
  return dialog;
}
const create = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));

describe('the GitHub question, with the choice on ask', () => {
  it('asks where the issue would go, with the board and the column for a Projects board', async () => {
    server();
    const dialog = await openAndFill(data({ projects: [project(BOARD)] }));
    await create(dialog);
    const ask = within(dialog).getByRole('group', { name: 'GitHub issue' });
    expect(ask).toHaveTextContent('Also create this as a GitHub issue in acme/billing. It will be added to the board acme/3, in the column Backlog?');
    expect(ticketPosts()).toEqual([]); // nothing is sent until it is answered
  });

  it('for plain issues it names only the repository', async () => {
    server();
    const dialog = await openAndFill(data());
    await create(dialog);
    expect(within(dialog).getByRole('group', { name: 'GitHub issue' })).toHaveTextContent('Also create this as a GitHub issue in acme/billing?');
  });

  it('Create on GitHub: checks for a duplicate, then sends the ticket asking for the issue', async () => {
    server();
    const dialog = await openAndFill(data());
    await create(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create on GitHub' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets/new-1'));
    expect(calledUrls()[0]).toBe('/api/projects/p1/github/issues/search?title=Add%20CSV%20export');
    expect(ticketPosts()).toEqual([expect.objectContaining({ title: 'Add CSV export', github: { create: true } })]);
    expect(calledUrls()).not.toContain('/api/system/settings'); // not remembered unless asked
  });

  it('Only in sdlc-agent: no search, no GitHub in the request', async () => {
    server();
    const dialog = await openAndFill(data());
    await create(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Only in sdlc-agent' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(calledUrls().some((u) => u.includes('/search'))).toBe(false);
    expect(ticketPosts()[0]).not.toHaveProperty('github');
  });

  it('Back returns to the form with everything typed still there', async () => {
    server();
    const dialog = await openAndFill(data());
    await create(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByRole('button', { name: 'Create ticket' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue('Add CSV export');
  });

  it('the fields cannot be edited while the question is open', async () => {
    server();
    const dialog = await openAndFill(data());
    await create(dialog);
    expect(within(dialog).getByLabelText(/^Title/)).toBeDisabled();
  });

  describe('remember my choice', () => {
    it('saves "always" in the settings for every project, then creates the issue', async () => {
      server();
      const dialog = await openAndFill(data());
      await create(dialog);
      await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Remember my choice for every project' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create on GitHub' }));
      await waitFor(() => expect(push).toHaveBeenCalled());
      const patch = fetchMock.mock.calls.find(([u]) => u === '/api/system/settings') as [string, RequestInit];
      expect(patch[1].method).toBe('PATCH');
      expect(JSON.parse(String(patch[1].body))).toEqual({ githubIssueOnCreate: 'always' });
      expect(calledUrls().indexOf('/api/system/settings')).toBeLessThan(calledUrls().indexOf('/api/tickets'));
    });

    it('saves "never" when the answer is Only in sdlc-agent', async () => {
      server();
      const dialog = await openAndFill(data());
      await create(dialog);
      await userEvent.click(within(dialog).getByRole('checkbox', { name: /Remember my choice/ }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Only in sdlc-agent' }));
      await waitFor(() => expect(push).toHaveBeenCalled());
      expect(JSON.parse(String((fetchMock.mock.calls.find(([u]) => u === '/api/system/settings') as [string, RequestInit])[1].body))).toEqual({ githubIssueOnCreate: 'never' });
    });

    it('when it cannot be saved nothing is sent, and the person is told', async () => {
      server({ settingsStatus: 500 });
      const dialog = await openAndFill(data());
      await create(dialog);
      await userEvent.click(within(dialog).getByRole('checkbox', { name: /Remember my choice/ }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create on GitHub' }));
      expect(await within(dialog).findByText('Could not remember your choice: disk full')).toBeInTheDocument();
      expect(ticketPosts()).toEqual([]);
      expect(push).not.toHaveBeenCalled();
    });
  });
});

describe('with the choice already made', () => {
  it('always: no question, a quiet line that says what happens, and the issue is asked for', async () => {
    server();
    const dialog = await openAndFill(data({ githubIssueOnCreate: 'always', projects: [project(BOARD)] }));
    expect(within(dialog).getByTestId('github-policy')).toHaveTextContent('A GitHub issue is also made in acme/billing. It will be added to the board acme/3, in the column Backlog.');
    expect(within(dialog).getByRole('link', { name: 'Change this in Settings' })).toHaveAttribute('href', '/settings');
    await create(dialog);
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(within(dialog).queryByRole('group', { name: 'GitHub issue' })).not.toBeInTheDocument();
    expect(ticketPosts()[0]).toMatchObject({ github: { create: true } });
  });

  it('never: no question, no search, and a line that says so', async () => {
    server();
    const dialog = await openAndFill(data({ githubIssueOnCreate: 'never' }));
    expect(within(dialog).getByTestId('github-policy')).toHaveTextContent('No GitHub issue is made.');
    await create(dialog);
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(calledUrls().some((u) => u.includes('/search'))).toBe(false);
    expect(ticketPosts()[0]).not.toHaveProperty('github');
  });
});

describe('a project that does not use GitHub', () => {
  it('shows nothing about GitHub whatever the choice is, and sends no GitHub request', async () => {
    server();
    const dialog = await openAndFill(data({ projects: [project({ mode: 'off', statusMap: {} })], githubIssueOnCreate: 'always' }));
    expect(within(dialog).queryByTestId('github-policy')).not.toBeInTheDocument();
    await create(dialog);
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(within(dialog).queryByRole('group', { name: 'GitHub issue' })).not.toBeInTheDocument();
    expect(calledUrls().some((u) => u.includes('/search'))).toBe(false);
    expect(ticketPosts()[0]).not.toHaveProperty('github');
  });

  it('follows the project chosen: GitHub is asked about for one project and not for another', async () => {
    server();
    const d = data({ projects: [project({ mode: 'off', statusMap: {} }), project(ISSUES, { id: 'p2', name: 'Shipping' })], githubIssueOnCreate: 'never' });
    const dialog = await openAndFill(d);
    expect(within(dialog).queryByTestId('github-policy')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Project'), 'p2');
    expect(within(dialog).getByTestId('github-policy')).toBeInTheDocument();
  });
});

describe('an issue with the same title already exists', () => {
  const found = { number: 42, title: 'Add CSV export', url: 'https://github.com/acme/billing/issues/42' };

  async function atPrompt() {
    server({ search: [found] });
    const dialog = await openAndFill(data({ githubIssueOnCreate: 'always' }));
    await create(dialog);
    return within(dialog).findByRole('group', { name: 'An issue with this title exists' });
  }

  it('offers to link it, and sends nothing yet', async () => {
    const prompt = await atPrompt();
    expect(prompt).toHaveTextContent('An open issue #42 “Add CSV export” already exists.');
    expect(within(prompt).getByRole('link', { name: /#42/ })).toHaveAttribute('href', found.url);
    expect(ticketPosts()).toEqual([]);
  });

  it('Link it: the ticket links that issue and makes none', async () => {
    const prompt = await atPrompt();
    await userEvent.click(within(prompt).getByRole('button', { name: 'Link it' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(ticketPosts()[0]).toMatchObject({ github: { create: false, link: 42 } });
  });

  it('Create a new one anyway', async () => {
    const prompt = await atPrompt();
    await userEvent.click(within(prompt).getByRole('button', { name: 'Create a new one anyway' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(ticketPosts()[0]).toMatchObject({ github: { create: true } });
    expect(ticketPosts()[0].github).not.toHaveProperty('link');
  });

  it('Cancel goes back to the form without creating anything', async () => {
    const prompt = await atPrompt();
    await userEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Create ticket' })).toBeInTheDocument();
    expect(ticketPosts()).toEqual([]);
  });

  it('when the search fails, the ticket is created anyway', async () => {
    server({ searchStatus: 502 });
    const dialog = await openAndFill(data({ githubIssueOnCreate: 'always' }));
    await create(dialog);
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(ticketPosts()[0]).toMatchObject({ github: { create: true } });
  });
});

describe('repoOf and githubTarget', () => {
  it('reads owner/name from a GitHub URL, and nothing else', () => {
    expect(repoOf('https://github.com/acme/billing')).toBe('acme/billing');
    expect(repoOf('https://github.com/acme/billing.git')).toBe('acme/billing');
    expect(repoOf('https://gitlab.com/acme/billing')).toBeNull();
  });
  it('is null when GitHub is off; the column is the one for NEW, else PLANNING, and only for a board', () => {
    expect(githubTarget(project({ mode: 'off', statusMap: {} }))).toBeNull();
    expect(githubTarget(project(BOARD))).toEqual({ repo: 'acme/billing', board: 'acme/3', column: 'Backlog' });
    expect(githubTarget(project({ ...BOARD, statusMap: { PLANNING: 'Planning' } }))?.column).toBe('Planning');
    expect(githubTarget(project({ ...BOARD, statusMap: {} }))?.column).toBeNull();
    expect(githubTarget(project({ mode: 'issues', statusMap: { NEW: 'Backlog' } }))).toEqual({ repo: 'acme/billing', board: null, column: null });
  });
});

describe('GithubIssueChip', () => {
  it('shows nothing when no issue was asked for', () => {
    const { container } = render(<GithubIssueChip ticketId="t1" state="none" error={null} url={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('says the issue is being made', () => {
    render(<GithubIssueChip ticketId="t1" state="pending" error={null} url={null} />);
    expect(screen.getByText('GitHub: creating the issue…')).toBeInTheDocument();
  });
  it('links the issue once it exists', () => {
    render(<GithubIssueChip ticketId="t1" state="created" error={null} url="https://github.com/acme/billing/issues/7" />);
    const link = screen.getByRole('link', { name: 'GitHub: #7 ↗' });
    expect(link).toHaveAttribute('href', 'https://github.com/acme/billing/issues/7');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('shows why it failed, and Retry asks for a new try and refreshes the page', async () => {
    fetchMock.mockResolvedValue(reply({}));
    render(<GithubIssueChip ticketId="t1" state="failed" error="Resource not accessible (HTTP 403)" url={null} />);
    expect(screen.getByText('GitHub: the issue could not be made: Resource not accessible (HTTP 403)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tickets/t1/github-issue/retry');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('POST');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it('says when the retry was refused', async () => {
    fetchMock.mockResolvedValue(reply({ message: 'There is no failed GitHub issue to retry' }, 409));
    render(<GithubIssueChip ticketId="t1" state="failed" error={null} url={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no failed GitHub issue to retry');
    expect(refresh).not.toHaveBeenCalled();
  });
});
