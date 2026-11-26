import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectView } from '@/lib/types';
import type { TicketFormData } from '@/lib/ticket-form-data';
import { CreateTicketButton } from './create-ticket-button';
import { CriteriaList } from './criteria-list';

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

const project = (over: Partial<ProjectView> = {}) => ({ id: 'p1', name: 'Billing', enabled: true, mirrorStatus: 'ok', onboardingStatus: 'confirmed', settings: { github: { mode: 'off' } }, ...over }) as unknown as ProjectView;
const data = (over: Partial<TicketFormData> = {}): TicketFormData => ({ projects: [project()], template: '## Problem\n\n## Expected behaviour\n\n## Acceptance criteria\n\n## Notes\n', githubIssueOnCreate: 'ask', ...over });

const open = async (d = data()) => {
  render(<CreateTicketButton data={d} />);
  await userEvent.click(screen.getByRole('button', { name: 'New ticket' }));
  return screen.getByRole('dialog', { name: 'New ticket' });
};
const fields = (dialog: HTMLElement) => within(within(dialog).getByRole('form', { name: 'Ticket fields' }));
const preview = (dialog: HTMLElement) => within(within(dialog).getByRole('region', { name: 'Preview of the ticket' }));

async function fillMinimum(dialog: HTMLElement) {
  const f = fields(dialog);
  await userEvent.type(f.getByLabelText(/^Title/), 'Add CSV export');
  await userEvent.type(f.getByLabelText(/^Problem/), 'Finance cannot export.');
  await userEvent.type(f.getByLabelText('Criterion 1'), 'Exports every row');
}

