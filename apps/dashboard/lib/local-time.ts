import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;
/** False on the server and during hydration, true afterwards: anything that depends on the browser's time zone waits for it. */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

function parts(d: Date, withZone: boolean) {
  const f = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(withZone ? { timeZoneName: 'short' } : {}) });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>;
}

/** "2026-11-14 17:23 GMT+5:30" in the browser's time zone. */
export function formatLocal(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = parts(d, true);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName}`;
}

/** "11-14 17:23" in the browser's time zone, for chart axes. */
export function formatLocalShort(iso: string): string {
  const p = parts(new Date(iso), false);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** The same, in UTC: what the server renders and what the first client render shows, so hydration always matches. */
export function formatUtcShort(iso: string): string {
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

/** An axis label function: UTC until the browser is ready, then local time. */
export function useChartLabel(): (iso: string) => string {
  return useIsClient() ? formatLocalShort : formatUtcShort;
}
