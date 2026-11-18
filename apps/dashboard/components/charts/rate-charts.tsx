'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatLocal, formatUtcShort, useChartLabel, useIsClient } from '@/lib/local-time';
import { formatDateTime } from '@/lib/ticket-status';
import type { RateSeriesView, UsageRateView } from '@/lib/types';
import { ChartFrame } from './chart-frame';
import { ACCENT, AXIS_PROPS, tooltipStyle } from './theme';

const RED = 'var(--status-red)';
type Row = Record<string, number | string | null>;

/**
 * One line per segment, so a reset never shows as a fall and a gap with no data is a break in the line, not a line drawn
 * across it (BUILD_PLAN v1 6.4). Rows are keyed by time; each segment only has values in its own rows.
 */
export function segmentRows(series: RateSeriesView, label: (iso: string) => string = formatUtcShort, prefix = 's'): { rows: Row[]; keys: string[] } {
  const rows = new Map<string, Row>();
  const keys: string[] = [];
  series.segments.forEach((seg, i) => {
    const key = `${prefix}${i}`;
    keys.push(key);
    for (const p of seg.points) {
      if (p.rate === null) continue;
      const row = rows.get(p.at) ?? { at: p.at, label: label(p.at) };
      row[key] = p.rate;
      rows.set(p.at, row);
    }
  });
  return { rows: [...rows.values()].sort((a, b) => String(a.at).localeCompare(String(b.at))), keys };
}

/** The rows of two series on one time axis. */
function mergeRows(...lists: Row[][]): Row[] {
  const merged = new Map<string, Row>();
  for (const list of lists) for (const r of list) merged.set(String(r.at), { ...(merged.get(String(r.at)) ?? {}), ...r });
  return [...merged.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function sentence(name: string, series: RateSeriesView, clock: (iso: string | null) => string): string {
  const latest = series.latest;
  const projection = series.projection;
  return [
    latest ? `${name}: now at ${Math.round(latest.pct)}%${latest.rate !== null ? `, rising ${latest.rate} ${series.unit}` : ''}.` : `${name}: no data yet.`,
    projection ? (projection.reachesAt ? `${projection.note}: ${clock(projection.reachesAt)}.` : `${projection.note}.`) : '',
  ].filter(Boolean).join(' ');
}

/**
 * How fast usage is rising, both windows on one chart: the 5-hour window as points per hour (accent line, left axis) and the weekly
 * window as points per day (red line, right axis), with the projection to each threshold in the text alternative.
 */
export function RateCharts({ data, compact = false }: { data: UsageRateView; compact?: boolean }) {
  const label = useChartLabel();
  const clock = useIsClient() ? formatLocal : formatDateTime;
  const five = segmentRows(data.fiveHour, label, 'h');
  const week = segmentRows(data.weekly, label, 'd');
  const rows = mergeRows(five.rows, week.rows);
  const legend = (
    <p className="ml-auto flex items-center gap-3 text-xs text-muted">
      <span className="flex items-center gap-1">
        <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: ACCENT }} />
        5-hour, pts/hour
      </span>
      <span className="flex items-center gap-1">
        <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: RED }} />
        weekly, pts/day
      </span>
    </p>
  );
  return (
    <ChartFrame
      title="How fast usage is rising"
      summary={`${sentence('5-hour window', data.fiveHour, clock)} ${sentence('Weekly window', data.weekly, clock)}`}
      action={legend}
      empty={rows.length === 0}
      emptyText="Not enough snapshots yet to show a rate. Two snapshots close together are needed."
      table={{
        columns: ['When', 'Window', 'Rate', 'Percent'],
        rows: [
          ...data.fiveHour.segments.flatMap((s) => s.points.filter((p) => p.rate !== null).map((p) => [label(p.at), '5-hour', `${p.rate} pts/hour`, Math.round(p.pct * 10) / 10])),
          ...data.weekly.segments.flatMap((s) => s.points.filter((p) => p.rate !== null).map((p) => [label(p.at), 'weekly', `${p.rate} pts/day`, Math.round(p.pct * 10) / 10])),
        ],
      }}
    >
      <ResponsiveContainer width="100%" height={compact ? 140 : 240}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={32} hide={compact} />
          <YAxis yAxisId="h" width={40} {...AXIS_PROPS} />
          <YAxis yAxisId="d" orientation="right" width={40} {...AXIS_PROPS} stroke={RED} tick={{ ...AXIS_PROPS.tick, fill: RED }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [typeof v === 'number' ? v : String(v), String(name)]} />
          {five.keys.map((k) => (
            <Line key={k} yAxisId="h" type="monotone" dataKey={k} name="5-hour (pts/hour)" stroke={ACCENT} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          ))}
          {week.keys.map((k) => (
            <Line key={k} yAxisId="d" type="monotone" dataKey={k} name="weekly (pts/day)" stroke={RED} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
