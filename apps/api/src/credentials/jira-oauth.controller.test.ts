import { describe, expect, it } from 'vitest';
import { metadataUrls } from '../jira/rovo-oauth';
import type { CredentialTester } from './credential-tester';
import type { CredentialsService } from './credentials.service';
import { JiraOAuthController } from './jira-oauth.controller';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ISSUER = 'https://auth.example.com/tenant1';

/** A fake Atlassian: the MCP 401, both metadata documents, registration and the token endpoint. */
function fakeAtlassian(opts: { tokenStatus?: number } = {}) {
  const seen: { url: string; body?: string }[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    seen.push({ url, body: typeof init.body === 'string' ? init.body : init.body?.toString() });
    if (url === 'https://mcp.example.com/v2/mcp') return new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/v2/mcp"' } });
    if (url === 'https://mcp.example.com/.well-known/oauth-protected-resource/v2/mcp') return Response.json({ authorization_servers: [ISSUER], scopes_supported: ['read:me', 'offline_access', 'read:jira:agent-interface', 'read:confluence:agent-interface'] });
    if (url === 'https://auth.example.com/.well-known/oauth-authorization-server/tenant1') return Response.json({ authorization_endpoint: 'https://auth.example.com/authorize', token_endpoint: 'https://auth.example.com/oauth/token', registration_endpoint: `${ISSUER}/dcr/register` });
    if (url === `${ISSUER}/dcr/register`) return Response.json({ client_id: 'client-1' }, { status: 201 });
    if (url === 'https://auth.example.com/oauth/token') return opts.tokenStatus ? Response.json({ error: 'invalid_grant' }, { status: opts.tokenStatus }) : Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 });
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

function setup(opts: { tokenStatus?: number; testOk?: boolean } = {}) {
  const stored: Json = {};
  const creds = { resolve: async () => ({ jira_mcp_url: 'https://mcp.example.com/v2/mcp' }), set: async (k: string, v: string) => void (stored[k] = v) } as unknown as CredentialsService;
  const tester = { test: async () => ({ ok: opts.testOk ?? true, message: 'Connected to https://acme.atlassian.net' }) } as unknown as CredentialTester;
  const atl = fakeAtlassian(opts);
  return { controller: new JiraOAuthController(creds, tester, atl.impl), stored, seen: atl.seen };
}

function fakeRes() {
  const out: { status?: number; location?: string; body?: string } = {};
  const res = {
    redirect: (status: number, location: string) => Object.assign(out, { status, location }),
    status(code: number) {
      out.status = code;
      return this;
    },
    type() {
      return this;
    },
    send: (body: string) => void (out.body = body),
  };
  return { res: res as never, out };
}

describe('Rovo MCP OAuth', () => {
  it('inserts the issuer path in the metadata URL first (RFC 8414)', () => {
    expect(metadataUrls(ISSUER)[0]).toBe('https://auth.example.com/.well-known/oauth-authorization-server/tenant1');
  });

  it('start registers a client for the dashboard callback and asks only for the Jira scopes offered', async () => {
    const { controller, seen } = setup();
    const { authorizeUrl, redirectUri } = await controller.start({ origin: 'http://localhost:3000' });
    expect(redirectUri).toBe('http://localhost:3000/api/jira-mcp/oauth/callback');
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://auth.example.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe('https://mcp.example.com/v2/mcp');
    expect(url.searchParams.get('scope')).toBe('read:me offline_access read:jira:agent-interface');
    expect(JSON.parse(seen.find((s) => s.url.endsWith('/dcr/register'))?.body ?? '{}')).toMatchObject({ redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' });
  });

  it('refuses a plain-http origin that is not loopback', async () => {
    const { controller } = setup();
    await expect(controller.start({ origin: 'http://dashboard.example.com' })).rejects.toThrow();
  });

  it('callback exchanges the code with the PKCE verifier, stores the grant and returns to Connections', async () => {
    const { controller, stored, seen } = setup();
    const { authorizeUrl } = await controller.start({ origin: 'http://localhost:3000' });
    const state = new URL(authorizeUrl).searchParams.get('state') as string;
    const { res, out } = fakeRes();
    await controller.callback('the-code', state, undefined, undefined, res);
    expect(out.location).toMatch(/^http:\/\/localhost:3000\/setup\/connections\?jira_mcp=connected/);
    expect(JSON.parse(stored.jira_mcp_oauth)).toMatchObject({ clientId: 'client-1', accessToken: 'at', refreshToken: 'rt', resource: 'https://mcp.example.com/v2/mcp' });
    const form = new URLSearchParams(seen.find((s) => s.url.endsWith('/oauth/token'))?.body);
    expect(form.get('code')).toBe('the-code');
    expect(form.get('code_verifier')?.length).toBeGreaterThan(40);
  });

  it('a state is used once', async () => {
    const { controller } = setup();
    const state = new URL((await controller.start({ origin: 'http://localhost:3000' })).authorizeUrl).searchParams.get('state') as string;
    await controller.callback('c', state, undefined, undefined, fakeRes().res);
    const again = fakeRes();
    await controller.callback('c', state, undefined, undefined, again.res);
    expect(again.out.status).toBe(400);
  });

  it('a refused consent or token exchange goes back with the reason and stores nothing', async () => {
    const denied = setup();
    const s1 = new URL((await denied.controller.start({ origin: 'http://localhost:3000' })).authorizeUrl).searchParams.get('state') as string;
    const r1 = fakeRes();
    await denied.controller.callback(undefined, s1, 'access_denied', 'Your organization blocks this app', r1.res);
    expect(r1.out.location).toContain('jira_mcp=error');
    expect(decodeURIComponent(r1.out.location ?? '').replace(/\+/g, ' ')).toContain('Your organization blocks this app');

    const refused = setup({ tokenStatus: 400 });
    const s2 = new URL((await refused.controller.start({ origin: 'http://localhost:3000' })).authorizeUrl).searchParams.get('state') as string;
    const r2 = fakeRes();
    await refused.controller.callback('c', s2, undefined, undefined, r2.res);
    expect(r2.out.location).toContain('jira_mcp=error');
    expect(refused.stored.jira_mcp_oauth).toBeUndefined();
  });
});
