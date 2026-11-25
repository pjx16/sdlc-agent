import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProjectSettingsSchema, type TicketStatus } from '@sdlc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Housekeeper } from '../loop/worker-loop';
import { GITHUB_CLIENT, type GitHubClient } from './github-client';

/** The label that shows a ticket's state on its GitHub issue. */
export const stateLabel = (status: string): string => `sdlc:${status.toLowerCase().replace(/_/g, '-')}`;

/** Where a card goes on a board when the project has not mapped the state: in progress while the pipeline works, Done at the end, untouched when stuck. */
export function defaultColumn(status: TicketStatus): string | null {
  if (status === 'DONE') return 'Done';
  if (status === 'ON_HOLD' || status === 'FAILED' || status === 'NEW') return null;
  return 'In Progress';
}

/** `owner/name#number` into its parts. */
export function parseGithubKey(key: string | null): { repo: string; number: number } | null {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(key ?? '');
  return m ? { repo: m[1] as string, number: Number(m[2]) } : null;
}

/**
 * Writes the progress of a GitHub ticket back to GitHub: a label on its issue (`issues` mode) or the status column of its card
 * (`projects` mode), a comment when it is picked up, and the issue is closed when the ticket is done. It compares each ticket's state with
 * the one last written (`Ticket.externalStatus`), so a change is written once, a GitHub problem is tried again at the next poll, and a
 * network outage costs nothing.
 */
@Injectable()
export class GithubSync implements Housekeeper {
  readonly name = 'github-sync';
  readonly intervalMs = (pollIntervalSec: number) => pollIntervalSec;
  private readonly logger = new Logger(GithubSync.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
  ) {}

  async check(): Promise<void> {
    const tickets = await this.prisma.ticket.findMany({
      // A ticket that is done and was written as done has nothing left to write.
      where: { source: 'github', project: { enabled: true }, NOT: { AND: [{ status: 'DONE' }, { externalStatus: 'DONE' }] } },
      include: { project: true },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    for (const ticket of tickets.filter((t) => t.externalStatus !== t.status)) {
      try {
        if (await this.sync(ticket)) await this.prisma.ticket.updateMany({ where: { id: ticket.id }, data: { externalStatus: ticket.status } });
      } catch (err) {
        this.logger.warn(`Writing ${ticket.key} back to GitHub failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** True when the state is written (or there is nothing to write); false leaves it for the next poll. */
  private async sync(ticket: { id: string; key: string; status: TicketStatus; externalKey: string | null; externalStatus: string | null; prUrl: string | null; project: { settings: unknown } }): Promise<boolean> {
    const gh = ProjectSettingsSchema.parse(ticket.project.settings).github;
    const ref = parseGithubKey(ticket.externalKey);
    if (gh.mode === 'off' || !ref) return true;

    if (gh.mode === 'issues') {
      const add = [stateLabel(ticket.status)];
      const remove = ticket.externalStatus ? [stateLabel(ticket.externalStatus)] : [];
      await this.github.setIssueLabels(ref.repo, ref.number, add, remove);
    } else if (gh.project) {
      const column = ticket.status in gh.statusMap ? gh.statusMap[ticket.status] ?? null : defaultColumn(ticket.status);
      if (column) {
        const moved = await this.github.setProjectItemStatus(gh.project.owner, gh.project.number, ref, gh.statusField, column);
        if (!moved) await this.prisma.event.create({ data: { ticketId: ticket.id, type: 'github', level: 'warn', message: `The card of ${ref.repo}#${ref.number} could not be moved to "${column}": the board has no such column, or the card is not on it` } });
      }
    }
    if (ticket.externalStatus === null) await this.github.commentIssue(ref.repo, ref.number, `Picked up by sdlc-agent as **${ticket.key}**.`);
    if (ticket.status === 'DONE') {
      await this.github.commentIssue(ref.repo, ref.number, ticket.prUrl ? `${ticket.key} is done: ${ticket.prUrl}` : `${ticket.key} is done.`);
      await this.github.closeIssue(ref.repo, ref.number);
    }
    return true;
  }
}
