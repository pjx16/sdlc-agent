import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Project } from '../../generated/prisma/client';
import { CredentialsService } from '../../credentials/credentials.service';
import { GitHubAuth } from '../github/github-auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkerConfig } from '../worker-config';
import { GitRunner } from './git-runner';
import { checkRepoAccess } from './repo-access';

/** A message already written for the user: shown as it is. */
class RepoAccessError extends Error {}

const CLONE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;

/** Bare mirrors of project repositories. */
@Injectable()
export class MirrorService {
  private readonly logger = new Logger(MirrorService.name);

  private readonly runner: GitRunner;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WorkerConfig,
    private readonly creds: CredentialsService,
    @Optional() private readonly auth?: GitHubAuth,
  ) {
    this.runner = new GitRunner({ token: (ctx) => this.tokenFor(ctx) });
  }

  /** The token for a call: the project's own (the bot's through the broker, or the personal one). */
  private async tokenFor(ctx: { cwd?: string; args: readonly string[] }): Promise<string> {
    return this.auth ? this.auth.tokenFor(ctx) : ((await this.creds.resolve()).github_token ?? '');
  }

  /** Clones the mirror for a pending project, checks the base branch, and records ok or failed. */
  async clone(project: Project): Promise<void> {
    const dir = this.config.mirrorPath(project.id);
    let error: string | null = null;
    try {
      await rm(dir, { recursive: true, force: true });
      await mkdir(path.dirname(dir), { recursive: true });
      // Ask GitHub first: a token without access to this repository would otherwise only produce a raw git 403.
      const denied = await checkRepoAccess(project.repoUrl, await this.tokenFor({ args: [project.repoUrl] }));
      if (denied) throw new RepoAccessError(denied);
      await this.git(['clone', '--mirror', '--', project.repoUrl, dir]);
      const hasBase = await this.git(['--git-dir', dir, 'show-ref', '--verify', '--quiet', `refs/heads/${project.baseBranch}`]).then(
        () => true,
        () => false,
      );
      if (!hasBase) error = `Base branch "${project.baseBranch}" was not found in the repository`;
    } catch (err) {
      error = err instanceof RepoAccessError ? err.message : this.describe(err);
    }
    if (error) await rm(dir, { recursive: true, force: true });

    // Only record the result if the project was not edited (and re-queued) while the clone ran.
    const { count } = await this.prisma.project.updateMany({
      where: { id: project.id, mirrorStatus: 'pending', repoUrl: project.repoUrl, baseBranch: project.baseBranch },
      data: error ? { mirrorStatus: 'failed', mirrorError: error } : { mirrorStatus: 'ok', mirrorError: null },
    });
    if (count > 0) this.logger.log(error ? `Mirror for "${project.name}" failed: ${error}` : `Mirror for "${project.name}" is ready`);
  }

  /**
   * A mirror recorded as ready whose folder is gone (data cleaned up by hand, a new DATA_DIR) would fail every stage with "not a git
   * repository" and never be cloned again. Queue each one to be cloned again; returns how many were queued.
   */
  async requeueMissing(): Promise<number> {
    const ready = await this.prisma.project.findMany({ where: { mirrorStatus: 'ok', enabled: true }, select: { id: true, name: true } });
    let queued = 0;
    for (const p of ready) {
      if (existsSync(path.join(this.config.mirrorPath(p.id), 'HEAD'))) continue;
      const { count } = await this.prisma.project.updateMany({ where: { id: p.id, mirrorStatus: 'ok' }, data: { mirrorStatus: 'pending', mirrorError: null } });
      if (count === 0) continue;
      queued++;
      this.logger.warn(`Mirror for "${p.name}" is missing on disk; cloning it again`);
      await this.prisma.event.create({ data: { type: 'git', message: `The mirror of ${p.name} was missing on disk: cloning it again` } }).catch(() => undefined);
    }
    return queued;
  }

  /** `git remote update --prune`, run before every workspace preparation. */
  async update(projectId: string): Promise<void> {
    await this.git(['--git-dir', this.config.mirrorPath(projectId), 'remote', 'update', '--prune']);
  }

  private git(args: string[]) {
    return this.runner.run(args, { timeoutMs: CLONE_TIMEOUT_MS });
  }

  private describe(err: unknown): string {
    const e = err as { stderr?: string; message?: string; killed?: boolean };
    const text = e.killed ? 'git clone timed out' : (e.stderr?.trim() || e.message || 'git clone failed');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return (lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines[0] ?? 'git clone failed').slice(0, MAX_ERROR_LENGTH);
  }
}
