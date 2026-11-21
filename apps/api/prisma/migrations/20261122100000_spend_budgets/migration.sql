-- Spend budgets (daily, weekly, monthly, in credits) replace the Claude subscription's 5-hour and 7-day usage thresholds.
ALTER TABLE "GlobalSettings"
  DROP COLUMN "usageThresholdPct",
  DROP COLUMN "usageThresholdWeeklyPct",
  DROP COLUMN "calibratedWindowTokens",
  ADD COLUMN "budgetDailyCredits" DOUBLE PRECISION,
  ADD COLUMN "budgetWeeklyCredits" DOUBLE PRECISION,
  ADD COLUMN "budgetMonthlyCredits" DOUBLE PRECISION,
  ADD COLUMN "budgetWarnPct" INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "budgetsApprovedAt" TIMESTAMPTZ(6);

-- Spend per period sums StageRun.costUsd by start time.
CREATE INDEX "StageRun_startedAt_idx" ON "StageRun"("startedAt");
