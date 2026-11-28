import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProjectSettingsSchema } from '@sdlc/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportRaiser } from '../../support/support-raiser';
import type { Housekeeper } from '../loop/worker-loop';
import { GITHUB_CLIENT, type CreatedIssue, type GitHubClient, parseRepo } from './github-client';
import { stateLabel } from './github-sync';

const MAX_PER_TICK = 20;

/** The line under the text of an issue that sdlc-agent made, so a reader of the issue knows where it came from. */
export const issueFooter = (key: string): string => `\n\n---\n_Created by sdlc-agent · ${key}_`;

/**
 * Makes the GitHub issue of a ticket that asked for one (`githubIssueState` is `pending`), or links the issue it named, and puts the card
 * on the project's Projects board. The ticket does not wait for any of this: the pipeline runs on, and a failure only tells the person.
 *
 * Two rules keep intake from picking the issue up as a second ticket. The ticket gets the issue's `externalKey` (which intake dedupes
 * on) BEFORE anything is done on the board, and an issue made in `issues` mode never carries the intake label.
 */
@Injectable()
export class GithubIssueCreator implements Housekeeper {
  readonly name = 'github-issue-creator';
  /** A person waits to see the issue appear, so this does not use the (slower) poll interval. */
  readonly intervalMs = 15_000;
  private readonly logger = new Logger(GithubIssueCreator.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    private readonly raiser: SupportRaiser,
  ) {}

  async check(): Promise<void> {
    const tickets = await this.prisma.ticket.findMany({ where: { githubIssueState: 'pending', project: { enabled: true } }, include: { project: true }, orderBy: { createdAt: 'asc' }, take: MAX_PER_TICK });
    for (const ticket of tickets) {
      try {
        await this.make(ticket);
      } catch (err) {
        await this.fail(ticket, err);
      }
    }
  }

  private async make(ticket: Prisma.TicketGetPayload<{ include: { project: true } }>): Promise<void> {
    // It came from a GitHub issue in the first place: that is its issue.
    if (ticket.source === 'github') {
      await this.prisma.ticket.updateMany({ where: { id: ticket.id, githubIssueState: 'pending' }, data: { githubIssueState: 'none' } });
      return;
    }
    const gh = ProjectSettingsSchema.parse(ticket.project.settings).github;
    if (gh.mode === 'off') throw new Error('This project no longer uses GitHub issues or a Projects board, so no issue was made');
    const repo = parseRepo(ticket.project.repoUrl);

    const linked = await this.linkedIssue(ticket, repo);
    const issue: CreatedIssue =
      linked ??
      (await this.github.createIssue(repo, ticket.title, `${ticket.body}${issueFooter(ticket.key)}`.trim(), [stateLabel('NEW'), ...(ticket.kind === 'bug' ? ['bug'] : ticket.kind === 'chore' ? ['chore'] : [])]));

    // First of all: the ticket and the issue belong together. Intake dedupes on this key.
    const { count } = await this.recordIssue(ticket, repo, issue);
    if (count === 0) return; // the ticket changed meanwhile (retried, or removed): nothing more to do
    await this.prisma.event.create({ data: { ticketId: ticket.id, type: 'github', message: `${linked ? 'Linked' : 'Created'} GitHub issue ${repo}#${issue.number}` } });
    await this.raiser.close({ dedupeKey: `github-issue:${ticket.id}` }, 'resolved', 'system', 'The GitHub issue was made').catch(() => undefined);

    if (gh.mode === 'projects' && gh.project) {
      try {
        await this.github.addIssueToProject(gh.project.owner, gh.project.number, issue.nodeId);
        // The column for a new ticket: the one mapped for NEW, else the one mapped for PLANNING. With neither, the card stays where the board puts it.
        const column = [gh.statusMap.NEW, gh.statusMap.PLANNING].find((c): c is string => typeof c === 'string' && c.trim() !== '');
        if (column) await this.github.setProjectItemStatus(gh.project.owner, gh.project.number, { repo, number: issue.number }, gh.statusField, column);
      } catch (err) {
        // The issue exists and is the ticket's: only the card is missing. Say so, and leave the state as it is.
        const message = err instanceof Error ? err.message : String(err);
        await this.prisma.event.create({ data: { ticketId: ticket.id, type: 'github', level: 'warn', message: `${repo}#${issue.number} could not be put on the board: ${message}`.slice(0, 500) } });
        await this.tell(ticket, `${ticket.key} has its GitHub issue (${repo}#${issue.number}), but it could not be put on the Projects board: ${message}`);
      }
    }
  }

  /** The issue the person named, when it is still open. A closed or missing one is not linked: a new issue is made instead, and the ticket says so. */
  private async linkedIssue(ticket: { id: string; githubIssueLink: number | null }, repo: string): Promise<CreatedIssue | null> {
    if (!ticket.githubIssueLink) return null;
    const note = (message: string) => this.prisma.event.create({ data: { ticketId: ticket.id, type: 'github', level: 'warn', message } });
    try {
      const issue = await this.github.getIssue(repo, ticket.githubIssueLink);
      if (issue.state === 'open') return issue;
      await note(`${repo}#${issue.number} is closed, so a new issue was made instead`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/not found|404/i.test(message)) throw err; // GitHub down or the token refused: try again, do not make a duplicate
      await note(`${repo}#${ticket.githubIssueLink} was not found, so a new issue was made instead`);
    }
    return null;
  }

  private async recordIssue(ticket: { id: string }, repo: string, issue: CreatedIssue): Promise<{ count: number }> {
    try {
      // `externalStatus` NEW: the label made with the issue says "new", and the sync must not write "picked up" over an issue we made ourselves.
      return await this.prisma.ticket.updateMany({
        where: { id: ticket.id, githubIssueState: 'pending' },
        data: { externalKey: `${repo}#${issue.number}`, source: 'github', githubIssueState: 'created', githubIssueError: null, externalStatus: 'NEW' },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new Error(`${repo}#${issue.number} is already a ticket in this project`, { cause: err });
      throw err;
    }
  }

  private async fail(ticket: { id: string; key: string }, err: unknown): Promise<void> {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    this.logger.warn(`The GitHub issue of ${ticket.key} could not be made: ${message}`);
    const { count } = await this.prisma.ticket.updateMany({ where: { id: ticket.id, githubIssueState: 'pending' }, data: { githubIssueState: 'failed', githubIssueError: message } });
    if (count === 0) return;
    await this.prisma.event.create({ data: { ticketId: ticket.id, type: 'github', level: 'warn', message: `The GitHub issue could not be made: ${message}` } });
    await this.tell(ticket, `${ticket.key} is going ahead, but its GitHub issue could not be made: ${message}\n\nRetry it from the ticket page once the problem is fixed.`);
  }

  /** An FYI in the inbox: nothing waits for it, and it needs a look. One per ticket. */
  private async tell(ticket: { id: string; key: string }, body: string): Promise<void> {
    await this.raiser
      .raise({ kind: 'credential', priority: 'fyi', ticketId: ticket.id, stage: 'github_issue', dedupeKey: `github-issue:${ticket.id}`, title: `${ticket.key}: the GitHub issue could not be made`, body })
      .catch((err: unknown) => this.logger.warn(`Could not tell the inbox about ${ticket.key}: ${String(err)}`));
  }
}
