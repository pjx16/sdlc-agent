import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketKbAttachments } from './ticket-kb-attachments';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('TicketKbAttachments', () => {
  it('shows the attached docs, and nothing for a coded ticket that has none', () => {
    const { container, rerender } = render(<TicketKbAttachments ticketId="t1" projectId="p1" status="PLANNING" attached={['auth.md']} />);
    expect(screen.getByText('auth.md')).toBeInTheDocument();
    rerender(<TicketKbAttachments ticketId="t1" projectId="p1" status="IN_PROGRESS" attached={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('cannot be changed once the ticket is being coded', () => {
    render(<TicketKbAttachments ticketId="t1" projectId="p1" status="IN_PROGRESS" attached={['auth.md']} />);
    expect(screen.getByText('auth.md')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });

  it('changes the docs with one PATCH and refreshes', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === 'PATCH' ? reply({}) : reply({ docs: [{ path: 'auth.md', title: 'Auth' }, { path: 'billing.md', title: 'Billing' }] })));
    render(<TicketKbAttachments ticketId="t1" projectId="p1" status="PLANNING" attached={['auth.md']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByRole('button', { name: /Attach knowledge-base docs/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Billing/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH') as [string, RequestInit];
    expect(patch[0]).toBe('/api/tickets/t1/kb-attachments');
    expect(JSON.parse(String(patch[1].body))).toEqual({ kbAttachments: ['auth.md', 'billing.md'] });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('shows why a change was refused and keeps the editor open', async () => {
    fetchMock.mockResolvedValue(reply({ fields: { kbAttachments: 'not a KB doc of this project: x.md' } }, 400));
    render(<TicketKbAttachments ticketId="t1" projectId="p1" status="NEW" attached={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a KB doc of this project');
    expect(refresh).not.toHaveBeenCalled();
  });
});
