'use client';

import { MODEL_ALIASES, STAGE_NAMES } from '@sdlc/shared';
import { useEffect, useState } from 'react';
import { Num, Text, useForm } from '@/components/form';
import { getIn } from '@/lib/form';
import { STAGE_LABELS } from '@/lib/stage-labels';

/** The settings that live under Advanced: a save error on one of them opens the section, so it cannot be missed. */
export const isAdvancedPath = (path: string): boolean =>
  /^(pollIntervalSec|stageTimeoutMin|verifyTimeoutSec|onboardingTimeoutMin|workspaceRetentionDays|logRetentionDays|assistantTokenCap)$/.test(path) || path.startsWith('modelAliases.') || path.startsWith('stageDefaults.');

const cell = 'rounded-md border bg-bg px-2 py-1 text-sm outline-none focus:border-accent';

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

/**
 * The settings that are fine as they are for most installs: timeouts, retention, the models behind the aliases and the model and turn limit
 * each stage starts with in a new project. Closed until opened (or until one of them has an error).
 */
export function AdvancedSection() {
  const { values, errors, set, dirty } = useForm();
  const [open, setOpen] = useState(false);
  const hasError = Object.keys(errors).some(isAdvancedPath);
  useEffect(() => {
    if (hasError) setOpen(true);
  }, [hasError]);

  return (
    <section aria-labelledby="advanced-title" className="panel px-6 py-4">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary id="advanced-title" className="cursor-pointer text-base font-semibold">
          Advanced
          <span className="ml-3 text-sm font-normal text-muted">The defaults are fine for most installs.</span>
        </summary>
        <div className="mt-5 space-y-8">
          <Group title="Polling and timeouts">
            <Num path="pollIntervalSec" label="Poll interval" suffix="seconds" />
            <Num path="stageTimeoutMin" label="Stage timeout" suffix="minutes" />
            <Num path="verifyTimeoutSec" label="Verify timeout" suffix="seconds" hint="Install, typecheck and test commands." />
            <Num path="onboardingTimeoutMin" label="Profiling timeout" suffix="minutes" hint="Profiling a repository is stopped after this long." />
          </Group>

          <Group title="Retention">
            <Num path="workspaceRetentionDays" label="Workspace retention" suffix="days" />
            <Num path="logRetentionDays" label="Log retention" suffix="days" />
            <Num path="assistantTokenCap" label="Assistant token cap per conversation" suffix="tokens" />
          </Group>

          <Group title="Models" description="What each alias passed to the CLI resolves to.">
            {MODEL_ALIASES.map((alias) => (
              <Text key={alias} path={`modelAliases.${alias}`} label={alias} />
            ))}
          </Group>

          <div>
            <h3 className="text-sm font-semibold">Stage defaults</h3>
            <p className="mt-1 text-xs text-muted">The model and turn limit each stage starts with in a project you onboard. A project can override them under Advanced.</p>
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="py-1 pr-3">Stage</th>
                  <th className="py-1 pr-3">Model</th>
                  <th className="py-1">Max turns</th>
                </tr>
              </thead>
              <tbody>
                {STAGE_NAMES.map((stage) => {
                  const model = `stageDefaults.${stage}.model`;
                  const turns = `stageDefaults.${stage}.maxTurns`;
                  const edge = (path: string) => (errors[path] ? 'border-red' : dirty?.includes(path) ? 'border-accent border-l-4' : 'border-border');
                  return (
                    <tr key={stage}>
                      <td className="py-1 pr-3">{STAGE_LABELS[stage] ?? stage}</td>
                      <td className="py-1 pr-3">
                        <select aria-label={`${STAGE_LABELS[stage] ?? stage}: model`} value={String(getIn(values, model) ?? '')} onChange={(e) => set(model, e.target.value)} className={`${cell} ${edge(model)}`}>
                          {MODEL_ALIASES.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1">
                        <input
                          aria-label={`${STAGE_LABELS[stage] ?? stage}: turns`}
                          aria-invalid={errors[turns] ? true : undefined}
                          inputMode="numeric"
                          value={String(getIn(values, turns) ?? '')}
                          onChange={(e) => set(turns, e.target.value)}
                          className={`w-20 ${cell} ${edge(turns)}`}
                        />
                        {errors[turns] && (
                          <p role="alert" className="mt-1 text-xs text-red">
                            {errors[turns]}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </section>
  );
}
