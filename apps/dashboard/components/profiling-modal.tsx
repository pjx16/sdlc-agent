'use client';

import { ONBOARDING_PHASES, type OnboardingProgress } from '@sdlc/shared';
import { useEffect, useRef, useState } from 'react';

function seconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Shown while a repository is being profiled: every step with its state (done, running, waiting) and the time spent, so it is obvious
 * that work is going on. It can be closed: the proposal waits in the inbox either way.
 */
export function ProfilingModal({ progress, onClose }: { progress: OnboardingProgress | null | undefined; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const planned = progress?.planned ?? [];
  const phases = ONBOARDING_PHASES.filter((p) => planned.length === 0 || planned.includes(p.id));
  const started = progress ? new Date(progress.startedAt).getTime() : now;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="profiling-title" className="panel w-full max-w-lg p-5 shadow-lg">
        <h2 id="profiling-title" className="text-base font-medium">Profiling your repository</h2>
        <p className="mt-1 text-sm text-muted">Elapsed {seconds(now - started)}. This takes a few minutes. You can close this: the proposal waits for you in the inbox.</p>
        <ol className="mt-4 space-y-2 text-sm" aria-live="polite">
          {phases.map((p) => {
            const done = progress?.done.find((d) => d.id === p.id);
            const running = progress?.running.includes(p.id) ?? false;
            const state = done ? 'done' : running ? 'running' : 'waiting';
            return (
              <li key={p.id} data-state={state} className="flex items-center gap-2">
                <span aria-hidden className={state === 'done' ? 'text-green' : state === 'running' ? 'animate-pulse text-accent motion-reduce:animate-none' : 'text-muted'}>
                  {state === 'done' ? '✔' : state === 'running' ? '●' : '○'}
                </span>
                <span className={state === 'waiting' ? 'text-muted' : ''}>{p.label}</span>
                <span className="sr-only">{state}</span>
                {done && <span className="ml-auto text-xs text-muted">{seconds(done.ms)}</span>}
              </li>
            );
          })}
        </ol>
        <div className="mt-5 flex justify-end">
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">Continue in background</button>
        </div>
      </div>
    </div>
  );
}
