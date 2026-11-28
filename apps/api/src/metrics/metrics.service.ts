import { Injectable } from '@nestjs/common';
import { TICKET_STATUSES, ACTIONABLE_STATUSES, budgetPeriod } from '@sdlc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BILLED_RUNS, spentSince } from '../usage/spend';
import { bucketSpend } from '../usage/spend-analytics';
import { finishedTicketCosts } from '../usage/ticket-costs';
import { firstPassRate, mean, median, mergedPerDay, parseRange, round2, tokensPerDay } from './aggregate';

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

/** Read-only metrics computed from the existing tables (F17); there are no extra tables. */
@Injectable()
export class MetricsService {
  /** The clock; tests replace it. */
  now: () => Date = () => new Date();

  constructor(private readonly prisma: PrismaService) {}

  /** Subtasks that became DONE in range: DONE, with a stage run that ended in range. `testFixRuns` counts their `fix` runs for tests. */
  private async finishedSubtasks(since: Date) {
    const subtasks = await this.prisma.subtask.findMany({
      where: { status: 'DONE', stageRuns: { some: { endedAt: { gte: since } } } },
      select: { stageRuns: { select: { stage: true, reason: true } } },
    });
    return subtasks.map((s) => ({ testFixRuns: s.stageRuns.filter((r) => r.stage === 'fix' && r.reason === 'tests').length }));
  }

  async summary(rangeInput?: string) {
    const now = this.now();
    const { range, since } = parseRange(rangeInput, now);
    const settings = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    const [done, finished, today, queue, costs] = await Promise.all([
      this.prisma.stateTransition.count({ where: { toStatus: 'DONE', at: { gte: since } } }),
      this.finishedSubtasks(since),
      spentSince(this.prisma, budgetPeriod('daily', now, settings?.timezone ?? 'UTC').start),
      this.prisma.ticket.count({ where: { OR: [{ status: { in: [...ACTIONABLE_STATUSES] } }, { status: 'AWAITING_CI', ciFixPending: true }] } }),
      finishedTicketCosts(this.prisma, since),
    ]);
    return {
      range,
      ticketsDone: done,
      firstPassRate: firstPassRate(finished),
      creditsToday: round2(today),
      queueLength: queue,
      /** Mean credits (1 credit = 1 USD) of the tickets that reached DONE in range, over their whole life. Null when none did. */
      avgCostPerTicket: costs.length ? round2(mean(costs.map((c) => c.credits)) as number) : null,
      ticketsCosted: costs.length,
    };
  }

  /** Credits per local hour (24h) or local day (7d, 30d) in the timezone from Settings, and the pauses in range. */
  async usage(rangeInput?: string) {
    const now = this.now();
    const { range, since } = parseRange(rangeInput, now);
    const [runs, settings, pauses] = await Promise.all([
      this.prisma.stageRun.findMany({ where: { ...BILLED_RUNS, startedAt: { gte: since } }, select: { startedAt: true, costUsd: true } }),
      this.prisma.globalSettings.findUnique({ where: { id: 'global' } }),
      this.prisma.event.findMany({ where: { type: 'usage', at: { gte: since }, message: { startsWith: 'Pipeline paused' } }, orderBy: { at: 'asc' } }),
    ]);
    const timezone = settings?.timezone ?? 'UTC';
    const unit = range === '24h' ? 'hour' : 'day';
    return {
      range,
      timezone,
      unit,
      series: bucketSpend(runs.map((r) => ({ startedAt: r.startedAt as Date, costUsd: Number(r.costUsd) })), since, now, unit, timezone),
      pauses: pauses.map((e) => ({ at: e.at.toISOString(), message: e.message })),
    };
  }

  async tokens(rangeInput?: string, groupBy?: string) {
    const now = this.now();
    const { range, since } = parseRange(rangeInput, now);
    const by = groupBy === 'model' ? 'model' : 'stage';
    const runs = await this.prisma.stageRun.findMany({
      where: { startedAt: { gte: since } },
      select: { startedAt: true, stage: true, model: true, inputTokens: true, outputTokens: true, cacheWriteTokens: true },
    });
    const { days, keys } = tokensPerDay(runs.map((r) => ({ ...r, startedAt: r.startedAt as Date })), by, since, now);
    return { range, groupBy: by, keys, days };
  }

  /** PRs merged and lines added and deleted per day (F17). Lines are recorded when the worker sees the merge. */
  async merged(rangeInput?: string) {
    const now = this.now();
    const { range, since } = parseRange(rangeInput, now);
    const tickets = await this.prisma.ticket.findMany({ where: { mergedAt: { gte: since } }, select: { mergedAt: true, prAdditions: true, prDeletions: true } });
    const { days, totals } = mergedPerDay(tickets.map((t) => ({ ...t, mergedAt: t.mergedAt as Date })), since, now);
    return { range, days, totals };
  }

  async ticketsByState() {
    const groups = await this.prisma.ticket.groupBy({ by: ['status'], _count: true });
    return TICKET_STATUSES.map((status) => ({ status, count: groups.find((g) => g.status === status)?._count ?? 0 }));
  }

  async quality(rangeInput?: string) {
    const { range, since } = parseRange(rangeInput, this.now());
    const [finished, fixRuns, reviewTickets, findings] = await Promise.all([
      this.finishedSubtasks(since),
      this.prisma.stageRun.groupBy({ by: ['ticketId'], where: { stage: 'fix', startedAt: { gte: since }, ticketId: { not: null } }, _count: true }),
      this.prisma.ticket.findMany({ where: { reviewRound: { gt: 0 }, updatedAt: { gte: since } }, select: { reviewRound: true } }),
      this.prisma.reviewFinding.groupBy({ by: ['severity'], where: { ticket: { updatedAt: { gte: since } } }, _count: true }),
    ]);
    const ticketsWithRuns = await this.prisma.stageRun.findMany({ where: { startedAt: { gte: since }, ticketId: { not: null } }, distinct: ['ticketId'], select: { ticketId: true } });
    const avg = (n: number | null) => (n === null ? null : round2(n));
    return {
      range,
      firstPassRate: firstPassRate(finished),
      // Fix rounds per ticket over every ticket that ran a stage in range (tickets with no fix count as zero).
      avgFixRounds: avg(ticketsWithRuns.length === 0 ? null : fixRuns.reduce((a, g) => a + g._count, 0) / ticketsWithRuns.length),
      avgReviewRounds: avg(mean(reviewTickets.map((t) => t.reviewRound))),
      findingsBySeverity: SEVERITIES.map((severity) => ({ severity, count: findings.find((f) => f.severity === severity)?._count ?? 0 })),
    };
  }

  async durations(rangeInput?: string) {
    const { range, since } = parseRange(rangeInput, this.now());
    const runs = await this.prisma.stageRun.findMany({ where: { status: 'succeeded', startedAt: { gte: since }, endedAt: { not: null } }, select: { stage: true, startedAt: true, endedAt: true } });
    const byStage = new Map<string, number[]>();
    for (const r of runs) {
      const seconds = ((r.endedAt as Date).getTime() - (r.startedAt as Date).getTime()) / 1000;
      byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), seconds]);
    }
    return {
      range,
      stages: [...byStage.entries()].map(([stage, secs]) => ({ stage, runs: secs.length, medianSeconds: round2(median(secs) as number) })).sort((a, b) => b.medianSeconds - a.medianSeconds),
    };
  }
}
