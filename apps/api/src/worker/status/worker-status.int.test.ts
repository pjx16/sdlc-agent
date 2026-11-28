import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service';
import { type TestDatabase, createTestDatabase } from '../../testing/test-db';
import { HeartbeatTimer, recordStart, recordTick, setPhase } from './worker-status';

let db: TestDatabase;
let prisma: PrismaService;
const status = () => prisma.workerStatus.findUniqueOrThrow({ where: { id: 'worker' } });

beforeAll(async () => {
  db = await createTestDatabase();
  process.env.DATABASE_URL = db.url;
  prisma = new PrismaService();
  await prisma.onModuleInit();
}, 180_000);
afterAll(async () => {
  await prisma?.onModuleDestroy();
  await db?.drop();
});
beforeEach(async () => {
  await prisma.event.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.project.deleteMany();
  await prisma.globalSettings.deleteMany();
  await prisma.workerStatus.deleteMany();
});

describe('worker status', () => {
  it('records a heartbeat with the outcome and detail', async () => {
    await recordTick(prisma, 'not_configured', 'anthropic_api_key, github_token');
    const row = await status();
    expect(row).toMatchObject({ tickOutcome: 'not_configured', tickDetail: 'anthropic_api_key, github_token' });
    expect(Date.now() - row.heartbeatAt.getTime()).toBeLessThan(5000);
    await recordTick(prisma, 'idle');
    expect(await status()).toMatchObject({ tickOutcome: 'idle', tickDetail: null });
  });

  it('keeps the heartbeat fresh while a loop iteration is still running', async () => {
    const timer = new HeartbeatTimer(prisma, 50);
    await timer.start();
    const first = (await status()).heartbeatAt.getTime();
    // A long stage: the loop writes nothing for the whole time, the timer still beats.
    await new Promise((r) => setTimeout(r, 300));
    const later = (await status()).heartbeatAt.getTime();
    timer.stop();
    expect(later).toBeGreaterThan(first);
    // recordTick records the outcome only and leaves the heartbeat alone.
    await recordTick(prisma, 'stepped', 'SDA-1 (IN_PROGRESS)');
    expect((await status()).heartbeatAt.getTime()).toBe(later);
  });

  it('reports each phase, and only moves phaseSince when the phase changes', async () => {
    for (const phase of ['cloning', 'intake', 'stage', 'housekeeping', 'paused', 'not_configured', 'idle'] as const) {
      await setPhase(prisma, phase, `detail ${phase}`);
      expect(await status()).toMatchObject({ phase, phaseDetail: `detail ${phase}` });
    }
    const since = (await status()).phaseSince!.getTime();
    await new Promise((r) => setTimeout(r, 20));
    await setPhase(prisma, 'idle', 'detail idle');
    expect((await status()).phaseSince!.getTime()).toBe(since);
  });

  it('records a start, and writes an error event on the third start within 10 minutes', async () => {
    await recordStart(prisma, '1.0.0', 4242);
    expect(await status()).toMatchObject({ pid: 4242, version: '1.0.0', phase: 'idle' });
    await recordStart(prisma, '1.0.0', 4243);
    expect(await prisma.event.count({ where: { type: 'error' } })).toBe(0);
    await recordStart(prisma, '1.0.0', 4244);
    expect((await prisma.event.findMany({ where: { type: 'error' } })).map((e) => e.message)).toEqual(['Worker is restarting repeatedly']);
  });

});
