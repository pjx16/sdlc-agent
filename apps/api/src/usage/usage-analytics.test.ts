import { describe, expect, it } from 'vitest';
import { usageByModel, type RunUsage } from './usage-analytics';

const t = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 14, h, m));
const run = (id: string, model: string, stage: string, end: Date, tokens: number, cost = 0.1): RunUsage => ({
  id, model, stage, startedAt: new Date(end.getTime() - 60_000), endedAt: end, inputTokens: tokens, outputTokens: 0, cacheReadTokens: 999, cacheWriteTokens: 0, costUsd: cost,
});

describe('usageByModel', () => {
  const runs = [run('a', 'opus', 'plan', t(10, 20), 3000, 0.6), run('b', 'sonnet', 'implement', t(10, 40), 1000, 0.1), run('c', 'sonnet', 'fix', t(10, 50), 1000, 0.1)];

  it('gives exact tokens, cost, runs and shares per model, biggest spender first', () => {
    const m = usageByModel(runs);
    expect(m.map((x) => x.model)).toEqual(['opus', 'sonnet']);
    expect(m[0]).toMatchObject({ model: 'opus', runs: 1, inputTokens: 3000, cacheReadTokens: 999, costUsd: 0.6 });
    expect(m[0]?.tokenShare).toBeCloseTo(0.6);
    expect(m[1]?.costShare).toBeCloseTo(0.25);
  });
  it('splits each model by stage and by day', () => {
    const sonnet = usageByModel(runs)[1];
    expect(sonnet?.byStage.map((s) => s.stage).sort()).toEqual(['fix', 'implement']);
    expect(sonnet?.perDay).toEqual([{ day: '2026-11-14', tokens: 2000, costUsd: 0.2, runs: 2 }]);
  });
  it('is empty without runs', () => expect(usageByModel([])).toEqual([]));
});
