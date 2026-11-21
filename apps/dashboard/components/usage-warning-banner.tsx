import Link from 'next/link';
import { budgetWarning } from '@/lib/budgets';
import type { SystemView } from '@/lib/types';

/** A quiet heads-up under the top bar when spend nears a budget. The pipeline keeps running. */
export function UsageWarningBanner({ system }: { system: SystemView | null }) {
  const w = budgetWarning(system);
  if (!w) return null;
  return (
    <div role="note" aria-label="Budget warning" className="flex flex-wrap items-center gap-x-4 border-b border-border bg-surface px-8 py-2 text-sm text-amber">
      <span>{w.text}</span>
      <span className="text-muted">The pipeline keeps running until a budget is used up.</span>
      <Link href="/usage" className="text-accent hover:underline">
        Usage
      </Link>
    </div>
  );
}
