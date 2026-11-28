import { Injectable } from '@nestjs/common';
import { CredentialsService } from '../credentials/credentials.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CommitSigningResult {
  ok: boolean;
  message: string;
  /** The GitHub account the key was looked for on. */
  login?: string;
}

const TIMEOUT_MS = 10_000;

/** The part of a public key that identifies it: its type and its key material, without the comment at the end. */
export const keyIdentity = (key: string): string => key.trim().split(/\s+/).slice(0, 2).join(' ');

/**
 * Is the key that signs the pipeline's commits one of the signing keys of the account that opens the pull requests? GitHub only shows a
 * commit as Verified when it is. The list of an account's signing keys is public, so asking needs the account name and no extra permission.
 * With sdlc-agent-bot the App signs its own commits and there is nothing to add, so this only applies to a personal token.
 */
@Injectable()
export class CommitSigningCheck {
  /** Replaced in tests. */
  fetchImpl: typeof fetch = fetch;
  /** GITHUB_API_URL exists for the end-to-end tests, which point it at a local fake GitHub. */
  private readonly api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly creds: CredentialsService,
  ) {}

  private get(url: string, token?: string): Promise<Response> {
    return this.fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sdlc-agent', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async check(): Promise<CommitSigningResult> {
    const row = await this.prisma.globalSettings.findUnique({ where: { id: 'global' }, select: { signingPublicKey: true } });
    if (!row?.signingPublicKey) return { ok: false, message: 'The signing key is made when the worker starts. It is not there yet: look at the worker log if it stays that way.' };
    const token = (await this.creds.resolve()).github_token;
    if (!token) return { ok: false, message: 'This can be checked with a personal token. With sdlc-agent-bot, commits are signed by the App and there is nothing to add.' };

    try {
      const me = await this.get(`${this.api}/user`, token);
      if (me.status === 401) return { ok: false, message: 'GitHub rejected the token' };
      if (me.status !== 200) return { ok: false, message: `GitHub answered ${me.status}` };
      const login = ((await me.json()) as { login?: string }).login;
      if (!login) return { ok: false, message: 'GitHub did not say whose token this is' };

      const keys = await this.get(`${this.api}/users/${encodeURIComponent(login)}/ssh_signing_keys?per_page=100`);
      if (keys.status !== 200) return { ok: false, message: `GitHub answered ${keys.status} when asked for the signing keys of @${login}`, login };
      const wanted = keyIdentity(row.signingPublicKey);
      const found = ((await keys.json()) as { key?: string }[]).some((k) => typeof k.key === 'string' && keyIdentity(k.key) === wanted);
      return found
        ? { ok: true, message: `Found on @${login}. Commits will show as Verified.`, login }
        : { ok: false, message: `Not found on @${login}. Add it as a Signing Key (not an Authentication Key).`, login };
    } catch {
      return { ok: false, message: 'Cannot reach GitHub' };
    }
  }
}
