'use client';

import { GUIDELINE_GROUPS, formatSpec, missingPlaceholders } from '@sdlc/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { appendTweak } from '@/lib/guideline-tweaks';
import type { GuidelineEntry } from '@/lib/types';
import { Markdown } from '../markdown';
import { Modal } from '../modal';
import { CustomisedBadge, ModelBadge } from './badges';
import { TweakChips } from './tweak-chips';

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** A copy of the record without one key. */
const withoutKey = (o: Record<string, string>, key: string): Record<string, string> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

type Notice = { kind: 'ok' | 'error'; text: string } | null;
type Tab = 'behaviour' | 'pipeline';
type Pane = 'edit' | 'preview';

/**
 * The guideline editor: every item on the left, one item on the right. An agent has two tabs: its behaviour (editable) and how it works in
 * the pipeline (shown, never editable: it is how the pipeline reads the agent's answer). Drafts are kept per file, so moving between items
 * loses nothing, and closing with a draft asks first.
 */
export function EditorModal({ entries, initialId, onClose, onChanged }: { entries: GuidelineEntry[]; initialId: string; onClose: () => void; onChanged: () => void }) {
  const [currentId, setCurrentId] = useState(initialId);
  const [tab, setTab] = useState<Tab>('behaviour');
  const [pane, setPane] = useState<Pane>('edit');
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const item = entries.find((e) => e.id === currentId) ?? (entries[0] as GuidelineEntry);
  const path = item.editable;
  const readonlyPath = item.readonly;
  const text = drafts[path] ?? saved[path] ?? '';
  const dirty = (p: string) => drafts[p] !== undefined && drafts[p] !== saved[p];
  const anyDirty = Object.keys(drafts).some(dirty);
  const itemDirty = dirty(path);
  const tabs: { id: Tab; label: string }[] = item.kind === 'agent' ? [{ id: 'behaviour', label: 'Behaviour' }, { id: 'pipeline', label: 'In this pipeline' }] : [{ id: 'behaviour', label: item.kind === 'format' ? 'Format' : 'Text' }];

  const load = useCallback(
    async (p: string) => {
      if (saved[p] !== undefined) return;
      setLoading(p);
      try {
        const res = await fetch(`/api/guidelines/${encodePath(p)}`);
        const body = await res.json().catch(() => ({}));
        if (res.ok) setSaved((s) => ({ ...s, [p]: String(body.content ?? '') }));
        else setNotice({ kind: 'error', text: body.message ?? 'Could not open this item.' });
      } catch {
        setNotice({ kind: 'error', text: 'Cannot reach the server.' });
      } finally {
        setLoading(null);
      }
    },
    [saved],
  );

  useEffect(() => {
    void load(tab === 'pipeline' && readonlyPath ? readonlyPath : path);
  }, [load, tab, path, readonlyPath]);

  function choose(id: string) {
    setCurrentId(id);
    setTab('behaviour');
    setNotice(null);
  }

  async function save() {
    setBusy('save');
    setNotice(null);
    try {
      const res = await fetch(`/api/guidelines/${encodePath(path)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved((s) => ({ ...s, [path]: text }));
        setSavedAt((s) => ({ ...s, [path]: new Date().toISOString() }));
        setNotice({ kind: 'ok', text: 'Saved. It applies from the next stage run.' });
        onChanged();
      } else {
        setNotice({ kind: 'error', text: body.fields ? Object.values(body.fields).join(' ') : (body.message ?? 'Could not save.') });
      }
    } catch {
      setNotice({ kind: 'error', text: 'Cannot reach the server.' });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!window.confirm(`Go back to the text ${item.label} shipped with? Your changes to it are lost.`)) return;
    setBusy('reset');
    setNotice(null);
    try {
      const res = await fetch(`/api/guidelines/reset/${encodePath(path)}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved((s) => ({ ...s, [path]: String(body.content ?? '') }));
        setDrafts((d) => withoutKey(d, path));
        setSavedAt((s) => ({ ...s, [path]: new Date().toISOString() }));
        setNotice({ kind: 'ok', text: 'Back to the original. It applies from the next stage run.' });
        onChanged();
      } else {
        setNotice({ kind: 'error', text: body.message ?? 'Could not reset.' });
      }
    } catch {
      setNotice({ kind: 'error', text: 'Cannot reach the server.' });
    } finally {
      setBusy(null);
    }
  }

  const discard = () => setDrafts((d) => withoutKey(d, path));
  const edit = (value: string) => setDrafts((d) => ({ ...d, [path]: value }));

  const format = item.kind === 'format' ? formatSpec(item.id.slice('format:'.length)) : undefined;
  const missing = format ? missingPlaceholders(format.name, text) : [];
  const lastSaved = savedAt[path] ?? item.updatedAt;
  const groups = useMemo(() => GUIDELINE_GROUPS.map((g) => ({ ...g, items: entries.filter((e) => e.kind === g.kind) })).filter((g) => g.items.length > 0), [entries]);
  const customised = item.customised || savedAt[path] !== undefined;
  const readonlyText = readonlyPath ? (saved[readonlyPath] ?? '') : '';

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted" aria-live="polite">
        Applies from the next stage run{lastSaved ? ` · Last saved ${new Date(lastSaved).toLocaleString()}` : ''}
        {itemDirty && <span className="ml-3 text-amber">● Unsaved</span>}
      </p>
      <div className="flex items-center gap-2">
        {tab === 'behaviour' && (
          <>
            <button type="button" onClick={reset} disabled={busy !== null || (!customised && !itemDirty)} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50">
              {busy === 'reset' ? 'Resetting…' : 'Reset to default'}
            </button>
            <button type="button" onClick={discard} disabled={!itemDirty || busy !== null} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50">
              Discard
            </button>
            <button type="button" onClick={save} disabled={!itemDirty || busy !== null} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-text disabled:opacity-60">
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={item.label} description={item.description} size="xl" dirty={anyDirty} footer={footer}>
      <div className="grid h-full gap-4 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Guidelines" className="lg:overflow-y-auto lg:pr-2">
          {groups.map((g) => (
            <div key={g.kind} className="mb-3">
              <p className="px-2 py-1 text-xs uppercase tracking-wide text-muted">{g.title}</p>
              <ul>
                {g.items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => choose(it.id)}
                      aria-current={it.id === item.id ? 'true' : undefined}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm ${it.id === item.id ? 'bg-accent text-accent-text' : 'text-muted hover:bg-bg hover:text-text'}`}
                    >
                      <span>{it.label}</span>
                      {dirty(it.editable) && <span role="img" aria-label="Unsaved changes" className="text-amber">●</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{item.label}</h3>
            {item.model && <ModelBadge model={item.model} />}
            {customised && <CustomisedBadge />}
          </div>
          {item.position && <p className="text-sm text-muted">{item.position}</p>}

          {tabs.length > 1 && (
            <div role="tablist" aria-label="Part of the guideline" className="flex gap-2 border-b border-border">
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === t.id ? 'border-accent text-text' : 'border-transparent text-muted'}`}>
                  {t.label}
                  {t.id === 'pipeline' && <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs text-muted">read-only</span>}
                </button>
              ))}
            </div>
          )}

          {tab === 'pipeline' && readonlyPath ? (
            <section aria-label="How this agent works in the pipeline" className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              <p className="text-xs text-muted">This part is managed by sdlc-agent: it is how the pipeline hands work to the agent and reads its answer. It cannot be edited here.</p>
              {saved[readonlyPath] === undefined ? <p className="text-sm text-muted">{loading === readonlyPath ? 'Loading…' : ''}</p> : <Markdown source={readonlyText} toggle={false} />}
            </section>
          ) : (
            <>
              {format && (
                <section aria-label="About this format" className="panel space-y-2 p-3 text-sm">
                  {format.placeholders.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-muted">
                      {format.placeholders.map((p) => (
                        <li key={p.name}>
                          <code className="text-text">{`{{${p.name}}}`}</code> {p.meaning}
                        </li>
                      ))}
                    </ul>
                  )}
                  {missing.length > 0 && (
                    <p role="alert" className="text-xs text-amber">
                      Missing {missing.map((m) => `{{${m}}}`).join(', ')}: that part will not appear.
                    </p>
                  )}
                </section>
              )}
              <TweakChips tweaks={item.tweaks} onPick={(t) => edit(appendTweak(text, t))} disabled={saved[path] === undefined} />
              <div role="tablist" aria-label="Edit or preview" className="flex gap-2 lg:hidden">
                {(['edit', 'preview'] as const).map((p) => (
                  <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)} className={`rounded-md border px-3 py-1 text-xs ${pane === p ? 'border-accent text-text' : 'border-border text-muted'}`}>
                    {p === 'edit' ? 'Edit' : 'Preview'}
                  </button>
                ))}
              </div>
              <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
                <div className={`${pane === 'edit' ? 'flex' : 'hidden'} min-h-64 flex-col lg:flex`}>
                  <label htmlFor="guideline-text" className="sr-only">
                    Text of {item.label}
                  </label>
                  <textarea
                    id="guideline-text"
                    value={text}
                    onChange={(e) => edit(e.target.value)}
                    disabled={saved[path] === undefined}
                    spellCheck={false}
                    className="h-full min-h-64 w-full flex-1 rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                  />
                </div>
                <div className={`${pane === 'preview' ? 'block' : 'hidden'} min-h-64 overflow-y-auto rounded-md border border-border px-3 py-2 lg:block`} aria-label="Preview">
                  <Markdown source={text} toggle={false} />
                </div>
              </div>
            </>
          )}
          {notice && (
            <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${notice.kind === 'error' ? 'text-red' : 'text-green'}`}>
              {notice.text}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
