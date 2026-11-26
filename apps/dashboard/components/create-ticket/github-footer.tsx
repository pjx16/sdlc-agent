'use client';

import Link from 'next/link';
import { useState } from 'react';

export interface GithubTargetView {
  repo: string | null;
  board: string | null;
  column: string | null;
}

/** What the person is told about where the issue goes: the repository and, for a Projects board, its board and column. */
function Where({ target }: { target: GithubTargetView }) {
  return (
    <>
      in <strong>{target.repo ?? 'the repository'}</strong>
      {target.board && (
        <>
          . It will be added to the board <strong>{target.board}</strong>
          {target.column && (
            <>
              , in the column <strong>{target.column}</strong>
            </>
          )}
        </>
      )}
    </>
  );
}

/** With "always" or "never" chosen there is nothing to ask: a quiet line says what will happen, and where to change it. */
export function PolicyLine({ policy, target }: { policy: 'always' | 'never'; target: GithubTargetView }) {
  return (
    <p className="text-xs text-muted" data-testid="github-policy">
      {policy === 'always' ? (
        <>
          A GitHub issue is also made <Where target={target} />.
        </>
      ) : (
        'No GitHub issue is made.'
      )}{' '}
      <Link href="/settings" target="_blank" className="text-accent underline">
        Change this in Settings
      </Link>
    </p>
  );
}

/** "Create ticket" with the choice still on ask: should it also be an issue on GitHub? The answer can be remembered for every project. */
export function GithubConfirm({ target, busy, onChoose, onBack }: { target: GithubTargetView; busy: boolean; onChoose: (createIssue: boolean, remember: boolean) => void; onBack: () => void }) {
  const [remember, setRemember] = useState(false);
  return (
    <div role="group" aria-label="GitHub issue" className="space-y-3">
      <p className="text-sm">
        Also create this as a GitHub issue <Where target={target} />?
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember my choice for every project
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => onChoose(true, remember)} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-60">
          Create on GitHub
        </button>
        <button type="button" disabled={busy} onClick={() => onChoose(false, remember)} className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-60">
          Only in sdlc-agent
        </button>
        <button type="button" disabled={busy} onClick={onBack} className="text-sm text-muted underline">
          Back
        </button>
      </div>
    </div>
  );
}

/** An open issue with exactly this title exists: link it instead of making a duplicate, or make one anyway. */
export function DuplicatePrompt({ issue, busy, onLink, onCreateAnyway, onCancel }: { issue: { number: number; title: string; url: string }; busy: boolean; onLink: () => void; onCreateAnyway: () => void; onCancel: () => void }) {
  return (
    <div role="group" aria-label="An issue with this title exists" className="space-y-3">
      <p className="text-sm">
        An open issue{' '}
        <a href={issue.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
          #{issue.number} “{issue.title.trim()}”
        </a>{' '}
        already exists.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={onLink} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-60">
          Link it
        </button>
        <button type="button" disabled={busy} onClick={onCreateAnyway} className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-60">
          Create a new one anyway
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="text-sm text-muted underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
