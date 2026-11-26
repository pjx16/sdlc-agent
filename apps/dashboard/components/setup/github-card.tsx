'use client';

import type { CredentialKey, CredentialView } from '@sdlc/shared';
import { useState } from 'react';
import { BotCard, type BotStatus } from '@/components/bot-card';
import { Field } from '@/components/credential-field';
import { type BotInstalls, type SetupProgress, isSet } from '@/lib/setup-progress';
import { useCredentials } from '@/lib/use-credentials';
import { GithubTokenHelp } from './github-token-help';
import { Stepper, type Step } from './stepper';

export interface GithubCardProps {
  views: ReadonlyMap<CredentialKey, CredentialView>;
  progress: SetupProgress;
  bot: BotInstalls | null;
  /** The public half of the key that signs the pipeline's commits (null until the worker has made it). */
  signingKey: string | null;
  encryptionKeyOk: boolean;
  /** What the check of the signing key said, once it passed or the person confirmed it. */
  signingNote: string | null;
  onSaved: (saved: CredentialView[]) => void;
  /** Reads the saved credentials again (a test marks one as verified on the server). */
  refresh: () => Promise<void>;
  onBot: (status: BotStatus) => void;
  onSigningDone: (note: string) => void;
}

const button = 'rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-50';
const quiet = 'rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50';

function Outcome({ test, message }: { test: { ok: boolean; message: string } | null; message: string | null }) {
  return (
    <>
      {message && (
        <p role="status" className="mt-3 text-xs text-muted">
          {message}
        </p>
      )}
      {test && (
        <p role="status" className={`mt-3 text-sm ${test.ok ? 'text-green' : 'text-red'}`}>
          {test.ok ? '✔' : '✖'} {test.message}
        </p>
      )}
    </>
  );
}

/** Step 1: how GitHub is reached: a personal token, or sdlc-agent-bot. Either one is enough, and it can be changed whenever. */
function AccessStep({ views, progress, onSaved, refresh, onBot, encryptionKeyOk }: Pick<GithubCardProps, 'views' | 'progress' | 'onSaved' | 'refresh' | 'onBot' | 'encryptionKeyOk'>) {
  const token = useCredentials(['github_token'], views, onSaved);
  const [mode, setMode] = useState<'token' | 'bot'>(progress.botInstalled && !progress.tokenSet ? 'bot' : 'token');
  const view = views.get('github_token');

  async function saveAndTest() {
    if (token.changed.length > 0 && !(await token.save())) return;
    await token.runTest('github_token');
    await refresh();
  }

  return (
    <div>
      <div role="radiogroup" aria-label="How should sdlc-agent reach GitHub?" className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ['token', 'Personal access token', 'Pull requests and comments appear under your account.'],
            ['bot', 'sdlc-agent-bot', 'Install a GitHub App. No token to make or keep.'],
          ] as const
        ).map(([value, label, hint]) => (
          <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)} className={`rounded-md border p-3 text-left text-sm ${mode === value ? 'border-accent bg-accent-soft' : 'border-border'}`}>
            <span className="block font-medium">{label}</span>
            <span className="mt-0.5 block text-xs text-muted">{hint}</span>
          </button>
        ))}
      </div>

      {mode === 'token' ? (
        <div className="mt-4">
          {!encryptionKeyOk && (
            <p role="alert" className="mb-3 rounded-md border border-amber px-3 py-2 text-sm">
              ENCRYPTION_KEY is not set, so a token cannot be saved. Add it to .env (<code>openssl rand -base64 32</code>) and restart.
            </p>
          )}
          {view && <Field view={view} value={token.values.github_token ?? ''} onChange={(v) => token.setValue('github_token', v)} error={token.errors.github_token} />}
          <GithubTokenHelp />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void saveAndTest()} disabled={token.busy !== null || !encryptionKeyOk || (token.changed.length === 0 && !isSet(view))} className={button}>
              {token.busy === 'save' ? 'Saving…' : token.busy === 'test' ? 'Testing…' : token.changed.length > 0 || !isSet(view) ? 'Save & test' : 'Test again'}
            </button>
          </div>
          <Outcome test={token.test} message={token.message} />
          {!token.test && view?.verifyError && <p className="mt-3 text-xs text-red">{view.verifyError}</p>}
        </div>
      ) : (
        <div className="mt-4">
          <BotCard onStatus={onBot} />
        </div>
      )}
    </div>
  );
}

