import { formatDuration } from './ticket-status';
import type { SystemView } from './types';

export type Tone = 'green' | 'amber' | 'red' | 'grey';

export interface ActivityLine {
  key: 'worker' | 'agent-image' | 'pipeline' | 'onboarding' | 'intake';
  label: string;
  tone: Tone;
  text: string;
  /** A link the line offers (to the page that fixes it or shows more). */
  link?: { href: string; text: string };
}

/** "5s ago", "3 min ago", "2 h ago". */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

/** "in 40s", "in 2 min" (or "due now"). */
export function inFuture(ms: number): string {
  if (ms <= 0) return 'due now';
  const s = Math.round(ms / 1000);
  return s < 120 ? `in ${s}s` : `in ${Math.round(s / 60)} min`;
}

/** What the worker is doing, in plain language: is it alive, what the pipeline is doing, and whether intake is paused. */
export function describeActivity(system: SystemView | null, now: number): ActivityLine[] {
  const lines: ActivityLine[] = [];
  const worker = system?.worker ?? null;

  if (!system || !worker) {
    lines.push({ key: 'worker', label: 'Worker', tone: 'amber', text: 'Has not reported yet. If it is not running, nothing will happen: start it with `npm run up:dev` or `docker compose up -d`.' });
    return lines;
  }
  if (worker.state === 'offline') {
    lines.push({ key: 'worker', label: 'Worker', tone: 'red', text: `Offline: last seen ${ago(worker.heartbeatAt, now)}. Nothing is polled or run until it is started again.` });
    return lines;
  }
  if (worker.restartingRepeatedly) {
    lines.push({ key: 'worker', label: 'Worker', tone: 'red', text: 'Worker is restarting repeatedly (3 starts in the last 10 minutes). Check its logs.' });
  } else if (worker.state === 'stalled') {
    lines.push({ key: 'worker', label: 'Worker', tone: 'amber', text: `Stalled: online, but stuck in "${worker.phaseDetail ?? worker.phase}" for ${ago(worker.phaseSince, now).replace(' ago', '')}. It may be hung.` });
  } else if (worker.state === 'busy') {
    const what = worker.phaseDetail ? `${worker.phase}: ${worker.phaseDetail}` : worker.phase;
    lines.push({ key: 'worker', label: 'Worker', tone: 'green', text: `Online, busy (${what}) for ${ago(worker.phaseSince, now).replace(' ago', '')}.` });
  } else {
    lines.push({ key: 'worker', label: 'Worker', tone: 'green', text: `Online, idle (checked ${ago(worker.heartbeatAt, now)}).` });
  }

  if (worker.agentImageError) lines.push({ key: 'agent-image', label: 'Agent image', tone: 'red', text: worker.agentImageError });

  const run = system.runningStage ?? null;
  if (system.settings.pipelinePaused) {
    lines.push({ key: 'pipeline', label: 'Pipeline', tone: 'amber', text: `Paused. ${system.settings.pausedReason === 'manual' ? 'Paused by you.' : (system.settings.pausedReason ?? '')}`.trim() });
  } else if (run) {
    lines.push({ key: 'pipeline', label: 'Pipeline', tone: 'green', text: `Running ${run.stage} with ${run.model}${run.startedAt ? ` for ${formatDuration(run.startedAt, new Date(now).toISOString())}` : ''}.`, link: { href: `/runs/${run.id}`, text: 'Watch the log' } });
  } else if (worker.state === 'busy' && worker.phase === 'stage' && worker.phaseDetail && !/^[A-Z_]+ on /.test(worker.phaseDetail)) {
    // A step that is not a recorded stage run (an install, the typecheck, the tests): say what it is.
    lines.push({ key: 'pipeline', label: 'Pipeline', tone: 'green', text: `${worker.phaseDetail} for ${ago(worker.phaseSince, now).replace(' ago', '')}.` });
  } else if (worker.tickOutcome === 'not_configured') {
    lines.push({ key: 'pipeline', label: 'Pipeline', tone: 'amber', text: `Blocked: setup is incomplete (missing ${worker.tickDetail ?? 'credentials'}).`, link: { href: '/setup/connections', text: 'Finish setup' } });
  } else if (worker.tickOutcome === 'stepped' && worker.tickDetail) {
    lines.push({ key: 'pipeline', label: 'Pipeline', tone: 'green', text: `Working on ${worker.tickDetail}.` });
  } else if (worker.tickOutcome === 'idle' && worker.tickDetail?.startsWith('Iteration failed')) {
    lines.push({ key: 'pipeline', label: 'Pipeline', tone: 'red', text: worker.tickDetail });
  } else {
    lines.push({ key: 'pipeline', label: 'Pipeline', tone: 'grey', text: 'Idle. No ticket is waiting for a stage.' });
  }

  for (const o of system.onboarding ?? []) {
    lines.push(o.status === 'profiling'
      ? { key: 'onboarding', label: 'Onboarding', tone: 'green', text: `Reading ${o.name}: the repository and, when it uses one, its GitHub board. This takes a few minutes.`, link: { href: `/projects/${o.projectId}`, text: 'Open' } }
      : { key: 'onboarding', label: 'Onboarding', tone: 'amber', text: `The proposal for ${o.name} waits for your review.`, link: { href: `/projects/${o.projectId}`, text: 'Review it' } });
  }

  if (system.settings.intakePaused) {
    lines.push({ key: 'intake', label: 'Intake', tone: 'amber', text: 'Paused by you: new tickets are not being picked up from GitHub. Pasted tickets still work.' });
  }
  return lines;
}
