import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GITHUB_CLIENT, type GitHubClient } from './github-client';
import { parseGithubKey } from './github-sync';

/** The marker of one kind of comment on one ticket. It stays the same when the text changes, so the comment is rewritten in place. */
export const issueMarker = (ticketKey: string, purpose: string): string => `sdlc-agent:${ticketKey}:${purpose}`;

export type PostOutcome = 'created' | 'updated' | 'unchanged' | 'no_issue' | 'failed';

/**
 * Where the pipeline talks to people about a ticket: comments on the ticket's GitHub issue. A comment of one kind (`plan`, `breakdown`, ...)
 * exists once per ticket: writing it again changes it in place, or does nothing when the text is the same, so a stage that runs twice never
 * leaves two. A ticket without a GitHub issue has nowhere to talk (a note is made once), and a GitHub problem is only noted: nothing here
 * ever stops the pipeline.
 */
@Injectable()
export class TicketComments {
  private readonly logger = new Logger(TicketComments.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
  ) {}

  async post(ticket: { id: string; key: string; externalKey: string | null }, purpose: string, markdown: string): Promise<PostOutcome> {
    const ref = parseGithubKey(ticket.externalKey);
    if (!ref) {
      await this.note(ticket.id, 'info', `The ${purpose} was not posted: this ticket has no GitHub issue to comment on`);
      return 'no_issue';
    }
    try {
      return await this.github.upsertIssueComment(ref.repo, ref.number, markdown, issueMarker(ticket.key, purpose));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`The ${purpose} of ${ticket.key} could not be posted to GitHub: ${message}`);
      await this.note(ticket.id, 'warn', `The ${purpose} could not be posted to GitHub: ${message}`.slice(0, 500));
      return 'failed';
    }
  }

  /** A note on the ticket's own timeline, once: the same note is not written again for every run of the stage. */
  private async note(ticketId: string, level: 'info' | 'warn', message: string): Promise<void> {
    const same = await this.prisma.event.count({ where: { ticketId, type: 'github', message } });
    if (same === 0) await this.prisma.event.create({ data: { ticketId, type: 'github', level, message } }).catch(() => undefined);
  }
}
