import { Injectable, Logger } from '@nestjs/common';
import { ProjectSettingsSchema, approvalTarget, validateBreakdown, type SubtaskDraft, type TicketStatus } from '@sdlc/shared';
import type { Project } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StateMachine } from '../state/state-machine.service';
import { SubtasksService } from '../subtasks/subtasks.service';
import { JiraNotConfiguredError, JiraClients } from './jira-clients';
import { JiraUnavailableError } from './jira-client';

/**
 * Inbound approval (F15): for tickets awaiting plan or breakdown approval, read the issue's
 * Jira status; if it equals the configured approval status, approve. Any other manual Jira change is ignored.
 */
@Injectable()
export class ApprovalPoller {
  private readonly logger = new Logger(ApprovalPoller.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: JiraClients,
    private readonly states: StateMachine,
    private readonly subtasks: SubtasksService,
  ) {}

  /** When each connector ticket was last read: reading it runs a Claude agent, so it waits out the project's poll interval. */
  private readonly lastConnectorRead = new Map<string, number>();

  /**
   * Returns how many tickets were approved. When one mode's Jira is down the rest of that mode is skipped and the other modes still run;
   * the first such error is thrown at the end (the loop logs it).
   */
  async check(only?: (project: Project) => boolean): Promise<number> {
    const tickets = await this.prisma.ticket.findMany({
      where: { source: 'jira', externalKey: { not: null }, status: { in: ['AWAITING_PLAN_APPROVAL', 'AWAITING_BREAKDOWN_APPROVAL'] }, project: { enabled: true, onboardingStatus: 'confirmed', jiraMode: { in: ['rest', 'mcp', 'connector'] } } },
      include: { project: true },
      orderBy: { createdAt: 'asc' },
    });
    let approved = 0;
    const down = new Map<string, Error>();
    for (const ticket of tickets.filter((t) => !only || only(t.project))) {
      const mode = ticket.project.jiraMode;
      if (down.has(mode)) continue;
      if (mode === 'connector') {
        const last = this.lastConnectorRead.get(ticket.id);
        if (last !== undefined && Date.now() - last < ProjectSettingsSchema.parse(ticket.project.settings).jiraConnector.pollIntervalMin * 60_000) continue;
      }
      const approvals = ProjectSettingsSchema.parse(ticket.project.settings).jiraApprovalStatuses;
      if (!approvals.plan && !approvals.breakdown) continue;
      try {
        if (mode === 'connector') this.lastConnectorRead.set(ticket.id, Date.now());
        const issue = await (await this.clients.forMode(mode)).readStatus(ticket.externalKey as string);
        const { status } = issue;
        const next = approvalTarget(ticket.status as TicketStatus, status, approvals);
        if (!next) continue;
        // Plan approval: developer edits to the title and description made in Jira reach the breakdown stage (F7).
        if (next === 'BREAKDOWN') await this.prisma.ticket.update({ where: { id: ticket.id }, data: { title: issue.summary || undefined, body: issue.description } });
        // Breakdown approval: the proposed subtasks become Subtask rows, exactly as a dashboard approval does (F8).
        if (next === 'IN_PROGRESS') {
          const verdict = validateBreakdown(ticket.breakdownDraft, { maxSubtasks: ProjectSettingsSchema.parse(ticket.project.settings).limits.maxSubtasks });
          if (!verdict.ok) {
            this.logger.warn(`Breakdown of ${ticket.key} cannot be approved from Jira: its proposed list is not valid`);
            continue;
          }
          await this.subtasks.create(ticket.id, verdict.subtasks as SubtaskDraft[]);
          await this.subtasks.publishToJira(ticket.id);
        }
        await this.states.transition(ticket.id, next, 'jira', `approved in Jira (status "${status}")`);
        approved++;
      } catch (err) {
        if (err instanceof JiraUnavailableError || err instanceof JiraNotConfiguredError) {
          down.set(mode, err);
          continue;
        }
        // One bad ticket (deleted issue, no permission) must not stop the others.
        this.logger.warn(`Approval check for ${ticket.key} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const first = down.values().next().value;
    if (first) throw first;
    return approved;
  }
}
