/** Chart styling (F17): one accent colour, faint grid lines, monospace ticks. Colours are the dashboard's CSS variables, so both themes work. */
export const GRID = 'var(--border)';
export const AXIS = 'var(--muted)';
export const ACCENT = 'var(--accent)';
export const AXIS_PROPS = { stroke: AXIS, tick: { fill: AXIS, fontSize: 11, fontFamily: 'var(--font-mono)' }, tickLine: false, axisLine: { stroke: GRID } } as const;

/** A colour two shades lower: the same hue, mixed toward the surface, for the dashed threshold line that goes with a solid line of that colour. */
export const lower = (color: string): string => `color-mix(in srgb, ${color} 55%, var(--surface))`;

/** Tones of the accent for the n-th series of a stacked chart: strongest first. */
export const tone = (index: number, total: number): string => {
  const pct = total <= 1 ? 100 : Math.round(100 - (index * 70) / (total - 1));
  return `color-mix(in srgb, var(--accent) ${pct}%, var(--surface))`;
};

export const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' } as const;
