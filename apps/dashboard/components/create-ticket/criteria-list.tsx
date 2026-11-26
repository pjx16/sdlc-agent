'use client';

import { useEffect, useRef } from 'react';

/**
 * The acceptance criteria, one per row. Enter adds a row after the current one, Backspace on an empty row removes it and goes back to the
 * one before, and a row can always be removed with its button. There is always at least one row.
 */
export function CriteriaList({ items, onChange, errors = {} }: { items: string[]; onChange: (items: string[]) => void; errors?: Record<number, string> }) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const focusNext = useRef<number | null>(null);
  useEffect(() => {
    if (focusNext.current !== null) {
      inputs.current[focusNext.current]?.focus();
      focusNext.current = null;
    }
  });

  const set = (i: number, value: string) => onChange(items.map((x, j) => (j === i ? value : x)));
  const insertAfter = (i: number) => {
    focusNext.current = i + 1;
    onChange([...items.slice(0, i + 1), '', ...items.slice(i + 1)]);
  };
  const remove = (i: number, focus: number) => {
    if (items.length === 1) return set(0, '');
    focusNext.current = focus;
    onChange(items.filter((_, j) => j !== i));
  };

  return (
    <ul className="space-y-2" aria-label="Acceptance criteria">
      {items.map((value, i) => (
        <li key={i}>
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-muted">
              ☐
            </span>
            <input
              ref={(el) => void (inputs.current[i] = el)}
              value={value}
              aria-label={`Criterion ${i + 1}`}
              aria-invalid={errors[i] ? true : undefined}
              placeholder={i === 0 ? 'What must be true when this is done?' : undefined}
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault(); // Enter adds a criterion; it does not send the form
                  insertAfter(i);
                } else if (e.key === 'Backspace' && value === '' && items.length > 1) {
                  e.preventDefault();
                  remove(i, Math.max(0, i - 1));
                }
              }}
              className={`w-full rounded-md border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent ${errors[i] ? 'border-red' : 'border-border'}`}
            />
            <button type="button" aria-label={`Remove criterion ${i + 1}`} onClick={() => remove(i, Math.max(0, i - 1))} className="rounded-md border border-border px-2 py-1 text-sm text-muted hover:text-text">
              ✕
            </button>
          </div>
          {errors[i] && (
            <p role="alert" className="ml-6 mt-1 text-xs text-red">
              {errors[i]}
            </p>
          )}
        </li>
      ))}
      <li>
        <button type="button" onClick={() => insertAfter(items.length - 1)} className="text-sm text-accent underline">
          + Add a criterion
        </button>
      </li>
    </ul>
  );
}
