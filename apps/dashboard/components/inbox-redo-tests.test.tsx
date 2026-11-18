import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxRedoTests } from './inbox-redo-tests';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
});
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });

describe('InboxRedoTests', () => {
  it('is offered only when the ticket allows it', async () => {
    fetchMock.mockResolvedValue(reply({ canRedoTests: false }));
    const { container } = render(<InboxRedoTests ticketId="t1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('sends the tests of the stuck subtask back with the note', async () => {
    fetchMock.mockResolvedValueOnce(reply({ canRedoTests: true, subtask: { seq: 2, title: 'Add README link' } }));
    render(<InboxRedoTests ticketId="t1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Redo tests with a note' }));
    await userEvent.type(screen.getByLabelText('Your note'), 'import only fs and path');
    fetchMock.mockResolvedValueOnce(reply({}));
    await userEvent.click(screen.getByRole('button', { name: 'Redo the tests' }));
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/tickets/t1/subtasks/2/rerun');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ part: 'tests', note: 'import only fs and path' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
