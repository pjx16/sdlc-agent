import Link from 'next/link';
import type { ReactNode } from 'react';
import { PIPELINE_STEPS, currentActivity, groupByStatus } from '@/lib/pipeline';
import type { SystemView, TicketListItem } from '@/lib/types';

const SHOWN = 3;

/** Small line icons, one per step. */
const ICONS: Record<string, ReactNode> = {
  NEW: <path d="M3 13h5l1.5 3h5L16 13h5M5 13 7 5h10l2 8v6H5z" />,
  KB: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11" />,
  PLANNING: <path d="m4 20 1-4L16 5l3 3L8 19zM14 7l3 3" />,
  AWAITING_PLAN_APPROVAL: <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6zM9 12l2 2 4-4" />,
  BREAKDOWN: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  IN_PROGRESS: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  REVIEW: <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
  KB_UPDATE: <path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5" />,
  AWAITING_CI: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />,
  IN_HUMAN_REVIEW: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6" />,
  DONE: <path d="M5 21V4M5 4h12l-2 4 2 4H5" />,
};

function Icon({ status }: { status: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[status]}
    </svg>
  );
}

/** The route in four legs, so the picture reads as a journey and not a row of boxes. */
const PHASES: { name: string; statuses: string[] }[] = [
  { name: 'Prepare', statuses: ['NEW', 'KB'] },
  { name: 'Plan', statuses: ['PLANNING', 'AWAITING_PLAN_APPROVAL', 'BREAKDOWN'] },
  { name: 'Build', statuses: ['IN_PROGRESS', 'REVIEW', 'KB_UPDATE'] },
  { name: 'Ship', statuses: ['AWAITING_CI', 'IN_HUMAN_REVIEW', 'DONE'] },
];

function Chips({ tickets }: { tickets: TicketListItem[] }) {
  if (tickets.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap justify-center gap-1">
      {tickets.slice(0, SHOWN).map((t) => (
        <li key={t.id}>
          <Link href={`/tickets/${t.id}`} className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-accent hover:underline">
            {t.key}
          </Link>
        </li>
      ))}
      {tickets.length > SHOWN && <li className="px-1 py-0.5 text-[11px] text-muted">+{tickets.length - SHOWN}</li>}
    </ul>
  );
}

/**
 * The ticket pipeline as a route: stations on a rail in four legs. The rail is lit as far as the furthest ticket has got, the
 * station that is moving right now has rippling rings and a flowing connector, and stations that wait for a person are amber.
 * On hold and failed tickets sit below, apart from the route.
 */
export function PipelineFlow({ system, tickets }: { system: SystemView | null; tickets: TicketListItem[] }) {
  const byStatus = groupByStatus(tickets);
  const active = currentActivity(system, tickets);
  const paused = Boolean(system?.settings.pipelinePaused);
  const furthest = PIPELINE_STEPS.reduce((far, s, i) => ((byStatus.get(s.status)?.length ?? 0) > 0 ? i : far), -1);
  const indexOf = (status: string) => PIPELINE_STEPS.findIndex((s) => s.status === status);
  const stopped = [
    { status: 'ON_HOLD', label: 'On hold' },
    { status: 'FAILED', label: 'Failed' },
  ].map((s) => ({ ...s, tickets: byStatus.get(s.status) ?? [] }));

  return (
    <section aria-label="Pipeline" className="panel overflow-hidden p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Pipeline</h2>
        <p className="text-xs text-muted" role="status">
          {paused ? 'Paused: nothing is moving.' : active.status ? `Now: ${active.ticketKey ? `${active.ticketKey}, ` : ''}${active.text ?? ''}` : 'Nothing is moving right now.'}
        </p>
      </div>

      <div className="mt-5 grid gap-y-6 lg:grid-cols-[2fr_4fr_3fr_3fr]">
        {PHASES.map((phase) => (
          <div key={phase.name} className="min-w-0">
            <p className="eyebrow mb-3 px-1">{phase.name}</p>
            <ol className="flex">
              {phase.statuses.map((status) => {
                const step = PIPELINE_STEPS[indexOf(status)];
                if (!step) return null;
                const i = indexOf(status);
                const here = byStatus.get(status) ?? [];
                const isActive = active.status === status;
                const waiting = Boolean(step.gate) && status !== 'AWAITING_CI' && here.length > 0;
                const lit = i <= furthest;
                const tone = isActive ? 'border-accent text-accent' : waiting ? 'border-amber text-amber' : here.length > 0 ? 'border-accent text-accent' : lit ? 'border-border-strong text-text' : 'border-border text-muted';
                return (
                  <li key={status} data-testid={`step-${status}`} data-active={isActive || undefined} className="relative min-w-0 flex-1 text-center">
                    {/* The rail: a half line on each side of the station, lit up to the furthest ticket, flowing into the moving one. */}
                    <span aria-hidden className={`absolute left-0 top-[19px] h-0.5 w-1/2 ${isActive ? 'flow-line' : i <= furthest ? 'bg-accent/60' : 'bg-border'} ${i === 0 ? 'hidden' : ''}`} />
                    <span aria-hidden className={`absolute right-0 top-[19px] h-0.5 w-1/2 ${i < furthest ? 'bg-accent/60' : 'bg-border'} ${i === PIPELINE_STEPS.length - 1 ? 'hidden' : ''}`} />
                    <div className="relative mx-auto flex h-10 w-10 items-center justify-center">
                      {isActive && <span aria-hidden className="ripple absolute inset-0 rounded-full border border-accent" />}
                      {isActive && <span aria-hidden className="ripple absolute inset-0 rounded-full border border-accent [animation-delay:0.8s]" />}
                      <span className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 bg-surface ${tone}`} style={isActive ? { boxShadow: '0 0 16px var(--glow)' } : undefined}>
                        <Icon status={status} />
                        {here.length > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-medium text-accent-text">{here.length}</span>}
                      </span>
                    </div>
                    <p className="mt-2 px-0.5 text-xs font-medium leading-tight">{step.label}</p>
                    {isActive && <p className="text-[11px] text-accent">Working</p>}
                    {waiting && <p className="text-[11px] text-amber">Waiting for you</p>}
                    <Chips tickets={here} />
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-3 border-t border-border pt-3">
        {stopped.map((s) => (
          <div key={s.status} data-testid={`step-${s.status}`} className={`min-w-40 rounded-md border bg-surface p-3 ${s.tickets.length > 0 ? (s.status === 'FAILED' ? 'border-red' : 'border-amber') : 'border-border'}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium">{s.label}</span>
              <span className={`font-mono text-lg ${s.tickets.length === 0 ? 'text-muted' : ''}`}>{s.tickets.length}</span>
            </div>
            <Chips tickets={s.tickets} />
          </div>
        ))}
      </div>
    </section>
  );
}
