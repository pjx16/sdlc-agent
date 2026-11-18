import type { SystemView, TicketListItem } from './types';

export interface PipelineStep {
  status: string;
  label: string;
  /** A step where the ticket waits for a person or for CI rather than for the worker. */
  gate?: boolean;
}

/** The happy path of a ticket, in order. ON_HOLD and FAILED are shown apart: they are not part of the flow. */
export const PIPELINE_STEPS: PipelineStep[] = [
  { status: 'NEW', label: 'Intake' },
  { status: 'KB', label: 'Knowledge base' },
  { status: 'PLANNING', label: 'Planning' },
  { status: 'AWAITING_PLAN_APPROVAL', label: 'Plan approval', gate: true },
  { status: 'BREAKDOWN', label: 'Subtasks' },
  { status: 'IN_PROGRESS', label: 'Implement' },
  { status: 'REVIEW', label: 'Review' },
  { status: 'KB_UPDATE', label: 'KB update' },
  { status: 'AWAITING_CI', label: 'CI', gate: true },
  { status: 'IN_HUMAN_REVIEW', label: 'Human review', gate: true },
  { status: 'DONE', label: 'Done' },
];

/** The ticket status a running stage belongs to. */
const STAGE_STATUS: Record<string, string> = {
  kbBuild: 'KB', featureMap: 'KB',
  solutionDesign: 'PLANNING', bugInvestigation: 'PLANNING',
  technicalDesign: 'BREAKDOWN',
  tests: 'IN_PROGRESS', implement: 'IN_PROGRESS', fix: 'IN_PROGRESS',
  prReview: 'REVIEW', qualityReview: 'REVIEW', securityReview: 'REVIEW',
  kbUpdate: 'KB_UPDATE',
  ciTriage: 'AWAITING_CI',
};

export interface PipelineActivity {
  /** The step that is moving right now, or null when nothing is. */
  status: string | null;
  /** The ticket being worked on, when known. */
  ticketKey: string | null;
  /** What is happening, for the caption. */
  text: string | null;
}

/**
 * Which step is moving: a running stage run first, then a step the worker reports without a stage run (an install, the typecheck,
 * the tests), whose phase detail reads "STATUS on KEY" or "Installing dependencies for KEY (...)".
 */
export function currentActivity(system: SystemView | null, tickets: TicketListItem[]): PipelineActivity {
  const none = { status: null, ticketKey: null, text: null };
  if (!system || system.settings.pipelinePaused) return none;
  const run = system.runningStage;
  if (run) {
    const status = STAGE_STATUS[run.stage];
    if (status) return { status, ticketKey: tickets.find((t) => t.id === run.ticketId)?.key ?? null, text: `${run.stage} (${run.model})` };
  }
  const w = system.worker;
  if (w?.state !== 'busy' || w.phase !== 'stage' || !w.phaseDetail) return none;
  const onTicket = /^([A-Z_]+) on (\S+)$/.exec(w.phaseDetail);
  if (onTicket) return { status: onTicket[1] ?? null, ticketKey: onTicket[2] ?? null, text: w.phaseDetail };
  const key = /\b([A-Z][A-Z0-9_]*-\d+)\b/.exec(w.phaseDetail)?.[1] ?? null;
  const status = key ? tickets.find((t) => t.key === key)?.status ?? null : null;
  return { status, ticketKey: key, text: w.phaseDetail };
}

/** Tickets grouped by status. */
export function groupByStatus(tickets: TicketListItem[]): Map<string, TicketListItem[]> {
  const map = new Map<string, TicketListItem[]>();
  for (const t of tickets) map.set(t.status, [...(map.get(t.status) ?? []), t]);
  return map;
}
