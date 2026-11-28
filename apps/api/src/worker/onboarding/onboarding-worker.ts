import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DEFAULT_GLOBAL_SETTINGS, GlobalSettingsSchema, ONBOARDING_PHASES, ProjectSettingsSchema, defaultRouting, describeError, events,
  type CommandCheck, type OnboardingPhaseId, type OnboardingProgress, type JiraFacts, type ModelAlias, type OnboardAdvice, type OnboardingFacts, type OnboardingProposal, type RepoProfile, type StageEnvelope, type TicketStatus, jiraOn } from '@sdlc/shared';
import { logEvent } from '../../common/event-log';
import { Prisma, type Project } from '../../generated/prisma/client';
import { JiraClients, JiraNotConfiguredError } from '../../jira/jira-clients';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportRaiser } from '../../support/support-raiser';
import { AgentRunner, type StageResult } from '../agent-runner/agent-runner';
import { GITHUB_CLIENT, type GitHubClient, parseRepo } from '../github/github-client';
import { RepoAccessService } from '../github/repo-access.service';
import { GitRunner } from '../git/git-runner';
import { MirrorService } from '../git/mirror.service';
import { makeWritableForAgent } from '../git/workspace';
import type { Housekeeper } from '../loop/worker-loop';
import { VerifyService } from '../verify/verify.service';
import { WorkerConfig } from '../worker-config';

const CHECKOUT_TIMEOUT_MS = 5 * 60_000;

/** Profiling ran past its time limit. */
export class OnboardingTimeoutError extends Error {
  constructor(readonly minutes: number) {
    super(`Profiling stopped after ${minutes} minutes`);
    this.name = 'OnboardingTimeoutError';
  }
}

/** The person cancelled profiling. */
export class OnboardingCancelledError extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'OnboardingCancelledError';
  }
}

const phaseLabel = (id: OnboardingPhaseId): string => ONBOARDING_PHASES.find((p) => p.id === id)?.label ?? id;

/** What the person reads when profiling was stopped on purpose or failed in a step. */
export function stopMessage(reason: unknown, phase: OnboardingPhaseId | null): string {
  if (reason instanceof OnboardingTimeoutError) {
    const where = phase ? ` while "${phaseLabel(phase)}" was running` : '';
    return `Profiling stopped after ${reason.minutes} minutes${where}. Try again; if it keeps happening, the install or typecheck command may be too slow.`;
  }
  if (reason instanceof OnboardingCancelledError) return 'Cancelled.';
  return (reason instanceof Error ? reason.message : String(reason)).slice(0, 500);
}

export interface TrackerOptions {
  now?: () => number;
  /** When profiling is stopped for taking too long. Shown to the person as a countdown. */
  deadlineAt?: Date;
  /** Aborted at the deadline or on cancel. Every phase is stopped with it. */
  signal?: AbortSignal;
  /** How often a sign of life is written while running. */
  heartbeatMs?: number;
}

export const HEARTBEAT_MS = 30_000;

/**
 * Writes where profiling is (`Project.onboardingProgress`) as phases start and end, so the dashboard can show them, and keeps how long each
 * took. Phases may overlap: the Jira advice does not wait for the code profiling.
 *
 * Every phase is raced against the abort signal, so a call that cannot be cancelled (a hung request) still cannot hold profiling past its
 * deadline. A failing phase is recorded as `failed` (the first one wins), and a heartbeat writes `updatedAt` so a dead worker is noticed.
 */
