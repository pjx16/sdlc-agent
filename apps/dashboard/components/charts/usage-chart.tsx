'use client';

import { Bar, BarChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCredits } from '@/lib/budgets';
import { useChartLabel } from '@/lib/local-time';
import type { MetricsUsage } from '@/lib/types';
import { ChartFrame } from './chart-frame';
import { ACCENT, AXIS_PROPS, GRID, tooltipStyle } from './theme';

/** Credits per hour (24h) or per day (7d, 30d), with pauses as markers (F17). Times are in the viewer's time zone. */
export function UsageChart({ data }: { data: MetricsUsage }) {
  const label = useChartLabel();
  const rows = data.series.map((s) => ({ ...s, label: label(s.at) }));
  const total = data.series.at(-1)?.cumulative ?? 0;
  const markers = data.pauses.map((p) => {
    const t = Date.parse(p.at);
    const bucket = [...rows].reverse().find((r) => Date.parse(r.at) <= t);
    return bucket ? { label: bucket.label, y: bucket.credits, message: p.message } : null;
  });
  return (
    <ChartFrame
      title="Spend over time"
      summary={`Credits per ${data.unit} (1 credit = 1 USD), ${formatCredits(total)} in range. ${data.pauses.length} pause(s) in range.`}
      empty={total === 0}
      emptyText="Nothing spent in this range."
      table={{ columns: ['When', 'Credits', 'Running total'], rows: data.series.filter((s) => s.credits > 0).map((s) => [label(s.at), s.credits, s.cumulative]) }}
    >
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={32} />
          <YAxis width={44} {...AXIS_PROPS} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => (typeof v === 'number' ? formatCredits(v) : String(v))} />
          <Bar dataKey="credits" name="Credits" fill={ACCENT} isAnimationActive={false} />
          {markers.map((m, i) => (m ? <ReferenceDot key={i} x={m.label} y={m.y} r={5} fill="var(--status-amber)" stroke="var(--surface)" /> : null))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
