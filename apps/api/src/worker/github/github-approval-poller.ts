import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProjectSettingsSchema, githubBoard } from '@sdlc/shared';
import { ApprovalService, type ApprovalResult } from '../../approval/approval.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { Housekeeper } from '../loop/worker-loop';
import { GITHUB_CLIENT, type GitHubClient } from './github-client';
import { parseGithubKey } from './github-sync';
import { TicketComments } from './ticket-comments';

type Waiting = 'plan' | 'breakdown';
type GithubSettings = ReturnType<typeof ProjectSettingsSchema.parse>['github'];

/**
 * Approval from GitHub. A ticket that waits for a person to approve its plan or breakdown is approved when its card is moved to the
 * approval column (`projects` mode) or its issue gets the approval label (`issues` mode). The label is taken off once used.
 * A plan that still has open questions is not approved: a comment says so and the card goes back to the review column.
 */
@Injectable()
export class GithubApprovalPoller implements Housekeeper {
  readonly name = 'github-approval';
  readonly intervalMs = (pollIntervalSec: number) => pollIntervalSec;
  private readonly logger = new Logger(GithubApprovalPoller.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    private readonly approvals: ApprovalService,
    private readonly comments: TicketComments,
  ) {}

  async check(): Promise<void> {
    const tickets = await this.prisma.ticket.findMany({
      where: { source: 'github', externalKey: { not: null }, status: { in: ['AWAITING_PLAN_APPROVAL', 'AWAITING_BREAKDOWN_APPROVAL'] }, project: { enabled: true, onboardingStatus: 'confirmed' } },
      include: { project: true },
      orderBy: { createdAt: 'asc' },
    });
    // One read of the board, or of the labelled issues of a repository, serves every ticket of the project.
    const boards = new Map<string, Promise<Map<number, string | null>>>();
    const labelled = new Map<string, Promise<Set<number>>>();
    for (const ticket of tickets) {
      try {
        const gh = ProjectSettingsSchema.parse(ticket.project.settings).github;
        const ref = parseGithubKey(ticket.externalKey);
        if (gh.mode === 'off' || !ref) continue;
        const waiting: Waiting = ticket.status === 'AWAITING_PLAN_APPROVAL' ? 'plan' : 'breakdown';

        let asked: boolean;
        if (gh.mode === 'projects') {
          const column = githubBoard(gh).approval[waiting];
          if (!gh.project || !column) continue;
          const key = `${gh.project.owner}/${gh.project.number}/${gh.statusField}`;
          if (!boards.has(key)) boards.set(key, this.github.listProjectItems(gh.project.owner, gh.project.number, gh.statusField).then((items) => new Map(items.map((i) => [i.issue.number, i.status]))));
          const status = (await boards.get(key)!).get(ref.number) ?? null;
          asked = status !== null && status.toLowerCase() === column.toLowerCase();
        } else {
          const key = `${ref.repo}/${gh.approval.label}`;
          if (!labelled.has(key)) labelled.set(key, this.github.listIssues(ref.repo, gh.approval.label).then((issues) => new Set(issues.map((i) => i.number))));
          asked = (await labelled.get(key)!).has(ref.number);
        }
        if (!asked) continue;

        const result = waiting === 'plan' ? await this.approvals.approvePlan(ticket.id, 'Plan approved on GitHub') : await this.approvals.approveBreakdown(ticket.id, 'Breakdown approved on GitHub');
        await this.after(ticket, waiting, result, gh, ref);
      } catch (err) {
        this.logger.warn(`Approval check for ${ticket.key} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async after(ticket: { id: string; key: string; externalKey: string | null; status: string }, waiting: Waiting, result: ApprovalResult, gh: GithubSettings, ref: { repo: string; number: number }): Promise<void> {
    const note = (message: string, level: 'info' | 'warn' = 'info') => this.prisma.event.create({ data: { ticketId: ticket.id, type: 'github', level, message } });
    if (result.kind === 'approved') await note(`${waiting === 'plan' ? 'Plan' : 'Breakdown'} approved on GitHub`);
    else if (result.kind === 'open_questions') {
      const posted = await this.comments.post(ticket, 'open-questions', `Answer the ${result.count} open question${result.count === 1 ? '' : 's'} of the plan in the dashboard first, then approve it again.`);
      if (gh.mode === 'projects' && gh.project) {
        const back = githubBoard(gh).statusMap[ticket.status] ?? null;
        if (back) await this.github.setProjectItemStatus(gh.project.owner, gh.project.number, ref, gh.statusField, back);
      }
      if (posted !== 'unchanged') await note(`The plan was not approved on GitHub: ${result.count} open question${result.count === 1 ? '' : 's'} still need an answer`, 'warn');
    } else if (result.kind === 'invalid') await note(`The ${waiting} could not be approved on GitHub: ${result.message}`, 'warn');
    // The label is a one-time request: it comes off whatever the answer was, so it is not read again.
    if (gh.mode === 'issues') await this.github.setIssueLabels(ref.repo, ref.number, [], [gh.approval.label]);
  }
}
