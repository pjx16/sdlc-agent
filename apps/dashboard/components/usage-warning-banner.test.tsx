import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UsageWarningBanner } from './usage-warning-banner';
import type { SystemView } from '@/lib/types';

const sys = (spent: number): SystemView =>
  ({ settings: { pipelinePaused: false }, spend: { timezone: 'UTC', warnPct: 80, periods: [{ period: 'weekly', spent, budget: 50, pct: (spent / 50) * 100, resetsAt: '2026-11-23T00:00:00Z' }], suggested: { daily: 10, weekly: 50, monthly: 150 } } }) as unknown as SystemView;

describe('UsageWarningBanner', () => {
  it('shows the heads-up as a note, not as a live status: a page keeps its own status messages for its actions', () => {
    render(<UsageWarningBanner system={sys(42)} />);
    expect(screen.getByRole('note', { name: 'Budget warning' })).toHaveTextContent('weekly 84% (42.00 credits of 50.00 credits)');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('renders nothing while spend is well under the budgets', () => {
    const { container } = render(<UsageWarningBanner system={sys(10)} />);
    expect(container).toBeEmptyDOMElement();
  });
});
