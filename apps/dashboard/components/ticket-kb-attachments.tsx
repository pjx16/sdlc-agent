'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { KbDocPicker } from './kb-doc-picker';

/** The states in which the docs can still change: the same ones the API accepts (before the ticket is coded). */
export const KB_ATTACHMENTS_EDITABLE = ['NEW', 'KB', 'PLANNING', 'AWAITING_PLAN_APPROVAL', 'BREAKDOWN', 'AWAITING_BREAKDOWN_APPROVAL', 'ON_HOLD'];

/**
 * The knowledge-base docs attached to a ticket. Until the ticket is coded they can be changed here; after that they are shown as they
 * were (every stage so far saw them).
 */
export function TicketKbAttachments({ ticketId, projectId, status, attached }: { ticketId: string; projectId: string; status: string; attached: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(attached);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = KB_ATTACHMENTS_EDITABLE.includes(status);
  if (attached.length === 0 && !editable) return null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/kb-attachments`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kbAttachments: selected }) });
      if (res.ok) {
        setEditing(false);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { message?: string; fields?: Record<string, string> };
      setError(body.fields?.kbAttachments ?? body.message ?? 'Could not save.');
    } catch {
      setError('Cannot reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Attached knowledge" className="mt-4 text-sm">
      <p className="text-muted">
        Attached knowledge:{' '}
        {attached.length === 0 ? 'none' : attached.map((p) => (
          <code key={p} className="mr-2 rounded border border-border px-1.5 py-0.5 font-mono text-xs">
            {p}
          </code>
        ))}
        {editable && !editing && (
          <button type="button" onClick={() => { setSelected(attached); setEditing(true); }} className="ml-2 text-accent underline">
            Change
          </button>
        )}
      </p>
      {editing && (
        <div className="mt-2">
          <KbDocPicker projectId={projectId} selected={selected} onChange={setSelected} error={error ?? undefined} />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void save()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-text disabled:opacity-60">
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