describe('New ticket window', () => {
  it('opens in place, 90vw by 90vh, with the fields on the left and a read-only preview on the right', async () => {
    const dialog = await open();
    expect(dialog.closest('dialog')).toHaveClass('w-[90vw]', 'h-[90vh]');
    expect(push).not.toHaveBeenCalled();
    for (const name of [/^Title/, /^Problem/, /^Expected behaviour/, /^Notes/]) expect(fields(dialog).getByLabelText(name)).toBeInTheDocument();
    expect(fields(dialog).getByRole('list', { name: 'Acceptance criteria' })).toBeInTheDocument();
    expect(preview(dialog).getByText('The ticket appears here as you write it.')).toBeInTheDocument();
    expect(preview(dialog).queryAllByRole('textbox')).toHaveLength(0); // read only: nothing to type in
    expect(preview(dialog).queryByRole('tablist')).not.toBeInTheDocument(); // and no Preview / Raw switch
  });

  it('the preview is the ticket as it will be stored, in the order of the team format, and follows what is typed', async () => {
    const dialog = await open();
    const f = fields(dialog);
    await userEvent.type(f.getByLabelText(/^Title/), 'Add CSV export');
    await userEvent.type(f.getByLabelText(/^Problem/), 'Finance cannot export.');
    await userEvent.type(f.getByLabelText('Criterion 1'), 'Exports every row');
    await userEvent.click(f.getByRole('button', { name: '+ Add a criterion' }));
    await userEvent.type(f.getByLabelText('Criterion 2'), 'Opens in Excel');
    await userEvent.type(f.getByLabelText(/^Notes/), 'See the March thread.');
    const p = preview(dialog);
    await waitFor(() => expect(p.getByRole('heading', { name: 'Problem' })).toBeInTheDocument());
    expect(p.getByRole('heading', { level: 3, name: 'Add CSV export' })).toBeInTheDocument();
    expect(p.getAllByRole('checkbox')).toHaveLength(2);
    expect(p.getByText('Opens in Excel')).toBeInTheDocument();
    const order = p.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(order).toEqual(['Problem', 'Acceptance criteria', 'Notes']); // no expected behaviour was written, so no empty section
  });

  it('offers only enabled, confirmed projects and marks one whose mirror is not ready', async () => {
    const dialog = await open(data({ projects: [project(), project({ id: 'p2', name: 'Off', enabled: false }), project({ id: 'p3', name: 'Cloning', mirrorStatus: 'pending' }), project({ id: 'p4', name: 'Profiling', onboardingStatus: 'profiling' })] }));
    expect(within(fields(dialog).getByLabelText('Project')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Billing', 'Cloning (mirror pending)']);
  });

  it('with no usable project it says so, and cannot create anything', async () => {
    const dialog = await open(data({ projects: [project({ enabled: false })] }));
    expect(within(dialog).getByText('There is no enabled project yet. Create a project first.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create ticket' })).toBeDisabled();
  });

  describe('a bug', () => {
    it('has steps to reproduce, and needs the expected behaviour; a feature has neither', async () => {
      const dialog = await open();
      const f = fields(dialog);
      expect(f.queryByLabelText(/^Steps to reproduce/)).not.toBeInTheDocument();
      expect(f.getByLabelText(/^Expected behaviour/).closest('div')?.querySelector('[aria-hidden]')).toBeNull(); // not required
      await userEvent.click(f.getByRole('radio', { name: 'Bug' }));
      expect(f.getByLabelText(/^Steps to reproduce/)).toBeInTheDocument();
      expect(f.getByText('Expected behaviour').parentElement?.querySelector('[aria-hidden]')).not.toBeNull(); // required
      await fillMinimum(dialog);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
      expect(await f.findByText('required for a bug')).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('its steps appear in the preview between the expected behaviour and the criteria', async () => {
      const dialog = await open(data({ template: '' }));
      const f = fields(dialog);
      await userEvent.click(f.getByRole('radio', { name: 'Bug' }));
      await userEvent.type(f.getByLabelText(/^Problem/), 'Export crashes.');
      await userEvent.type(f.getByLabelText(/^Expected behaviour/), 'It exports.');
      await userEvent.type(f.getByLabelText(/^Steps to reproduce/), 'Click Export');
      await userEvent.type(f.getByLabelText('Criterion 1'), 'No crash');
      await waitFor(() => expect(preview(dialog).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Problem', 'Expected behaviour', 'Steps to reproduce', 'Acceptance criteria']));
    });
  });

  describe('creating it', () => {
    it('shows what is missing at the field, sends nothing, and does not close', async () => {
      const dialog = await open();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
      expect(await fields(dialog).findByText('add at least one acceptance criterion')).toBeInTheDocument();
      expect(fields(dialog).getAllByText('required').length).toBeGreaterThanOrEqual(2); // title and problem
      expect(fetchMock).not.toHaveBeenCalled();
      expect(dialog.closest('dialog')).toHaveAttribute('open');
    });

    it('sends the fields, closes, and opens the ticket', async () => {
      fetchMock.mockResolvedValue(reply({ id: 'new-1' }, 201));
      const dialog = await open();
      await fillMinimum(dialog);
      await userEvent.type(fields(dialog).getByLabelText(/^Notes/), 'See the thread');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets/new-1'));
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/tickets');
      expect(JSON.parse(String(init.body))).toEqual({ projectId: 'p1', kind: 'feature', title: 'Add CSV export', problem: 'Finance cannot export.', criteria: ['Exports every row'], notes: 'See the thread', kbAttachments: [] });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('an error from the server lands on its field and keeps what was typed', async () => {
      fetchMock.mockResolvedValue(reply({ fields: { featureKey: 'use lower-case letters, digits, dot, dash or underscore', kbAttachments: 'nope.md is not a doc' } }, 400));
      const dialog = await open();
      await fillMinimum(dialog);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
      expect(await within(dialog).findByText('Some fields need attention.')).toBeInTheDocument();
      expect(within(dialog).getByText('nope.md is not a doc')).toBeInTheDocument();
      expect(fields(dialog).getByLabelText(/^Title/)).toHaveValue('Add CSV export');
      expect(push).not.toHaveBeenCalled();
    });

    it('says when the server cannot be reached, or refuses without fields', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(reply({ message: 'The repository mirror is still being cloned' }, 409));
      const dialog = await open();
      await fillMinimum(dialog);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
      expect(await within(dialog).findByText('Cannot reach the server.')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
      expect(await within(dialog).findByText('The repository mirror is still being cloned')).toBeInTheDocument();
    });

    it('attached KB docs are loaded when asked for, and sent with the ticket', async () => {
      fetchMock.mockImplementation(async (url: string) => (url === '/api/projects/p1/kb' ? reply({ docs: [{ path: 'auth.md', title: 'Authentication' }], updatedAt: 'now' }) : reply({ id: 'new-2' }, 201)));
      const dialog = await open();
      await fillMinimum(dialog);
      await userEvent.click(within(dialog).getByRole('button', { name: /Attach knowledge-base docs/ }));
      await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Authentication/ }));
      await waitFor(() => expect(preview(dialog).getByText('auth.md')).toBeInTheDocument());
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets/new-2'));
      expect(JSON.parse(String((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body)).kbAttachments).toEqual(['auth.md']);
    });
  });

  describe('closing it', () => {
    it('asks first when something was written, from the close button and from Cancel', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const dialog = await open();
      await userEvent.type(fields(dialog).getByLabelText(/^Title/), 'Half done');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(dialog.closest('dialog')).toHaveAttribute('open');
      confirm.mockReturnValue(true);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not ask when nothing was written, and starts empty the next time', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      let dialog = await open();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(confirm).not.toHaveBeenCalled();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }));
      dialog = screen.getByRole('dialog', { name: 'New ticket' });
      await userEvent.type(fields(dialog).getByLabelText(/^Title/), 'Draft');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }));
      expect(fields(screen.getByRole('dialog')).getByLabelText(/^Title/)).toHaveValue('');
    });
  });

  it('as the /tickets/new address it starts open, and closing goes back to /tickets', async () => {
    render(<CreateTicketButton data={data()} defaultOpen />);
    const dialog = screen.getByRole('dialog', { name: 'New ticket' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(replace).toHaveBeenCalledWith('/tickets');
  });
});

describe('CriteriaList', () => {
  function Harness({ start = [''] }: { start?: string[] }) {
    const [items, setItems] = useState(start);
    return <CriteriaList items={items} onChange={setItems} errors={{ 1: 'must not be empty' }} />;
  }
  const rows = () => screen.getAllByLabelText(/^Criterion \d+$/) as HTMLInputElement[];

  it('Enter adds a row after the current one and moves into it, without sending a form', async () => {
    render(<Harness start={['first', 'third']} />);
    await userEvent.click(rows()[0]!);
    await userEvent.keyboard('{Enter}');
    expect(rows().map((r) => r.value)).toEqual(['first', '', 'third']);
    expect(rows()[1]).toHaveFocus();
  });

  it('Backspace in an empty row removes it and goes back to the one before; in a row with text it just deletes', async () => {
    render(<Harness start={['first', '']} />);
    await userEvent.click(rows()[1]!);
    await userEvent.keyboard('{Backspace}');
    expect(rows().map((r) => r.value)).toEqual(['first']);
    expect(rows()[0]).toHaveFocus();
    await userEvent.keyboard('{Backspace}'); // text: ordinary delete, the row stays
    expect(rows().map((r) => r.value)).toEqual(['firs']);
  });

  it('there is always one row: removing the last one only empties it', async () => {
    render(<Harness start={['only']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove criterion 1' }));
    expect(rows().map((r) => r.value)).toEqual(['']);
  });

  it('adds a row at the end, removes any row with its button, and shows an error under its row', async () => {
    render(<Harness start={['a', 'b']} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Add a criterion' }));
    expect(rows()).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Remove criterion 1' }));
    expect(rows().map((r) => r.value)).toEqual(['b', '']);
    expect(screen.getByText('must not be empty')).toBeInTheDocument();
    expect(rows()[1]).toHaveAttribute('aria-invalid', 'true');
  });
});
