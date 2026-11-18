import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalPreview } from './approval-preview';

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => fetchMock.mockReset());
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });

describe('ApprovalPreview', () => {
  it('loads the plan only when opened and shows it', async () => {
    fetchMock.mockResolvedValue(reply({ planMarkdown: '## Plan\nAdd a README' }));
    render(<ApprovalPreview ticketId="t1" stage="plan" />);
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('View the plan'));
    await waitFor(() => expect(screen.getByText(/Add a README/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/tickets/t1');
    expect(screen.getByRole('link', { name: 'open the ticket' })).toHaveAttribute('href', '/tickets/t1?tab=plan');
  });

  it('lists the subtasks of a breakdown with their criteria', async () => {
    fetchMock.mockResolvedValue(reply({ breakdownDraft: [{ seq: 1, title: 'Write README', description: 'd', acceptanceCriteria: ['README.md exists'], files: ['README.md'], dependsOn: [] }] }));
    render(<ApprovalPreview ticketId="t1" stage="breakdown" />);
    await userEvent.click(screen.getByText('View the breakdown'));
    await waitFor(() => expect(screen.getByText('Write README')).toBeInTheDocument());
    expect(screen.getByText('README.md exists')).toBeInTheDocument();
  });

  it('says so when there is nothing to show or the load fails', async () => {
    fetchMock.mockResolvedValue(reply({ planMarkdown: null }));
    render(<ApprovalPreview ticketId="t1" stage="plan" />);
    await userEvent.click(screen.getByText('View the plan'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('There is no plan to show yet.'));
  });
});
