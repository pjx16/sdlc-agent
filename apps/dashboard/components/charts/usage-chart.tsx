'use client';

import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartLabel } from '@/lib/local-time';
import type { MetricsUsage } from '@/lib/types';
import { ChartFrame } from './chart-frame';
import { ACCENT, AXIS_PROPS, GRID, lower, tooltipStyle } from './theme';

const RED = 'var(--status-red)';


/** The 5-hour window % as a line, the pause threshold as a dashed line, pauses as markers; the 7-day (weekly limit) % as a red line (F17). Times are in the viewer's time zone. */
export function UsageChart({ data }: { data: MetricsUsage }) {
  const label = useChartLabel();
  const rows = data.series.map((s) => ({ ...s, label: label(s.at) }));
  const markers = data.pauses.map((p) => {
    const nearest = rows.reduce<(typeof rows)[number] | undefined>((best, r) => (!best || Math.abs(Date.parse(r.at) - Date.parse(p.at)) < Math.abs(Date.parse(best.at) - Date.parse(p.at)) ? r : best), undefined);
    return nearest ? { label: nearest.label, y: nearest.fiveHourPct ?? data.thresholdPct, message: p.message } : null;
  });
  const latest = [...rows].reverse().find((r) => r.fiveHourPct !== null);
  return (
    <ChartFrame
      title="Usage over time"
      summary={`5-hour window usage with the ${data.thresholdPct}% pause threshold and the weekly limit with its ${data.thresholdWeeklyPct}% pause threshold${latest ? `; latest ${Math.round(latest.fiveHourPct as number)}%` : ''}. ${data.pauses.length} pause(s) in range.`}
      empty={rows.length === 0}
      emptyText="No usage recorded in this range. A snapshot is stored after every AI stage."
      table={{ columns: ['When', '5-hour %', '7-day %', 'Status'], rows: data.series.map((s) => [label(s.at), s.fiveHourPct === null ? null : Math.round(s.fiveHourPct * 10) / 10, s.sevenDayPct === null ? null : Math.round(s.sevenDayPct * 10) / 10, s.status]) }}
    >
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={32} />
          <YAxis domain={[0, 100]} unit="%" width={44} {...AXIS_PROPS} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => (typeof v === 'number' ? `${Math.round(v * 10) / 10}%` : String(v))} />
          <ReferenceLine y={data.thresholdPct} stroke={lower(ACCENT)} strokeDasharray="4 4" label={{ value: `5-hour pause at ${data.thresholdPct}%`, position: 'insideTopRight', fill: lower(ACCENT), fontSize: 11 }} />
          <ReferenceLine y={data.thresholdWeeklyPct} stroke={lower(RED)} strokeDasharray="4 4" label={{ value: `weekly pause at ${data.thresholdWeeklyPct}%`, position: 'insideBottomRight', fill: lower(RED), fontSize: 11 }} />
          <Line type="monotone" dataKey="sevenDayPct" name="7-day" stroke={RED} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="fiveHourPct" name="5-hour" stroke={ACCENT} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          {markers.map((m, i) => (m ? <ReferenceDot key={i} x={m.label} y={m.y} r={5} fill="var(--status-amber)" stroke="var(--surface)" /> : null))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
