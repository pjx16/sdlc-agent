'use client';

import type { CredentialView } from '@sdlc/shared';
import { useEffect, useState } from 'react';

/**
 * "Connect with Atlassian" for Rovo MCP mode: the API registers a client for this dashboard's callback and returns Atlassian's consent page,
 * which sends the browser back to /setup/connections?jira_mcp=connected (or =error). Atlassian accepts localhost callbacks out of the box;
 * any other dashboard address must be allowed by an org admin.
 */
export function RovoConnect({ view, onChanged }: { view?: CredentialView; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const connected = view !== undefined && view.source !== 'unset';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('jira_mcp');
    if (!outcome) return;
    setNotice({ ok: outcome === 'connected', text: params.get('message') ?? (outcome === 'connected' ? 'Connected.' : 'The sign-in failed.') });
    params.delete('jira_mcp');
    params.delete('message');
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`);
  }, []);

  async function connect() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/jira-mcp/oauth/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: window.location.origin }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.authorizeUrl) {
        window.location.assign(data.authorizeUrl as string);
        return;
      }
      setNotice({ ok: false, text: data.fields?.origin ?? data.message ?? 'Could not start the sign-in.' });
    } catch {
      setNotice({ ok: false, text: 'Cannot reach the server.' });
    }
    setBusy(false);
  }

  async function disconnect() {
    setBusy(true);
    await fetch('/api/credentials/jira_mcp_oauth', { method: 'DELETE' }).catch(() => undefined);
    setNotice({ ok: true, text: 'Disconnected. The scoped token, if set, is used instead.' });
    setBusy(false);
    onChanged();
  }

  const isLoopback = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  return (
    <div data-testid="rovo-connect" className="mt-4 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">OAuth sign-in</span>
        <span className={`rounded border px-1.5 py-0.5 text-xs ${connected ? 'border-green text-green' : 'border-amber text-amber'}`}>
          {view?.source === 'env' ? 'Set in .env' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={connect} disabled={busy || view?.source === 'env'} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-50">
          {busy ? 'Opening Atlassian…' : connected ? 'Connect again' : 'Connect with Atlassian'}
        </button>
        {connected && view?.source === 'db' && (
          <button type="button" onClick={disconnect} disabled={busy} className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50">
            Disconnect
          </button>
        )}
      </div>
      {!isLoopback && <p className="mt-2 text-xs text-amber">This dashboard is not on localhost: an Atlassian org admin must allow its address for the Rovo MCP server first.</p>}
      {notice && (
        <p role="status" className={`mt-2 text-xs ${notice.ok ? 'text-green' : 'text-red'}`}>
          {notice.ok ? '✔' : '✖'} {notice.text}
        </p>
      )}
    </div>
  );
}
