import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestApp, createTestApp } from '../testing/test-app';
import { type TestDatabase, createTestDatabase } from '../testing/test-db';
import { UsageModule } from './usage.module';

describe('Usage API', () => {
  let db: TestDatabase;
  let t: TestApp;
  let projectId: string;
  const now = Date.now();
  const ago = (min: number) => new Date(now - min * 60_000);

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await createTestApp(db.url, [UsageModule]);
    projectId = (await t.prisma.project.create({ data: { name: 'p', repoUrl: 'https://x/y', stack: 'ts_node', testCmdTemplate: 'x {files}', localKeyPrefix: 'P', mirrorStatus: 'ok' } })).id;
  }, 180_000);
  afterAll(async () => {
    await t?.close();
    await db?.drop();
  });
  beforeEach(async () => {
    await t.prisma.stageRun.deleteMany();
    await t.prisma.stateTransition.deleteMany();
    await t.prisma.ticket.deleteMany();
    await t.prisma.globalSettings.deleteMany();
  });

  const run = (over: { model?: string; stage?: string; min?: number; tokens?: number; cost?: number; ticketId?: string } = {}) =>
    t.prisma.stageRun.create({
      data: { projectId, stage: over.stage ?? 'plan', model: over.model ?? 'opus', status: 'succeeded', startedAt: ago((over.min ?? 1) + 1), endedAt: ago(over.min ?? 1), inputTokens: over.tokens ?? 100, outputTokens: 50, cacheWriteTokens: 10, costUsd: over.cost ?? 0.1, ticketId: over.ticketId },
    });

  it('requires a session', async () => {
    for (const p of ['spend', 'tickets', 'models', 'summary']) await t.anonymous.get(`/usage/${p}`).expect(401);
  });

  it('spend: each budget period, its burn and the month projection, without connector runs', async () => {
    await t.prisma.globalSettings.create({ data: { id: 'global', budgetDailyCredits: 10, budgetMonthlyCredits: 100 } });
    await run({ min: 5, cost: 1.5 });
    await run({ min: 4, cost: 50, stage: 'jiraConnector' });
    const body = (await t.agent.get('/usage/spend').expect(200)).body;
    expect(body).toMatchObject({ timezone: 'UTC', warnPct: 80 });
    expect(body.suggested).toBeUndefined();
    expect(body.periods.map((p: { period: string; spent: number; budget: number | null }) => [p.period, p.spent, p.budget])).toEqual([['daily', 1.5, 10], ['weekly', 1.5, null], ['monthly', 1.5, 100]]);
    expect(body.burn.daily).toMatchObject({ unit: 'hour', spent: 1.5, budget: 10 });
    expect(body.burn.daily.buckets).toHaveLength(24);
    expect(body.burn.monthly.unit).toBe('day');
    expect(body.projection).toMatchObject({ monthToDate: 1.5, budget: 100 });
    expect(body.projection.avgDaily).toBeCloseTo(1.5 / 7, 2);
  });

  it('tickets: average credits per ticket finished in the last 30 days, per kind, and the most expensive', async () => {
    const ticket = async (key: string, kind: 'feature' | 'bug', cost: number, doneDaysAgo: number) => {
      const tk = await t.prisma.ticket.create({ data: { projectId, key, title: `Ticket ${key}`, kind, status: 'DONE', source: 'paste', body: '' } as never });
      await t.prisma.stateTransition.create({ data: { ticketId: tk.id, fromStatus: 'IN_HUMAN_REVIEW', toStatus: 'DONE', actor: 'system', at: ago(doneDaysAgo * 24 * 60) } });
      await run({ ticketId: tk.id, cost });
      await run({ ticketId: tk.id, cost: 100, stage: 'jiraConnector' });
      return tk;
    };
    await ticket('P-1', 'feature', 4, 1);
    await ticket('P-2', 'feature', 2, 2);
    await ticket('P-3', 'bug', 1, 3);
    await ticket('P-4', 'bug', 50, 40); // finished too long ago
    const body = (await t.agent.get('/usage/tickets').expect(200)).body;
    expect(body).toMatchObject({ days: 30, tickets: 3, avgCredits: 2.33, byKind: [{ kind: 'feature', tickets: 2, avgCredits: 3 }, { kind: 'bug', tickets: 1, avgCredits: 1 }] });
    expect(body.top.map((x: { key: string; credits: number }) => [x.key, x.credits])).toEqual([['P-1', 4], ['P-2', 2], ['P-3', 1]]);
  });

  it('models: exact figures per model, inside the requested period', async () => {
    await run({ model: 'opus', min: 40, tokens: 3000, cost: 0.6 });
    await run({ model: 'sonnet', stage: 'implement', min: 20, tokens: 1000, cost: 0.1 });
    await run({ model: 'opus', min: 3 * 24 * 60 });
    const all = (await t.agent.get('/usage/models').expect(200)).body;
    expect(all.models.map((m: { model: string }) => m.model)).toEqual(['opus', 'sonnet']);
    expect(all.models[0]).toMatchObject({ runs: 2, inputTokens: 3100 });
    expect(all.models[0].estimate).toBeUndefined();
    const recent = (await t.agent.get(`/usage/models?from=${ago(60).toISOString()}&to=${ago(0).toISOString()}`).expect(200)).body;
    expect(recent.models[0]).toMatchObject({ model: 'opus', runs: 1 });
  });

  it('summary: tokens and credits by stage and model, most credits first', async () => {
    await run({ stage: 'plan', model: 'opus', tokens: 100, cost: 0.5 });
    await run({ stage: 'plan', model: 'opus', tokens: 100, cost: 0.5 });
    await run({ stage: 'implement', model: 'haiku', tokens: 1000, cost: 0.2 });
    expect((await t.agent.get('/usage/summary').expect(200)).body).toEqual({
      rows: [
        { stage: 'plan', model: 'opus', tokens: 320, credits: 1, runs: 2 },
        { stage: 'implement', model: 'haiku', tokens: 1060, credits: 0.2, runs: 1 },
      ],
    });
  });
});
