import { Injectable } from '@nestjs/common';
import { ProjectSettingsSchema, validateBreakdown, type SubtaskDraft } from '@sdlc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StateMachine } from '../state/state-machine.service';
import { SubtasksService } from '../subtasks/subtasks.service';

/** What came of an approval from outside the dashboard. */
export type ApprovalResult = { kind: 'approved' } | { kind: 'open_questions'; count: number } | { kind: 'invalid'; message: string } | { kind: 'not_waiting' };

/**
 * Approving a plan or a breakdown on behalf of a person who did it somewhere else (a GitHub board or label). The dashboard's own
 * approval can also edit and answer questions; this one takes the plan or list as it stands and refuses when a plan still has questions.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly states: StateMachine,
    private readonly subtasks: SubtasksService,
  ) {}

  async approvePlan(ticketId: string, reason: string): Promise<ApprovalResult> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.status !== 'AWAITING_PLAN_APPROVAL') return { kind: 'not_waiting' };
    const count = await this.prisma.supportTicket.count({ where: { ticketId, kind: 'open_question', status: 'open' } });
    if (count > 0) return { kind: 'open_questions', count };
    await this.states.transition(ticketId, 'BREAKDOWN', 'user', reason, undefined, { kind: 'approve' });
    return { kind: 'approved' };
  }

  async approveBreakdown(ticketId: string, reason: string): Promise<ApprovalResult> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId }, include: { project: true } });
    if (!ticket || ticket.status !== 'AWAITING_BREAKDOWN_APPROVAL') return { kind: 'not_waiting' };
    const verdict = validateBreakdown(ticket.breakdownDraft, { maxSubtasks: ProjectSettingsSchema.parse(ticket.project.settings).limits.maxSubtasks });
    if (!verdict.ok) return { kind: 'invalid', message: 'the proposed list is not valid' };
    await this.subtasks.create(ticketId, verdict.subtasks as SubtaskDraft[]);
    await this.states.transition(ticketId, 'IN_PROGRESS', 'user', reason, undefined, { kind: 'approve' });
    return { kind: 'approved' };
  }
}
