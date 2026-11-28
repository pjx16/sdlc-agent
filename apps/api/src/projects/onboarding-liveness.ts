import type { OnboardingProgress } from '@sdlc/shared';
import { Prisma, type Project } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/** The worker writes a sign of life every 30 seconds; this much silence at boot means the run is gone. */
export const SILENT_AT_BOOT_MS = 60_000;
/** Beyond the time limit, how long the silence of a run lasts before it is given up on. */
export const GRACE_MIN = 2;
export const STOPPED_MESSAGE = 'Profiling stopped: the worker restarted or stopped responding. Try again.';

/** How long a run may be silent, with the time limit it has: its limit plus a grace. */
export const silentAfterMs = (timeoutMin: number): number => (timeoutMin + GRACE_MIN) * 60_000;

type Row = Pick<Project, 'onboardingStatus' | 'onboardingProgress'>;

export const progressOf = (p: Pick<Project, 'onboardingProgress'>): OnboardingProgress | null => (p.onboardingProgress as unknown as OnboardingProgress | null) ?? null;

/**
 * Profiling that has started (it has progress) but has not written a sign of life for `afterMs`. A project that has not started
 * (no progress) is waiting its turn, not silent: it can wait for hours while the pipeline is paused.
 */
export function isSilent(p: Row, nowMs: number, afterMs: number): boolean {
  const progress = progressOf(p);
  if (p.onboardingStatus !== 'profiling' || !progress?.updatedAt) return false;
  return nowMs - Date.parse(progress.updatedAt) > afterMs;
}

/** Ends profiling that is not running (any more): the project becomes a draft that says why, and keeps the step that was running. */
export async function stopProfiling(prisma: PrismaService, p: Pick<Project, 'id' | 'onboardingProgress'>, message: string): Promise<boolean> {
  const progress = progressOf(p);
  const running = progress?.running?.[0];
  const ended: OnboardingProgress | null = progress
    ? { ...progress, running: [], endedAt: new Date().toISOString(), failed: progress.failed ?? (running ? { id: running, message } : undefined) }
    : null;
  const { count } = await prisma.project.updateMany({
    where: { id: p.id, onboardingStatus: 'profiling' },
    data: { onboardingStatus: 'draft', onboardingError: message, onboardingProgress: ended ? (ended as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
  });
  return count > 0;
}
