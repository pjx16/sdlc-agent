import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemSettingsService } from '../../system/system-settings.service';
import { type TestDatabase, createTestDatabase } from '../../testing/test-db';
import { BudgetGate } from './budget-gate';

describe('BudgetGate', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let gate: BudgetGate;
  let system: SystemSettingsService;
  // Saturday 21 Nov 2026, 12:00 UTC.
  let now = new Date('2026-11-21T12:00:00Z');
  let projectId: string;

  const settings = () => prisma.globalSettings.findUniqueOrThrow({ where: { id: 'global' } });
  const reset = (data: Record<string, unknown> = {}) =>
    prisma.globalSettings.upsert({
      where: { id: 'global' },
      update: { budgetDailyCredits: null, budgetWeeklyCredits: null, budgetMonthlyCredits: null, timezone: 'UTC', usageIgnoredUntil: null, pipelinePaused: false, pausedReason: null, pausedCode: null, resetsAt: null, ...data },
      create: { id: 'global', ...data },
    });
  const spend = (costUsd: number, startedAt = now, stage = 'implement') => prisma.stageRun.create({ data: { projectId, stage, model: 'opus', status: 'succeeded', startedAt, costUsd } });

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.url;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    gate = new BudgetGate(prisma, () => now);
    system = new SystemSettingsService(prisma);
    projectId = (await prisma.project.create({ data: { name: 'p', repoUrl: 'https://x/y', stack: 'ts_node', testCmdTemplate: 'x {files}', localKeyPrefix: 'P', mirrorStatus: 'ok' } })).id;
  }, 180_000);
  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await db?.drop();
  });
  beforeEach(async () => {
    now = new Date('2026-11-21T12:00:00Z');
    await prisma.stageRun.deleteMany();
    await prisma.event.deleteMany();
    await reset();
  });

  it('does nothing with no budgets, whatever the spend', async () => {
    await spend(500);
    expect(await gate.check()).toBe(false);
    expect((await settings()).pipelinePaused).toBe(false);
  });

  it('pauses when the daily budget is used up, until the next day, and logs it', async () => {
    await reset({ budgetDailyCredits: 5 });
    await spend(3);
    expect(await gate.check()).toBe(false);
    await spend(2.5);
    expect(await gate.check()).toBe(true);
    expect(await settings()).toMatchObject({ pipelinePaused: true, pausedCode: 'SPEND_BUDGET_REACHED', pausedReason: expect.stringContaining('daily budget of 5 credits'), resetsAt: new Date('2026-11-22T00:00:00Z') });
    expect(await prisma.event.findFirst({ where: { type: 'usage' } })).toMatchObject({ errorCode: 'SPEND_BUDGET_REACHED' });
  });

  it('counts only the current period, and not Jira connector runs', async () => {
    await reset({ budgetDailyCredits: 5, budgetWeeklyCredits: 20 });
    await spend(4, new Date('2026-11-20T23:00:00Z')); // yesterday, same week
    await spend(4, new Date('2026-11-21T01:00:00Z'));
    await spend(50, now, 'jiraConnector');
    expect(await gate.check()).toBe(false);
    await spend(13, new Date('2026-11-16T09:00:00Z')); // Monday: the week reaches 21
    expect(await gate.check()).toBe(true);
    expect((await settings()).resetsAt).toEqual(new Date('2026-11-23T00:00:00Z'));
  });

  it('uses the timezone from Settings for the period', async () => {
    // 20:00 UTC on Saturday is already Sunday 01:30 in Kolkata: Saturday's spend is not today's there.
    now = new Date('2026-11-21T20:00:00Z');
    await reset({ budgetDailyCredits: 5, timezone: 'Asia/Kolkata' });
    await spend(6, new Date('2026-11-21T12:00:00Z'));
    expect(await gate.check()).toBe(false);
    await reset({ budgetDailyCredits: 5, timezone: 'UTC' });
    expect(await gate.check()).toBe(true);
  });

  it('enforces nothing while the budgets are ignored, and keeps a pause it did not cause', async () => {
    await reset({ budgetDailyCredits: 1, usageIgnoredUntil: new Date(now.getTime() + 3600_000) });
    await spend(2);
    expect(await gate.check()).toBe(false);
    await reset({ budgetDailyCredits: 1, pipelinePaused: true, pausedReason: 'manual' });
    expect(await gate.check()).toBe(false);
    expect(await settings()).toMatchObject({ pausedReason: 'manual', pausedCode: null });
  });

  it('saving new budgets approves them and ends a budget pause; ignoring resumes until the reset', async () => {
    await reset({ budgetDailyCredits: 1 });
    await spend(2);
    await gate.check();
    const ignored = await system.ignoreUsage({});
    expect(ignored).toMatchObject({ pipelinePaused: false, pausedCode: null, usageIgnoredUntil: '2026-11-22T00:00:00.000Z' });

    await reset({ budgetDailyCredits: 1 });
    await gate.check();
    const raised = await system.update({ budgetDailyCredits: 10 });
    expect(raised).toMatchObject({ pipelinePaused: false, budgetDailyCredits: 10, budgetsApprovedAt: expect.any(String) });
    expect(await gate.check()).toBe(false);
  });
});
