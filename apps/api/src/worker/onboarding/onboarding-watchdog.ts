import { Injectable, Logger } from '@nestjs/common';
import { events } from '@sdlc/shared';
import { logEvent } from '../../common/event-log';
import { PrismaService } from '../../prisma/prisma.service';
import { STOPPED_MESSAGE, isSilent, silentAfterMs, stopProfiling } from '../../projects/onboarding-liveness';
import type { Housekeeper } from '../loop/worker-loop';

/**
 * Profiling that went silent (its worker died or hung) is ended with a clear message instead of staying "profiling" for ever, so the
 * person can try again. It only looks at runs that have started: one that is waiting its turn is not silent.
 */
@Injectable()
export class OnboardingWatchdog implements Housekeeper {
  readonly name = 'onboarding-watchdog';
  readonly intervalMs = 60_000;
  private readonly logger = new Logger(OnboardingWatchdog.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<void> {
    const settings = await this.prisma.globalSettings.findUnique({ where: { id: 'global' }, select: { onboardingTimeoutMin: true } });
    await sweepSilentProfiling(this.prisma, silentAfterMs(settings?.onboardingTimeoutMin ?? 15), this.logger);
  }
}

/** Ends every profiling run that has been silent for longer than `afterMs`. Returns how many. */
export async function sweepSilentProfiling(prisma: PrismaService, afterMs: number, logger?: Logger): Promise<number> {
  const profiling = await prisma.project.findMany({ where: { onboardingStatus: 'profiling' } });
  let stopped = 0;
  for (const p of profiling.filter((x) => isSilent(x, Date.now(), afterMs))) {
    if (!(await stopProfiling(prisma, p, STOPPED_MESSAGE))) continue;
    stopped++;
    logger?.warn(`Profiling of "${p.name}" was silent and has been stopped`);
    await logEvent(prisma, events.note({ source: 'system', type: 'error', level: 'error', message: `Onboarding of ${p.name} stopped: ${STOPPED_MESSAGE}` })).catch(() => undefined);
  }
  return stopped;
}
