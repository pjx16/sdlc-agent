export const INTAKE_SOURCES = ['jira', 'paste'] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];

export interface IntakePauseSettings {
  intakePaused: boolean;
  pausedIntakeSources: readonly IntakeSource[];
}

/** True when the source is held by the master switch or by its own switch. */
export function isIntakePaused(settings: IntakePauseSettings, source: IntakeSource): boolean {
  return settings.intakePaused || settings.pausedIntakeSources.includes(source);
}

/** Every source when the master switch is on, else the sources paused one by one. */
export function pausedSourcesFor(settings: IntakePauseSettings): IntakeSource[] {
  return settings.intakePaused ? [...INTAKE_SOURCES] : [...settings.pausedIntakeSources];
}
