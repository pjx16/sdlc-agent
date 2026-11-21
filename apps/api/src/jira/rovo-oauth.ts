import { createHash, randomBytes } from 'node:crypto';
import type { JiraMcpOAuthGrant } from '@sdlc/shared';
import { grantFrom, tokenRequest } from './mcp-auth';

/** Only what Jira needs: who the user is (to find the site), a refresh token, and the Jira agent-interface scopes. */
export const JIRA_OAUTH_SCOPES = ['read:me', 'read:account', 'offline_access', 'read:jira:agent-interface', 'write:jira:agent-interface', 'search:jira:agent-interface'];

export interface OAuthServer {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  /** Scopes to ask for: ours, as far as the server offers them. */
  scopes: string[];
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * MCP authorization discovery: the server's 401 names its protected-resource metadata (RFC 9728), which names the authorization server,
 * whose metadata (RFC 8414, path inserted for an issuer with a path, as Atlassian's has) gives the endpoints.
 */
export async function discoverOAuth(mcpUrl: string, fetchImpl: typeof fetch = fetch): Promise<OAuthServer> {
  const probe = await fetchImpl(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sdlc-agent', version: '1' } } }),
    signal: AbortSignal.timeout(15_000),
  });
  const challenge = probe.headers.get('www-authenticate') ?? '';
  const u = new URL(mcpUrl);
  const prmUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1] ?? `${u.origin}/.well-known/oauth-protected-resource${u.pathname.replace(/\/+$/, '')}`;
  const prm = await getJson(prmUrl, fetchImpl);
  const issuer: string = prm?.authorization_servers?.[0] ?? u.origin;
  let meta: Json | null = null;
  for (const url of metadataUrls(issuer)) {
    meta = await getJson(url, fetchImpl);
    if (meta?.authorization_endpoint && meta?.token_endpoint) break;
    meta = null;
  }
  if (!meta) throw new Error(`No OAuth metadata found for ${issuer}`);
  if (!meta.registration_endpoint) throw new Error('The Atlassian sign-in server offers no dynamic client registration');
  const offered: string[] | undefined = prm?.scopes_supported ?? meta.scopes_supported;
  return {
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    registrationEndpoint: meta.registration_endpoint,
    scopes: offered?.length ? JIRA_OAUTH_SCOPES.filter((s) => offered.includes(s)) : JIRA_OAUTH_SCOPES,
  };
}

export function metadataUrls(issuer: string): string[] {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, '');
  return [
    `${u.origin}/.well-known/oauth-authorization-server${path}`,
    ...(path ? [`${u.origin}${path}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration${path}`] : []),
    `${u.origin}${path}/.well-known/openid-configuration`,
  ];
}

/** Dynamic client registration (RFC 7591): a public client (PKCE, no secret) for this redirect URI. */
export async function registerClient(server: OAuthServer, redirectUri: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(server.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_name: 'sdlc-agent', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!body.client_id) throw new Error(`Atlassian refused to register the client (${res.status}${body.error_description ? `: ${body.error_description}` : body.error ? `: ${body.error}` : ''})`);
  return String(body.client_id);
}

export interface PendingSignIn {
  clientId: string;
  tokenEndpoint: string;
  resource: string;
  redirectUri: string;
  verifier: string;
  /** Where the browser goes back to afterwards. */
  returnTo: string;
  expiresAt: number;
}

export function pkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), state: randomBytes(16).toString('base64url') };
}

export function authorizeUrl(server: OAuthServer, p: { clientId: string; redirectUri: string; resource: string; state: string; challenge: string }): string {
  const url = new URL(server.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
    resource: p.resource,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    scope: server.scopes.join(' '),
  }).toString();
  return url.toString();
}

export async function exchangeCode(pending: PendingSignIn, code: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<JiraMcpOAuthGrant> {
  const tokens = await tokenRequest(
    pending.tokenEndpoint,
    { grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri, client_id: pending.clientId, code_verifier: pending.verifier, resource: pending.resource },
    fetchImpl,
  );
  return grantFrom(tokens, { clientId: pending.clientId, tokenEndpoint: pending.tokenEndpoint, resource: pending.resource }, now);
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<Json | null> {
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    return res.ok ? ((await res.json()) as Json) : null;
  } catch {
    return null;
  }
}
