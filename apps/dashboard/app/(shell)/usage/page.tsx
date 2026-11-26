import { BudgetOverview } from '@/components/budget-overview';
import { BurnChart } from '@/components/charts/burn-chart';
import { ModelUsage } from '@/components/model-usage';
import { TicketCosts } from '@/components/ticket-costs';
import { TokensTable } from '@/components/usage-tables';
import Link from 'next/link';
import { apiGet } from '@/lib/server-api';
import type { ModelUsageView, SpendOverviewView, TicketCostsView, UsageSummaryView } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function UsagePage() {
  const [spend, tickets, summary, models] = await Promise.all([
    apiGet<SpendOverviewView>('/usage/spend'),
    apiGet<TicketCostsView>('/usage/tickets'),
    apiGet<UsageSummaryView>('/usage/summary'),
    apiGet<ModelUsageView>('/usage/models'),
  ]);
  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="mt-1 text-sm text-muted">
          Every figure is in credits: 1 credit = 1 USD of Anthropic credit balance, billed to your API key. Days, weeks (from Monday) and months are counted in{' '}
          {spend?.timezone ?? 'UTC'}. Set the budgets in{' '}
          <Link href="/settings" className="text-accent hover:underline">
            Settings
          </Link>
          .
        </p>
      </div>
      {spend && <BudgetOverview periods={spend.periods} warnPct={spend.warnPct} projection={spend.projection} />}
      {spend && <BurnChart burn={spend.burn} />}
      <div id="ticket-costs">
        <h2 className="mb-2 text-sm font-medium">Cost per ticket</h2>
        {tickets ? <TicketCosts data={tickets} /> : <p className="text-sm text-muted">Not available.</p>}
      </div>
      <div>
        <h2 className="mb-2 text-sm font-medium">By model, last 7 days</h2>
        {models ? <ModelUsage data={models} /> : <p className="text-sm text-muted">Not available.</p>}
      </div>
      <div>
        <h2 className="mb-2 text-sm font-medium">Tokens and credits by stage and model, last 30 days</h2>
        <TokensTable rows={summary?.rows ?? []} />
      </div>
    </section>
  );
}
