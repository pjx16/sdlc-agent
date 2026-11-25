'use client';

import { KB_ATTACHMENT_MAX } from '@sdlc/shared';
import { useState } from 'react';

interface Doc {
  path: string;
  title: string;
}

/**
 * Picks knowledge-base docs of a project to attach to a new ticket. The list is fetched when the person opens it, so a form that never
 * attaches anything costs nothing.
 */
export function KbDocPicker({ projectId, selected, onChange, error }: { projectId: string; selected: string[]; onChange: (paths: string[]) => void; error?: string }) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('');

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (!next || docs) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/kb`);
      if (!res.ok) throw new Error();
      setDocs(((await res.json()) as { docs: Doc[] }).docs);
    } catch {
      setFailed(true);
    }
  }

  const shown = (docs ?? []).filter((d) => `${d.title} ${d.path}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (path: string) => onChange(selected.includes(path) ? selected.filter((p) => p !== path) : [...selected, path]);

  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => void toggleOpen()} className="rounded-md border border-border px-3 py-1.5 text-sm">
        Attach knowledge-base docs{selected.length > 0 ? ` (${selected.length})` : ''}
      </button>
      <p className="mt-1 text-xs text-muted">Every stage of the ticket keeps these docs in its context (up to {KB_ATTACHMENT_MAX}).</p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red">
          {error}
        </p>
      )}
      {selected.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached docs">
          {selected.map((p) => (
            <li key={p} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
              <span className="font-mono">{p}</span>
              <button type="button" aria-label={`Remove ${p}`} onClick={() => toggle(p)} className="text-muted hover:text-text">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="mt-2 rounded-md border border-border p-3">
          {failed && <p className="text-sm text-red">The docs of this project could not be loaded.</p>}
          {!failed && docs === null && <p className="text-sm text-muted">Loading…</p>}
          {docs !== null && docs.length === 0 && <p className="text-sm text-muted">This project has no knowledge-base docs yet. They appear after the first feature is documented.</p>}
          {docs !== null && docs.length > 0 && (
            <>
              <label htmlFor="kb-filter" className="sr-only">
                Filter docs
              </label>
              <input id="kb-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter docs" className="mb-2 w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent" />
              <ul className="max-h-56 space-y-1 overflow-auto">
                {shown.map((d) => {
                  const on = selected.includes(d.path);
                  return (
                    <li key={d.path}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input type="checkbox" checked={on} disabled={!on && selected.length >= KB_ATTACHMENT_MAX} onChange={() => toggle(d.path)} />
                        <span>{d.title}</span>
                        <span className="font-mono text-xs text-muted">{d.path}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
