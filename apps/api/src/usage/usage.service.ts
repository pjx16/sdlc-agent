import { Injectable } from '@nestjs/common';
import { BUDGET_PERIODS, budgetPeriod, type BudgetPeriod } from '@sdlc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SystemSettingsService, type SpendView } from '../system/system-settings.service';
import { BILLED_RUNS, budgetsOf, spentSince } from './spend';
import { monthProjection, periodBurn, ticketCosts, type MonthProjection, type PeriodBurn, type TicketCosts } from './spend-analytics';
import { usageByModel, type ModelUsage } from './usage-analytics';

export interface SpendOverviewDto extends Omit<SpendView, 'suggested'> {
  projection: MonthProjection;
  burn: Record<BudgetPeriod, PeriodBurn>;
}

export interface UsageSummaryDto {
  /** Tokens (input + output + cache write) and credits per stage and model, last 30 days, most credits first. */
  rows: { stage: string; model: string; tokens: number; credits: number; runs: number }[];
}

const DAY_MS = 86_400_000;
const TICKET_DAYS = 30;

const parseDate = (v?: string): Date | undefined => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** The usage page, in credits (1 credit = 1 USD of Anthropic credit balance, the CLI's `total_cost_usd`). */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemSettingsService,
  ) {}

  /** GET /usage/spend: each budget period with its spend, how it is burning, and the projection for the month. */
  async spend(now = new Date()): Promise<SpendOverviewDto> {
    const settings = await this.system.settings();
    const { suggested: _suggested, ...view } = await this.system.spend(now); // eslint-disable-line @typescript-eslint/no-unused-vars
    const tz = settings.timezone;
    const monthStart = budgetPeriod('monthly', now, tz).start;
    const weekStart = budgetPeriod('weekly', now, tz).start;
    const since = monthStart < weekStart ? monthStart : weekStart;
    const runs = (await this.prisma.stageRun.findMany({ where: { ...BILLED_RUNS, startedAt: { gte: since } }, select: { startedAt: true, costUsd: true } })).map((r) => ({ startedAt: r.startedAt as Date, costUsd: Number(r.costUsd) }));
    const budgets = budgetsOf({ budgetDailyCredits: settings.budgetDailyCredits, budgetWeeklyCredits: settings.budgetWeeklyCredits, budgetMonthlyCredits: settings.budgetMonthlyCredits });
    const burn = Object.fromEntries(BUDGET_PERIODS.map((p) => [p, periodBurn(runs, p, budgets[p], now, tz)])) as Record<BudgetPeriod, PeriodBurn>;
    const last7Days = await spentSince(this.prisma, new Date(now.getTime() - 7 * DAY_MS));
    return { ...view, projection: monthProjection({ monthToDate: burn.monthly.spent, last7Days, budget: budgets.monthly, now, timeZone: tz }), burn };
  }

  /** GET /usage/tickets: credits per ticket that reached DONE in the last 30 days, overall and per kind, and the most expensive. */
  async tickets(now = new Date()): Promise<TicketCosts & { days: number }> {
    const done = await this.prisma.stateTransition.findMany({ where: { toStatus: 'DONE', at: { gte: new Date(now.getTime() - TICKET_DAYS * DAY_MS) } }, select: { ticketId: true }, distinct: ['ticketId'] });
    const ids = done.map((d) => d.ticketId);
    const [tickets, costs] = await Promise.all([
      this.prisma.ticket.findMany({ where: { id: { in: ids } }, select: { id: true, key: true, title: true, kind: true } }),
      this.prisma.stageRun.groupBy({ by: ['ticketId'], where: { ...BILLED_RUNS, ticketId: { in: ids } }, _sum: { costUsd: true } }),
    ]);
    const byTicket = new Map(costs.map((c) => [c.ticketId, Number(c._sum.costUsd ?? 0)]));
    return { days: TICKET_DAYS, ...ticketCosts(tickets.map((t) => ({ ...t, credits: byTicket.get(t.id) ?? 0 }))) };
  }

  /** GET /usage/models: tokens by kind, credits, runs and share per model, with the split by stage and day. */
  async models(query: { from?: string; to?: string }): Promise<{ from: string; to: string; models: ModelUsage[] }> {
    const to = parseDate(query.to) ?? new Date();
    const from = parseDate(query.from) ?? new Date(to.getTime() - 7 * DAY_MS);
    const runs = await this.prisma.stageRun.findMany({ where: { ...BILLED_RUNS, startedAt: { gte: from, lte: to } } });
    return { from: from.toISOString(), to: to.toISOString(), models: usageByModel(runs.map((r) => ({ ...r, costUsd: Number(r.costUsd) }))) };
  }

  /** GET /usage/summary: tokens and credits by stage and model over the last 30 days. */
  async summary(): Promise<UsageSummaryDto> {
    const since = new Date(Date.now() - 30 * DAY_MS);
    const groups = await this.prisma.stageRun.groupBy({
      by: ['stage', 'model'],
      where: { ...BILLED_RUNS, startedAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true, cacheWriteTokens: true, costUsd: true },
      _count: true,
    });
    const rows = groups
      .map((g) => ({
        stage: g.stage,
        model: g.model,
        tokens: (g._sum.inputTokens ?? 0) + (g._sum.outputTokens ?? 0) + (g._sum.cacheWriteTokens ?? 0),
        credits: Math.round(Number(g._sum.costUsd ?? 0) * 100) / 100,
        runs: g._count,
      }))
      .sort((a, b) => b.credits - a.credits || b.tokens - a.tokens);
    return { rows };
  }
}
