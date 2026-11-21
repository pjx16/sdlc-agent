/** Pure calculations behind the usage page. No database here, so they are unit-tested directly. */

export interface RunUsage {
  id: string;
  model: string;
  stage: string;
  startedAt: Date | null;
  endedAt: Date | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/** The tokens shown as "tokens": input, output and cache write (cache reads are cheap and reported on their own). */
export const countedTokens = (r: Pick<RunUsage, 'inputTokens' | 'outputTokens' | 'cacheWriteTokens'>): number => r.inputTokens + r.outputTokens + r.cacheWriteTokens;

export interface ModelUsage {
  model: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Share of all counted tokens and of all cost, 0 to 1. */
  tokenShare: number;
  costShare: number;
  byStage: { stage: string; runs: number; tokens: number; costUsd: number }[];
  perDay: { day: string; tokens: number; costUsd: number; runs: number }[];
}

const day = (d: Date): string => d.toISOString().slice(0, 10);
const round = (n: number, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

export function usageByModel(runs: RunUsage[]): ModelUsage[] {
  const byModel = new Map<string, RunUsage[]>();
  for (const r of runs) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  const totalTokens = runs.reduce((n, r) => n + countedTokens(r), 0);
  const totalCost = runs.reduce((n, r) => n + r.costUsd, 0);

  return [...byModel.entries()]
    .map(([model, rs]) => {
      const stages = new Map<string, { runs: number; tokens: number; costUsd: number }>();
      const days = new Map<string, { tokens: number; costUsd: number; runs: number }>();
      for (const r of rs) {
        const s = stages.get(r.stage) ?? { runs: 0, tokens: 0, costUsd: 0 };
        s.runs++;
        s.tokens += countedTokens(r);
        s.costUsd += r.costUsd;
        stages.set(r.stage, s);
        const when = r.startedAt ?? r.endedAt;
        if (when) {
          const d = days.get(day(when)) ?? { tokens: 0, costUsd: 0, runs: 0 };
          d.tokens += countedTokens(r);
          d.costUsd += r.costUsd;
          d.runs++;
          days.set(day(when), d);
        }
      }
      const tokens = rs.reduce((n, r) => n + countedTokens(r), 0);
      const cost = rs.reduce((n, r) => n + r.costUsd, 0);
      return {
        model,
        runs: rs.length,
        inputTokens: rs.reduce((n, r) => n + r.inputTokens, 0),
        outputTokens: rs.reduce((n, r) => n + r.outputTokens, 0),
        cacheReadTokens: rs.reduce((n, r) => n + r.cacheReadTokens, 0),
        cacheWriteTokens: rs.reduce((n, r) => n + r.cacheWriteTokens, 0),
        costUsd: round(cost, 4),
        tokenShare: totalTokens ? round(tokens / totalTokens) : 0,
        costShare: totalCost ? round(cost / totalCost) : 0,
        byStage: [...stages.entries()].map(([stage, v]) => ({ stage, ...v, costUsd: round(v.costUsd, 4) })).sort((a, b) => b.tokens - a.tokens),
        perDay: [...days.entries()].map(([d, v]) => ({ day: d, ...v, costUsd: round(v.costUsd, 4) })).sort((a, b) => a.day.localeCompare(b.day)),
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs);
}
