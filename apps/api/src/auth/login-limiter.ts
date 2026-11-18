import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from './clock';

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

interface Entry {
  failures: number[];
  lockedUntil: number;
}

/** F1: after 5 failed logins within 15 minutes from one IP, that IP is locked out for 15 minutes. */
@Injectable()
export class LoginLimiter implements OnModuleInit {
  private readonly logger = new Logger(LoginLimiter.name);
  private readonly entries = new Map<string, Entry>();

  /** `prisma` is absent in unit tests: the counts then live in memory only. With it, they survive a restart. */
  constructor(
    @Inject(CLOCK) private readonly now: Clock,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /** Loads the counts that are still relevant, so a restart does not give an attacker a fresh set of attempts. */
  async onModuleInit(): Promise<void> {
    if (!this.prisma) return;
    try {
      const now = this.now();
      for (const row of await this.prisma.loginLimit.findMany()) {
        const entry = { failures: row.failures.map(Number).filter((t) => now - t < WINDOW_MS), lockedUntil: Number(row.lockedUntil) };
        if (entry.lockedUntil > now || entry.failures.length > 0) this.entries.set(row.key, entry);
      }
    } catch (err) {
      this.logger.warn(`Could not load login limits: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Writes one address's state without making the login wait for it. */
  private persist(ip: string): void {
    if (!this.prisma) return;
    const entry = this.entries.get(ip);
    const op = entry
      ? this.prisma.loginLimit.upsert({ where: { key: ip }, create: { key: ip, failures: entry.failures.map(BigInt), lockedUntil: BigInt(entry.lockedUntil) }, update: { failures: entry.failures.map(BigInt), lockedUntil: BigInt(entry.lockedUntil) } })
      : this.prisma.loginLimit.deleteMany({ where: { key: ip } });
    void op.catch((err: unknown) => this.logger.warn(`Could not save the login limit: ${err instanceof Error ? err.message : String(err)}`));
  }

  /** Seconds left on the lock, or 0 if the IP may try. */
  lockedForSeconds(ip: string): number {
    const entry = this.entries.get(ip);
    if (!entry) return 0;
    const remaining = entry.lockedUntil - this.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  recordFailure(ip: string): void {
    const now = this.now();
    const entry = this.entries.get(ip) ?? { failures: [], lockedUntil: 0 };
    entry.failures = [...entry.failures.filter((t) => now - t < WINDOW_MS), now];
    if (entry.failures.length >= MAX_FAILURES) {
      entry.lockedUntil = now + LOCK_MS;
      entry.failures = [];
    }
    this.entries.set(ip, entry);
    this.persist(ip);
    this.prune(now);
  }

  recordSuccess(ip: string): void {
    if (this.entries.delete(ip)) this.persist(ip);
  }

  private prune(now: number): void {
    for (const [ip, e] of this.entries) {
      if (e.lockedUntil <= now && e.failures.every((t) => now - t >= WINDOW_MS)) {
        this.entries.delete(ip);
        this.persist(ip);
      }
    }
  }
}
