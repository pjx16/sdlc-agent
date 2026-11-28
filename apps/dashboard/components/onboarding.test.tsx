import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OnboardingProposal } from '@sdlc/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardForm } from './onboard-form';
import { OnboardingPanel } from './onboarding-panel';
import { ProjectSummary } from './project-summary';
import type { OnboardingView, ProjectView } from '@/lib/types';
import { DEFAULT_PROJECT_SETTINGS } from '@sdlc/shared';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  fetchMock.mockReset();
  push.mockReset();
  refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.useRealTimers());
const sentBody = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i] as [string, RequestInit])[1].body));

describe('OnboardForm: one field', () => {
  it('has only a repo URL, and starts the onboarding', async () => {
    fetchMock.mockResolvedValue(reply({ id: 'p9' }));
    render(<OnboardForm />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Repository URL'), 'https://github.com/acme/billing');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects/onboard');
    expect(sentBody()).toEqual({ repoUrl: 'https://github.com/acme/billing', githubAuth: 'token' });
    expect(push).toHaveBeenCalledWith('/projects/p9');
  });

  it('lets the person choose between their own token and sdlc-agent-bot, and sends the choice', async () => {
    fetchMock.mockResolvedValue(reply({ id: 'p9' }));
    render(<OnboardForm />);
    expect(screen.getByRole('radio', { name: /My own token/ })).toBeChecked(); // the current way stays the default
    await userEvent.click(screen.getByRole('radio', { name: /sdlc-agent-bot/ }));
    await userEvent.type(screen.getByLabelText('Repository URL'), 'https://github.com/acme/billing');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(sentBody()).toMatchObject({ githubAuth: 'bot' });
  });

  it('shows the field errors from the server', async () => {
    fetchMock.mockResolvedValue(reply({ fields: { repoUrl: 'must be an HTTPS github.com repository URL' } }, 400));
    render(<OnboardForm />);
    await userEvent.type(screen.getByLabelText('Repository URL'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('must be an HTTPS github.com repository URL')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

const proposal = (over: Partial<OnboardingProposal> = {}): OnboardingProposal => ({
  facts: {
    github: { defaultBranch: 'main', languages: ['TypeScript'] },
  },
  profile: { stack: 'nestjs', installCmd: 'npm ci', typecheckCmd: 'npx tsc --noEmit', testCmdTemplate: 'npx jest {files}', kbDir: 'docs/kb', testFilePattern: '', exampleTestFile: null, baseBranch: 'main', installCheck: { command: 'npm ci', ok: true, tail: '' }, typecheckCheck: { command: 'npx tsc --noEmit', ok: false, tail: 'error TS2304' } },
  accepted: {},
  createdAt: '2026-11-14T10:00:00Z',
  ...over,
});
const view = (over: Partial<OnboardingView> = {}): OnboardingView => ({ status: 'proposed', error: null, proposal: proposal(), ...over });

describe('OnboardingPanel', () => {
  it('shows progress while the project is being profiled, and asks again until a proposal arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValue(reply(view()));
    render(<OnboardingPanel projectId="p1" initial={view({ status: 'profiling', proposal: null })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Profiling the repository');
    expect(screen.getByRole('dialog', { name: 'Profiling your repository' })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects/p1/onboarding');
    expect(await screen.findByRole('region', { name: 'Commands' })).toBeInTheDocument();
  });

  it('can hide the progress window and bring it back', async () => {
    fetchMock.mockResolvedValue(reply(view({ status: 'profiling', proposal: null })));
    render(<OnboardingPanel projectId="p1" initial={view({ status: 'profiling', proposal: null })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue in background' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show progress' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows why it failed and offers to run it again', async () => {
    fetchMock.mockResolvedValue(reply(view({ status: 'profiling', proposal: null })));
    render(<OnboardingPanel projectId="p1" initial={view({ status: 'draft', proposal: null, error: 'GitHub: Not Found. Check the GitHub token' })} />);
    expect(screen.getByText(/Check the GitHub token/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Run it again' }));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects/p1/onboarding/rerun');
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('shows the commands with their checks', () => {
    render(<OnboardingPanel projectId="p1" initial={view()} />);
    expect(screen.getByRole('region', { name: 'Commands' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'GitHub board columns' })).not.toBeInTheDocument();
    const commands = screen.getByRole('region', { name: 'Commands' });
    expect(within(commands).getByText('npx jest {files}')).toBeInTheDocument();
    expect(within(commands).getByText(/Install check: passed/)).toBeInTheDocument();
    expect(within(commands).getByText(/Typecheck check: failed/)).toBeInTheDocument();
    expect(within(commands).getByText('error TS2304')).toBeInTheDocument();
  });

  it('turns the Accept button off once the section is accepted', async () => {
    render(<OnboardingPanel projectId="p1" initial={view({ proposal: proposal({ accepted: { commands: true } }) })} />);
    expect(within(screen.getByRole('region', { name: 'Commands' })).getByRole('button', { name: 'Accepted' })).toBeDisabled();
    expect(within(screen.getByRole('region', { name: 'Commands' })).getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  it('edits a section and sends the change', async () => {
    fetchMock.mockResolvedValue(reply(view()));
    render(<OnboardingPanel projectId="p1" initial={view()} />);
    const commands = screen.getByRole('region', { name: 'Commands' });
    await userEvent.click(within(commands).getByRole('button', { name: 'Edit' }));
    const input = within(commands).getByLabelText('KB folder');
    await userEvent.clear(input);
    await userEvent.type(input, 'docs/knowledge');
    await userEvent.click(within(commands).getByRole('button', { name: 'Save and accept' }));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects/p1/onboarding/sections/commands');
    expect(sentBody()).toMatchObject({ action: 'edit', value: { kbDir: 'docs/knowledge' } });
  });

  it('shows the server error when an edit is refused', async () => {
    fetchMock.mockResolvedValue(reply({ fields: { testCmdTemplate: 'must contain {files}' } }, 400));
    render(<OnboardingPanel projectId="p1" initial={view()} />);
    await userEvent.click(within(screen.getByRole('region', { name: 'Commands' })).getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('must contain {files}');
  });

  it('confirms, shows any warning and refreshes the page', async () => {
    const accepted = proposal({ accepted: { commands: true } });
    fetchMock.mockResolvedValue(reply({ warnings: ['The label could not be created on the board.'] }));
    render(<OnboardingPanel projectId="p1" initial={view({ proposal: accepted })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm the project' }));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects/p1/onboarding/confirm');
    expect(await screen.findByText(/could not be created on the board/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('a project without a board needs no accepting and says it takes pasted tickets and GitHub issues only', () => {
    render(<OnboardingPanel projectId="p1" initial={view()} />);
    expect(screen.getByText(/pasted tickets and GitHub issues only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm the project' })).toBeEnabled();
  });
});

describe('the GitHub board mapping', () => {
  const boardProposal = (board: Partial<NonNullable<OnboardingProposal['board']>> = {}, accepted: OnboardingProposal['accepted'] = {}) =>
    proposal({
      facts: { github: { defaultBranch: 'main', languages: [], board: { columns: ['Todo', 'Doing', 'Approved', 'Done'] } } },
      board: { statusMap: { PLANNING: 'Doing', DONE: 'Done' }, approval: { plan: 'Approved', breakdown: null }, intakeStatus: 'Todo', useDefaultColumns: false, ...board },
      accepted,
    });

  it('shows the mapping, the approval columns and the intake column, and holds Confirm until it is accepted', () => {
    render(<OnboardingPanel projectId="p1" initial={view({ proposal: boardProposal() })} />);
    const card = screen.getByRole('region', { name: 'GitHub board columns' });
    expect(within(card).getByText('Doing')).toBeInTheDocument();
    expect(within(card).getAllByText('Approved').length).toBeGreaterThan(0);
    expect(within(card).getByText('must be accepted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm the project' })).toBeDisabled();
    expect(screen.queryByText(/pasted tickets/)).not.toBeInTheDocument();
  });

  it('Confirm is on once the board card is accepted', () => {
    render(<OnboardingPanel projectId="p1" initial={view({ proposal: boardProposal({}, { board: true }) })} />);
    expect(screen.getByRole('button', { name: 'Confirm the project' })).toBeEnabled();
  });

  it('the default-columns switch is sent at once, and says the columns are added when needed', async () => {
    fetchMock.mockResolvedValue(reply(view({ proposal: boardProposal({ useDefaultColumns: true }) })));
    render(<OnboardingPanel projectId="p1" initial={view({ proposal: boardProposal() })} />);
    const card = screen.getByRole('region', { name: 'GitHub board columns' });
    const toggle = within(card).getByRole('switch', { name: /default columns/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects/p1/onboarding/sections/board');
    expect(sentBody()).toEqual({ action: 'edit', value: { useDefaultColumns: true } });
    expect(await within(card).findByText(/added to the board when they are first needed/)).toBeInTheDocument();
  });

  it('edits the columns as lines and sends them as a map', async () => {
    fetchMock.mockResolvedValue(reply(view({ proposal: boardProposal() })));
    render(<OnboardingPanel projectId="p1" initial={view({ proposal: boardProposal() })} />);
    const card = screen.getByRole('region', { name: 'GitHub board columns' });
    await userEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    const plan = within(card).getByLabelText('Plan approved column (empty for none)');
    await userEvent.clear(plan);
    await userEvent.type(plan, 'Done');
    await userEvent.click(within(card).getByRole('button', { name: 'Save and accept' }));
    expect(sentBody()).toEqual({ action: 'edit', value: { statusMap: { PLANNING: 'Doing', DONE: 'Done' }, approval: { plan: 'Done', breakdown: null }, intakeStatus: 'Todo' } });
  });
});

describe('ProjectSummary', () => {
  const project = { id: 'p1', name: 'billing', repoUrl: 'https://github.com/acme/billing', baseBranch: 'main', stack: 'nestjs', settings: { ...DEFAULT_PROJECT_SETTINGS, github: { ...DEFAULT_PROJECT_SETTINGS.github, mode: 'projects', project: { owner: 'acme', number: 3 } }, confluence: { spaceKey: 'ENG', parentPageId: '1' } } } as unknown as ProjectView;
  it('shows what the project is, without every setting', () => {
    render(<ProjectSummary project={project} />);
    expect(screen.getByText('GitHub board acme/3, and pasted tickets')).toBeInTheDocument();
    expect(screen.getByText('Committed to the knowledge-base folder of the repository')).toBeInTheDocument();
  });
  it('says pasted tickets only without a GitHub source', () => {
    render(<ProjectSummary project={{ ...project, settings: { ...project.settings, github: { ...project.settings.github, mode: 'off' } } }} />);
    expect(screen.getByText('Pasted tickets only')).toBeInTheDocument();
  });
});
