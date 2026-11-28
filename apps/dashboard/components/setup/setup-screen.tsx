'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CredentialView } from '@sdlc/shared';
import type { BotStatus } from '@/components/bot-card';
import { type BotInstalls, setupProgress } from '@/lib/setup-progress';
import { AnthropicCard } from './anthropic-card';
import { GithubCard } from './github-card';

const SIGNING_KEY = 'sdlc.setup.signing';

/**
 * The first-run screen: GitHub and Anthropic, side by side, each a short flow. Nothing can be skipped; the way out is open once the agents
 * have what they need. What is done is read from what is saved, so a reload comes back to the same step.
 */
export function SetupScreen({ initial, signingKey, encryptionKeyOk }: { initial: CredentialView[]; signingKey: string | null; encryptionKeyOk: boolean }) {
  const router = useRouter();
  const [views, setViews] = useState(initial);
  const [bot, setBot] = useState<BotInstalls | null>(null);
  // That the signing key was added is a fact about GitHub, which cannot always be checked (the bot, no token): remembered in this browser.
  const [signingNote, setSigningNote] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(views.map((v) => [v.key, v])), [views]);
  const progress = setupProgress(byKey, bot, signingNote !== null);

  useEffect(() => {
    try {
      setSigningNote(window.localStorage.getItem(SIGNING_KEY));
    } catch {
      /* no storage: the step simply asks again */
    }
    void fetch('/api/bot')
      .then((res) => (res.ok ? (res.json() as Promise<BotInstalls>) : null))
      .then((status) => status && setBot(status))
      .catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/credentials');
      if (res.ok) setViews((await res.json()) as CredentialView[]);
    } catch {
      /* what is shown stays as it was */
    }
    router.refresh(); // the setup banner lives in the shell, which stays mounted
  }, [router]);

  const onSaved = (saved: CredentialView[]) => setViews((all) => all.map((x) => saved.find((s) => s.key === x.key) ?? x));
  const onBot = (status: BotStatus) => {
    setBot(status);
    router.refresh();
  };
  const onSigningDone = (note: string) => {
    setSigningNote(note);
    try {
      window.localStorage.setItem(SIGNING_KEY, note);
    } catch {
      /* ignored */
    }
  };

  return (
    <section className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold">Connect GitHub and Anthropic</h1>
      <p className="mb-6 mt-2 text-sm text-muted">The agents need both before they can work. Each takes a few minutes, one step at a time.</p>
      <div className="grid items-start gap-6 md:grid-cols-2">
        <GithubCard views={byKey} progress={progress} bot={bot} signingKey={signingKey} encryptionKeyOk={encryptionKeyOk} signingNote={signingNote} onSaved={onSaved} refresh={refresh} onBot={onBot} onSigningDone={onSigningDone} />
        <AnthropicCard views={byKey} progress={progress} encryptionKeyOk={encryptionKeyOk} onSaved={onSaved} refresh={refresh} />
      </div>
      <div className="mt-8 flex items-center gap-4">
        {progress.ready ? (
          <Link href="/" className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-text">
            Go to dashboard
          </Link>
        ) : (
          <>
            <button type="button" disabled className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-text opacity-50">
              Go to dashboard
            </button>
            <p className="text-sm text-muted">Finish GitHub access, the Git identity and the Anthropic key to continue.</p>
          </>
        )}
      </div>
    </section>
  );
}
