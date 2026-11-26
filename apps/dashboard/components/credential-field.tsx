'use client';

import { CREDENTIAL_KEYS, type CredentialView } from '@sdlc/shared';

const BADGE: Record<CredentialView['source'], { text: string; cls: string }> = {
  env: { text: 'Set in .env', cls: 'border-border text-muted' },
  db: { text: 'Saved', cls: 'border-green text-green' },
  unset: { text: 'Not set', cls: 'border-amber text-amber' },
};

export function Field({ view, value, onChange, error }: { view: CredentialView; value: string; onChange: (v: string) => void; error?: string }) {
  const def = CREDENTIAL_KEYS.find((c) => c.key === view.key)!;
  const readOnly = view.source === 'env';
  const badge = BADGE[view.source];
  const id = `cred-${view.key}`;
  return (
    <div data-testid={`field-${view.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm">
          {def.label}
        </label>
        <span className={`rounded border px-1.5 py-0.5 text-xs ${badge.cls}`}>{badge.text}</span>
        {def.secret && view.hint && view.source !== 'unset' && <span className="text-xs text-muted">••••{view.hint}</span>}
      </div>
      <input
        id={id}
        type={def.secret ? 'password' : 'text'}
        autoComplete="off"
        disabled={readOnly}
        placeholder={readOnly ? 'Set in .env' : def.secret ? (view.source === 'db' ? 'Paste a new value to replace it' : 'Paste the value') : 'Enter a value'}
        value={readOnly ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
      />
      {error && (
        <p role="alert" className="mt-1 text-xs text-red">
          {error}
        </p>
      )}
    </div>
  );
}
