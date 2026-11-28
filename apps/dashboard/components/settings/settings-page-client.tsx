'use client';

import { useEffect, type ReactNode } from 'react';
import { FormProvider } from '@/components/form';
import { useSettingsForm } from '@/lib/use-settings-form';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import type { GlobalSettingsView } from '@/lib/types';
import { AdvancedSection } from './advanced-section';
import { BudgetsSection } from './budgets-section';
import { SettingsHeader } from './settings-header';
import { SourcesSection } from './sources-section';

/**
 * The settings page: one form, one Save. The connections summary and the password form are given in (they have their own data and their own
 * buttons) and sit with the rest, but are not part of what Save sends.
 */
export function SettingsPageClient({ settings, connections, account }: { settings: GlobalSettingsView; connections: ReactNode; account: ReactNode }) {
  const form = useSettingsForm(settings);
  useUnsavedGuard(form.dirty);

  // Cmd+S or Ctrl+S saves, when there is something to save.
  const { dirty, save, errors } = form;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, save]);

  // After a save that was refused, the first field with an error is brought into view.
  useEffect(() => {
    const first = Object.keys(errors)[0];
    if (!first) return;
    const el = document.getElementById(first) ?? document.querySelector<HTMLElement>(`[aria-invalid="true"]`);
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [errors]);

  const reset = () => {
    if (window.confirm('Reset all settings to their defaults? Connections, ticket sources and the password are not affected. Nothing is saved until you press Save.')) form.reset();
  };

  return (
    <FormProvider value={{ values: form.values, errors: form.errors, set: form.set, dirty: form.changed }}>
      <div className="mx-auto max-w-3xl">
        <SettingsHeader changes={form.changed.length} dirty={form.dirty} busy={form.busy} message={form.message} onSave={() => void form.save()} onDiscard={form.discard} onReset={reset} />
        <div className="space-y-6">
          {connections}
          <BudgetsSection />
          <SourcesSection intakePaused={settings.intakePaused} />
          {account}
          <AdvancedSection />
        </div>
      </div>
    </FormProvider>
  );
}
