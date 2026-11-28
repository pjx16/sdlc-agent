import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewProjectButton } from './new-project-button';

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh: vi.fn() }) }));

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  fetchMock.mockReset();
  push.mockReset();
  replace.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.restoreAllMocks());

const dialogEl = () => document.querySelector('dialog') as HTMLDialogElement;
const modal = () => screen.getByRole('dialog', { name: 'New project' });
const open = async () => userEvent.click(screen.getByRole('button', { name: 'New project' }));

describe('New project modal', () => {
  it('opens in place from the button, with no navigation, and says what a project is', async () => {
    render(<NewProjectButton />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await open();
    expect(modal()).toHaveAccessibleDescription(/one repository sdlc-agent works on. You can add as many as you like/);
    expect(push).not.toHaveBeenCalled();
    expect(within(modal()).getByRole('tab', { name: /Quick start/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(modal()).getByLabelText('Repository URL')).toBeInTheDocument();
  });

  it('quick start: creates the project, closes, and opens its page', async () => {
    fetchMock.mockResolvedValue(reply({ id: 'p9' }));
    render(<NewProjectButton />);
    await open();
    await userEvent.type(within(modal()).getByLabelText('Repository URL'), 'https://github.com/acme/billing');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p9'));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects/onboard');
    expect(dialogEl()).not.toHaveAttribute('open');
  });

  it('quick start: a validation error stays inside the modal', async () => {
    fetchMock.mockResolvedValue(reply({ fields: { repoUrl: 'must be an HTTPS github.com URL' } }, 400));
    render(<NewProjectButton />);
    await open();
    await userEvent.type(within(modal()).getByLabelText('Repository URL'), 'nope');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Start' }));
    expect(await within(modal()).findByText('must be an HTTPS github.com URL')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(modal()).toHaveAttribute('open');
  });

  it('manual: every setting is there in folding sections with only the first open, and it creates the project', async () => {
    fetchMock.mockResolvedValue(reply({ id: 'p7' }));
    render(<NewProjectButton />);
    await open();
    await userEvent.click(within(modal()).getByRole('tab', { name: 'Manual' }));
    const repository = within(modal()).getByText('Repository').closest('details') as HTMLDetailsElement;
    const commands = within(modal()).getByText('Commands').closest('details') as HTMLDetailsElement;
    expect(repository.open).toBe(true);
    expect(commands.open).toBe(false);
    await userEvent.type(within(modal()).getByLabelText('Name', { exact: true }), 'Shipping');
    await userEvent.type(within(modal()).getByLabelText('Repository URL'), 'https://github.com/acme/shipping');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p7'));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects');
  });

  it('manual: a server error in a folded section opens the sections so it is seen', async () => {
    fetchMock.mockResolvedValue(reply({ fields: { installCmd: 'required' } }, 400));
    render(<NewProjectButton />);
    await open();
    await userEvent.click(within(modal()).getByRole('tab', { name: 'Manual' }));
    expect((within(modal()).getByText('Commands').closest('details') as HTMLDetailsElement).open).toBe(false);
    await userEvent.type(within(modal()).getByLabelText('Name', { exact: true }), 'X');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect((within(modal()).getByText('Commands').closest('details') as HTMLDetailsElement).open).toBe(true));
    expect(await within(modal()).findByText('required')).toBeInTheDocument();
  });

  it('asks before throwing away what was typed, and not when nothing was', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<NewProjectButton />);
    await open();
    await userEvent.click(within(modal()).getByRole('button', { name: 'Close' }));
    expect(confirm).not.toHaveBeenCalled();
    await open();
    await userEvent.type(within(modal()).getByLabelText('Repository URL'), 'https://github.com/acme/x');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Close' }));
    expect(confirm).toHaveBeenCalledWith('Discard your changes?');
    expect(modal()).toHaveAttribute('open');
    confirm.mockReturnValue(true);
    await userEvent.click(within(modal()).getByRole('button', { name: 'Close' }));
    expect(dialogEl()).not.toHaveAttribute('open');
  });

  it('starts empty each time it is opened', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<NewProjectButton />);
    await open();
    await userEvent.type(within(modal()).getByLabelText('Repository URL'), 'https://github.com/acme/x');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Close' }));
    await open();
    expect(within(modal()).getByLabelText('Repository URL')).toHaveValue('');
  });

  describe('as a link (/projects/new)', () => {
    it('starts open, in quick start, and closing goes back to /projects', async () => {
      render(<NewProjectButton defaultOpen="quick" />);
      expect(modal()).toHaveAttribute('open');
      expect(within(modal()).getByRole('tab', { name: /Quick start/ })).toHaveAttribute('aria-selected', 'true');
      await userEvent.click(within(modal()).getByRole('button', { name: 'Close' }));
      expect(replace).toHaveBeenCalledWith('/projects');
    });

    it('/projects/new?manual=1 starts in manual mode', () => {
      render(<NewProjectButton defaultOpen="manual" />);
      expect(within(modal()).getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true');
      expect(within(modal()).getByLabelText('Name', { exact: true })).toBeInTheDocument();
    });

    it('creating a project from it goes to the project page, not back to the list', async () => {
      fetchMock.mockResolvedValue(reply({ id: 'p3' }));
      render(<NewProjectButton defaultOpen="quick" />);
      await userEvent.type(within(modal()).getByLabelText('Repository URL'), 'https://github.com/acme/y');
      await userEvent.click(within(modal()).getByRole('button', { name: 'Start' }));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p3'));
      expect(replace).not.toHaveBeenCalled();
    });
  });

  it('can be used more than once: another project can always be created', async () => {
    fetchMock.mockResolvedValueOnce(reply({ id: 'a' })).mockResolvedValueOnce(reply({ id: 'b' }));
    render(<NewProjectButton />);
    for (const id of ['a', 'b']) {
      await open();
      await userEvent.type(within(modal()).getByLabelText('Repository URL'), `https://github.com/acme/${id}`);
      await userEvent.click(within(modal()).getByRole('button', { name: 'Start' }));
      await waitFor(() => expect(push).toHaveBeenLastCalledWith(`/projects/${id}`));
    }
  });
});
