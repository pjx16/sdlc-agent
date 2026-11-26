import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingCancelledError, OnboardingTimeoutError, ProgressTracker, stopMessage } from './onboarding-worker';

interface Snapshot {
  running: string[];
  done: { id: string; ms: number }[];
  failed?: { id: string; message: string };
  deadlineAt?: string;
  updatedAt?: string;
}

/** A Prisma stand-in: the first save is an `update` (it replaces), later saves are a raw JSON merge. Both end up in `saved`. */
function fake() {
  const saved: Snapshot[] = [];
  const prisma = {
    project: { update: vi.fn(async ({ data }: { data: { onboardingProgress: Snapshot } }) => void saved.push(data.onboardingProgress)) },
    $executeRaw: vi.fn(async (_strings: TemplateStringsArray, json: string) => void saved.push(JSON.parse(json) as Snapshot)),
  };
  return { prisma, saved };
}

afterEach(() => vi.useRealTimers());

describe('ProgressTracker', () => {
  it('records overlapping phases and their durations', async () => {
    const { prisma, saved } = fake();
    let t = 0;
    const tracker = new ProgressTracker(prisma as never, 'p1', ['facts', 'profile', 'advise'], { now: () => t });
    const advise = tracker.track('advise', async () => {
      t += 5000;
    });
    await tracker.track('profile', async () => {
      t += 3000;
    });
    await advise;
    await tracker.flush();
    expect(tracker.timings()).toEqual({ profile: 3000, advise: 8000 }); // advise ran from the start, across the whole of profile
    expect(saved.at(-1)?.running).toEqual([]);
    expect(saved.some((s) => s.running.includes('advise') && s.running.includes('profile'))).toBe(true);
  });

  it('records a phase that fails as the failed step, keeps it out of the timings, and rethrows', async () => {
    const { prisma, saved } = fake();
    const tracker = new ProgressTracker(prisma as never, 'p1', ['mirror']);
    await expect(tracker.track('mirror', async () => Promise.reject(new Error('clone failed')))).rejects.toThrow('clone failed');
    await tracker.flush();
    expect(tracker.timings()).toEqual({});
    expect(tracker.failedPhase()).toBe('mirror');
    expect(saved.at(-1)?.failed).toEqual({ id: 'mirror', message: 'clone failed' });
  });

  it('the first failure wins when phases run at once', async () => {
    const { prisma } = fake();
    const tracker = new ProgressTracker(prisma as never, 'p1', ['advise', 'profile']);
    await tracker.track('profile', async () => Promise.reject(new Error('first'))).catch(() => undefined);
    await tracker.track('advise', async () => Promise.reject(new Error('second'))).catch(() => undefined);
    expect(tracker.failedPhase()).toBe('profile');
  });

  it('never fails the onboarding when saving progress fails', async () => {
    const down = vi.fn().mockRejectedValue(new Error('db down'));
    const tracker = new ProgressTracker({ project: { update: down }, $executeRaw: down } as never, 'p1', ['facts']);
    await expect(tracker.track('facts', async () => 'ok')).resolves.toBe('ok');
    await expect(tracker.flush()).resolves.toBeUndefined();
  });

  it('writes the deadline, and the first save replaces while later ones merge', async () => {
    const { prisma, saved } = fake();
    const deadlineAt = new Date('2026-11-26T10:15:00Z');
    const tracker = new ProgressTracker(prisma as never, 'p1', ['facts'], { deadlineAt });
    tracker.start();
    await tracker.track('facts', async () => 'ok');
    tracker.stop();
    await tracker.flush();
    expect(saved[0]?.deadlineAt).toBe(deadlineAt.toISOString());
    expect(prisma.project.update).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  describe('abort', () => {
    it('gives up on a phase that never ends when the signal aborts, and says which phase and why', async () => {
      const { prisma } = fake();
      const ctrl = new AbortController();
      const tracker = new ProgressTracker(prisma as never, 'p1', ['facts'], { signal: ctrl.signal });
      const hung = tracker.track('facts', () => new Promise<string>(() => undefined));
      ctrl.abort(new OnboardingTimeoutError(15));
      await expect(hung).rejects.toBeInstanceOf(OnboardingTimeoutError);
      expect(tracker.failedPhase()).toBe('facts');
      const final = await tracker.failed({ message: 'x' });
      expect(final.failed?.message).toContain('stopped after 15 minutes while "Reading the repository');
      expect(final.endedAt).toBeDefined();
    });

    it('passes the signal to the phase, and does not leave an unhandled rejection when the abandoned work fails later', async () => {
      const { prisma } = fake();
      const ctrl = new AbortController();
      const tracker = new ProgressTracker(prisma as never, 'p1', ['profile'], { signal: ctrl.signal });
      let seen: AbortSignal | undefined;
      let failLate!: (e: Error) => void;
      const hung = tracker.track('profile', (signal) => {
        seen = signal;
        return new Promise<string>((_, reject) => void (failLate = reject));
      });
      ctrl.abort(new OnboardingCancelledError());
      await expect(hung).rejects.toBeInstanceOf(OnboardingCancelledError);
      failLate(new Error('killed container'));
      await new Promise((r) => setTimeout(r, 10));
      expect(seen).toBe(ctrl.signal);
    });

    it('does not start a phase work result when the signal was already aborted', async () => {
      const { prisma } = fake();
      const tracker = new ProgressTracker(prisma as never, 'p1', ['install'], { signal: AbortSignal.abort(new OnboardingCancelledError()) });
      await expect(tracker.track('install', async () => 'late')).rejects.toBeInstanceOf(OnboardingCancelledError);
    });
  });

  describe('heartbeat', () => {
    it('writes a sign of life on each beat, runs the tick, and stops when told to', async () => {
      vi.useFakeTimers();
      const { prisma, saved } = fake();
      let clock = Date.parse('2026-11-26T10:00:00Z');
      const tick = vi.fn(async () => undefined);
      const tracker = new ProgressTracker(prisma as never, 'p1', ['profile'], { heartbeatMs: 30_000, now: () => clock });
      tracker.start(tick);
      clock += 30_000;
      await vi.advanceTimersByTimeAsync(30_000);
      clock += 30_000;
      await vi.advanceTimersByTimeAsync(30_000);
      await tracker.flush();
      expect(tick).toHaveBeenCalledTimes(2);
      expect(saved.at(-1)?.updatedAt).toBe(new Date(clock).toISOString());
      tracker.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(tick).toHaveBeenCalledTimes(2);
    });

    it('a failing tick does not stop the heartbeat', async () => {
      vi.useFakeTimers();
      const { prisma } = fake();
      const tick = vi.fn().mockRejectedValue(new Error('db down'));
      const tracker = new ProgressTracker(prisma as never, 'p1', ['profile'], { heartbeatMs: 1000 });
      tracker.start(tick);
      await vi.advanceTimersByTimeAsync(3000);
      tracker.stop();
      expect(tick).toHaveBeenCalledTimes(3);
    });
  });
});

describe('stopMessage', () => {
  it('names the minutes and the step for a timeout', () => {
    expect(stopMessage(new OnboardingTimeoutError(15), 'install')).toBe(
      'Profiling stopped after 15 minutes while "Checking the install command" was running. Try again; if it keeps happening, the install or typecheck command may be too slow.',
    );
    expect(stopMessage(new OnboardingTimeoutError(15), null)).toMatch(/^Profiling stopped after 15 minutes\. Try again/);
  });
  it('says Cancelled for a cancel and passes any other error through, capped', () => {
    expect(stopMessage(new OnboardingCancelledError(), 'profile')).toBe('Cancelled.');
    expect(stopMessage(new Error('boom'), 'profile')).toBe('boom');
    expect(stopMessage('x'.repeat(900), null)).toHaveLength(500);
  });
});
