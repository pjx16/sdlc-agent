import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service';
import { STOPPED_MESSAGE } from '../../projects/onboarding-liveness';
import { StateMachine } from '../../state/state-machine.service';
import { type TestDatabase, createTestDatabase } from '../../testing/test-db';
import { FakeEngine } from '../agent-runner/fake-engine';
import { RestartRecovery } from '../loop/restart-recovery';
import { OnboardingWatchdog, sweepSilentProfiling } from './onboarding-watchdog';

describe('OnboardingWatchdog and boot recovery of profiling', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let n = 0;
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const project = (progress: unknown, status = 'profiling') =>
    prisma.project.create({ data: { name: `wd-${++n}`, repoUrl: 'https://github.com/a/b', stack: 'ts_node', testCmdTemplate: 'x {files}', localKeyPrefix: `W${n}`, onboardingStatus: status as never, onboardingProgress: progress as never } });
  const progress = (silentMin: number) => ({ startedAt: minutesAgo(silentMin + 1), updatedAt: minutesAgo(silentMin), planned: ['profile'], running: ['profile'], done: [] });
  const reload = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });

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
    await prisma.globalSettings.deleteMany();
    await prisma.project.deleteMany({ where: { name: { startsWith: 'wd-' } } });
  });

  it('ends a run that is silent for longer than the limit plus 2 minutes, naming the step that was running', async () => {
    const dead = await project(progress(18));
    const alive = await project(progress(5));
    await new OnboardingWatchdog(prisma).check();
    expect(await reload(dead.id)).toMatchObject({ onboardingStatus: 'draft', onboardingError: STOPPED_MESSAGE, onboardingProgress: { running: [], failed: { id: 'profile' }, endedAt: expect.any(String) } });
    expect((await reload(alive.id)).onboardingStatus).toBe('profiling');
    expect(await prisma.event.count({ where: { type: 'error', message: { contains: STOPPED_MESSAGE } } })).toBe(1);
  });

  it('uses the limit from the settings', async () => {
    await prisma.globalSettings.create({ data: { id: 'global', onboardingTimeoutMin: 5 } });
    const p = await project(progress(8)); // over 5 + 2 minutes
    await new OnboardingWatchdog(prisma).check();
    expect((await reload(p.id)).onboardingStatus).toBe('draft');
  });

  it('leaves a project that has not started alone, however long it has waited', async () => {
    const waiting = await project(null);
    await prisma.$executeRaw`UPDATE "Project" SET "updatedAt" = now() - interval '5 hours' WHERE "id" = ${waiting.id}`;
    expect(await sweepSilentProfiling(prisma, 60_000)).toBe(0);
    expect((await reload(waiting.id)).onboardingStatus).toBe('profiling');
  });

  it('ignores projects that are not profiling', async () => {
    const proposed = await project(progress(60), 'proposed');
    expect(await sweepSilentProfiling(prisma, 60_000)).toBe(0);
    expect((await reload(proposed.id)).onboardingStatus).toBe('proposed');
  });

  it('at boot, a run silent for more than a minute is ended, and a fresh one is left for the worker to run again', async () => {
    const dead = await project(progress(3));
    const fresh = await project({ ...progress(0), updatedAt: new Date().toISOString() });
    await new RestartRecovery(prisma, new StateMachine(prisma), new FakeEngine()).recover();
    expect((await reload(dead.id)).onboardingStatus).toBe('draft');
    expect((await reload(fresh.id)).onboardingStatus).toBe('profiling');
  });
});
