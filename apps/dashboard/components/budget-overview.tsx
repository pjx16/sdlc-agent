import { LocalTime } from '@/components/local-time';
import { PERIOD_LABEL, formatCredits } from '@/lib/budgets';
import type { BudgetPeriodView, MonthProjectionView } from '@/lib/types';

function Bar({ p, warnPct }: { p: BudgetPeriodView; warnPct: number }) {
  const pct = p.pct === null ? null : Math.min(p.pct, 100);
  const tone = p.pct === null ? 'bg-accent' : p.pct >= 100 ? 'bg-red' : p.pct >= warnPct ? 'bg-amber' : 'bg-accent';
  return (
    <div className="panel p-4" data-testid={`budget-${p.period}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow">{PERIOD_LABEL[p.period]}</span>
        <span className="text-xs text-muted">
          resets <LocalTime iso={p.resetsAt} />
        </span>
      </div>
      <p className="mt-2 font-mono text-2xl font-medium tracking-tight">{formatCredits(p.spent)}</p>
      <p className="text-xs text-muted">{p.budget === null ? 'No budget set' : `of ${formatCredits(p.budget)} (${Math.round(p.pct ?? 0)}%)`}</p>
      {pct !== null && (
        <div className="mt-3 h-2 rounded bg-border" role="meter" aria-label={`${PERIOD_LABEL[p.period]}: ${Math.round(p.pct ?? 0)}% of the budget`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className={`h-2 rounded ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Today, this week and this month against their budgets, and where the month is heading. */
export function BudgetOverview({ periods, warnPct, projection }: { periods: BudgetPeriodView[]; warnPct: number; projection: MonthProjectionView }) {
  const over = projection.budget !== null && projection.projected > projection.budget;
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {periods.map((p) => (
        <Bar key={p.period} p={p} warnPct={warnPct} />
      ))}
      <div className="panel p-4" data-testid="month-projection">
        <span className="eyebrow">Month projection</span>
        <p className={`mt-2 font-mono text-2xl font-medium tracking-tight ${over ? 'text-amber' : ''}`}>{formatCredits(projection.projected)}</p>
        <p className="text-xs text-muted">
          {formatCredits(projection.monthToDate)} so far, plus {formatCredits(projection.avgDaily)} a day (last 7 days) for {projection.daysLeft} days left.
        </p>
        {projection.reachesBudgetAt && (
          <p className="mt-1 text-xs text-amber">
            Reaches the monthly budget <LocalTime iso={projection.reachesBudgetAt} />.
          </p>
        )}
      </div>
    </div>
  );
}
