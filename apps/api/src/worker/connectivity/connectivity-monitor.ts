import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Housekeeper } from '../loop/worker-loop';

/** One way of asking "is the internet there": true when something answered. */
export type Probe = () => Promise<boolean>;

/** What the pipeline depends on, plus a plain public address: the internet is "up" when any of them answers. */
export const DEFAULT_PROBE_URLS = ['https://api.anthropic.com', 'https://api.github.com', 'https://1.1.1.1'] as const;

/** A probe that counts any HTTP answer, even an error status, as proof of a connection. A timeout or a refused connection is not. */
export function httpProbe(url: string, timeoutMs = 3000, fetchFn: typeof fetch = fetch): Probe {
  return async () => {
    try {
      await fetchFn(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
      return true;
    } catch {
      return false;
    }
  };
}

/** `CONNECTIVITY_CHECK=off` turns the monitor off; `CONNECTIVITY_PROBES` replaces the addresses (comma separated, https only). */
export function probesFromEnv(env: NodeJS.ProcessEnv = process.env): Probe[] | null {
  if ((env.CONNECTIVITY_CHECK ?? 'on').toLowerCase() === 'off') return null;
  const urls = (env.CONNECTIVITY_PROBES ?? '').split(',').map((u) => u.trim()).filter((u) => /^https:\/\//.test(u));
  return (urls.length > 0 ? urls : [...DEFAULT_PROBE_URLS]).map((u) => httpProbe(u));
}

/** Rounds in a row without any answer before the pipeline is told it is offline. One slow host is not an outage. */
export const FAILED_ROUNDS_TO_OFFLINE = 3;

/**
 * Watches for the internet going away. Offline is declared after `FAILED_ROUNDS_TO_OFFLINE` rounds in a row in which every probe failed; the
 * first round with any answer ends it. The state is `GlobalSettings.networkOffline`, apart from the pause switches, so a manual pause or a
 * credential pause is never touched.
 */
@Injectable()
export class ConnectivityMonitor implements Housekeeper {
  readonly name = 'connectivity';
  readonly intervalMs = 10_000;
  private readonly logger = new Logger(ConnectivityMonitor.name);
  private failedRounds = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly probes: Probe[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(): Promise<void> {
    const row = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    const offline = row?.networkOffline ?? false;
    // Switched off (CONNECTIVITY_CHECK=off): never offline, and an offline flag left by an earlier run is cleared.
    const online = this.probes.length === 0 || (await Promise.all(this.probes.map((p) => p().catch(() => false)))).some(Boolean);
    if (online) {
      this.failedRounds = 0;
      if (offline) await this.set(false, row?.offlineSince ?? null);
      return;
    }
    this.failedRounds++;
    if (!offline && this.failedRounds >= FAILED_ROUNDS_TO_OFFLINE) await this.set(true, null);
  }

  private async set(offline: boolean, since: Date | null): Promise<void> {
    const now = this.now();
    await this.prisma.globalSettings.upsert({
      where: { id: 'global' },
      update: { networkOffline: offline, offlineSince: offline ? now : null },
      create: { id: 'global', networkOffline: offline, offlineSince: offline ? now : null },
    });
    const message = offline ? 'No internet connection: the pipeline is paused until it is back' : `The internet connection is back${since ? ` after ${Math.round((now.getTime() - since.getTime()) / 1000)} s` : ''}: the pipeline resumes`;
    this.logger.warn(message);
    await this.prisma.event.create({ data: { type: 'system', level: offline ? 'warn' : 'info', message } }).catch(() => undefined);
  }
}
