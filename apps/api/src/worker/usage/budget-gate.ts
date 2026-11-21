import { Injectable, Logger } from '@nestjs/common';
import { budgetPauseReason, describeError, events } from '@sdlc/shared';
import { writeEvent } from '../../common/event-log';
import { PrismaService } from '../../prisma/prisma.service';
import { budgetDecision } from '../../usage/spend';

export const BUDGET_GATE = Symbol('BUDGET_GATE');

export interface BudgetGatePort {
  /** Pauses the pipeline when a budget is used up. True when the pipeline is (now) paused for a budget. */
  check(): Promise<boolean>;
}

/**
 * The spend gate. It runs before the worker starts a step and after every AI stage run. When the spend of the current day, week or
 * month reaches its budget, it pauses the pipeline with SPEND_BUDGET_REACHED until every used-up budget has reset; the worker loop
 * then resumes by itself. Nothing is enforced while `usageIgnoredUntil` is in the future.
 */
@Injectable()
export class BudgetGate implements BudgetGatePort {
  private readonly logger = new Logger(BudgetGate.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(): Promise<boolean> {
    const row = await this.prisma.globalSettings.upsert({ where: { id: 'global' }, update: {}, create: { id: 'global' } });
    if (row.pipelinePaused) return row.pausedCode === 'SPEND_BUDGET_REACHED';
    const now = this.now();
    if (row.usageIgnoredUntil && row.usageIgnoredUntil.getTime() > now.getTime()) return false;
    const decision = await budgetDecision(this.prisma, row, now);
    if (!decision.reached.length) return false;

    const first = decision.reached[0];
    const reason = budgetPauseReason(decision.reached);
    this.logger.warn(`Pipeline paused: ${reason}`);
    await this.prisma.globalSettings.update({ where: { id: 'global' }, data: { pipelinePaused: true, pausedReason: reason.slice(0, 300), pausedCode: 'SPEND_BUDGET_REACHED', resetsAt: decision.resumeAt } });
    await writeEvent(this.prisma, events.paused({ reason: describeError('SPEND_BUDGET_REACHED', { period: first?.period, budget: first?.budget ?? undefined, time: decision.resumeAt?.toISOString() }), code: 'SPEND_BUDGET_REACHED' }));
    return true;
  }
}
