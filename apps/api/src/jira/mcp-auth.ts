import type { JiraMcpOAuthGrant } from '@sdlc/shared';
import { JiraHttpError } from './jira-client';
import type { McpAuth } from './mcp-session';

/** A scoped Atlassian API token with the account email: `Basic base64(email:token)`. An org admin must allow API-token access. */
export function basicAuth(email: string, token: string): McpAuth {
  const header = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  return { header: async () => header };
}

/** Refresh this long before the access token runs out. */
const EARLY_MS = 60_000;

/**
 * An OAuth sign-in from the dashboard's Connect flow. The access token is refreshed before it expires and after a 401; Atlassian
 * rotates refresh tokens, so every refreshed grant is saved at once (a lost rotation means signing in again).
 */
export class OAuthGrantAuth implements McpAuth {
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private grant: JiraMcpOAuthGrant,
    private readonly save: (grant: JiraMcpOAuthGrant) => Promise<void>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async header(): Promise<string> {
    if (this.grant.expiresAt > 0 && this.grant.expiresAt - EARLY_MS <= this.now() && this.grant.refreshToken) await this.refresh();
    return `Bearer ${this.grant.accessToken}`;
  }

  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    if (!this.grant.refreshToken) return false;
    const tokens = await tokenRequest(
      this.grant.tokenEndpoint,
      { grant_type: 'refresh_token', refresh_token: this.grant.refreshToken, client_id: this.grant.clientId, resource: this.grant.resource },
      this.fetchImpl,
    );
    this.grant = grantFrom(tokens, { clientId: this.grant.clientId, tokenEndpoint: this.grant.tokenEndpoint, resource: this.grant.resource, previousRefresh: this.grant.refreshToken }, this.now());
    await this.save(this.grant);
    return true;
  }
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/** POST to an OAuth token endpoint. A refused grant is a 401, so it raises the Jira credential support item. */
export async function tokenRequest(endpoint: string, form: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<TokenResponse> {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    const why = [body.error, body.error_description].filter(Boolean).join(': ') || `HTTP ${res.status}`;
    throw new JiraHttpError(res.status >= 500 ? 502 : 401, `Atlassian refused the sign-in (${why}); connect Jira again in Settings → Connections`);
  }
  return body as TokenResponse;
}

export function grantFrom(
  tokens: TokenResponse,
  base: { clientId: string; tokenEndpoint: string; resource: string; previousRefresh?: string | null },
  now: number,
): JiraMcpOAuthGrant {
  return {
    clientId: base.clientId,
    tokenEndpoint: base.tokenEndpoint,
    resource: base.resource,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? base.previousRefresh ?? null,
    expiresAt: tokens.expires_in ? now + tokens.expires_in * 1000 : 0,
  };
}
