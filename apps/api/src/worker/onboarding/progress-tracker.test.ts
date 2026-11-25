import { describe, expect, it, vi } from 'vitest';
import { ProgressTracker } from './onboarding-worker';

function fake() {
  const saved: { running: string[]; done: { id: string; ms: number }[] }[] = [];
  const prisma = { project: { update: vi.fn(async ({ data }: { data: { onboardingProgress: (typeof saved)[number] } }) => void saved.push(data.onboardingProgress)) } };
  return { prisma, saved };
}

describe('ProgressTracker', () => {
  it('records overlapping phases and their durations', async () => {
    const { prisma, saved } = fake();
    let t = 0;
    const tracker = new ProgressTracker(prisma as never, 'p1', ['facts', 'profile', 'advise'], () => t);
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

  it('still records a phase that fails, and rethrows', async () => {
    const { prisma } = fake();
    const tracker = new ProgressTracker(prisma as never, 'p1', ['mirror']);
    await expect(tracker.track('mirror', async () => Promise.reject(new Error('clone failed')))).rejects.toThrow('clone failed');
    expect(Object.keys(tracker.timings())).toEqual(['mirror']);
  });

  it('never fails the onboarding when saving progress fails', async () => {
    const tracker = new ProgressTracker({ project: { update: vi.fn().mockRejectedValue(new Error('db down')) } } as never, 'p1', ['facts']);
    await expect(tracker.track('facts', async () => 'ok')).resolves.toBe('ok');
    await expect(tracker.flush()).resolves.toBeUndefined();
  });
});
