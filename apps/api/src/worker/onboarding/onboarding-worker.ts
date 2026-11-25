import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DEFAULT_GLOBAL_SETTINGS, GlobalSettingsSchema, ProjectSettingsSchema, defaultRouting, describeError, events,
  type CommandCheck, type ConfluenceSpace, type OnboardingPhaseId, type OnboardingProgress, type JiraFacts, type ModelAlias, type OnboardAdvice, type OnboardingFacts, type OnboardingProposal, type RepoProfile, type StageEnvelope, type TicketStatus, jiraOn } from '@sdlc/shared';
import { ConfluenceClients } from '../../confluence/confluence-clients';
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

/**
 * Writes where profiling is (`Project.onboardingProgress`) as phases start and end, so the dashboard can show them, and keeps how long each
 * took. Phases may overlap: the Jira advice does not wait for the code profiling.
 */
export class ProgressTracker {
  private readonly progress: OnboardingProgress;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectId: string,
    planned: OnboardingPhaseId[],
    private readonly now: () => number = () => Date.now(),
  ) {
    this.progress = { startedAt: new Date(now()).toISOString(), planned, running: [], done: [] };
  }

  /** Phase durations so far, in milliseconds. */
  timings(): Record<string, number> {
    return Object.fromEntries(this.progress.done.map((d) => [d.id, d.ms]));
  }

  async track<T>(id: OnboardingPhaseId, fn: () => Promise<T>): Promise<T> {
    const started = this.now();
    this.progress.running.push(id);
    this.save();
    try {
      return await fn();
    } finally {
      this.progress.running = this.progress.running.filter((r) => r !== id);
      this.progress.done.push({ id, ms: this.now() - started });
      this.save();
    }
  }

  /** Saves in order and never fails the onboarding: progress is only for display. */
  private save(): void {
    const snapshot = JSON.parse(JSON.stringify(this.progress)) as Prisma.InputJsonValue;
    this.queue = this.queue.then(() => this.prisma.project.update({ where: { id: this.projectId }, data: { onboardingProgress: snapshot } })).catch(() => undefined);
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
  if (facts.confluence.spaces) out.push('', 'Confluence spaces the person can write to:', ...(facts.confluence.spaces.length ? facts.confluence.spaces.map((s) => `- ${s.key}: ${s.name}`) : ['- none']));
  else out.push('', `Confluence is not available: ${facts.confluence.reason}`);
  return out.join('\n');
}

/**
 * The advisor only proposes: code checks that every name it used exists in the facts, so a proposal never carries an invented
 * status, issue type or space.
 */
