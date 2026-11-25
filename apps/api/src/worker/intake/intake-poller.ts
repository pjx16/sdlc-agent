import { Injectable, Logger } from '@nestjs/common';
import { ProjectSettingsSchema, kindForIssueType, kindOfType, mapJiraIssueType } from '@sdlc/shared';
import { JiraUnavailableError, type JiraTicket } from '../../jira/jira-client';
import { JiraClients, JiraNotConfiguredError } from '../../jira/jira-clients';
import { Prisma, type Project } from '../../generated/prisma/client';
import { SupportRaiser, isAuthFailure } from '../../support/support-raiser';
import { PrismaService } from '../../prisma/prisma.service';
import { recordIntake } from '../status/worker-status';

/** When Jira stays unreachable after the client's retries, intake pauses for this long; the pipeline does not pause. */
export const INTAKE_BACKOFF_MS = 10 * 60 * 1000;

export interface PollResult {
  /** Why nothing was polled, if so. */
  skipped?: 'intake_paused' | 'backoff' | 'source_off';
  projects: number;
  created: number;
  /** Tickets that were already stored. */
  duplicates: number;
  errors: { project: string; message: string }[];
  /** Jira sub-tasks that were left out: they are work items of a ticket, never tickets themselves. */
  subtasksIgnored: number;
}

/** The Jira modes intake polls. Each has its own backoff and status row: one transport being down must not stop the others. */
export const POLLED_JIRA_MODES = ['rest', 'mcp', 'connector'] as const;
export type PolledJiraMode = (typeof POLLED_JIRA_MODES)[number];

/**
 * Jira intake (F3): runs each project's JQL and stores new tickets as NEW, exactly once per (projectId, externalKey). REST and Rovo MCP
 * projects are polled on every call; connector projects run a Claude agent per poll, so each is polled at most every
 * `jiraConnector.pollIntervalMin` minutes.
 */
