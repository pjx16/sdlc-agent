'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { HoldInfo } from '@/lib/types';

/**
 * "Redo tests" for a held ticket, from the inbox: the tests of the subtask that is stuck are written again with your note as context.
 * It appears only when the ticket offers it, so the inbox card does not send you to the ticket page for the common case.
 */
export function InboxRedoTests({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [info, setInfo] = useState<HoldInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/hold`);
        const body: unknown = r?.ok ? await r.json() : null;
        if (alive && body && typeof body === 'object') setInfo(body as HoldInfo);
      } catch {
        /* the button is simply not offered */
      }
    })();
    return () => {
      alive = false;
    };
  }, [ticketId]);

  if (!info?.canRedoTests) return null;
  const seq = info.subtask?.seq ?? 1;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/subtasks/${seq}/rerun`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ part: 'tests', note: note.trim() || undefined }) });
      if (res.ok) {
        setOpen(false);
        setNote('');
        router.refresh();
        return;
      }
      setError((await res.json().catch(() => ({}))).message ?? 'Something went wrong.');
      if (res.status === 409) router.refresh();
    } catch {
      setError('Cannot reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={open ? 'w-full' : ''}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium">
        Redo tests with a note
      </button>
      {open && (
        <div role="group" aria-label="Redo tests" className="mt-3 rounded-md border border-border bg-bg p-4">
          <p className="text-xs text-muted">Subtask {seq}{info.subtask?.title ? `: ${info.subtask.title}` : ''}. Its tests are discarded and written again, with the failure and your note as context.</p>
          <label htmlFor={`redo-${ticketId}`} className="mt-3 block text-sm">
            Your note
          </label>
          <textarea id={`redo-${ticketId}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
          {error && (
            <p role="alert" className="mt-1 text-xs text-red">
              {error}
            </p>
          )}
          <button type="button" onClick={send} disabled={busy} className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-50">
            {busy ? 'Sending…' : 'Redo the tests'}
          </button>
        </div>
      )}
    </div>
  );
}
