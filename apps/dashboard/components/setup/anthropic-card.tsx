'use client';

import type { CredentialKey, CredentialView } from '@sdlc/shared';
import { Field } from '@/components/credential-field';
import { isSet, type SetupProgress } from '@/lib/setup-progress';
import { useCredentials } from '@/lib/use-credentials';
import { Stepper } from './stepper';

export interface AnthropicCardProps {
  views: ReadonlyMap<CredentialKey, CredentialView>;
  progress: SetupProgress;
  encryptionKeyOk: boolean;
  onSaved: (saved: CredentialView[]) => void;
  refresh: () => Promise<void>;
}

function KeyStep({ views, onSaved, refresh, encryptionKeyOk }: Omit<AnthropicCardProps, 'progress'>) {
  const key = useCredentials(['anthropic_api_key'], views, onSaved);
  const view = views.get('anthropic_api_key');

  async function saveAndTest() {
    if (key.changed.length > 0 && !(await key.save())) return;
    await key.runTest('anthropic_api_key');
    await refresh();
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Create an API key in the{' '}
        <a className="text-accent underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
          Anthropic Console ↗
        </a>{' '}
        and paste it (it starts with <code>sk-ant-api</code>). Every stage is billed to the key’s workspace, so also set a spend limit there.
      </p>
      {!encryptionKeyOk && (
        <p role="alert" className="mb-3 rounded-md border border-amber px-3 py-2 text-sm">
          ENCRYPTION_KEY is not set, so a key cannot be saved. Add it to .env (<code>openssl rand -base64 32</code>) and restart.
        </p>
      )}
      {view && <Field view={view} value={key.values.anthropic_api_key ?? ''} onChange={(v) => key.setValue('anthropic_api_key', v)} error={key.errors.anthropic_api_key} />}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => void saveAndTest()}
          disabled={key.busy !== null || !encryptionKeyOk || (key.changed.length === 0 && !isSet(view))}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-50"
        >
          {key.busy === 'save' ? 'Saving…' : key.busy === 'test' ? 'Testing…' : key.changed.length > 0 || !isSet(view) ? 'Save & test' : 'Test again'}
        </button>
      </div>
      {key.message && (
        <p role="status" className="mt-3 text-xs text-muted">
          {key.message}
        </p>
      )}
      {key.test && (
        <p role="status" className={`mt-3 text-sm ${key.test.ok ? 'text-green' : 'text-red'}`}>
          {key.test.ok ? '✔' : '✖'} {key.test.message}
        </p>
      )}
      {!key.test && view?.verifyError && <p className="mt-3 text-xs text-red">{view.verifyError}</p>}
    </div>
  );
}

/** Anthropic: one step. The key is tested when it is saved. */
export function AnthropicCard({ progress, ...rest }: AnthropicCardProps) {
  const view = rest.views.get('anthropic_api_key');
  return (
    <section aria-labelledby="setup-anthropic" data-testid="setup-anthropic" className="panel p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="setup-anthropic" className="text-lg font-semibold">
          Anthropic
        </h2>
        <span className={`text-xs ${progress.anthropic ? 'text-green' : 'text-muted'}`}>{progress.anthropic ? 'Connected' : 'Not connected'}</span>
      </div>
      <Stepper steps={[{ id: 'key', title: 'API key', done: progress.anthropic, summary: `••••${view?.hint ?? ''}`, render: () => <KeyStep {...rest} /> }]} />
    </section>
  );
}
