import Link from 'next/link';
import { formatCredits } from '@/lib/budgets';
import type { TicketCostsView } from '@/lib/types';

/** Average credits per finished ticket, per kind, and the most expensive ones. */
export function TicketCosts({ data }: { data: TicketCostsView }) {
  if (data.tickets === 0) return <p className="text-sm text-muted">No ticket was finished in the last {data.days} days.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="panel p-4">
        <span className="eyebrow">Average per ticket</span>
        <p className="mt-2 font-mono text-2xl font-medium tracking-tight">{formatCredits(data.avgCredits)}</p>
        <p className="text-xs text-muted">
          {data.tickets} ticket{data.tickets === 1 ? '' : 's'} finished in the last {data.days} days
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {data.byKind.map((k) => (
            <li key={k.kind} className="flex justify-between">
              <span className="capitalize">{k.kind}</span>
              <span className="text-muted">
                {formatCredits(k.avgCredits)} · {k.tickets} ticket{k.tickets === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="panel p-4">
        <span className="eyebrow">Most expensive</span>
        <ul className="mt-3 space-y-1 text-sm">
          {data.top.map((t) => (
            <li key={t.id} className="flex justify-between gap-3">
              <Link href={`/tickets/${t.id}`} className="min-w-0 truncate text-accent hover:underline">
                {t.key} <span className="text-muted">{t.title}</span>
              </Link>
              <span className="shrink-0 font-mono">{formatCredits(t.credits)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
