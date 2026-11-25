'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { GlobalSettingsView } from '@/lib/types';

const SOURCES = [
  { key: 'intakeGithubEnabled', label: 'GitHub', hint: 'Issues and Projects boards, per project (recommended: a Projects board)' },
  { key: 'intakeJiraEnabled', label: 'Jira', hint: 'The projects that use Jira' },
  { key: 'intakePasteEnabled', label: 'Pasted tickets', hint: 'Tickets created in the dashboard' },
] as const;

type Key = (typeof SOURCES)[number]['key'];

/**
 * Where tickets come from. The Pause intake button in the top bar stops every source at once; each switch here stops one and takes effect
 * at once. Work already in the pipeline is not affected.
 */
export function IntakeSources({ settings }: { settings: Pick<GlobalSettingsView, Key | 'intakePaused'> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: Key, on: boolean) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch('/api/system/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [key]: on }) });
      if (res.ok) router.refresh();
      else setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'Could not save.');
    } catch {
      setError('Cannot reach the server.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Intake sources" className="mb-8 panel p-6">
      <h2 className="text-lg font-semibold">Intake sources</h2>
      <p className="mt-1 text-sm text-muted">
        Where new tickets come from. {settings.intakePaused ? <strong>Intake is paused as a whole: nothing is taken from any source.</strong> : 'Switch one off to stop taking tickets from it.'}
      </p>
      <ul className="mt-3 space-y-2">
        {SOURCES.map((s) => (
          <li key={s.key}>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={settings[s.key] ?? true} disabled={busy !== null} onChange={(e) => void toggle(s.key, e.target.checked)} />
              <span className="font-medium">{s.label}</span>
              <span className="text-muted">{s.hint}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red">
          {error}
        </p>
      )}
    </section>
  );
}
