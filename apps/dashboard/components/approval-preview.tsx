'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SubtaskDraft } from '@sdlc/shared';
import type { TicketFull } from '@/lib/types';
import { Markdown } from './markdown';

type Loaded = { kind: 'plan'; text: string } | { kind: 'breakdown'; items: SubtaskDraft[] } | { kind: 'error'; message: string };

/**
 * Read what you are about to approve without leaving the Inbox: the plan, or the list of subtasks of the breakdown.
 * It loads when opened. To edit either, use the link to the ticket.
 */
export function ApprovalPreview({ ticketId, stage }: { ticketId: string; stage: 'plan' | 'breakdown' }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const what = stage === 'breakdown' ? 'the breakdown' : 'the plan';

  async function load(open: boolean) {
    if (!open || loaded?.kind === 'plan' || loaded?.kind === 'breakdown') return;
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}`);
      if (!res.ok) throw new Error();
      const t = (await res.json()) as TicketFull;
      if (stage === 'breakdown') setLoaded(t.breakdownDraft && t.breakdownDraft.length > 0 ? { kind: 'breakdown', items: t.breakdownDraft } : { kind: 'error', message: 'There is no breakdown to show yet.' });
      else setLoaded(t.planMarkdown ? { kind: 'plan', text: t.planMarkdown } : { kind: 'error', message: 'There is no plan to show yet.' });
    } catch {
      setLoaded({ kind: 'error', message: `Could not load ${what}.` });
    }
  }

  return (
    <details className="mt-3 rounded-md border border-border" onToggle={(e) => void load((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">View {what}</summary>
      <div className="border-t border-border p-3 text-sm">
        {!loaded && <p className="text-muted">Loading…</p>}
        {loaded?.kind === 'error' && <p role="alert" className="text-red">{loaded.message}</p>}
        {loaded?.kind === 'plan' && <Markdown source={loaded.text} maxHeight="max-h-96" />}
        {loaded?.kind === 'breakdown' && (
          <ol className="max-h-96 list-decimal space-y-4 overflow-auto pl-5">
            {loaded.items.map((s) => (
              <li key={s.seq}>
                <p className="font-medium">{s.title}</p>
                {s.description && <Markdown source={s.description} compact toggle={false} className="mt-1 text-muted" />}
                {s.acceptanceCriteria.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {s.acceptanceCriteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
                {s.files.length > 0 && <p className="mt-1 font-mono text-xs text-muted">Files: {s.files.join(', ')}</p>}
                {s.dependsOn.length > 0 && <p className="font-mono text-xs text-muted">After subtask {s.dependsOn.join(', ')}</p>}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-muted">
          To edit it before approving, <Link href={`/tickets/${ticketId}?tab=${stage}`} className="text-accent hover:underline">open the ticket</Link>.
        </p>
      </div>
    </details>
  );
}
