'use client';

import { Num, Section, useForm } from '@/components/form';

/**
 * Modern names that the browser's own list gives under an older one (it says Asia/Calcutta, a person types Asia/Kolkata). They are added when
 * the browser accepts them, so searching for the name people know finds it.
 */
const MODERN_NAMES = ['UTC', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Ho_Chi_Minh', 'Asia/Yangon', 'Europe/Kyiv', 'America/Nuuk'];
const accepted = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** Every time zone the browser knows, for the picker. Older browsers without the list get the modern names alone, and a plain text box otherwise. */
export function timeZoneChoices(known: readonly string[] | null = typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') : null): string[] {
  const list = new Set(known ?? []);
  for (const zone of MODERN_NAMES) if (accepted(zone)) list.add(zone);
  return [...list].sort();
}

const TIME_ZONES = timeZoneChoices();

/** The credits the pipeline may spend, and the time zone those days, weeks and months are counted in. */
export function BudgetsSection() {
  const { values, errors, set, dirty } = useForm();
  const error = errors.timezone;
  const edge = error ? 'border-red' : dirty?.includes('timezone') ? 'border-accent border-l-4' : 'border-border';
  return (
    <Section title="Budgets" description="Credits the pipeline may spend (1 credit = 1 USD of Anthropic credit balance). When one is used up the pipeline pauses until the next period starts. Leave a budget empty for no limit.">
      <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
        <Num path="budgetDailyCredits" label="Daily" suffix="$" />
        <Num path="budgetWeeklyCredits" label="Weekly" suffix="$" hint="Monday to Sunday." />
        <Num path="budgetMonthlyCredits" label="Monthly" suffix="$" />
      </div>
      <Num path="budgetWarnPct" label="Warn at" suffix="% of a budget" />
      <div>
        <label htmlFor="timezone" className="block text-sm">
          Timezone
        </label>
        <input
          id="timezone"
          list="timezone-list"
          autoComplete="off"
          spellCheck={false}
          value={String(values.timezone ?? '')}
          onChange={(e) => set('timezone', e.target.value)}
          aria-invalid={error ? true : undefined}
          placeholder="Start typing: Asia/Kolkata"
          className={`mt-1 w-full rounded-md border bg-bg px-3 py-2 text-sm outline-none focus:border-accent ${edge}`}
        />
        <datalist id="timezone-list">
          {TIME_ZONES.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        {error ? (
          <p role="alert" className="mt-1 text-xs text-red">
            {error}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">Days, weeks and months are counted here.</p>
        )}
      </div>
    </Section>
  );
}
