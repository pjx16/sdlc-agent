'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface BotStatus {
  connected: boolean;
  installations: { id: number; account: string }[];
  error: string | null;
}

const POLL_MS = 3000;
const POLL_FOR_MS = 5 * 60_000;

/**
 * Connect this system to sdlc-agent-bot (the sdlc-agent GitHub App, through the token broker): the person installs the App on GitHub and
 * chooses which repositories it may use. No token is typed or stored; projects that work as the bot get short-lived tokens.
 */
export function BotCard({ onStatus }: { /** Told each time the status is read, so a page can follow it (the setup steps). */ onStatus?: (status: BotStatus) => void } = {}) {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [code, setCode] = useState('');
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bot');
      if (res.ok) {
        const next = (await res.json()) as BotStatus;
        setStatus(next);
        onStatusRef.current?.(next);
      }
    } catch {
      /* the next poll tries again */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // After the install page was opened, look for the new installation until it shows up.
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const id = setInterval(() => {
      void load();
      if (Date.now() - started > POLL_FOR_MS) setWaiting(false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [waiting, load]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bot/connect', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message ?? 'Could not start the connection.');
        return;
      }
      window.open(body.url, '_blank', 'noopener,noreferrer');
      setWaiting(true);
      await load();
    } catch {
      setError('Cannot reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bot/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim() }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message ?? 'The code was not accepted.');
        return;
      }
      setConfirmed(body.account ?? '');
      setCode('');
      setWaiting(false);
      await load();
    } catch {
      setError('Cannot reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bot', { method: 'DELETE' });
      if (!res.ok) setError('Could not disconnect.');
      await load();
    } catch {
      setError('Cannot reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const accounts = status?.installations ?? [];
  return (
    <section aria-label="sdlc-agent-bot" id="card-bot" className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">sdlc-agent-bot</h2>
        <span className={`text-xs ${accounts.length > 0 ? 'text-green' : 'text-muted'}`}>{accounts.length > 0 ? 'Connected' : status?.connected ? 'Registered, App not installed yet' : 'Not connected'}</span>
      </div>
      <p className="mt-2 text-sm text-muted">
        Work without a personal token. Install the <strong>sdlc-agent</strong> GitHub App and choose the repositories it may use: pushes, pull requests and comments are then made in the name of sdlc-agent-bot, with short-lived
        tokens limited to one repository. Choose &ldquo;sdlc-agent-bot&rdquo; when you onboard a project. Projects that choose &ldquo;My own token&rdquo; keep using the GitHub token below.
      </p>
      {accounts.length > 0 && (
        <p className="mt-3 text-sm">
          Installed for: <span className="font-medium">{accounts.map((a) => a.account || `installation ${a.id}`).join(', ')}</span>
        </p>
      )}
      {waiting && (
        <div className="mt-3 text-sm">
          <p role="status" className="text-muted">
            Finish on GitHub. When it shows an 8-character code, enter it here to connect.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <label htmlFor="bot-pairing-code" className="sr-only">
              Pairing code
            </label>
            <input id="bot-pairing-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} autoComplete="off" spellCheck={false} placeholder="ABCD2345" className="w-36 rounded-md border border-border bg-transparent px-3 py-2 font-mono text-sm tracking-widest" />
            <button type="button" onClick={confirm} disabled={busy || code.trim().length !== 8} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-50">
              Connect
            </button>
          </div>
        </div>
      )}
      {confirmed !== null && !waiting && (
        <p role="status" className="mt-3 text-sm text-green">
          Connected{confirmed ? ` to ${confirmed}` : ''}.
        </p>
      )}
      {(error || status?.error) && (
        <p role="alert" className="mt-3 text-sm text-red">
          {error ?? status?.error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={connect} disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-50">
          {accounts.length > 0 ? 'Add another account or repository' : 'Connect sdlc-agent-bot'}
        </button>
        {status?.connected && (
          <button type="button" onClick={disconnect} disabled={busy} className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50">
            Disconnect
          </button>
        )}
      </div>
    </section>
  );
}
