import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ProjectSettingsSchema, type TicketType } from '@sdlc/shared';
import { jiraMarker } from '../../jira/jira-client';
import { GitHubAuth } from '../github/github-auth.service';
import { JiraClients } from '../../jira/jira-clients';
import { CredentialsService } from '../../credentials/credentials.service';
import { PrismaService } from '../../prisma/prisma.service';
import { type CmdResult, VerifyService } from '../verify/verify.service';
import { WorkerConfig } from '../worker-config';
import { readNoFollowSync, readTextNoFollowSync, writeTextNoFollowSync } from '../fs/safe-fs';
import { assertSafeKey, branchName } from './branch';
import { PolicyError, withRetry, type RetryOptions } from '../common/retry-policy';
import { type CommitResult, PushRejectedError, commitAll, pushBranch } from './commit';
import { setPhase } from '../status/worker-status';
import { GitRunner } from './git-runner';
import { makeWritableForAgent, prepareWorkspace } from './workspace';
import { revertRange, type RevertResult } from './revert';

export interface WorkspaceResult {
  path: string;
  branch: string;
  created: boolean;
  /** Null when the install was not needed (an existing workspace with dependencies) or the command is empty. */
  install: CmdResult | null;
  /** Why no install ran, when that is worth telling the developer. */
  installSkipped?: 'empty_command' | 'already_installed';
}

const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MANIFESTS = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'];

/** A hash of package.json and the lockfiles: when it changes, dependencies must be installed again. */
export function manifestHash(workspace: string): string {
  const hash = createHash('sha256');
  for (const f of MANIFESTS) {
    const content = readNoFollowSync(workspace, f, MAX_MANIFEST_BYTES); // lockfiles can be large; symlinks are never followed (S3)
    if (content) hash.update(`${f}\0`).update(content);
  }
  return hash.digest('hex');
}

const HASH_FILE = '.git/sdlc-install-hash'; // inside .git: never part of a commit
export const installedHash = (workspace: string): string | null => readTextNoFollowSync(workspace, HASH_FILE)?.trim() ?? null;
export const recordInstalled = (workspace: string): void => writeTextNoFollowSync(workspace, HASH_FILE, manifestHash(workspace));