export function sanitizeAdvice(advice: OnboardAdvice | null, jira: JiraFacts | null, spaces: ConfluenceSpace[] | null): OnboardAdvice {
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
  const space = advice?.confluenceSpaceKey && spaces?.some((s) => s.key === advice.confluenceSpaceKey) ? advice.confluenceSpaceKey : null;
  return { statusMap, approvalStatuses: { plan: known(advice?.approvalStatuses.plan), breakdown: known(advice?.approvalStatuses.breakdown) }, issueTypeRouting: routing, intakeLabel: label, confluenceSpaceKey: space };
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WorkerConfig,
    private readonly mirrors: MirrorService,
    private readonly git: GitRunner,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    private readonly jira: JiraClients,
    private readonly confluence: ConfluenceClients,
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
    try {
      const hasJira = jiraOn(project.jiraMode) && Boolean(project.jiraProjectKey);
      const planned: OnboardingPhaseId[] = [...(this.access ? (['access'] as const) : []), 'facts', 'mirror', 'checkout', 'profile', 'install', 'typecheck', ...(hasJira ? (['advise'] as const) : [])];
      const t = new ProgressTracker(this.prisma, project.id, planned);

      // First of all: a project that works as the bot must have the sdlc-agent GitHub App installed on its repository.
      if (this.access) {
        const access = await t.track('access', () => this.access!.ensure(project));
        if (!access.ok) throw new Error(access.message);
      }
      const facts = await t.track('facts', () => this.collectFacts(project));
      const baseBranch = facts.github.defaultBranch;
      const text = factsText(project.name, facts);
      const global = await this.global();
      const settings = ProjectSettingsSchema.parse(project.settings);

      // The Jira advice needs only the facts, so it runs while the repository is cloned, profiled and checked.
      const advicePromise: Promise<OnboardAdvice | null> = facts.jira
        ? t.track('advise', () => this.stage<OnboardAdvice>(project, 'onboardAdvise', { onboard: { facts: text } }, undefined, settings, global))
        : Promise.resolve(null);

      const codeChain = async () => {
        await this.prisma.project.update({ where: { id: project.id }, data: { baseBranch, mirrorStatus: 'pending', mirrorError: null } });
        await t.track('mirror', async () => {
          await this.mirrors.clone(await this.prisma.project.findUniqueOrThrow({ where: { id: project.id } }));
          const cloned = await this.prisma.project.findUniqueOrThrow({ where: { id: project.id } });
          if (cloned.mirrorStatus !== 'ok') throw new Error(cloned.mirrorError ?? 'The repository could not be cloned');
        });
        await t.track('checkout', async () => {
          await rm(checkout, { recursive: true, force: true });
          await mkdir(path.dirname(checkout), { recursive: true });
          await this.git.run(['clone', '--depth', '1', '--branch', baseBranch, '--', this.config.mirrorPath(project.id), checkout], { timeoutMs: CHECKOUT_TIMEOUT_MS });
          await makeWritableForAgent(checkout);
        });
        const profile = await t.track('profile', () => this.stage<RepoProfile>(project, 'repoProfile', { onboard: { facts: text } }, checkout, settings, global));
        const installCheck = await t.track('install', () => this.check1(project, 'install', profile.installCmd, checkout, global.verifyTimeoutSec));
        const typecheckCheck = installCheck && !installCheck.ok ? null : await t.track('typecheck', () => this.check1(project, 'typecheck', profile.typecheckCmd, checkout, global.verifyTimeoutSec));
        return { profile, installCheck, typecheckCheck };
      };
      // Both are awaited to the end even when one fails: no agent keeps running after the onboarding was reported as failed.
      const [code, adviceResult] = await Promise.allSettled([codeChain(), advicePromise]);
      if (code.status === 'rejected') throw code.reason;
      if (adviceResult.status === 'rejected') throw adviceResult.reason;
      const { profile, installCheck, typecheckCheck } = code.value;
      const advice = adviceResult.value;
      await t.flush();

      const proposal: OnboardingProposal = {
        facts,
        profile: { ...profile, baseBranch, installCheck, typecheckCheck },
        advice: sanitizeAdvice(advice, facts.jira, facts.confluence.spaces),
        accepted: {},
        createdAt: new Date().toISOString(),
        timings: t.timings(),
      };
      await this.prisma.project.update({ where: { id: project.id }, data: { onboardingStatus: 'proposed', onboardingError: null, onboardingProgress: Prisma.DbNull, onboardingProposal: proposal as unknown as Prisma.InputJsonValue } });
      await this.raiser.raise({
        kind: 'onboarding', projectId: project.id, stage: 'onboarding', dedupeKey: `onboarding:${project.id}`,
        title: `Review the setup of ${project.name}`,
        body: `The proposal for **${project.name}** is ready: commands, Jira statuses, issue types, the intake label and the Confluence space. Review each part, then confirm. Nothing is used until you do.`,
      });
      await logEvent(this.prisma, events.note({ source: 'system', type: 'system', message: `Onboarding proposal for ${project.name} is ready for review` }));
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      this.logger.warn(`Onboarding of "${project.name}" failed: ${message}`);
      await this.prisma.project.update({ where: { id: project.id }, data: { onboardingStatus: 'draft', onboardingError: message, onboardingProgress: Prisma.DbNull } });
      await logEvent(this.prisma, events.note({ source: 'system', type: 'error', level: 'error', message: `Onboarding of ${project.name} failed: ${message}` }));
    } finally {
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
    let confluence: OnboardingFacts['confluence'];
    try {
      confluence = { spaces: await (await this.confluence.forRest()).listWritableSpaces() };
    } catch (err) {
      confluence = { spaces: null, reason: err instanceof Error ? err.message : String(err) };
    }
    return { github, jira, confluence };
  }

  private async stage<T>(project: Project, stage: 'repoProfile' | 'onboardAdvise', inputs: { onboard: { facts: string } }, workspacePath: string | undefined, settings: ReturnType<typeof ProjectSettingsSchema.parse>, global: typeof DEFAULT_GLOBAL_SETTINGS): Promise<T> {
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
    });
    if (result.kind !== 'done') throw new Error(failureOf(stage, result));
    return (result.envelope as StageEnvelope).data as T;
  }

  /** Runs one command once in an agent container and records whether it passed. An empty command is skipped. */
  private async check1(project: Project, what: string, command: string, workspace: string, timeoutSec: number): Promise<CommandCheck | null> {
    if (!command.trim()) return null;
    const r = await this.verify.runCmd({ name: `sdlc-onboard-${what}-${project.id.slice(0, 8)}`, workspace, cmd: command, timeoutSec });
    return { command, ok: r.ok, tail: r.timedOut ? `Timed out after ${timeoutSec} seconds` : r.tail };
  }

  private async global() {
    const row = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    if (!row) return DEFAULT_GLOBAL_SETTINGS;
    return GlobalSettingsSchema.parse({ stageTimeoutMin: row.stageTimeoutMin, verifyTimeoutSec: row.verifyTimeoutSec, modelAliases: row.modelAliases });
  }
}
