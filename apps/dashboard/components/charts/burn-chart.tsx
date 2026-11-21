'use client';

import { useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PERIOD_LABEL, formatCredits } from '@/lib/budgets';
import { formatLocal, useChartLabel, useIsClient } from '@/lib/local-time';
import { formatDateTime } from '@/lib/ticket-status';
import type { BudgetPeriodName, PeriodBurnView } from '@/lib/types';
import { ChartFrame } from './chart-frame';
import { ACCENT, AXIS_PROPS, GRID, lower, tooltipStyle } from './theme';

const RED = 'var(--status-red)';
const PERIODS: BudgetPeriodName[] = ['daily', 'weekly', 'monthly'];

/** Credits per hour (today) or per day (this week, this month), the running total against the budget, and where it is heading. */
export function BurnChart({ burn }: { burn: Record<BudgetPeriodName, PeriodBurnView> }) {
  const [period, setPeriod] = useState<BudgetPeriodName>('daily');
  const label = useChartLabel();
  // The browser's own time zone once it is known; UTC on the server, so hydration matches.
  const when = useIsClient() ? formatLocal : formatDateTime;
  const b = burn[period];
  const rows = b.buckets.map((x) => ({ ...x, label: label(x.at) }));
  const heading = b.projectedAtEnd === null ? 'Nothing spent yet in this period.' : `At this rate the period ends at ${formatCredits(b.projectedAtEnd)}.`;
  const reaches = b.reachesBudgetAt ? ` The budget is used up ${when(b.reachesBudgetAt)}.` : '';
  return (
    <ChartFrame
      title="Spend rate"
      summary={`${PERIOD_LABEL[period]}: ${formatCredits(b.spent)} spent${b.budget !== null ? ` of ${formatCredits(b.budget)}` : ''}, per ${b.unit}. ${heading}${reaches}`}
      empty={b.spent === 0}
      emptyText="Nothing spent yet in this period."
      table={{ columns: ['When', 'Credits', 'Running total'], rows: b.buckets.filter((x) => x.credits > 0).map((x) => [label(x.at), x.credits, x.cumulative]) }}
      action={
        <div role="group" aria-label="Period" className="flex gap-1 text-xs">
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} className={`rounded px-2 py-0.5 ${period === p ? 'bg-accent text-accent-text' : 'border border-border text-muted'}`}>
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={32} />
          <YAxis width={44} {...AXIS_PROPS} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => (typeof v === 'number' ? formatCredits(v) : String(v))} />
          <Bar dataKey="credits" name="Credits" fill={lower(ACCENT)} isAnimationActive={false} />
          <Line type="monotone" dataKey="cumulative" name="Running total" stroke={ACCENT} strokeWidth={2} dot={false} isAnimationActive={false} />
          {b.budget !== null && <ReferenceLine y={b.budget} stroke={lower(RED)} strokeDasharray="4 4" label={{ value: `budget ${b.budget}`, position: 'insideTopRight', fill: lower(RED), fontSize: 11 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
