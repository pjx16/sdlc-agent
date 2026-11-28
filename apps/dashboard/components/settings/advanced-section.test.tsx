import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STAGE_NAMES } from '@sdlc/shared';
import { describe, expect, it } from 'vitest';
import { FormProvider } from '@/components/form';
import { initialSettingsValues } from '@/lib/settings-form';
import type { GlobalSettingsView } from '@/lib/types';
import { AdvancedSection, isAdvancedPath } from './advanced-section';

const settings = {
  budgetDailyCredits: 10, budgetWeeklyCredits: null, budgetMonthlyCredits: 150, budgetWarnPct: 80, timezone: 'UTC', pollIntervalSec: 120, stageTimeoutMin: 20,
  verifyTimeoutSec: 600, onboardingTimeoutMin: 15, githubIssueOnCreate: 'ask', workspaceRetentionDays: 7, logRetentionDays: 30, assistantTokenCap: 200000,
  stageDefaults: Object.fromEntries(STAGE_NAMES.map((st) => [st, { model: 'sonnet', maxTurns: 10 }])),
  modelAliases: { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' },
} as unknown as GlobalSettingsView;

function show(errors: Record<string, string> = {}, dirty: string[] = []) {
  const set = (path: string, value: unknown) => calls.push([path, value]);
  const calls: [string, unknown][] = [];
  render(
    <FormProvider value={{ values: initialSettingsValues(settings), errors, set, dirty }}>
      <AdvancedSection />
    </FormProvider>,
  );
  return calls;
}
const details = () => screen.getByText('Advanced').closest('details') as HTMLDetailsElement;

describe('AdvancedSection', () => {
  it('is closed until opened, and says the defaults are fine', async () => {
    show();
    expect(details().open).toBe(false);
    expect(screen.getByText('The defaults are fine for most installs.')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Advanced'));
    expect(details().open).toBe(true);
  });

  it('has the timeouts, retention and models, with their units', () => {
    show();
    expect(screen.getByLabelText('Poll interval')).toHaveValue('120');
    expect(screen.getByLabelText('Stage timeout')).toHaveValue('20');
    expect(screen.getByLabelText('Verify timeout')).toHaveValue('600');
    expect(screen.getByLabelText('Profiling timeout')).toHaveValue('15');
    expect(screen.getByLabelText('Workspace retention')).toHaveValue('7');
    expect(screen.getByLabelText('Log retention')).toHaveValue('30');
    expect(screen.getByLabelText('Assistant token cap per conversation')).toHaveValue('200000');
    for (const unit of ['seconds', 'minutes', 'days', 'tokens']) expect(screen.getAllByText(unit).length).toBeGreaterThan(0);
    for (const alias of ['haiku', 'sonnet', 'opus']) expect(screen.getByLabelText(alias)).toHaveValue(alias);
  });

  it('lists every stage in a table with its model and turns, and edits go through the form', async () => {
    const calls = show();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(STAGE_NAMES.length + 1);
    expect(screen.getByLabelText('Solution architect: model')).toHaveValue('sonnet');
    expect(screen.getByLabelText('Assistant: turns')).toHaveValue('10');
    await userEvent.selectOptions(screen.getByLabelText('Solution architect: model'), 'opus');
    expect(calls).toEqual([['stageDefaults.solutionDesign.model', 'opus']]);
    await userEvent.type(screen.getByLabelText('Coder: turns'), '5');
    expect(calls.at(-1)).toEqual(['stageDefaults.implement.maxTurns', '105']);
  });

  it('opens by itself when a save error is inside it, and stays closed for an error outside it', () => {
    show({ budgetWarnPct: 'must be at least 1' });
    expect(details().open).toBe(false);
  });

  it('opens on an error in a timeout, a model alias or a stage default, and shows it at the field', () => {
    show({ 'stageDefaults.implement.maxTurns': 'must be at most 200' });
    expect(details().open).toBe(true);
    expect(screen.getByText('must be at most 200')).toBeInTheDocument();
    expect(screen.getByLabelText('Coder: turns')).toHaveAttribute('aria-invalid', 'true');
  });

  it('marks what changed with an accent edge, in the fields and in the table', () => {
    show({}, ['pollIntervalSec', 'stageDefaults.fix.model']);
    expect(screen.getByLabelText('Poll interval')).toHaveClass('border-accent');
    expect(screen.getByLabelText('Fixer: model')).toHaveClass('border-accent');
    expect(screen.getByLabelText('Stage timeout')).not.toHaveClass('border-accent');
  });

  it('knows which paths are advanced', () => {
    for (const p of ['pollIntervalSec', 'onboardingTimeoutMin', 'modelAliases.opus', 'stageDefaults.plan.maxTurns', 'assistantTokenCap']) expect(isAdvancedPath(p)).toBe(true);
    for (const p of ['budgetDailyCredits', 'timezone', 'intakePasteEnabled', 'githubIssueOnCreate']) expect(isAdvancedPath(p)).toBe(false);
  });
});
