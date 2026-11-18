import { describe, expect, it } from 'vitest';
import { spell, ticketStats } from './ticket-stats';
import type { RunView, SubtaskRow } from './types';

const run = (o: Partial<RunView>): RunView => ({ id: 'r', stage: 'plan', model: 'opus', attempt: 1, round: 0, status: 'succeeded', startedAt: '2026-11-14T10:00:00Z', endedAt: '2026-11-14T10:02:00Z', inputTokens: 100, outputTokens: 50, cacheWriteTokens: 10, cacheReadTokens: 1000, costUsd: 0.5, numTurns: 4, error: null, ...o });
const sub = (o: Partial<SubtaskRow>): SubtaskRow => ({ id: 's', seq: 1, title: 't', description: '', status: 'DONE', fixRounds: 1, acceptanceCriteria: [], files: [], dependsOn: [], ...o });

describe('ticketStats', () => {
  const stats = ticketStats(
    [run({}), run({ stage: 'implement', model: 'sonnet', inputTokens: 300, costUsd: 1, startedAt: '2026-11-14T10:05:00Z', endedAt: '2026-11-14T10:10:00Z', trigger: 'user' }), run({ status: 'failed', supersededAt: '2026-11-14T10:11:00Z' })],
    [sub({}), sub({ seq: 2, status: 'PENDING', fixRounds: 2 })],
    '2026-11-14T09:00:00Z',
    '2026-11-14T11:00:00Z',
  );
  it('adds up tokens the way the usage window counts them, and cost and turns', () => {
    expect(stats.tokens).toEqual({ input: 500, output: 150, cacheWrite: 30, cacheRead: 3000, counted: 680 });
    expect(stats.costUsd).toBeCloseTo(2);
    expect(stats.turns).toBe(12);
  });
  it('counts runs by outcome, including replaced ones', () => {
    expect(stats.runs).toEqual({ total: 3, succeeded: 2, failed: 1, superseded: 1, byUser: 1 });
  });
  it('splits by stage (biggest first) and by model, and times the agent separately from the clock', () => {
    expect(stats.byStage.map((s) => [s.stage, s.runs])).toEqual([['implement', 1], ['plan', 2]]);
    expect(stats.byModel.map((m) => m.model)).toEqual(['sonnet', 'opus']);
    expect(stats.agentSeconds).toBe(120 + 300 + 120);
    expect(stats.elapsedSeconds).toBe(7200);
  });
  it('summarises the subtasks', () => {
    expect(stats.subtasks).toEqual({ total: 2, done: 1, fixRounds: 3 });
  });
  it('handles a ticket that has not run anything', () => {
    expect(ticketStats([], [], '2026-11-14T09:00:00Z', '2026-11-14T09:00:00Z').tokens.counted).toBe(0);
  });
});

describe('spell', () => {
  it('writes durations the short way', () => {
    expect([spell(37), spell(252), spell(7500), spell(200_000)]).toEqual(['37s', '4m 12s', '2h 5m', '2d 7h']);
  });
});
