import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TicketOverview } from './ticket-overview';
import { ticketStats } from '@/lib/ticket-stats';

const stats = ticketStats([], [], '2026-11-14T09:00:00Z', '2026-11-14T09:00:00Z');

describe('TicketOverview: PR size', () => {
  it('shows the size against the soft and hard limits', () => {
    const { rerender } = render(<TicketOverview stats={stats} pr={{ lines: 300, soft: 600, hard: 1500 }} />);
    expect(screen.getByText('300 lines')).toBeInTheDocument();
    expect(screen.getByText('Within the soft limit of 600')).toBeInTheDocument();
    rerender(<TicketOverview stats={stats} pr={{ lines: 700, soft: 600, hard: 1500 }} />);
    expect(screen.getByText('Over the soft limit of 600 (hard 1,500)')).toBeInTheDocument();
    rerender(<TicketOverview stats={stats} pr={{ lines: 1700, soft: 600, hard: 1500 }} />);
    expect(screen.getByText(/Over the hard limit of 1,500/)).toBeInTheDocument();
  });
  it('says it is measured after each subtask until there is a number', () => {
    render(<TicketOverview stats={stats} pr={{ lines: null, soft: 600, hard: 1500 }} />);
    expect(screen.getByText(/Measured after each subtask/)).toBeInTheDocument();
  });
});
