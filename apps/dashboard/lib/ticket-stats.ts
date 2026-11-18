import type { RunView, SubtaskRow } from './types';

export interface TicketStats {
  tokens: { input: number; output: number; cacheWrite: number; cacheRead: number; /** input + output + cache writes: what counts against the usage window. */ counted: number };
  costUsd: number;
  turns: number;
  runs: { total: number; succeeded: number; failed: number; superseded: number; byUser: number };
  /** Time Claude was actually running, and the time from the ticket's creation to its last update. */
  agentSeconds: number;
  elapsedSeconds: number;
  byStage: { stage: string; runs: number; tokens: number; costUsd: number; seconds: number }[];
  byModel: { model: string; runs: number; tokens: number; costUsd: number }[];
  subtasks: { total: number; done: number; fixRounds: number };
}

const counted = (r: RunView) => r.inputTokens + r.outputTokens + (r.cacheWriteTokens ?? 0);
const seconds = (r: RunView) => (r.startedAt && r.endedAt ? Math.max(0, (Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000) : 0);

/** Everything the Overview tab shows, worked out from the ticket's runs and subtasks. Superseded runs still cost tokens, so they count. */
export function ticketStats(runs: RunView[], subtasks: SubtaskRow[], createdAt: string, updatedAt: string): TicketStats {
  const stage = new Map<string, TicketStats['byStage'][number]>();
  const model = new Map<string, TicketStats['byModel'][number]>();
  for (const r of runs) {
    const s = stage.get(r.stage) ?? { stage: r.stage, runs: 0, tokens: 0, costUsd: 0, seconds: 0 };
    stage.set(r.stage, { ...s, runs: s.runs + 1, tokens: s.tokens + counted(r), costUsd: s.costUsd + r.costUsd, seconds: s.seconds + seconds(r) });
    const m = model.get(r.model) ?? { model: r.model, runs: 0, tokens: 0, costUsd: 0 };
    model.set(r.model, { ...m, runs: m.runs + 1, tokens: m.tokens + counted(r), costUsd: m.costUsd + r.costUsd });
  }
  const sum = (f: (r: RunView) => number) => runs.reduce((a, r) => a + f(r), 0);
  return {
    tokens: { input: sum((r) => r.inputTokens), output: sum((r) => r.outputTokens), cacheWrite: sum((r) => r.cacheWriteTokens ?? 0), cacheRead: sum((r) => r.cacheReadTokens ?? 0), counted: sum(counted) },
    costUsd: sum((r) => r.costUsd),
    turns: sum((r) => r.numTurns),
    runs: {
      total: runs.length,
      succeeded: runs.filter((r) => r.status === 'succeeded').length,
      failed: runs.filter((r) => r.status === 'failed').length,
      superseded: runs.filter((r) => r.supersededAt).length,
      byUser: runs.filter((r) => r.trigger === 'user').length,
    },
    agentSeconds: sum(seconds),
    elapsedSeconds: Math.max(0, (Date.parse(updatedAt) - Date.parse(createdAt)) / 1000),
    byStage: [...stage.values()].sort((a, b) => b.tokens - a.tokens),
    byModel: [...model.values()].sort((a, b) => b.tokens - a.tokens),
    subtasks: { total: subtasks.length, done: subtasks.filter((s) => s.status === 'DONE').length, fixRounds: subtasks.reduce((a, s) => a + s.fixRounds, 0) },
  };
}

/** "2h 5m", "4m 12s", "37s". */
export function spell(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
