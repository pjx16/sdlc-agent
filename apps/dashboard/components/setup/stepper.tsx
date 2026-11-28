'use client';

import { useId, useState, type ReactNode } from 'react';

export interface Step {
  id: string;
  title: string;
  /** Shown beside the title; the step can be skipped (the caller marks it done). */
  optional?: boolean;
  done: boolean;
  /** What a finished step says in one line, next to its title: "Connected as octocat". */
  summary?: ReactNode;
  /** The content, only built while the step is open. */
  render: () => ReactNode;
}

/**
 * A flow, not a list: one step open at a time, the first one that is not done. A finished step folds to one line ("✔ title · summary") with a
 * way to open it again to change it; the steps after the current one wait, greyed. So a person only ever has one thing in front of them.
 */
export function Stepper({ steps }: { steps: Step[] }) {
  const uid = useId();
  // A finished step the person reopened. Null: the first step that is not done is the open one.
  const [reopened, setReopened] = useState<string | null>(null);
  const current = steps.find((s) => !s.done)?.id ?? null;
  const open = reopened ?? current;

  return (
    <ol className="space-y-3">
      {steps.map((step, i) => {
        const isOpen = step.id === open;
        const waiting = !step.done && step.id !== current;
        const panel = `${uid}-${step.id}`;
        const mark = step.done ? '✔' : String(i + 1);
        const header = (
          <>
            <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${step.done ? 'border-green text-green' : isOpen ? 'border-accent text-accent' : 'border-border text-muted'}`}>
              {mark}
            </span>
            <span className={`text-sm font-medium ${waiting ? 'text-muted' : ''}`}>{step.title}</span>
            {step.optional && <span className="rounded border border-border px-1.5 py-0.5 text-xs font-normal text-muted">optional</span>}
            {step.done && !isOpen && step.summary && <span className="min-w-0 truncate text-sm text-muted">· {step.summary}</span>}
            {step.done && !isOpen && <span className="ml-auto text-xs text-accent underline">Edit</span>}
          </>
        );
        return (
          <li key={step.id} data-state={isOpen ? 'open' : step.done ? 'done' : 'waiting'} className={waiting ? 'opacity-70' : ''}>
            {waiting ? (
              <div className="flex items-center gap-3">{header}</div>
            ) : (
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panel}
                // A finished step opens (or, when it is the open one, closes); the current step brings itself back.
                onClick={() => setReopened(step.done && !isOpen ? step.id : null)}
                className="flex w-full items-center gap-3 text-left"
              >
                {header}
              </button>
            )}
            {isOpen && (
              <div id={panel} role="region" aria-label={step.title} className="ml-9 mt-3">
                {step.render()}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