export class ProgressTracker {
  private readonly progress: OnboardingProgress;
  private readonly now: () => number;
  private readonly signal?: AbortSignal;
  private readonly heartbeatMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private first = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectId: string,
    planned: OnboardingPhaseId[],
    opts: TrackerOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.signal = opts.signal;
    this.heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
    const at = new Date(this.now()).toISOString();
    this.progress = { startedAt: at, updatedAt: at, planned, running: [], done: [], ...(opts.deadlineAt ? { deadlineAt: opts.deadlineAt.toISOString() } : {}) };
  }

  /** Writes the first snapshot (replacing anything an earlier run left) and starts the heartbeat. `onTick` runs at every beat, for example to look for a cancel. */
  start(onTick?: () => Promise<void>): void {
    this.save();
    this.timer = setInterval(() => {
      this.touch();
      void onTick?.().catch(() => undefined);
    }, this.heartbeatMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Phase durations so far, in milliseconds. */
  timings(): Record<string, number> {
    return Object.fromEntries(this.progress.done.map((d) => [d.id, d.ms]));
  }

  /** The phase that failed (or was running when profiling was stopped), if any. */
  failedPhase(): OnboardingPhaseId | null {
    return this.progress.failed?.id ?? null;
  }

  async track<T>(id: OnboardingPhaseId, fn: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    const started = this.now();
    this.progress.running.push(id);
    this.touch();
    try {
      const result = await this.raced(fn(this.signal));
      this.progress.done.push({ id, ms: this.now() - started });
      return result;
    } catch (err) {
      // Several phases can run at once; the first failure is the one to show.
      this.progress.failed ??= { id, message: stopMessage(this.signal?.aborted ? this.signal.reason : err, id) };
      throw err;
    } finally {
      this.progress.running = this.progress.running.filter((r) => r !== id);
      this.touch();
    }
  }

  /** The final snapshot of a profiling that did not finish: the failed step is kept for the dashboard. */
  async failed(fallback: { id?: OnboardingPhaseId; message: string }): Promise<OnboardingProgress> {
    this.stop();
    this.progress.failed ??= fallback.id ? { id: fallback.id, message: fallback.message } : undefined;
    this.progress.endedAt = new Date(this.now()).toISOString();
    this.progress.updatedAt = this.progress.endedAt;
    await this.flush();
    return JSON.parse(JSON.stringify(this.progress)) as OnboardingProgress;
  }

  /** Races the work against the signal; the work's own late failure is swallowed so it cannot go unhandled. */
  private raced<T>(work: Promise<T>): Promise<T> {
    const signal = this.signal;
    if (!signal) return work;
    work.catch(() => undefined);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  private touch(): void {
    this.progress.updatedAt = new Date(this.now()).toISOString();
    this.save();
  }

  /**
   * Saves in order and never fails the onboarding: progress is only for display. The first save replaces what an earlier run left; later
   * ones are merged into the stored value, so a `cancelRequested` the API wrote in between is not lost.
   */
  private save(): void {
    const json = JSON.stringify(this.progress);
    const replace = this.first;
    this.first = false;
    this.queue = this.queue
      .then(async () => {
        if (replace) await this.prisma.project.update({ where: { id: this.projectId }, data: { onboardingProgress: JSON.parse(json) as Prisma.InputJsonValue } });
        else await this.prisma.$executeRaw`UPDATE "Project" SET "onboardingProgress" = COALESCE("onboardingProgress", '{}'::jsonb) || ${json}::jsonb WHERE "id" = ${this.projectId}`;
      })
      .catch(() => undefined);
  }

  flush(): Promise<unknown> {
    return this.queue;
  }
}

/** The facts as plain text for the agents. */
export function factsText(projectName: string, facts: OnboardingFacts): string {
  const out = [`Project: ${projectName}`, `Default branch: ${facts.github.defaultBranch}`, `Languages (most used first): ${facts.github.languages.join(', ') || 'unknown'}`];
  if (facts.jira) {
    out.push('', `Jira project: ${facts.jira.projectName}`, 'Issue types:', ...facts.jira.issueTypes.map((t) => `- ${t.name}${t.subtask ? ' (the sub-task type)' : ''}`));
    out.push('', 'Statuses per issue type (name [category]):', ...facts.jira.statusesByType.map((t) => `- ${t.type}: ${t.statuses.map((s) => `${s.name} [${s.category}]`).join(', ')}`));
    out.push('', `Labels already in use: ${facts.jira.labels.join(', ') || 'none'}`);
  }
  return out.join('\n');
}

/**
 * The advisor only proposes: code checks that every name it used exists in the facts, so a proposal never carries an invented
 * status or issue type.
 */
export function sanitizeAdvice(advice: OnboardAdvice | null, jira: JiraFacts | null): OnboardAdvice {
  const statuses = new Set((jira?.statusesByType ?? []).flatMap((t) => t.statuses.map((s) => s.name)));
  const known = (name: string | null | undefined) => (name && statuses.has(name) ? name : null);
  const fallback = defaultRouting(jira?.issueTypes ?? []);
  const routing: OnboardAdvice['issueTypeRouting'] = {};
  for (const t of jira?.issueTypes ?? []) {
    const proposed = advice?.issueTypeRouting[t.name];
    routing[t.name] = t.subtask ? 'ignore' : (proposed ?? fallback[t.name] ?? 'feature');
  }
  const statusMap: OnboardAdvice['statusMap'] = {};
  for (const [state, name] of Object.entries(advice?.statusMap ?? {})) statusMap[state as TicketStatus] = known(name as string | null);
  const label = advice?.intakeLabel && /^\S+$/.test(advice.intakeLabel) ? advice.intakeLabel : 'sdlc-agent';
  return { statusMap, approvalStatuses: { plan: known(advice?.approvalStatuses.plan), breakdown: known(advice?.approvalStatuses.breakdown) }, issueTypeRouting: routing, intakeLabel: label };
}

/** Why an agent run did not return data, in the words of the error policy. */
function failureOf(stage: string, r: Exclude<StageResult, { kind: 'done' }>): string {
  switch (r.kind) {
    case 'needs_input':
      return `The ${stage} agent needs an answer it cannot ask during onboarding: ${r.question}`;
    case 'out_of_credits':
      return describeError('CLAUDE_CREDITS');
    case 'claude_auth':
      return describeError('CLAUDE_AUTH');
    case 'turn_limit':
      return describeError('TURN_LIMIT', { agent: stage });
    case 'killed':
      return `The ${stage} agent was stopped.`;
    case 'failed':
      return r.reason;
  }
}

/**
 * Onboarding: for a project in `profiling`, code collects the facts, `repo-profiler` proposes the commands, code
 * checks them once, `onboarding-advisor` proposes the Jira mapping, and the result waits as a proposal for the person to review.
 * Nothing is applied to the project until it is confirmed.
 */
@Injectable()
export class OnboardingWorker implements Housekeeper {
  readonly name = 'onboarding';
  readonly intervalMs = 5000;
  private readonly logger = new Logger(OnboardingWorker.name);
  private running = false;
  /** How often profiling writes a sign of life and looks for a cancel. Tests make it short. */
  heartbeatMs = HEARTBEAT_MS;
  /** Replaces the deadline from the settings (whose minimum is 5 minutes). Only tests set it. */
  deadlineOverrideMs?: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WorkerConfig,
    private readonly mirrors: MirrorService,
    private readonly git: GitRunner,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    private readonly jira: JiraClients,
    private readonly runner: AgentRunner,
    private readonly verify: VerifyService,
    private readonly raiser: SupportRaiser,
    @Optional() private readonly access?: RepoAccessService,
  ) {}

  async check(): Promise<void> {
    if (this.running) return;
    const settings = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    // Onboarding runs Claude: it waits while the pipeline is paused for limits, like the assistant.
    if (settings?.pipelinePaused && settings.pausedReason !== 'manual') return;
    const project = await this.prisma.project.findFirst({ where: { onboardingStatus: 'profiling' }, orderBy: { createdAt: 'asc' } });
    if (!project) return;
    this.running = true;
    try {
      await this.onboard(project);
    } finally {
      this.running = false;
    }
  }

  /** Runs the whole flow for one project. A failure leaves the project in `draft` with the reason, never half-configured. */
  async onboard(project: Project): Promise<void> {
    const checkout = path.join(this.config.dataDir, 'onboarding', project.id);
    const global = await this.global();
    // The deadline starts when profiling really starts (not while it waited for the pipeline), and stops every step: containers and
    // git are killed, and a call that cannot be cancelled is given up on.
    const ctrl = new AbortController();
    const deadlineMs = this.deadlineOverrideMs ?? global.onboardingTimeoutMin * 60_000;
    const deadline = setTimeout(() => ctrl.abort(new OnboardingTimeoutError(global.onboardingTimeoutMin)), deadlineMs);
    let tracker: ProgressTracker | undefined;
    try {
      const hasJira = jiraOn(project.jiraMode) && Boolean(project.jiraProjectKey);
      const planned: OnboardingPhaseId[] = [...(this.access ? (['access'] as const) : []), 'facts', 'mirror', 'checkout', 'profile', 'install', 'typecheck', ...(hasJira ? (['advise'] as const) : [])];
      const t = new ProgressTracker(this.prisma, project.id, planned, { deadlineAt: new Date(Date.now() + deadlineMs), signal: ctrl.signal, heartbeatMs: this.heartbeatMs });
      tracker = t;
      t.start(() => this.stopIfCancelled(project.id, ctrl));

      // First of all: a project that works as the bot must have the sdlc-agent GitHub App installed on its repository.
      if (this.access) {
        await t.track('access', async () => {
          const access = await this.access!.ensure(project);
          if (!access.ok) throw new Error(access.message);
        });
      }
      const facts = await t.track('facts', () => this.collectFacts(project));
      const baseBranch = facts.github.defaultBranch;
      const text = factsText(project.name, facts);
      const settings = ProjectSettingsSchema.parse(project.settings);

      // The Jira advice needs only the facts, so it runs while the repository is cloned, profiled and checked.
      const advicePromise: Promise<OnboardAdvice | null> = facts.jira
        ? t.track('advise', (signal) => this.stage<OnboardAdvice>(project, 'onboardAdvise', { onboard: { facts: text } }, undefined, settings, global, signal))
        : Promise.resolve(null);

      const codeChain = async () => {
        await this.prisma.project.update({ where: { id: project.id }, data: { baseBranch, mirrorStatus: 'pending', mirrorError: null } });
        await t.track('mirror', async () => {
          await this.mirrors.clone(await this.prisma.project.findUniqueOrThrow({ where: { id: project.id } }), { signal: ctrl.signal });
          const cloned = await this.prisma.project.findUniqueOrThrow({ where: { id: project.id } });
          if (cloned.mirrorStatus !== 'ok') throw new Error(cloned.mirrorError ?? 'The repository could not be cloned');
        });
        await t.track('checkout', async () => {
          await rm(checkout, { recursive: true, force: true });
          await mkdir(path.dirname(checkout), { recursive: true });
          await this.git.run(['clone', '--depth', '1', '--branch', baseBranch, '--', this.config.mirrorPath(project.id), checkout], { timeoutMs: CHECKOUT_TIMEOUT_MS, signal: ctrl.signal });
          await makeWritableForAgent(checkout);
        });
        const profile = await t.track('profile', (signal) => this.stage<RepoProfile>(project, 'repoProfile', { onboard: { facts: text } }, checkout, settings, global, signal));
        const installCheck = await t.track('install', (signal) => this.check1(project, 'install', profile.installCmd, checkout, global.verifyTimeoutSec, signal));
        const typecheckCheck = installCheck && !installCheck.ok ? null : await t.track('typecheck', (signal) => this.check1(project, 'typecheck', profile.typecheckCmd, checkout, global.verifyTimeoutSec, signal));
        return { profile, installCheck, typecheckCheck };
      };
      // Both are awaited to the end even when one fails: no agent keeps running after the onboarding was reported as failed.
      const [code, adviceResult] = await Promise.allSettled([codeChain(), advicePromise]);
      if (code.status === 'rejected') throw code.reason;
      if (adviceResult.status === 'rejected') throw adviceResult.reason;
      const { profile, installCheck, typecheckCheck } = code.value;
      const advice = adviceResult.value;
      t.stop();
      await t.flush();

      const proposal: OnboardingProposal = {
        facts,
        profile: { ...profile, baseBranch, installCheck, typecheckCheck },
        advice: sanitizeAdvice(advice, facts.jira),
        accepted: {},
        createdAt: new Date().toISOString(),
        timings: t.timings(),
      };
      await this.prisma.project.update({ where: { id: project.id }, data: { onboardingStatus: 'proposed', onboardingError: null, onboardingProgress: Prisma.DbNull, onboardingProposal: proposal as unknown as Prisma.InputJsonValue } });
      await this.raiser.raise({
        kind: 'onboarding', projectId: project.id, stage: 'onboarding', dedupeKey: `onboarding:${project.id}`,
        title: `Review the setup of ${project.name}`,
        body: `The proposal for **${project.name}** is ready: commands, Jira statuses, issue types, and the intake label. Review each part, then confirm. Nothing is used until you do.`,
      });
      await logEvent(this.prisma, events.note({ source: 'system', type: 'system', message: `Onboarding proposal for ${project.name} is ready for review` }));
    } catch (err) {
      // Stopped on purpose (deadline, cancel): say so, in place of whatever a killed step reported.
      const message = ctrl.signal.aborted ? stopMessage(ctrl.signal.reason, tracker?.failedPhase() ?? null) : (err instanceof Error ? err.message : String(err)).slice(0, 500);
      this.logger.warn(`Onboarding of "${project.name}" failed: ${message}`);
      // The failed step stays on the project, so the dashboard can show where it went wrong.
      const progress = tracker ? await tracker.failed({ message }) : null;
      await this.prisma.project.update({
        where: { id: project.id },
        data: { onboardingStatus: 'draft', onboardingError: message, onboardingProgress: progress ? (progress as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
      });
      await logEvent(this.prisma, events.note({ source: 'system', type: 'error', level: 'error', message: `Onboarding of ${project.name} failed: ${message}` }));
    } finally {
      clearTimeout(deadline);
      tracker?.stop();
      ctrl.abort(); // nothing may keep running after the onboarding was reported as done or failed
      await rm(checkout, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Step 1: code only, no AI. */
  async collectFacts(project: Project): Promise<OnboardingFacts> {
    let github;
    try {
      github = await this.github.repoFacts(parseRepo(project.repoUrl));
    } catch (err) {
      throw new Error(`GitHub: ${err instanceof Error ? err.message : String(err)}. Check the GitHub token in Settings → Connections and the repository URL.`, { cause: err });
    }
    let jira: JiraFacts | null = null;
    if (jiraOn(project.jiraMode) && project.jiraProjectKey) {
      try {
        jira = await (await this.jira.forMode(project.jiraMode)).projectFacts(project.jiraProjectKey);
      } catch (err) {
        if (err instanceof JiraNotConfiguredError) throw new Error(`${err.message}. Or onboard without a Jira project key.`, { cause: err });
        throw new Error(`Jira: ${err instanceof Error ? err.message : String(err)}. Check the project key and the Jira credential.`, { cause: err });
      }
    }
    return { github, jira };
  }

  private async stage<T>(project: Project, stage: 'repoProfile' | 'onboardAdvise', inputs: { onboard: { facts: string } }, workspacePath: string | undefined, settings: ReturnType<typeof ProjectSettingsSchema.parse>, global: typeof DEFAULT_GLOBAL_SETTINGS, signal?: AbortSignal): Promise<T> {
    const result = await this.runner.run({
      projectId: project.id,
      stage,
      stack: project.stack,
      claudeMdMode: 'theirs',
      modelAlias: settings.stages[stage].model as ModelAlias,
      modelAliases: global.modelAliases,
      maxTurns: settings.stages[stage].maxTurns,
      stageTimeoutMin: global.stageTimeoutMin,
      inputs,
      workspacePath,
      signal,
    });
    if (result.kind !== 'done') throw new Error(failureOf(stage, result));
    return (result.envelope as StageEnvelope).data as T;
  }

  /** Runs one command once in an agent container and records whether it passed. An empty command is skipped. */
  private async check1(project: Project, what: string, command: string, workspace: string, timeoutSec: number, signal?: AbortSignal): Promise<CommandCheck | null> {
    if (!command.trim()) return null;
    const r = await this.verify.runCmd({ name: `sdlc-onboard-${what}-${project.id.slice(0, 8)}`, workspace, cmd: command, timeoutSec, signal });
    return { command, ok: r.ok, tail: r.timedOut ? `Timed out after ${timeoutSec} seconds` : r.tail };
  }

  /** At each heartbeat: has the person cancelled? Then the whole run is stopped. */
  private async stopIfCancelled(projectId: string, ctrl: AbortController): Promise<void> {
    if (ctrl.signal.aborted) return;
    const row = await this.prisma.project.findUnique({ where: { id: projectId }, select: { onboardingProgress: true } });
    if ((row?.onboardingProgress as { cancelRequested?: boolean } | null)?.cancelRequested) ctrl.abort(new OnboardingCancelledError());
  }

  private async global() {
    const row = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    if (!row) return DEFAULT_GLOBAL_SETTINGS;
    return GlobalSettingsSchema.parse({ stageTimeoutMin: row.stageTimeoutMin, verifyTimeoutSec: row.verifyTimeoutSec, onboardingTimeoutMin: row.onboardingTimeoutMin, modelAliases: row.modelAliases });
  }
}
