'use client';

import { useState } from 'react';

/**
 * The key that signs every commit of the pipeline. GitHub shows a commit as Verified once this public key is added to the account that
 * opens the pull requests, as a signing key (not an authentication key).
 */
export function CommitSigningCard({ publicKey }: { publicKey: string | null }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicKey ?? '');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-label="Commit signing" className="panel p-4">
      <h2 className="text-sm font-medium">Commit signing</h2>
      <p className="mt-1 text-sm text-muted">Every commit the pipeline makes is signed with this key. Add it to GitHub as a <strong>signing key</strong> so the commits show as Verified.</p>
      {publicKey ? (
        <>
          <textarea readOnly aria-label="Public signing key" rows={3} value={publicKey} className="mt-2 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs" />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <button type="button" onClick={() => void copy()} className="rounded-md border border-border px-3 py-1.5">
              {copied ? 'Copied' : 'Copy the key'}
            </button>
            <a href="https://github.com/settings/ssh/new" target="_blank" rel="noopener noreferrer" className="text-accent underline">
              Add it on GitHub (choose “Signing Key”)
            </a>
          </div>
        </>
      ) : (
        <p role="status" className="mt-2 text-sm text-amber">
          The key is made when the worker starts. If it does not appear, check that ENCRYPTION_KEY is set and look at the worker log: commits stop until there is a key.
        </p>
      )}
    </section>
  );
}