/** Step 2: the name and email of every commit. Checked for their form when saved. */
function IdentityStep({ views, onSaved }: Pick<GithubCardProps, 'views' | 'onSaved'>) {
  const identity = useCredentials(['git_author_name', 'git_author_email'], views, onSaved);
  return (
    <div>
      <p className="mb-3 text-sm text-muted">Every commit the pipeline makes carries this name and email.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {identity.fields.map((v) => (
          <Field key={v.key} view={v} value={identity.values[v.key] ?? ''} onChange={(text) => identity.setValue(v.key, text)} error={identity.errors[v.key]} />
        ))}
      </div>
      <div className="mt-4">
        <button type="button" onClick={() => void identity.save()} disabled={identity.busy !== null || identity.changed.length === 0} className={button}>
          {identity.busy === 'save' ? 'Saving…' : 'Save'}
        </button>
      </div>
      <Outcome test={null} message={identity.message} />
    </div>
  );
}

/** Step 3: the key that signs the commits has to be on the GitHub account, as a Signing Key, for GitHub to show them as Verified. */
function SigningStep({ signingKey, onSigningDone }: Pick<GithubCardProps, 'signingKey' | 'onSigningDone'>) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(signingKey ?? '');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  async function check() {
    setBusy(true);
    try {
      const res = await fetch('/api/system/commit-signing/test', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; login?: string };
      if (!res.ok) return setResult({ ok: false, message: data.message ?? 'The check could not run.' });
      setResult({ ok: Boolean(data.ok), message: data.message ?? '' });
      if (data.ok) onSigningDone(data.login ? `Found on @${data.login}` : 'Found on GitHub');
    } catch {
      setResult({ ok: false, message: 'Cannot reach the server.' });
    } finally {
      setBusy(false);
    }
  }

  if (!signingKey) {
    return (
      <p role="status" className="text-sm text-amber">
        The key is made when the worker starts. If it does not appear, check that ENCRYPTION_KEY is set and look at the worker log: commits stop until there is a key.
      </p>
    );
  }
  return (
    <div>
      <p className="text-sm text-muted">
        Every commit is signed with this key. Add it to GitHub as a <strong>Signing Key</strong> (not an Authentication Key) and GitHub shows the commits as Verified.
      </p>
      <textarea readOnly aria-label="Public signing key" rows={3} value={signingKey} className="mt-3 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void copy()} className={quiet}>
          {copied ? 'Copied' : 'Copy the key'}
        </button>
        <a href="https://github.com/settings/ssh/new" target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">
          Add it on GitHub (choose “Signing Key”) ↗
        </a>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void check()} disabled={busy} className={button}>
          {busy ? 'Checking…' : 'Check'}
        </button>
        <button type="button" onClick={() => onSigningDone('Marked as added')} disabled={busy} className={quiet}>
          I’ve added it
        </button>
      </div>
      <Outcome test={result} message={null} />
    </div>
  );
}

/** GitHub, in the order a person does it: access, identity, then the signing key. */
export function GithubCard(props: GithubCardProps) {
  const { views, progress, bot, signingNote } = props;
  const token = views.get('github_token');
  const accounts = (bot?.installations ?? []).map((i) => i.account || `installation ${i.id}`).join(', ');
  const access = [isSet(token) ? `Personal token ••••${token?.hint ?? ''}` : null, progress.botInstalled ? `sdlc-agent-bot for ${accounts}` : null].filter(Boolean).join(' and ');
  const name = views.get('git_author_name');
  const email = views.get('git_author_email');

  const steps: Step[] = [
    { id: 'access', title: 'Access', done: progress.githubAccess, summary: access, render: () => <AccessStep {...props} /> },
    { id: 'identity', title: 'Git identity', done: progress.identity, summary: [name?.hint, email?.hint].filter(Boolean).join(' · '), render: () => <IdentityStep {...props} /> },
    {
      id: 'signing',
      title: 'Commit signing',
      done: progress.signing,
      summary: progress.botOnly ? 'The App signs its own commits' : signingNote,
      render: () => <SigningStep {...props} />,
    },
  ];
  const connected = progress.githubAccess && progress.identity;

  return (
    <section aria-labelledby="setup-github" data-testid="setup-github" className="panel p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="setup-github" className="text-lg font-semibold">
          GitHub
        </h2>
        <span className={`text-xs ${connected ? 'text-green' : 'text-muted'}`}>{connected ? 'Connected' : 'Not connected'}</span>
      </div>
      <Stepper steps={steps} />
    </section>
  );
}
