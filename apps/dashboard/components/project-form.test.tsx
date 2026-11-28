import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_PROJECT_SETTINGS } from '@sdlc/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MirrorStatus } from './mirror-status';
import { ProjectForm } from './project-form';
import type { ProjectView } from '@/lib/types';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

const fetchMock = vi.fn();
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

const existing: ProjectView = {
  id: 'p1', name: 'Billing', repoUrl: 'https://github.com/a/b', baseBranch: 'dev', stack: 'nestjs', installCmd: 'npm ci',
  typecheckCmd: 'npx tsc --noEmit', testCmdTemplate: 'npx jest {files}', kbDir: 'docs/kb', claudeMdMode: 'both',
  localKeyPrefix: 'BILL', enabled: true, mirrorStatus: 'ok', mirrorError: null, nextLocalNumber: 1, createdAt: '', updatedAt: '',
  settings: DEFAULT_PROJECT_SETTINGS,
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  push.mockReset();
  refresh.mockReset();
});

describe('ProjectForm', () => {
  it('pre-fills the three commands when the stack changes', async () => {
    render(<ProjectForm />);
    expect(screen.getByLabelText('Test command template')).toHaveValue('npx vitest run {files}');
    await userEvent.selectOptions(screen.getByLabelText('Stack'), 'nestjs');
    expect(screen.getByLabelText('Test command template')).toHaveValue('npx jest {files}');
    expect(screen.getByLabelText('Install command')).toHaveValue('npm ci');
  });

  it('warns when the install or typecheck command is empty', async () => {
    render(<ProjectForm />);
    expect(screen.queryByRole('list', { name: 'Warnings' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Typecheck command'));
    expect(screen.getByText(/typecheck step is skipped/i)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Install command'));
    expect(screen.getByText(/install step is skipped/i)).toBeInTheDocument();
  });

  it('shows a stage-dependency warning when a dependent stage is disabled, and locks implement on', async () => {
    render(<ProjectForm />);
    expect(screen.getByLabelText('Coder enabled')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Solution architect enabled'));
    expect(screen.getByText(/the ticket body becomes the plan\./)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('PR reviewer enabled'));
    expect(screen.getByText(/The correctness review is skipped\./)).toBeInTheDocument();
  });

  it('shows the GitHub approval fields for the mode that uses them', async () => {
    render(<ProjectForm />);
    expect(screen.queryByLabelText('Plan approved column')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Source'), 'projects');
    expect(screen.getByLabelText('Plan approved column')).toBeInTheDocument();
    expect(screen.getByLabelText('Breakdown approved column')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Source'), 'issues');
    expect(screen.getByLabelText('Approval label')).toHaveValue('sdlc:approved');
  });

  it('creates a project: posts numbers as numbers and goes to the new project', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'new-id' }, 201));
    render(<ProjectForm />);
    await userEvent.type(screen.getByLabelText('Name'), 'Billing');
    await userEvent.type(screen.getByLabelText('Repository URL'), 'https://github.com/a/b');
    await userEvent.clear(screen.getByLabelText('Solution architect max turns'));
    await userEvent.type(screen.getByLabelText('Solution architect max turns'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/new-id'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/projects');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ name: 'Billing', repoUrl: 'https://github.com/a/b', stack: 'ts_node', baseBranch: 'dev' });
    expect(body.settings.stages.solutionDesign.maxTurns).toBe(7);
    expect(body.settings.limits.maxSubtasks).toBe(8);
    expect(body.localKeyPrefix).toBeUndefined();
  });

  it('shows field-level errors next to the fields, including nested settings', async () => {
    fetchMock.mockResolvedValue(
      ok({ error: 'validation_error', message: 'Validation failed', fields: { name: 'required', testCmdTemplate: 'must contain {files}', 'settings.limits.maxSubtasks': 'must be at least 1' } }, 400),
    );
    render(<ProjectForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('must contain {files}')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Max subtasks')).toHaveAttribute('aria-describedby', 'settings.limits.maxSubtasks-error');
    expect(screen.getByText('must be at least 1')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    expect(screen.queryByText('required')).not.toBeInTheDocument(); // an error clears when the field is edited
  });

  it('shows per-line errors on the red-pattern list', async () => {
    fetchMock.mockResolvedValue(ok({ error: 'validation_error', message: 'Validation failed', fields: { 'settings.verify.redInvalidPatterns.1': 'must be a valid regular expression' } }, 400));
    render(<ProjectForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('line 2: must be a valid regular expression')).toBeInTheDocument();
  });

  it('edits a project with PATCH and confirms the save', async () => {
    fetchMock.mockResolvedValue(ok({ ...existing }));
    render(<ProjectForm project={existing} />);
    expect(screen.getByLabelText('Name')).toHaveValue('Billing');
    await userEvent.clear(screen.getByLabelText('Base branch'));
    await userEvent.type(screen.getByLabelText('Base branch'), 'main');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Saved\. Changes apply from the next stage run/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/projects/p1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body)).baseBranch).toBe('main');
    expect(refresh).toHaveBeenCalled();
  });

  it('reports a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    render(<ProjectForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Cannot reach the server.')).toBeInTheDocument();
  });
});

describe('MirrorStatus', () => {
  it('shows Cloning while pending', () => {
    render(<MirrorStatus project={{ ...existing, mirrorStatus: 'pending' }} />);
    expect(within(screen.getByRole('status')).getByText('Cloning…')).toBeInTheDocument();
  });

  it('shows Ready when ok, and can clone a ready mirror again', async () => {
    fetchMock.mockResolvedValue(ok({}));
    render(<MirrorStatus project={existing} />);
    expect(screen.getByRole('status')).toHaveTextContent('Ready');
    await userEvent.click(screen.getByRole('button', { name: 'Clone again' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1/mirror/retry', { method: 'POST' }));
  });

  it('shows the error and retries a failed mirror', async () => {
    fetchMock.mockResolvedValue(ok({}));
    render(<MirrorStatus project={{ ...existing, mirrorStatus: 'failed', mirrorError: 'fatal: repository not found' }} />);
    expect(screen.getByText('fatal: repository not found')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1/mirror/retry', { method: 'POST' }));
    expect(refresh).toHaveBeenCalled();
  });
});
