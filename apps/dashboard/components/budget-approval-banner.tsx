'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { browserTimeZone } from '@/lib/budgets';
import type { BudgetPeriodName } from '@/lib/types';

const FIELDS: { period: BudgetPeriodName; key: 'budgetDailyCredits' | 'budgetWeeklyCredits' | 'budgetMonthlyCredits'; label: string }[] = [
  { period: 'daily', key: 'budgetDailyCredits', label: 'Daily' },
  { period: 'weekly', key: 'budgetWeeklyCredits', label: 'Weekly' },
  { period: 'monthly', key: 'budgetMonthlyCredits', label: 'Monthly' },
];

/**
 * Asks once for spending limits. It blocks nothing: Approve saves the suggested (or edited) budgets, No limits saves none; both record
 * the choice so the banner goes away. The browser's timezone is saved with it, so "today" is the owner's day.
 */
export function BudgetApprovalBanner({ suggested }: { suggested: Record<BudgetPeriodName, number> }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<BudgetPeriodName, string>>({ daily: String(suggested.daily), weekly: String(suggested.weekly), monthly: String(suggested.monthly) });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(limits: boolean) {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { timezone: browserTimeZone() };
    for (const f of FIELDS) body[f.key] = limits ? Number(values[f.period]) : null;
    try {
      const res = await fetch('/api/system/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      const fields = data.fields as Record<string, string> | undefined;
      setError(fields ? Object.entries(fields).map(([k, v]) => `${FIELDS.find((f) => f.key === k)?.label ?? k}: ${v}`).join('; ') : (data.message ?? 'Could not save the budgets.'));
    } catch {
      setError('Cannot reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="region" aria-label="Set spending limits" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-8 py-3 text-sm">
      <p className="min-w-0 flex-1">
        <span className="font-medium">Set your spending limits.</span>{' '}
        <span className="text-muted">Every stage is billed to your Anthropic API key. The pipeline pauses when a budget is used up (1 credit = 1 USD).</span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {FIELDS.map((f) =>
          editing ? (
            <label key={f.period} className="flex items-center gap-1">
              <span className="text-muted">{f.label}</span>
              <input
                inputMode="decimal"
                value={values[f.period]}
                onChange={(e) => setValues((v) => ({ ...v, [f.period]: e.target.value }))}
                className="w-20 rounded-md border border-border bg-bg px-2 py-1"
                aria-label={`${f.label} budget (credits)`}
              />
            </label>
          ) : (
            <span key={f.period}>
              <span className="text-muted">{f.label}</span> <span className="font-mono">{values[f.period]}</span>
            </span>
          ),
        )}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => save(true)} disabled={busy} className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-text disabled:opacity-50">
          {busy ? 'Saving…' : 'Approve'}
        </button>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} disabled={busy} className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50">
            Edit
          </button>
        )}
        <button type="button" onClick={() => save(false)} disabled={busy} className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50">
          No limits
        </button>
        <Link href="/settings" className="text-accent hover:underline">
          Settings
        </Link>
      </div>
      {error && <p className="w-full text-xs text-red">{error}</p>}
    </div>
  );
}
