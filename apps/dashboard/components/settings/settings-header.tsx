'use client';

import type { SettingsMessage } from '@/lib/use-settings-form';

/**
 * The top of the settings page, always in view: the title, what the page is doing (how many changes wait, or what the last save said), and
 * the three actions at the right. Save and Discard are only on when something changed.
 */
export function SettingsHeader({ changes, dirty, busy, message, onSave, onDiscard, onReset }: { changes: number; dirty: boolean; busy: boolean; message: SettingsMessage | null; onSave: () => void; onDiscard: () => void; onReset: () => void }) {
  return (
    <header className="sticky top-0 z-20 -mx-8 -mt-8 mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg/90 px-8 py-4 backdrop-blur">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p role="status" className={`mt-1 text-sm ${message?.kind === 'error' ? 'text-red' : message?.kind === 'ok' && !dirty ? 'text-green' : 'text-muted'}`}>
          {dirty ? <span className="text-amber">● {changes} unsaved {changes === 1 ? 'change' : 'changes'}</span> : (message?.text ?? 'Everything is saved.')}
          {dirty && message?.kind === 'error' && <span className="ml-3 text-red">{message.text}</span>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onReset} disabled={busy} className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-text disabled:opacity-50">
          Reset
        </button>
        <button type="button" onClick={onDiscard} disabled={!dirty || busy} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">
          Discard
        </button>
        <button type="button" onClick={onSave} disabled={!dirty || busy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </header>
  );
}
