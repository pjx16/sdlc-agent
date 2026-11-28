import { BUDGET_PERIODS, budgetPeriod, evaluateBudgets, type BudgetAmounts, type BudgetDecision, type SpendAmounts } from '@sdlc/shared';
import type { GlobalSettings, Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Runs billed to the Anthropic API key. Runs of the removed Jira connector stage used their own claude.ai login, so they stay out of the spend.
 */
export const BILLED_RUNS: Prisma.StageRunWhereInput = { stage: { not: 'jiraConnector' } };

/** Credits spent since `since` (the sum of StageRun.costUsd, which the CLI reports in USD). */
export async function spentSince(prisma: PrismaService, since: Date): Promise<number> {
  const sum = await prisma.stageRun.aggregate({ where: { ...BILLED_RUNS, startedAt: { gte: since } }, _sum: { costUsd: true } });
  return Number(sum._sum.costUsd ?? 0);
}

/** Credits spent in the current day, week and month of `timeZone`. */
export async function currentSpend(prisma: PrismaService, now: Date, timeZone: string): Promise<SpendAmounts> {
  const [daily = 0, weekly = 0, monthly = 0] = await Promise.all(BUDGET_PERIODS.map((p) => spentSince(prisma, budgetPeriod(p, now, timeZone).start)));
  return { daily, weekly, monthly };
}

export const budgetsOf = (row: Pick<GlobalSettings, 'budgetDailyCredits' | 'budgetWeeklyCredits' | 'budgetMonthlyCredits'>): BudgetAmounts => ({
  daily: row.budgetDailyCredits,
  weekly: row.budgetWeeklyCredits,
  monthly: row.budgetMonthlyCredits,
});

/** Spend against the budgets of `row`, right now. */
export async function budgetDecision(prisma: PrismaService, row: GlobalSettings, now: Date): Promise<BudgetDecision> {
  const spend = await currentSpend(prisma, now, row.timezone);
  return evaluateBudgets({ spend, budgets: budgetsOf(row), warnPct: row.budgetWarnPct, now, timeZone: row.timezone });
}
