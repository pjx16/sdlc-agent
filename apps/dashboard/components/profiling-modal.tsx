'use client';

import { ONBOARDING_PHASES, type OnboardingProgress } from '@sdlc/shared';
import { useEffect, useState } from 'react';
import type { OnboardingView } from '@/lib/types';
import { Modal } from './modal';

export function seconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

type PhaseState = 'done' | 'running' | 'failed' | 'waiting';

/** The steps of profiling with their state. Failed wins over everything else, so the failing step is the one that stands out. */
export function PhaseList({ progress }: { progress: OnboardingProgress | null | undefined }) {
  const planned = progress?.planned ?? [];
  const phases = ONBOARDING_PHASES.filter((p) => planned.length === 0 || planned.includes(p.id));
  return (
    <ol className="space-y-2 text-sm" aria-live="polite">
      {phases.map((p) => {
        const done = progress?.done.find((d) => d.id === p.id);
        const failed = progress?.failed?.id === p.id;
        const running = progress?.running.includes(p.id) ?? false;
        const state: PhaseState = failed ? 'failed' : done ? 'done' : running ? 'running' : 'waiting';
        return (
          <li key={p.id} data-state={state}>
            <div className="flex items-center gap-2">
              <span aria-hidden className={state === 'done' ? 'text-green' : state === 'failed' ? 'text-red' : state === 'running' ? 'animate-pulse text-accent motion-reduce:animate-none' : 'text-muted'}>
                {state === 'done' ? '✔' : state === 'failed' ? '✖' : state === 'running' ? '●' : '○'}
              </span>
              <span className={state === 'waiting' ? 'text-muted' : state === 'failed' ? 'text-red' : ''}>{p.label}</span>
              <span className="sr-only">{state}</span>
              {done && !failed && <span className="ml-auto text-xs text-muted">{seconds(done.ms)}</span>}
            </div>
            {failed && <p className="ml-6 mt-1 whitespace-pre-wrap text-xs text-red">{progress?.failed?.message}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/** "times out in 11m 48s", or what is happening when the time is up. */
function limitLine(progress: OnboardingProgress | null | undefined, now: number): { text: string; soon: boolean } | null {
  if (!progress?.deadlineAt) return null;
  const left = new Date(progress.deadlineAt).getTime() - now;
  if (left <= 0) return { text: 'time limit reached, stopping…', soon: true };
  return { text: `times out in ${seconds(left)}`, soon: left < 120_000 };
}

/**
 * Shown while a repository is being profiled: every step with its state (done, running, failed, waiting), the time spent and the time
 * left, so it is obvious that work is going on and when it will be stopped. It can be closed: the proposal waits in the inbox either way.
 */
export function ProfilingModal({
  progress,
  waiting,
  stale,
  onClose,
  onCancel,
  cancelling,
}: {
  progress: OnboardingProgress | null | undefined;
  waiting?: OnboardingView['waiting'];
  stale?: boolean;
  onClose: () => void;
  /** Stops profiling. Without it there is no Cancel button. */
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const started = progress ? new Date(progress.startedAt).getTime() : now;
  const limit = limitLine(progress, now);

  const footer = (
    <div className="flex justify-end gap-2">
      {onCancel && (
        <button type="button" onClick={onCancel} disabled={cancelling} className="rounded-md border border-border px-3 py-1.5 text-sm text-red disabled:opacity-50">
          {cancelling ? 'Cancelling…' : 'Cancel profiling'}
        </button>
      )}
      <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">Continue in background</button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Profiling your repository" size="md" footer={footer}>
      {waiting && !progress ? (
        <p role="status" className="text-sm text-amber">{waiting.message}</p>
      ) : (
        <p className="text-sm text-muted">
          Elapsed {seconds(now - started)}
          {limit && <> · <span data-testid="time-limit" className={limit.soon ? 'text-amber' : ''}>{limit.text}</span></>}. You can close this: the proposal waits for you in the inbox.
        </p>
      )}
      {stale && (
        <p role="alert" className="mt-2 text-sm text-red">
          The worker stopped responding. Cancel to stop this run, then try again.
        </p>
      )}
      <div className="mt-4">
        <PhaseList progress={progress} />
      </div>
    </Modal>
  );
}
