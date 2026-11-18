import { Injectable } from '@nestjs/common';
import { BrokerClient, BrokerError } from '../../broker/broker-client';
import { GitHubAuth } from './github-auth.service';
import { parseRepo } from './github-client';

export interface RepoAccessResult {
  ok: boolean;
  /** What happened, or what to do when it did not work. */
  message: string;
  /** Who works on the repository, when it is the bot. */
  login?: string;
}

/**
 * Before a project that works as the bot is onboarded: can the sdlc-agent GitHub App reach its repository? The answer comes from the token
 * broker (it hands out a token only for a repository of an installation that was connected from this system). A project that uses a
 * personal token needs no such step.
 */
@Injectable()
export class RepoAccessService {
  constructor(
    private readonly auth: GitHubAuth,
    private readonly broker: BrokerClient,
  ) {}

  async ensure(project: { repoUrl: string; githubAuth: string }): Promise<RepoAccessResult> {
    if (project.githubAuth !== 'bot') return { ok: true, message: 'This project uses the personal GitHub token from Settings' };
    const repo = parseRepo(project.repoUrl);
    if (!(await this.broker.isConnected())) {
      return { ok: false, message: 'This system is not connected to sdlc-agent-bot yet. Open Settings → Connections, connect sdlc-agent-bot, then run the onboarding again.' };
    }
    try {
      const t = await this.auth.botToken(repo);
      return { ok: true, login: t.identity?.name, message: `${t.identity?.name ?? 'sdlc-agent-bot'} can work on ${repo}` };
    } catch (err) {
      if (err instanceof BrokerError && (err.status === 404 || err.status === 403)) {
        const link = await this.broker.startInstall().then((r) => r.url, () => null);
        return {
          ok: false,
          message: `sdlc-agent-bot has no access to ${repo}. ${link ? `Install the sdlc-agent GitHub App on it: ${link} ` : 'Open Settings → Connections to install the sdlc-agent GitHub App on it '}and choose this repository. Then run the onboarding again.`,
        };
      }
      return { ok: false, message: `Could not reach the sdlc-agent-bot broker: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
