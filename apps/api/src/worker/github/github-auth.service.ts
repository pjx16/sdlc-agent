import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { BrokerClient, type BrokerToken } from '../../broker/broker-client';
import { CredentialsService } from '../../credentials/credentials.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkerConfig } from '../worker-config';

const REFRESH_BEFORE_MS = 5 * 60_000;
const REPO_IN_URL = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#]|$)/;

/** Where a git or gh call is going: its arguments and the folder it runs in. The repository is worked out from them. */
export interface AuthContext {
  cwd?: string;
  args?: readonly string[];
}

/**
 * Which token to use for a repository. A project that works as the bot gets a one-hour token from the broker (kept until five minutes
 * before it expires); every other project uses the personal token saved in Settings. This is the only place that decides.
 */
@Injectable()
export class GitHubAuth {
  private readonly cache = new Map<string, BrokerToken>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly creds: CredentialsService,
    private readonly broker: BrokerClient,
    private readonly config: WorkerConfig,
  ) {}

  /** Replaced in tests. */
  now: () => number = Date.now;

  /** owner/name of the repository a call is about, from a URL or `-R owner/name` or `repos/owner/name` in its arguments, else from the project folder. */
  async repoOf(ctx: AuthContext): Promise<string | null> {
    const args = ctx.args ?? [];
    const flag = args.indexOf('-R');
    const viaFlag = flag >= 0 ? args[flag + 1] : undefined;
    if (viaFlag && /^[\w.-]+\/[\w.-]+$/.test(viaFlag)) return viaFlag;
    for (const a of args) {
      const m = /^repos\/([\w.-]+\/[\w.-]+)/.exec(a);
      if (m?.[1]) return m[1];
    }
    // The project folder comes before any URL in the arguments: arguments can carry text written by the AI (a PR body quoting another repository).
    const id = ctx.cwd ? this.projectIdOf(ctx.cwd) : null;
    if (!id) {
      for (const a of args) {
        const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(a);
        if (m) return `${m[1]}/${m[2]}`;
      }
      return null;
    }
    const project = await this.prisma.project.findUnique({ where: { id }, select: { repoUrl: true } });
    const m = project ? REPO_IN_URL.exec(project.repoUrl) : null;
    return m ? `${m[1]}/${m[2]}` : null;
  }

  /** The project id in a path under the data folder: mirrors/<id>, workspaces/<id>/<key>, onboarding/<id>. */
  private projectIdOf(cwd: string): string | null {
    const rel = path.relative(this.config.dataDir, path.resolve(cwd)).split(path.sep);
    return rel.length >= 2 && ['mirrors', 'workspaces', 'onboarding'].includes(rel[0] ?? '') ? (rel[1] ?? null) : null;
  }

  /** Whether a repository's project works as the bot. */
  private async usesBot(repo: string): Promise<boolean> {
    const candidates = await this.prisma.project.findMany({ where: { repoUrl: { contains: `github.com/${repo}`, mode: 'insensitive' } }, select: { repoUrl: true, githubAuth: true } });
    // `contains` also matches owner/app-two for owner/app: compare the parsed owner/name exactly.
    const project = candidates.find((c) => {
      const m = REPO_IN_URL.exec(c.repoUrl);
      return m !== null && `${m[1]}/${m[2]}`.toLowerCase() === repo.toLowerCase();
    });
    return project?.githubAuth === 'bot';
  }

  /** The bot's token for a repository (broker), kept until shortly before it expires. */
  async botToken(repo: string): Promise<BrokerToken> {
    const key = repo.toLowerCase();
    const cached = this.cache.get(key);
    if (cached && Date.parse(cached.expiresAt) - this.now() > REFRESH_BEFORE_MS) return cached;
    const fresh = await this.broker.token(repo);
    this.cache.set(key, fresh);
    return fresh;
  }

  /** The token for the call. With no repository to go by, or a project that uses its own token: the personal token from Settings. */
  async tokenFor(ctx: AuthContext): Promise<string> {
    const repo = await this.repoOf(ctx);
    if (repo && (await this.usesBot(repo))) return (await this.botToken(repo)).token;
    return (await this.creds.resolve()).github_token ?? '';
  }

  /** The commit author for a repository: the bot's for a project that works as the bot, otherwise the one set in Settings. */
  async identityFor(repo: string | null): Promise<{ name: string; email: string }> {
    if (repo && (await this.usesBot(repo))) {
      const id = (await this.botToken(repo)).identity;
      if (id) return id;
    }
    const c = await this.creds.resolve();
    return { name: c.git_author_name ?? '', email: c.git_author_email ?? '' };
  }
}
