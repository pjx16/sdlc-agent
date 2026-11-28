import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCodes } from '@sdlc/shared';
import { ApiException } from '../common/api-exception';
import { BrokerClient } from '../broker/broker-client';
import { CredentialsService } from '../credentials/credentials.service';
import { PrismaService } from '../prisma/prisma.service';
import { type FoundIssue, exactTitleMatches, issueSearchQuery, parseRepo } from '../worker/github/github-client';

/**
 * What the dashboard may ask GitHub about a project's repository, read-only. The worker makes everything that writes. The `gh` program lives
 * in the worker's image only, so this one search goes straight to GitHub's API with the project's own token (the bot's, or the personal one).
 */
@Injectable()
export class GithubReadService {
  /** Replaced in tests. */
  fetchImpl: typeof fetch = fetch;
  /** GITHUB_API_URL exists for the end-to-end tests, which point it at a local fake GitHub. */
  private readonly api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly creds: CredentialsService,
    private readonly broker: BrokerClient,
  ) {}

  /** GET /projects/:id/github/issues/search?title=: the open issues of the project's repository with exactly this title. */
  async searchOpenIssuesByTitle(projectId: string, title: string): Promise<FoundIssue[]> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { repoUrl: true, githubAuth: true } });
    if (!project) throw new ApiException(HttpStatus.NOT_FOUND, ErrorCodes.notFound, 'Project not found');
    if (!title.trim()) return [];
    const repo = parseRepo(project.repoUrl);
    const token = project.githubAuth === 'bot' ? (await this.broker.token(repo)).token : ((await this.creds.resolve()).github_token ?? '');
    if (!token) throw new ApiException(HttpStatus.CONFLICT, ErrorCodes.conflict, 'There is no GitHub token: add one in Settings, or connect sdlc-agent-bot');

    const url = `${this.api}/search/issues?${new URLSearchParams({ q: issueSearchQuery(repo, title), per_page: '30' })}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sdlc-agent' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ApiException(HttpStatus.BAD_GATEWAY, ErrorCodes.githubError, 'Cannot reach GitHub');
    }
    if (!res.ok) throw new ApiException(HttpStatus.BAD_GATEWAY, ErrorCodes.githubError, `GitHub answered ${res.status}`);
    const found = (await res.json()) as { items?: { number: number; title: string; html_url: string }[] };
    return exactTitleMatches(found.items ?? [], title);
  }
}
