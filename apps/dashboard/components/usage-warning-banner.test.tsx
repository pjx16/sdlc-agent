import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UsageWarningBanner } from './usage-warning-banner';
import type { SystemView } from '@/lib/types';

const sys = (sevenDayPct: number): SystemView =>
  ({ settings: { pipelinePaused: false, usageThresholdPct: 90, usageThresholdWeeklyPct: 80 }, usage: { at: '', fiveHourPct: 10, sevenDayPct, status: 'allowed', resetsAt: '2026-11-15T11:00:00Z', source: 'event' } }) as unknown as SystemView;
const NOW = Date.parse('2026-11-14T13:30:00Z');

describe('UsageWarningBanner', () => {
  it('shows the heads-up as a note, not as a live status: a page keeps its own status messages for its actions', () => {
    render(<UsageWarningBanner system={sys(76)} now={NOW} />);
    expect(screen.getByRole('note', { name: 'Usage warning' })).toHaveTextContent('weekly usage 76% (pauses at 80%)');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('renders nothing while usage is well under the thresholds', () => {
    const { container } = render(<UsageWarningBanner system={sys(20)} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});
