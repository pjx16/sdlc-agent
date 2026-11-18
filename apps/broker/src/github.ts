import { appJwt } from './jwt';

export interface AppConfig {
  appId: string;
  slug: string;
  privateKey: string;
  /** For verifying who is installing the App (OAuth during installation). */
  clientId: string;
  clientSecret: string;
}

export type Fetch = typeof fetch;

/** What a token may do. Everything the pipeline needs on one repository, and nothing else: no administration, no workflows. */
export const TOKEN_PERMISSIONS = {
  contents: 'write',
  pull_requests: 'write',
  issues: 'write',
  actions: 'read',
  checks: 'read',
  statuses: 'read',
  security_events: 'read',
  metadata: 'read',
} as const;

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

/** The few GitHub API calls the broker makes. `fetchImpl` is replaced in tests. */
export class GitHubApi {
  constructor(
    private readonly app: AppConfig,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly base = 'https://api.github.com',
  ) {}

  private async call<T>(method: string, path: string, auth: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${auth}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sdlc-agent-broker', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new GitHubApiError(`GitHub answered ${res.status} for ${method} ${path}`, res.status);
    return (await res.json()) as T;
  }

  private jwt = (): string => appJwt(this.app.appId, this.app.privateKey, this.now());

  /** The installation of the App on a repository, or null when the App is not installed there. */
  async repoInstallation(repo: string): Promise<{ id: number; account: string } | null> {
    try {
      const r = await this.call<{ id: number; account?: { login?: string } }>('GET', `/repos/${repo}/installation`, this.jwt());
      return { id: r.id, account: r.account?.login ?? '' };
    } catch (err) {
      if (err instanceof GitHubApiError && err.status === 404) return null;
      throw err;
    }
  }

  /** A token that works on one repository only, for one hour. */
  async installationToken(installationId: number, repoName: string): Promise<{ token: string; expiresAt: string }> {
    const r = await this.call<{ token: string; expires_at: string }>('POST', `/app/installations/${installationId}/access_tokens`, this.jwt(), { repositories: [repoName], permissions: TOKEN_PERMISSIONS });
    return { token: r.token, expiresAt: r.expires_at };
  }

  /** The name and e-mail that commits made by the App carry, so GitHub shows them as the App's bot. */
  async botIdentity(): Promise<{ name: string; email: string }> {
    const login = `${this.app.slug}[bot]`;
    const r = await this.call<{ id: number }>('GET', `/users/${encodeURIComponent(login)}`, this.jwt());
    return { name: login, email: `${r.id}+${login}@users.noreply.github.com` };
  }

  /**
   * Proves the person who just installed the App owns the installation, and says whose account it is. Being able to see an installation
   * is not enough (a read-only collaborator sees it too): the person must be the account itself, or an admin of the organisation.
   */
  async verifyInstaller(code: string, installationId: number): Promise<{ account: string } | null> {
    const res = await this.fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'sdlc-agent-broker' },
      body: JSON.stringify({ client_id: this.app.clientId, client_secret: this.app.clientSecret, code }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json()) as { access_token?: string };
    if (!res.ok || !body.access_token) throw new GitHubApiError('GitHub did not accept the authorisation code', res.status);
    const token = body.access_token;
    const list = await this.call<{ installations: { id: number }[] }>('GET', '/user/installations?per_page=100', token);
    if (!list.installations.some((i) => i.id === installationId)) return null;
    const inst = await this.call<{ account?: { login?: string; type?: string } }>('GET', `/app/installations/${installationId}`, this.jwt());
    const account = inst.account?.login ?? '';
    if (!account) return null;
    if (inst.account?.type === 'Organization') {
      try {
        const m = await this.call<{ role?: string; state?: string }>('GET', `/user/memberships/orgs/${encodeURIComponent(account)}`, token);
        return m.role === 'admin' && m.state === 'active' ? { account } : null;
      } catch (err) {
        if (err instanceof GitHubApiError && (err.status === 403 || err.status === 404)) return null;
        throw err;
      }
    }
    const me = await this.call<{ login?: string }>('GET', '/user', token);
    return me.login?.toLowerCase() === account.toLowerCase() ? { account } : null;
  }
}
