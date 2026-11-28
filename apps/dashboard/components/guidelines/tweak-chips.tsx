'use client';

/** Small changes a person might want: one click adds the line to the rules. They are suggestions only. */
export function TweakChips({ tweaks, onPick, disabled }: { tweaks: string[]; onPick: (tweak: string) => void; disabled?: boolean }) {
  if (tweaks.length === 0) return null;
  return (
    <div aria-label="Quick tweaks" role="group" className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">Add a rule:</span>
      {tweaks.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onPick(t)}
          disabled={disabled}
          className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-accent hover:text-text disabled:opacity-50"
        >
          + {t}
        </button>
      ))}
    </div>
  );
}
