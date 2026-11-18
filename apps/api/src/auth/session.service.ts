import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from './clock';

/** A session ends 7 days after login at the latest. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** ... and after 12 hours without use: each use pushes the expiry to now + 12 h, never past the 7-day limit. */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const IDLE_REFRESH_AFTER_MS = 5 * 60 * 1000;

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  /** Creates a session and returns the raw token. Only its SHA-256 is stored. */
  async create(ip: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.prisma.session.create({
      data: { tokenHash: hashToken(token), ip, expiresAt: new Date(this.now() + SESSION_IDLE_MS) },
    });
    return token;
  }

  async isValid(token: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session) return false;
    if (session.expiresAt.getTime() <= this.now()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return false;
    }
    // Sliding idle timeout, written at most every few minutes, and never beyond the absolute limit.
    const now = this.now();
    const next = Math.min(now + SESSION_IDLE_MS, session.createdAt.getTime() + SESSION_TTL_MS);
    if (next - session.expiresAt.getTime() > IDLE_REFRESH_AFTER_MS) await this.prisma.session.updateMany({ where: { id: session.id }, data: { expiresAt: new Date(next) } });
    return true;
  }

  /** Logs out every session except the one holding `token`. */
  async destroyOthers(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: { not: hashToken(token) } } });
  }

  async destroy(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
}