@Injectable()
export class IntakePoller {
  private readonly logger = new Logger(IntakePoller.name);
  private readonly backoffUntil = new Map<PolledJiraMode, number>();
  private readonly lastConnectorPoll = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: JiraClients,
    private readonly now: () => number = () => Date.now(),
    private readonly raiser?: SupportRaiser,
  ) {}

  /** Milliseconds of intake backoff still to run for a mode (0 when polling is allowed). */
  backoffRemainingMs(mode: PolledJiraMode = 'rest'): number {
    return Math.max(0, (this.backoffUntil.get(mode) ?? 0) - this.now());
  }

  /** Polls one mode, or every mode when none is given (the results are added up). */
  async poll(mode?: PolledJiraMode, only?: (project: Project) => boolean): Promise<PollResult> {
    if (mode) return this.pollMode(mode, only);
    const total: PollResult = { projects: 0, created: 0, duplicates: 0, errors: [], subtasksIgnored: 0 };
    for (const m of POLLED_JIRA_MODES) {
      const r = await this.pollMode(m, only);
      total.projects += r.projects;
      total.created += r.created;
      total.duplicates += r.duplicates;
      total.subtasksIgnored += r.subtasksIgnored;
      total.errors.push(...r.errors);
      if (m === 'rest' && r.skipped) total.skipped = r.skipped;
    }
    return total;
  }

  private async pollMode(mode: PolledJiraMode, only?: (project: Project) => boolean): Promise<PollResult> {
    const result: PollResult = { projects: 0, created: 0, duplicates: 0, errors: [], subtasksIgnored: 0 };

    // Pausing intake and pausing the pipeline are separate switches: only the intake switch stops polling.
    const settings = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    if (settings?.intakePaused) return this.finish(mode, { ...result, skipped: 'intake_paused' });
    // One source can be switched off on its own: the other sources keep going.
    if (settings && !settings.intakeJiraEnabled) return this.finish(mode, { ...result, skipped: 'source_off' });
    if (this.backoffRemainingMs(mode) > 0) return this.finish(mode, { ...result, skipped: 'backoff' });

    // A project accepts tickets only when its mirror is ready (F2).
    const projects = await this.prisma.project.findMany({ where: { enabled: true, onboardingStatus: 'confirmed', jiraMode: mode, mirrorStatus: 'ok' }, orderBy: { createdAt: 'asc' } });
    for (const project of projects.filter((p) => (!only || only(p)) && this.due(mode, p))) {
      result.projects++;
      try {
        const tickets = await (await this.clients.forMode(mode)).searchTickets(project);
        if (mode === 'connector') this.lastConnectorPoll.set(project.id, this.now());
        for (const jt of tickets) {
          if (await this.isSubtask(jt)) {
            result.subtasksIgnored++;
            continue;
          }
          const outcome = await this.store(project, jt);
          if (outcome === 'created') result.created++;
          else if (outcome === 'duplicate') result.duplicates++;
          else if (outcome === 'ignored') continue;
          else result.errors.push({ project: project.name, message: `Jira issue ${jt.key} collides with a pasted ticket key in "${project.name}"` });
        }
      } catch (err) {
        if (err instanceof JiraUnavailableError) {
          this.backoffUntil.set(mode, this.now() + INTAKE_BACKOFF_MS);
          result.errors.push({ project: project.name, message: err.message });
          this.logger.warn(`${err.message}; ${mode} intake paused for 10 minutes`);
          await this.prisma.event.create({ data: { type: 'jira', message: `Jira (${mode}) is unavailable: intake paused for 10 minutes` } }).catch(() => undefined);
          break; // every project in this mode talks to the same Jira
        }
        if (mode === 'connector') this.lastConnectorPoll.set(project.id, this.now()); // a failing agent must not run again on every tick
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({ project: project.name, message });
        if (!(err instanceof JiraNotConfiguredError)) this.logger.warn(`Polling "${project.name}" failed: ${message}`);
        if (isAuthFailure(err)) await this.raiser?.credentialFailed('jira', `Jira refused the credential while polling "${project.name}": ${message}`).catch(() => undefined);
      }
    }
    return this.finish(mode, result);
  }

  /** Connector projects wait out their poll interval; the other modes are always due. */
  private due(mode: PolledJiraMode, project: Project): boolean {
    if (mode !== 'connector') return true;
    const last = this.lastConnectorPoll.get(project.id);
    return last === undefined || this.now() - last >= ProjectSettingsSchema.parse(project.settings).jiraConnector.pollIntervalMin * 60_000;
  }

  /** Remembers the outcome of this poll for the dashboard, then returns it. Modes nobody uses leave no status row. */
  private async finish(mode: PolledJiraMode, result: PollResult): Promise<PollResult> {
    const waiting = await this.prisma.project.count({ where: { enabled: true, onboardingStatus: 'confirmed', jiraMode: mode, mirrorStatus: { not: 'ok' } } }).catch(() => 0);
    if (mode !== 'rest' && result.projects === 0 && waiting === 0 && result.errors.length === 0) {
      const used = await this.prisma.project.count({ where: { enabled: true, onboardingStatus: 'confirmed', jiraMode: mode } }).catch(() => 0);
      if (used === 0) return result;
    }
    await recordIntake(this.prisma, {
      mode,
      projects: result.projects,
      waiting,
      created: result.created,
      seen: result.created + result.duplicates,
      error: result.errors[0]?.message,
      skipped: result.skipped,
    });
    return result;
  }

  /**
   * Sub-tasks are never tickets. The pipeline breaks a ticket into subtasks and publishes them to Jira as sub-tasks for visibility; the
   * implement stage works through them one by one, so intake must not take them back as new tickets. A Jira issue is a sub-task when
   * its type says so, when it has a parent, or when it is one the pipeline created itself.
   */
  private async isSubtask(jt: JiraTicket): Promise<boolean> {
    if (jt.isSubtask || /^sub[-\s]?tasks?$/i.test(jt.issuetype.trim())) return true;
    return (await this.prisma.subtask.count({ where: { externalKey: jt.key } })) > 0;
  }

  private async store(project: Project, jt: JiraTicket): Promise<'created' | 'duplicate' | 'collision' | 'ignored'> {
    // The project's routing says what each issue type becomes; a type routed to `ignore` is never picked up.
    const routing = ProjectSettingsSchema.parse(project.settings).jiraIssueTypeRouting;
    const kind = kindForIssueType(routing, jt.issuetype, kindOfType(mapJiraIssueType(jt.issuetype)));
    if (kind === 'ignore') return 'ignored';
    try {
      const ticket = await this.prisma.ticket.create({
        data: {
          projectId: project.id,
          key: jt.key,
          externalKey: jt.key,
          source: 'jira',
          type: mapJiraIssueType(jt.issuetype),
          kind,
          title: jt.summary,
          body: jt.description,
          labels: jt.labels,
          status: 'NEW',
        },
      });
      await this.prisma.event.create({ data: { ticketId: ticket.id, type: 'intake', message: `${jt.key} picked up from Jira` } });
      return 'created';
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      // Either this Jira issue is already stored (the normal case for every poll after the first)...
      if (await this.prisma.ticket.findFirst({ where: { projectId: project.id, externalKey: jt.key }, select: { id: true } })) return 'duplicate';
      // ...or a pasted ticket already uses this key (a local prefix equal to the Jira project key). Do not lose it silently.
      await this.prisma.event.create({ data: { type: 'error', message: `Jira issue ${jt.key} was skipped: a pasted ticket in "${project.name}" already uses that key` } }).catch(() => undefined);
      return 'collision';
    }
  }
}
