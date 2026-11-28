'use client';

import { GUIDELINE_GROUPS } from '@sdlc/shared';
import { useCallback, useState } from 'react';
import type { GuidelineEntry } from '@/lib/types';
import { EditorModal } from './editor-modal';
import { ModelBadge, CustomisedBadge } from './badges';

/**
 * The guidelines page: cards, not files. Each agent follows a short brief in plain words; a card opens the editor at that item. No file
 * path or folder is shown anywhere.
 */
export function GuidelinesGallery({ initial }: { initial: GuidelineEntry[] }) {
  const [entries, setEntries] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);

  // After a save or a reset the server says again which items differ from what shipped.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/guidelines/catalogue');
      if (res.ok) setEntries((await res.json()) as GuidelineEntry[]);
    } catch {
      /* the badges stay as they were */
    }
  }, []);

  return (
    <div>
      <p className="mb-6 text-sm text-muted">Each agent follows a short brief in plain words. Change it and the agent behaves differently from its next run.</p>
      {GUIDELINE_GROUPS.map((group) => {
        const items = entries.filter((e) => e.kind === group.kind);
        if (items.length === 0) return null;
        return (
          <section key={group.kind} aria-label={group.title} className="mb-8">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">{group.title}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(item.id)}
                    aria-label={item.label}
                    className="panel flex h-full w-full flex-col items-start gap-2 p-4 text-left transition hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="flex w-full flex-wrap items-center gap-2">
                      <span className="font-medium">{item.label}</span>
                      {item.model && <ModelBadge model={item.model} />}
                      {item.customised && <CustomisedBadge />}
                    </span>
                    <span className="text-sm text-muted">{item.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {openId && <EditorModal entries={entries} initialId={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
}
