import Link from 'next/link';
import { usageWarning } from '@/lib/usage-warning';
import type { SystemView } from '@/lib/types';

/** A quiet heads-up under the top bar when usage nears a threshold. The pipeline keeps running. */
export function UsageWarningBanner({ system, now }: { system: SystemView | null; now?: number }) {
  const w = usageWarning(system, now);
  if (!w) return null;
  return (
    <div role="note" aria-label="Usage warning" className="flex flex-wrap items-center gap-x-4 border-b border-border bg-surface px-8 py-2 text-sm text-amber">
      <span>{w.text}</span>
      <span className="text-muted">The pipeline keeps running until a threshold is crossed.</span>
      <Link href="/usage" className="text-accent hover:underline">
        Usage
      </Link>
    </div>
  );
}
