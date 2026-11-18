import type { SystemView } from './types';

/** How close to a threshold (in percentage points) counts as "nearing" it. */
export const NEAR_POINTS = 10;

export interface UsageWarning {
  text: string;
}

/**
 * The heads-up banner: usage is getting close to the pause thresholds, or Claude itself warned. It pauses nothing: the pipeline stops only
 * when a number crosses its threshold. A snapshot whose window has already reset (its reset time has passed) says nothing about now.
 */
export function usageWarning(system: SystemView | null, now: number = Date.now()): UsageWarning | null {
  const u = system?.usage;
  const s = system?.settings;
  if (!u || !s || s.pipelinePaused) return null;
  if (u.resetsAt && new Date(u.resetsAt).getTime() < now) return null;
  const parts: string[] = [];
  const near = (pct: number | null, threshold: number, label: string) => {
    if (pct !== null && pct < threshold && pct >= threshold - NEAR_POINTS) parts.push(`${label} ${Math.round(pct)}% (pauses at ${threshold}%)`);
  };
  near(u.fiveHourPct, s.usageThresholdPct, '5-hour usage');
  near(u.sevenDayPct, s.usageThresholdWeeklyPct, 'weekly usage');
  if (parts.length === 0 && u.status === 'allowed_warning') {
    const bits = [u.fiveHourPct !== null ? `5-hour ${Math.round(u.fiveHourPct)}% (pauses at ${s.usageThresholdPct}%)` : null, u.sevenDayPct !== null ? `weekly ${Math.round(u.sevenDayPct)}% (pauses at ${s.usageThresholdWeeklyPct}%)` : null].filter(Boolean);
    return { text: `Claude warns that usage is getting high${bits.length > 0 ? `: ${bits.join(', ')}` : ''}.` };
  }
  return parts.length > 0 ? { text: `Nearing the pause threshold: ${parts.join(', ')}.` } : null;
}
