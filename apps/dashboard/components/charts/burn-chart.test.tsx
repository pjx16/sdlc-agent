import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { PeriodBurnView } from '@/lib/types';
import { BurnChart } from './burn-chart';

const burn = (over: Partial<PeriodBurnView>): PeriodBurnView => ({
  period: 'daily', unit: 'hour', start: '2026-11-21T00:00:00Z', end: '2026-11-22T00:00:00Z', budget: null, spent: 0, projectedAtEnd: null, reachesBudgetAt: null, buckets: [], ...over,
});

describe('BurnChart', () => {
  const data = {
    daily: burn({ spent: 2, budget: 6, projectedAtEnd: 8, reachesBudgetAt: '2026-11-21T18:00:00Z', buckets: [{ at: '2026-11-21T01:00:00Z', credits: 2, cumulative: 2 }] }),
    weekly: burn({ period: 'weekly', unit: 'day' }),
    monthly: burn({ period: 'monthly', unit: 'day', spent: 40, buckets: [{ at: '2026-11-03T00:00:00Z', credits: 40, cumulative: 40 }] }),
  };

  it('says where today is heading and when the budget is used up, and switches period', async () => {
    render(<BurnChart burn={data} />);
    expect(screen.getByText(/Today: 2\.00 credits spent of 6\.00 credits, per hour\. At this rate the period ends at 8\.00 credits\. The budget is used up 2026-11-21 18:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'This week' }));
    expect(screen.getByText('Nothing spent yet in this period.', { selector: 'p.py-10' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'This month' }));
    expect(screen.getByText(/This month: 40\.00 credits spent, per day/)).toBeInTheDocument();
  });
});
