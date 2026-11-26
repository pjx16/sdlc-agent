import { HttpStatus, Injectable } from '@nestjs/common';
import { DEFAULT_GLOBAL_SETTINGS, DEFAULT_SUGGESTED_BUDGETS, ErrorCodes, GlobalSettingsSchema, budgetPeriod, deepMerge, type GlobalSettingsInput } from '@sdlc/shared';
import { z } from 'zod';
import { ApiException } from '../common/api-exception';
import { parseBody } from '../common/parse-body';
import type { GlobalSettings, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { budgetDecision, spentSince } from '../usage/spend';

const GLOBAL_ID = 'global';
const BUDGET_KEYS = ['budgetDailyCredits', 'budgetWeeklyCredits', 'budgetMonthlyCredits'] as const;

export interface GlobalSettingsView extends GlobalSettingsInput {
  pipelinePaused: boolean;
  pausedReason: string | null;
  /** The ERROR_CODES value behind the pause (CLAUDE_AUTH, CLAUDE_CREDITS, SPEND_BUDGET_REACHED, ...), or null for a manual pause. */
  pausedCode: string | null;
  resetsAt: string | null;
  /** Budgets are not enforced until then. */
  usageIgnoredUntil: string | null;
  /** When the budgets were approved (or "no limits" chosen); null while the dashboard should ask. */
  budgetsApprovedAt: string | null;
  intakePaused: boolean;
  /** True while the worker finds no internet connection: the pipeline waits and resumes by itself. */
  networkOffline: boolean;
  offlineSince: string | null;
}

/** Spend in the current day, week and month against the budgets, for the banners. */
export interface SpendView {
  timezone: string;
  warnPct: number;
  periods: { period: 'daily' | 'weekly' | 'monthly'; spent: number; budget: number | null; pct: number | null; resetsAt: string }[];
  /** What the approval banner suggests: 1.5 times the average day of the last 30 days, rounded up, or the defaults with no spend. */
  suggested: Record<'daily' | 'weekly' | 'monthly', number>;
}

/** What the worker last reported (see worker/status). `online` is derived from the heartbeat. */
export interface WorkerStatusView {
  /** Heartbeat is fresh. Kept for older callers; `state` is the full picture. */
  online: boolean;
  /** idle: online, nothing running. busy: online and working. stalled: online but one phase has lasted too long. offline: no heartbeat. */
  state: WorkerState;
  phase: string;
  phaseDetail: string | null;
  phaseSince: string | null;
  startedAt: string | null;
  pid: number | null;
  version: string | null;
  /** The worker started three or more times in the last 10 minutes. */
  restartingRepeatedly: boolean;
  heartbeatAt: string;
  /** idle | stepped | paused | blocked | not_configured */
  tickOutcome: string;
  tickDetail: string | null;
  /** Why the agent image cannot be used (with how to fix it), or null. */
  agentImageError: string | null;
  /** The last Jira intake poll of each mode that has run. */
  intake: IntakeStatusView[];
}

export interface IntakeStatusView {
  mode: 'rest' | 'mcp' | 'connector';
  at: string | null;
  /** Projects polled (Jira mode on, mirror ready). */
  projects: number;
  /** Projects in this mode left out because their mirror is not ready. */
  waiting: number;
  created: number;
  seen: number;
  error: string | null;
  skipped: string | null;
}

export interface RecentEvent {
  id: string;
  at: string;
  type: string;
  message: string;
  ticketId: string | null;
  ticketKey: string | null;
}

export type WorkerState = 'idle' | 'busy' | 'stalled' | 'offline';

/** A busy phase is stalled when it has lasted longer than the stage time limit plus this much. */
export const STALL_GRACE_MS = 5 * 60_000;

/** The four dashboard states, from the heartbeat and the phase. Pure, so it is tested without a database. */
export function workerState(w: { heartbeatAt: Date; phase: string; phaseSince: Date | null }, nowMs: number, stageTimeoutMin: number): WorkerState {
  if (nowMs - w.heartbeatAt.getTime() >= WORKER_ONLINE_MS) return 'offline';
  if (w.phase === 'idle' || w.phase === 'paused' || w.phase === 'not_configured') return 'idle';
  if (w.phaseSince && nowMs - w.phaseSince.getTime() > stageTimeoutMin * 60_000 + STALL_GRACE_MS) return 'stalled';
  return 'busy';
}

/** The worker is considered offline when its last heartbeat is older than this (it ticks every 5 seconds). */
export const WORKER_ONLINE_MS = 30_000;

export interface SystemView {
  settings: GlobalSettingsView;
  worker: WorkerStatusView | null;
  recentEvents: RecentEvent[];
  /** Open items that need you: blocking tickets and approvals. The sidebar badge. */
  inboxBadge: number;
  /** Open FYI items (for example a pull request ready for human review): they need a look but block nothing. */
  inboxFyi: number;
  /** Projects whose onboarding is running or waits for review, so the overview can show them. */
  onboarding: { projectId: string; name: string; status: 'profiling' | 'proposed' }[];
  runningStage: { id: string; stage: string; model: string; projectId: string; ticketId: string | null; startedAt: string | null } | null;
  spend: SpendView;
}

/** Room above an average day, so a busy day does not pause the pipeline: weekly is five such days, monthly about four weeks. */
export function suggestBudgets(avgDaily: number): Record<'daily' | 'weekly' | 'monthly', number> {
  if (avgDaily <= 0) return { ...DEFAULT_SUGGESTED_BUDGETS };
  const daily = Math.max(1, Math.ceil(avgDaily * 1.5));
  return { daily, weekly: daily * 5, monthly: daily * 20 };
}

const IgnoreBody = z.object({ until: z.coerce.date({ error: 'must be a date' }).optional() });

function toView(row: GlobalSettings): GlobalSettingsView {
  const parsed = GlobalSettingsSchema.parse({
    budgetDailyCredits: row.budgetDailyCredits,
    budgetWeeklyCredits: row.budgetWeeklyCredits,
    budgetMonthlyCredits: row.budgetMonthlyCredits,
    budgetWarnPct: row.budgetWarnPct,
    intakeJiraEnabled: row.intakeJiraEnabled,
    intakeGithubEnabled: row.intakeGithubEnabled,
    intakePasteEnabled: row.intakePasteEnabled,
    timezone: row.timezone,
    pollIntervalSec: row.pollIntervalSec,
    stageTimeoutMin: row.stageTimeoutMin,
    verifyTimeoutSec: row.verifyTimeoutSec,
    onboardingTimeoutMin: row.onboardingTimeoutMin,
    workspaceRetentionDays: row.workspaceRetentionDays,
    logRetentionDays: row.logRetentionDays,
    assistantTokenCap: row.assistantTokenCap,
    stageDefaults: GlobalSettingsSchema.parse({ stageDefaults: row.stageDefaults }).stageDefaults,
    modelAliases: row.modelAliases,
  });
  return {
    ...parsed,
    pipelinePaused: row.pipelinePaused,
    pausedReason: row.pausedReason,
    pausedCode: row.pausedCode,
    resetsAt: row.resetsAt?.toISOString() ?? null,
    usageIgnoredUntil: row.usageIgnoredUntil?.toISOString() ?? null,
    budgetsApprovedAt: row.budgetsApprovedAt?.toISOString() ?? null,
    intakePaused: row.intakePaused,
    networkOffline: row.networkOffline,
    offlineSince: row.offlineSince?.toISOString() ?? null,
  };
}

@Injectable()
export class SystemSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The single settings row, created with the defaults on first use. */
  private async row(): Promise<GlobalSettings> {
    const d = DEFAULT_GLOBAL_SETTINGS;
    return this.prisma.globalSettings.upsert({
      where: { id: GLOBAL_ID },
      update: {},
      create: {
        id: GLOBAL_ID,
        ...d,
        modelAliases: d.modelAliases as unknown as Prisma.InputJsonValue,
        stageDefaults: d.stageDefaults as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async settings(): Promise<GlobalSettingsView> {
    return toView(await this.row());
  }

  async system(): Promise<SystemView> {
    const settings = await this.settings();
    const running = await this.prisma.stageRun.findFirst({ where: { status: 'running' }, orderBy: { startedAt: 'desc' } });
    const spend = await this.spend();
    const worker = await this.prisma.workerStatus.findUnique({ where: { id: 'worker' } });
    const intakeRows = await this.prisma.workerStatus.findMany({ where: { id: { in: ['intake-rest', 'intake-mcp', 'intake-connector'] } }, orderBy: { id: 'asc' } });
    const restarts = await this.prisma.event.count({ where: { type: 'worker', message: { startsWith: 'Worker started' }, at: { gte: new Date(Date.now() - 10 * 60_000) } } });
    const events = await this.prisma.event.findMany({ orderBy: { at: 'desc' }, take: 8, include: { ticket: { select: { key: true } } } });
    const inboxFyi = await this.prisma.supportTicket.count({ where: { status: 'open', NOT: { OR: [{ kind: 'approval' }, { priority: 'blocking' }] } } });
    const inboxBadge = await this.prisma.supportTicket.count({ where: { status: 'open', OR: [{ kind: 'approval' }, { priority: 'blocking' }] } });
    const onboarding = await this.prisma.project.findMany({ where: { onboardingStatus: { in: ['profiling', 'proposed'] } }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, onboardingStatus: true } });
    return {
      settings,
      onboarding: onboarding.map((p) => ({ projectId: p.id, name: p.name, status: p.onboardingStatus as 'profiling' | 'proposed' })),
      inboxBadge,
      inboxFyi,
      worker: worker && {
        online: Date.now() - worker.heartbeatAt.getTime() < WORKER_ONLINE_MS,
        state: workerState(worker, Date.now(), settings.stageTimeoutMin),
        phase: worker.phase,
        phaseDetail: worker.phaseDetail,
        phaseSince: worker.phaseSince?.toISOString() ?? null,
        startedAt: worker.startedAt?.toISOString() ?? null,
        pid: worker.pid,
        version: worker.version,
        restartingRepeatedly: restarts >= 3,
        heartbeatAt: worker.heartbeatAt.toISOString(),
        tickOutcome: worker.tickOutcome,
        tickDetail: worker.tickDetail,
        agentImageError: worker.agentImageError,
        intake: intakeRows.map((r) => ({
          mode: (r.intakeMode === 'mcp' || r.intakeMode === 'connector' ? r.intakeMode : 'rest') as 'rest' | 'mcp' | 'connector',
          at: r.intakeAt?.toISOString() ?? null,
          projects: r.intakeProjects,
          waiting: r.intakeWaiting,
          created: r.intakeCreated,
          seen: r.intakeSeen,
          error: r.intakeError,
          skipped: r.intakeSkipped,
        })),
      },
      recentEvents: events.map((e) => ({ id: e.id, at: e.at.toISOString(), type: e.type, message: e.message, ticketId: e.ticketId, ticketKey: e.ticket?.key ?? null })),
      runningStage: running && {
        id: running.id,
        stage: running.stage,
        model: running.model,
        projectId: running.projectId,
        ticketId: running.ticketId,
        startedAt: running.startedAt?.toISOString() ?? null,
      },
      spend,
    };
  }

  async spend(now = new Date()): Promise<SpendView> {
    const row = await this.row();
    const decision = await budgetDecision(this.prisma, row, now);
    const last30 = await spentSince(this.prisma, new Date(now.getTime() - 30 * 86_400_000));
    return { timezone: row.timezone, warnPct: row.budgetWarnPct, periods: decision.statuses.map((s) => ({ ...s, resetsAt: s.resetsAt.toISOString() })), suggested: suggestBudgets(last30 / 30) };
  }

  /**
   * PATCH: merge into the current editable values, validate the whole result, then save. Saving any budget counts as approving the
   * budgets (null for "no limit" too), and ends a budget pause: the gate checks the new budgets before the next step.
   */
  async update(body: unknown): Promise<GlobalSettingsView> {
    const current = await this.settings();
    const editable = GlobalSettingsSchema.parse(current);
    const next = parseBody(GlobalSettingsSchema, deepMerge(editable, body ?? {}));
    const touchesBudgets = typeof body === 'object' && body !== null && BUDGET_KEYS.some((k) => k in body);
    const endsBudgetPause = touchesBudgets && current.pipelinePaused && current.pausedCode === 'SPEND_BUDGET_REACHED';
    const row = await this.prisma.globalSettings.update({
      where: { id: GLOBAL_ID },
      data: {
        ...next,
        modelAliases: next.modelAliases as unknown as Prisma.InputJsonValue,
        stageDefaults: next.stageDefaults as unknown as Prisma.InputJsonValue,
        ...(touchesBudgets ? { budgetsApprovedAt: new Date() } : {}),
        ...(endsBudgetPause ? { pipelinePaused: false, pausedReason: null, pausedCode: null, resetsAt: null } : {}),
      },
    });
    await this.event('settings', touchesBudgets ? 'Budgets updated' : 'Global settings updated');
    return toView(row);
  }

  /** The public half of the key that signs the pipeline's commits. The private half never leaves the worker. */
  async commitSigning(): Promise<{ publicKey: string | null }> {
    const row = await this.prisma.globalSettings.findUnique({ where: { id: GLOBAL_ID }, select: { signingPublicKey: true } });
    return { publicKey: row?.signingPublicKey ?? null };
  }

  async pause(): Promise<GlobalSettingsView> {
    await this.row();
    const row = await this.prisma.globalSettings.update({ where: { id: GLOBAL_ID }, data: { pipelinePaused: true, pausedReason: 'manual' } });
    await this.event('state', 'Pipeline paused (manual)');
    return toView(row);
  }

  async resume(): Promise<GlobalSettingsView> {
    await this.row();
    const row = await this.prisma.globalSettings.update({
      where: { id: GLOBAL_ID },
      data: { pipelinePaused: false, pausedReason: null, pausedCode: null, resetsAt: null },
    });
    await this.event('state', 'Pipeline resumed');
    return toView(row);
  }

  /** Ignore the budgets until `until` (default: when the used-up budget resets, or the end of today) and clear the pause. */
  async ignoreUsage(body: unknown): Promise<GlobalSettingsView> {
    const { until } = parseBody(IgnoreBody, body ?? {});
    const current = await this.row();
    if (!current.pipelinePaused) {
      throw new ApiException(HttpStatus.CONFLICT, ErrorCodes.conflict, 'The pipeline is not paused');
    }
    const ignoredUntil = until ?? current.resetsAt ?? budgetPeriod('daily', new Date(), current.timezone).end;
    const row = await this.prisma.globalSettings.update({
      where: { id: GLOBAL_ID },
      data: { usageIgnoredUntil: ignoredUntil, pipelinePaused: false, pausedReason: null, pausedCode: null, resetsAt: null },
    });
    await this.event('usage', `Budgets ignored until ${ignoredUntil.toISOString()}`);
    return toView(row);
  }

  async setIntakePaused(paused: boolean): Promise<GlobalSettingsView> {
    await this.row();
    const row = await this.prisma.globalSettings.update({ where: { id: GLOBAL_ID }, data: { intakePaused: paused } });
    await this.event('state', paused ? 'Intake paused' : 'Intake resumed');
    return toView(row);
  }

  private event(type: string, message: string) {
    return this.prisma.event.create({ data: { type, message } });
  }
}
