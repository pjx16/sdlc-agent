'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * A ticket's GitHub issue, on its page: being made, its link, or the reason it could not be made with a way to try again. The pipeline does not
 * wait for the issue, so this is information, not a gate.
 */
export function GithubIssueChip({ ticketId, state, error, url }: { ticketId: string; state: 'none' | 'pending' | 'created' | 'failed'; error: string | null; url: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (state === 'none') return null;
  if (state === 'pending') return <span className="text-muted">GitHub: creating the issue…</span>;
  if (state === 'created') {
    const number = url ? /\/issues\/(\d+)$/.exec(url)?.[1] : null;
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
        GitHub: #{number ?? 'issue'} ↗
      </a>
    ) : (
      <span className="text-muted">GitHub: issue created</span>
    );
  }

  async function retry() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/github-issue/retry`, { method: 'POST' });
      if (res.ok) router.refresh();
      else setMessage(((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'Could not retry.');
    } catch {
      setMessage('Cannot reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-amber">
      <span>GitHub: the issue could not be made{error ? `: ${error}` : ''}</span>
      <button type="button" onClick={() => void retry()} disabled={busy} className="rounded-md border border-border px-2 py-0.5 text-xs text-text disabled:opacity-60">
        {busy ? 'Retrying…' : 'Retry'}
      </button>
      {message && (
        <span role="alert" className="text-red">
          {message}
        </span>
      )}
    </span>
  );
}
