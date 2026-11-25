export type IntakeSource = 'jira' | 'paste';

export interface IntakePauseSettings {
  intakePaused: boolean;
  pausedIntakeSources: readonly IntakeSource[];
}

/** True when the source is held by the master switch or by its own switch. */
export function isIntakePaused(_settings: IntakePauseSettings, _source: IntakeSource): boolean {
  throw new Error('Not implemented');
}

/** Every source when the master switch is on, else the sources paused one by one. */
export function pausedSourcesFor(_settings: IntakePauseSettings): IntakeSource[] {
  throw new Error('Not implemented');
}
