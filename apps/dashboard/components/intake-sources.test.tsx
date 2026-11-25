import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntakeSources } from './intake-sources';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const on = { intakeJiraEnabled: true, intakeGithubEnabled: true, intakePasteEnabled: true, intakePaused: false };

describe('IntakeSources', () => {
  it('shows one switch per source, all on by default', () => {
    render(<IntakeSources settings={on} />);
    expect(screen.getAllByRole('checkbox').map((c) => (c as HTMLInputElement).checked)).toEqual([true, true, true]);
    expect(screen.getByRole('checkbox', { name: /GitHub/ })).toBeInTheDocument();
  });

  it('switches one source off with one PATCH, and nothing else', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<IntakeSources settings={on} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Jira/ }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/system/settings');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ intakeJiraEnabled: false });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('says when the whole intake is paused, and shows a server error', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'Nope' }) });
    render(<IntakeSources settings={{ ...on, intakePaused: true }} />);
    expect(screen.getByText(/Intake is paused as a whole/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Pasted/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope');
  });
});