/** Prepares a ticket's workspace, installs its dependencies, and records the branch. */
@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WorkerConfig,
    private readonly git: GitRunner,
    private readonly verify: VerifyService,
    private readonly creds: CredentialsService,
    @Optional() private readonly jira?: JiraClients,
    @Optional() private readonly auth?: GitHubAuth,
  ) {}

  /** Waits and scale of the retry policy; tests shrink them. */
  retry: RetryOptions = {};
  async prepare(ticketId: string): Promise<WorkspaceResult> {
    const ticket = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { project: true } });
    const { project } = ticket;
    if (project.mirrorStatus !== 'ok') throw new Error(`The repository mirror of "${project.name}" is not ready`);
    assertSafeKey(ticket.key);

    const branch = branchName({ key: ticket.key, title: ticket.title, type: ticket.type as TicketType });
    const prepared = await prepareWorkspace(this.git, {
      mirrorPath: this.config.mirrorPath(project.id),
      repoUrl: project.repoUrl,
      baseBranch: project.baseBranch,
      workspacePath: this.config.workspacePath(project.id, ticket.key),
      branch,
    });
    if (ticket.branch !== branch) await this.prisma.ticket.update({ where: { id: ticketId }, data: { branch } });
    await makeWritableForAgent(prepared.path);

    const result: WorkspaceResult = { ...prepared, install: null };
    const installCmd = project.installCmd.trim();
    if (installCmd === '') {
      result.installSkipped = 'empty_command';
      await this.prisma.event.create({ data: { ticketId, type: 'git', message: 'The install command is empty: dependencies were not installed' } });
      return result;
    }
    // node_modules stays inside the workspace, so an existing workspace that has it needs no new install.
    if (!prepared.created && existsSync(path.join(prepared.path, 'node_modules'))) {
      result.installSkipped = 'already_installed';
      return result;
    }
    const settings = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    // The install can take minutes and is not a recorded stage run: say what the worker is doing so the dashboard does not look idle.
    await setPhase(this.prisma, 'stage', `Installing dependencies for ${ticket.key} (${installCmd}, up to ${Math.round((settings?.verifyTimeoutSec ?? 600) / 60)} min)`);
    result.install = await this.verify.runCmd({ name: `sdlc-install-${ticket.key}-${Date.now()}`, workspace: prepared.path, cmd: installCmd, timeoutSec: settings?.verifyTimeoutSec ?? 600 });
    if (result.install.ok) recordInstalled(prepared.path);
    if (!result.install.ok) this.logger.warn(`Install failed for ${ticket.key}: ${result.install.tail.split('\n').slice(-3).join(' | ')}`);
    await makeWritableForAgent(prepared.path); // the install created files as the agent user
    return result;
  }

  /** `Git.commit(ticket, message)`: commits the workspace as the configured identity; hooks never run. */
  async commit(ticketId: string, message: string, opts: { paths?: readonly string[] } = {}): Promise<CommitResult> {
    const ticket = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    const result = await commitAll(this.git, this.config.workspacePath(ticket.projectId, ticket.key), message, await this.identity(ticket.projectId), opts);
    if (result.committed) {
      await this.prisma.event.create({ data: { ticketId, type: 'git', message: `Committed ${result.sha.slice(0, 8)}: ${message.split('\n')[0]}`.slice(0, 500) } });
      // The stage that made this commit ends here: its range is startSha..endSha.
      const run = await this.prisma.stageRun.findFirst({ where: { ticketId, startSha: { not: null }, endedAt: { not: null } }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] });
      if (run) await this.prisma.stageRun.update({ where: { id: run.id }, data: { endSha: result.sha } }).catch(() => undefined);
    }
    return result;
  }

  /** The identity commits are made as: the bot's for a project that works as the bot, otherwise the one set in Settings. */
  async identity(projectId?: string): Promise<{ name: string; email: string }> {
    if (projectId && this.auth) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { repoUrl: true } });
      const repo = project ? /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(project.repoUrl) : null;
      if (repo) return this.auth.identityFor(`${repo[1]}/${repo[2]}`);
    }
    const c = await this.creds.resolve();
    return { name: c.git_author_name, email: c.git_author_email };
  }

  /** Removes work with a revert commit: history is append-only and nothing is ever force-pushed. */
  async revertRange(ticketId: string, range: string, message: string): Promise<RevertResult> {
    const ticket = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    const result = await revertRange(this.git, this.config.workspacePath(ticket.projectId, ticket.key), range, message, await this.identity(ticket.projectId));
    if (result.status === 'reverted') await this.prisma.event.create({ data: { ticketId, type: 'git', message: `Reverted ${result.commits} commit${result.commits === 1 ? '' : 's'} (${result.sha.slice(0, 8)}): ${message.split('\n')[0]}`.slice(0, 500) } });
    return result;
  }

  /**
   * `Git.push(ticket)`. A normal push is never forced. When the remote branch only holds the pipeline's own earlier attempt at this ticket
   * (a rerun rebuilt the branch), that superseded work is replaced under a lease (see `pushBranch`); the decision is recorded and written to Jira.
   * Anything else throws PushRejectedError, which puts the ticket on hold (`needs_help`).
   */
  async push(ticketId: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    if (!ticket.branch) throw new Error(`${ticket.key} has no branch yet`);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: ticket.projectId } });
    const branch = ticket.branch;
    // A failed push is retried by the GIT_ERROR policy (3 times, 1, 4 and 10 minutes). A rejected push is never retried: the remote moved on.
    const result = await withRetry('GIT_ERROR', () => pushBranch(this.git, this.config.workspacePath(ticket.projectId, ticket.key), branch, project.repoUrl, this.config.pushUrlPrefixes, { knownShas: ticket.pushedShas, baseBranch: project.baseBranch }), {
      ...this.retry,
      isFinal: (e) => e instanceof PushRejectedError,
      onRetry: ({ attempt, message }) => this.logger.warn(`Push of ${branch} failed (attempt ${attempt}): ${message}`),
    }).catch((e: unknown) => {
      throw e instanceof PolicyError && e.cause instanceof PushRejectedError ? e.cause : e;
    });
    // Remember what was pushed: a later rerun may replace exactly these commits, and nothing else.
    if (result.pushed.length > 0) await this.prisma.ticket.update({ where: { id: ticketId }, data: { pushedShas: [...new Set([...ticket.pushedShas, ...result.pushed])] } });
    if (result.replaced.length > 0) await this.announceReplaced(ticket, project, branch, result.replaced);
    await this.prisma.event.create({ data: { ticketId, type: 'git', message: `Pushed ${ticket.branch}` } });
  }

  /** Records the replacement as a decision and writes it on the Jira ticket, so the team can see what was overwritten and why. */
  private async announceReplaced(ticket: { id: string; key: string; source: string; externalKey: string | null }, project: { jiraMode: string; settings: unknown }, branch: string, shas: string[]): Promise<void> {
    const short = shas.map((s) => s.slice(0, 8)).join(', ');
    const reason = `GitHub still held ${shas.length} earlier commit${shas.length === 1 ? '' : 's'} of this ticket's branch (${short}), all made by the pipeline, from an attempt that a rerun replaced. They were replaced with the current work, under a lease that fails if anyone pushed in the meantime.`;
    await this.prisma.orchestratorDecision.create({ data: { ticketId: ticket.id, point: 'push_replace', legalMoves: [{ kind: 'push', to: 'push' }, { kind: 'replace_own_commits', to: 'push' }] as never, chosen: 'replace_own_commits push', reason, fallbackUsed: false } });
    await this.prisma.event.create({ data: { ticketId: ticket.id, type: 'git', level: 'warn', source: 'git', message: `Replaced ${shas.length} earlier commit(s) of ${branch} on the remote (${short}): ${reason}`.slice(0, 500) } });
    try {
      if (!this.jira || ticket.source !== 'jira' || !ticket.externalKey || project.jiraMode !== 'rest' || !ProjectSettingsSchema.parse(project.settings).jiraWriteBack.comments) return;
      await (await this.jira.forRest()).comment(ticket.externalKey, `sdlc-agent decided (push): replace its own earlier commits on ${branch}.\nWhy: ${reason}`, jiraMarker(ticket.key, 'decision-push', `${Date.now()}`));
    } catch (err) {
      this.logger.warn(`Could not write the push decision to Jira for ${ticket.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
