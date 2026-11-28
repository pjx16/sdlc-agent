'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { JIRA_MODE_INFO } from '@sdlc/shared';

/** The two-field start of a project: a repo URL and, optionally, a Jira project key. Everything else is proposed. */
export function OnboardForm({ onCreated, onDirtyChange, defaultGithubAuth = 'token' }: { /** Called with the new project's id instead of opening its page (the form is in a modal). */ onCreated?: (id: string) => void; /** Tells the modal whether there is anything to lose. */ onDirtyChange?: (dirty: boolean) => void; /** What "How should sdlc-agent reach GitHub?" starts as: the install's default. */ defaultGithubAuth?: 'token' | 'bot' }) {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState('');
  const [jiraProjectKey, setKey] = useState('');
  const [githubAuth, setGithubAuth] = useState<'token' | 'bot'>(defaultGithubAuth);
  const [jiraMode, setJiraMode] = useState<'rest' | 'mcp' | 'connector'>('rest');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => onDirtyChange?.(repoUrl.trim() !== '' || jiraProjectKey.trim() !== ''), [repoUrl, jiraProjectKey, onDirtyChange]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const res = await fetch('/api/projects/onboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repoUrl, jiraProjectKey, githubAuth, jiraMode }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        if (onCreated) onCreated(body.id);
        else router.push(`/projects/${body.id}`);
        return;
      }
      if (res.status === 400 && body.fields) {
        setErrors(body.fields);
        setMessage('Some fields need attention.');
      } else setMessage(body.message ?? 'Could not start the project.');
    } catch {
      setMessage('Cannot reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, hint: string, placeholder: string) => (
    <div>
      <label htmlFor={id} className="block text-sm">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        aria-invalid={errors[id] ? true : undefined}
        aria-describedby={`${id}-hint`}
        className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
        {hint}
      </p>
      {errors[id] && (
        <p role="alert" className="mt-1 text-xs text-red">
          {errors[id]}
        </p>
      )}
    </div>
  );

  return (
    <form onSubmit={submit} className="max-w-xl space-y-5" noValidate>
      {field('repoUrl', 'Repository URL', repoUrl, setRepoUrl, 'The GitHub repository the agent works in.', 'https://github.com/acme/billing')}
      {field('jiraProjectKey', 'Jira project key (optional)', jiraProjectKey, setKey, 'Leave it empty to work from pasted tickets only. The Atlassian credential is set once in Settings → Connections.', 'SDA')}
      {jiraProjectKey.trim() !== '' && (
        <fieldset>
          <legend className="block text-sm">How should sdlc-agent reach Jira?</legend>
          {(['rest', 'mcp', 'connector'] as const).map((value) => {
            const info = JIRA_MODE_INFO[value];
            return (
              <label key={value} className="mt-2 flex cursor-pointer gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-accent">
                <input type="radio" name="jiraMode" value={value} checked={jiraMode === value} onChange={() => setJiraMode(value)} className="mt-1" />
                <span>
                  <span className="font-medium">{info.label}</span>
                  {info.recommended && <span className="ml-2 rounded border border-green px-1.5 py-0.5 text-xs text-green">Recommended</span>}
                  {info.usesClaudeTokens && <span className="ml-2 rounded border border-amber px-1.5 py-0.5 text-xs text-amber">Uses Claude tokens</span>}
                  <span className="mt-0.5 block text-xs text-muted">{info.description}</span>
                </span>
              </label>
            );
          })}
          {errors.jiraMode && (
            <p role="alert" className="mt-1 text-xs text-red">
              {errors.jiraMode}
            </p>
          )}
        </fieldset>
      )}
      <fieldset>
        <legend className="block text-sm">How should sdlc-agent reach GitHub?</legend>
        {([
          ['token', 'My own token', 'Uses the personal access token saved in Settings → Connections. Pull requests and comments appear under your account.'],
          ['bot', 'sdlc-agent-bot', 'No token needed. Install the sdlc-agent GitHub App on this repository and everything is done in the name of sdlc-agent-bot. Connect it first in Settings → Connections.'],
        ] as const).map(([value, label, hint]) => (
          <label key={value} className="mt-2 flex cursor-pointer gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-accent">
            <input type="radio" name="githubAuth" value={value} checked={githubAuth === value} onChange={() => setGithubAuth(value)} className="mt-1" />
            <span>
              <span className="font-medium">{label}</span>
              <span className="mt-0.5 block text-xs text-muted">{hint}</span>
            </span>
          </label>
        ))}
        {errors.githubAuth && (
          <p role="alert" className="mt-1 text-xs text-red">
            {errors.githubAuth}
          </p>
        )}
      </fieldset>
      <p className="text-sm text-muted">The pipeline then reads the repository and your Jira project and proposes the commands, the status mapping, the issue types and the label. You review it before anything is used.</p>
      <div className="flex items-center gap-4">
        <button type="submit" disabled={busy || repoUrl.trim() === ''} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-60">
          {busy ? 'Starting…' : 'Start'}
        </button>
        {message && (
          <p role="alert" className="text-sm text-red">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
