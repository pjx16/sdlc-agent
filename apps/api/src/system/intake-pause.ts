import type { TicketSource } from '../generated/prisma/client';

export interface IntakePauseSettings {
  intakePaused: boolean;
  pausedIntakeSources: TicketSource[];
}

/** True when the master switch is on or the given source is in the paused list. */
export function isIntakePaused(_settings: IntakePauseSettings, _source: TicketSource): boolean {
  throw new Error('Not implemented');
}
