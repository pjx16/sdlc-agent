'use client';

import { DEFAULT_GLOBAL_SETTINGS } from '@sdlc/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { setIn, type FormValues } from './form';
import { KEPT_BY_RESET, diffPaths, initialSettingsValues, toSettingsPayload } from './settings-form';
import type { GlobalSettingsView } from './types';

export interface SettingsMessage {
  kind: 'ok' | 'error';
  text: string;
}

/**
 * The state of the settings page: what is saved (`initial`), what is on the screen (`values`), and so what changed. Save sends only the
 * settings that changed; Discard goes back to what is saved; Reset puts the defaults on the screen but does not save them, so the person sees
 * what would change and decides.
 */
export function useSettingsForm(settings: GlobalSettingsView) {
  const router = useRouter();
  const [initial, setInitial] = useState<FormValues>(() => initialSettingsValues(settings));
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<SettingsMessage | null>(null);
  const [busy, setBusy] = useState(false);

  const changed = useMemo(() => diffPaths(initial, values), [initial, values]);
  const dirty = changed.length > 0;

  const set = useCallback((path: string, value: unknown) => {
    setValues((v) => setIn(v, path, value));
    setMessage(null);
    setErrors((e) => {
      if (!(path in e)) return e;
      const { [path]: _removed, ...rest } = e; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest;
    });
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    setBusy(true);
    setMessage(null);
    try {
      const topLevel = [...new Set(changed.map((p) => p.split('.')[0] as string))];
      const res = await fetch('/api/system/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toSettingsPayload(values, topLevel)) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const saved = initialSettingsValues(body);
        setErrors({});
        setInitial(saved);
        setValues(saved);
        setMessage({ kind: 'ok', text: 'Saved. Changes apply from the next stage run.' });
        router.refresh();
        return true;
      }
      if (res.status === 400 && body.fields) {
        setErrors(body.fields);
        setMessage({ kind: 'error', text: 'Some fields need attention.' });
      } else setMessage({ kind: 'error', text: body.message ?? 'Could not save the settings.' });
    } catch {
      setMessage({ kind: 'error', text: 'Cannot reach the server.' });
    } finally {
      setBusy(false);
    }
    return false;
  }, [changed, dirty, router, values]);

  const discard = useCallback(() => {
    setValues(initial);
    setErrors({});
    setMessage(null);
  }, [initial]);

  const reset = useCallback(() => {
    const defaults = initialSettingsValues(DEFAULT_GLOBAL_SETTINGS);
    setValues((current) => ({ ...defaults, ...Object.fromEntries(KEPT_BY_RESET.map((k) => [k, current[k]])) }));
    setErrors({});
    setMessage(null);
  }, []);

  return { values, errors, message, busy, dirty, changed, set, save, discard, reset };
}
