'use client';

import { CREDENTIAL_KEYS, type CredentialKey, type CredentialView } from '@sdlc/shared';
import { useState } from 'react';

export interface TestState {
  ok: boolean;
  message: string;
  at: string;
}

const secretOf = (key: CredentialKey): boolean => CREDENTIAL_KEYS.find((c) => c.key === key)!.secret;

/** What a field starts with: plain values are shown so they can be edited, secrets are never pre-filled. */
export const initialValue = (view: CredentialView, secret: boolean): string => (!secret && view.source === 'db' ? (view.hint ?? '') : '');

/**
 * The state of one group of credentials that are saved together (a token; a name and an email): what is typed, what changed, Save, and a
 * connection test. Only fields that changed (a secret: anything typed) are sent. Secrets are never rendered back: the view
 * only has a hint of the last four characters.
 */
export function useCredentials(keys: readonly CredentialKey[], views: ReadonlyMap<CredentialKey, CredentialView>, onSaved: (saved: CredentialView[]) => void) {
  const fields = keys.map((k) => views.get(k)).filter((v): v is CredentialView => Boolean(v));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((v) => [v.key, initialValue(v, secretOf(v.key))])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [test, setTest] = useState<TestState | null>(null);

  const changed = fields.filter((v) => values[v.key]?.trim() && values[v.key]!.trim() !== initialValue(v, secretOf(v.key)));

  const setValue = (key: CredentialKey, text: string) => setValues((cur) => ({ ...cur, [key]: text }));

  async function save(): Promise<boolean> {
    setBusy('save');
    setMessage(null);
    setErrors({});
    const failed: Record<string, string> = {};
    const saved: CredentialView[] = [];
    for (const v of changed) {
      try {
        const res = await fetch(`/api/credentials/${v.key}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: values[v.key] }) });
        const data = await res.json().catch(() => ({}));
        if (res.ok) saved.push(data as CredentialView);
        else failed[v.key] = data.fields?.value ?? data.message ?? 'Could not save.';
      } catch {
        failed[v.key] = 'Cannot reach the server.';
      }
    }
    if (saved.length > 0) {
      setValues((cur) => ({ ...cur, ...Object.fromEntries(saved.map((s) => [s.key, initialValue(s, secretOf(s.key))])) }));
      setTest(null);
      onSaved(saved);
    }
    setErrors(failed);
    const ok = Object.keys(failed).length === 0;
    if (ok) setMessage(`Saved ${saved.length} ${saved.length === 1 ? 'value' : 'values'}.`);
    setBusy(null);
    return ok;
  }

  /** Tests the connection with the credential `testKey` (the connection as a whole is tested through one key). */
  async function runTest(testKey: CredentialKey): Promise<TestState | null> {
    setBusy('test');
    setMessage(null);
    try {
      const res = await fetch(`/api/credentials/${testKey}/test`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const result = { ok: data.ok as boolean, message: data.message as string, at: new Date().toISOString() };
        setTest(result);
        return result;
      }
      setMessage(data.message ?? 'The test failed to run.');
    } catch {
      setMessage('Cannot reach the server.');
    } finally {
      setBusy(null);
    }
    return null;
  }

  return { fields, values, setValue, errors, busy, message, test, changed, save, runTest, setMessage };
}
