#!/usr/bin/env node
/**
 * Spike: can a client other than claude.ai sign in to the Atlassian Rovo MCP server with OAuth and call the Jira tools?
 *
 * What it does, with no dependencies (Node 24+):
 *   1. Calls the MCP server without a token and follows the 401 to the OAuth metadata (RFC 9728, then RFC 8414).
 *   2. Registers a client dynamically (RFC 7591) with a loopback redirect URI: http://localhost:<port>/callback.
 *   3. Opens the consent page in your browser (authorization code + PKCE) and waits for the redirect.
 *   4. Exchanges the code, then proves a refresh-token grant works.
 *   5. Opens an MCP session with the bearer token, lists the tools, reads the accessible sites (cloudId) and runs one bounded JQL search.
 *   6. With --write-issue KEY: posts one comment on that issue and lists its transitions (nothing else is written).
 *
 * Tokens are never printed or saved. The report (tool names and schemas, sites, results) is written to --out.
 *
 * Usage:
 *   node scripts/spike/jira-mcp-oauth.mjs [--url https://mcp.atlassian.com/v2/mcp] [--port 33418] [--project KEY]
 *                                         [--write-issue KEY-123] [--out ./jira-mcp-spike.json] [--no-open]
 *
 * If the consent page says your organisation blocks the app, an org admin must allow the redirect domain (localhost) for the
 * Rovo MCP server: Atlassian Administration → Rovo → Rovo MCP server.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const args = parseArgs(process.argv.slice(2));
const MCP_URL = args.url ?? 'https://mcp.atlassian.com/v2/mcp';
const PORT = Number(args.port ?? 33418);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const OUT = args.out ?? './jira-mcp-spike.json';
// Only what Jira needs: who the user is (to find the site), a refresh token, and the Jira agent-interface scopes.
const JIRA_SCOPES = ['read:me', 'read:account', 'offline_access', 'read:jira:agent-interface', 'write:jira:agent-interface', 'search:jira:agent-interface'];
const report = { mcpUrl: MCP_URL, redirectUri: REDIRECT_URI, startedAt: new Date().toISOString(), steps: [] };

async function main() {
  // 1. Discovery
  const probe = await fetch(MCP_URL, { method: 'POST', headers: mcpHeaders(), body: JSON.stringify(rpc('initialize', initParams())) });
  const challenge = probe.headers.get('www-authenticate') ?? '';
  step('probe', { status: probe.status, wwwAuthenticate: challenge || null });
  const resourceMetadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1] ?? wellKnown(MCP_URL, 'oauth-protected-resource', true);
  let authServer = new URL(MCP_URL).origin;
  const prm = await getJson(resourceMetadataUrl);
  if (prm?.authorization_servers?.[0]) authServer = prm.authorization_servers[0];
  step('protected-resource-metadata', { url: resourceMetadataUrl, found: Boolean(prm), authorizationServer: authServer, scopes: prm?.scopes_supported ?? null });
  const asMeta = await firstJson(authServerMetadataUrls(authServer));
  if (!asMeta?.authorization_endpoint || !asMeta?.token_endpoint) throw new Error(`No OAuth metadata found for ${authServer}`);
  step('authorization-server-metadata', pick(asMeta, ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'scopes_supported', 'code_challenge_methods_supported']));

  // 2. Dynamic client registration
  if (!asMeta.registration_endpoint) throw new Error('The authorization server offers no registration endpoint (no dynamic client registration)');
  const regRes = await fetch(asMeta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_name: 'sdlc-agent (spike)', redirect_uris: [REDIRECT_URI], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  const reg = await regRes.json().catch(() => ({}));
  step('client-registration', { status: regRes.status, clientIdIssued: Boolean(reg.client_id), error: reg.error ?? null, errorDescription: reg.error_description ?? null });
  if (!reg.client_id) throw new Error(`Client registration failed (${regRes.status})`);

  // 3. Consent (authorization code + PKCE)
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  const authUrl = new URL(asMeta.authorization_endpoint);
  authUrl.search = new URLSearchParams({
    response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT_URI, state, resource: MCP_URL,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    ...(prm?.scopes_supported?.length ? { scope: JIRA_SCOPES.filter((sc) => prm.scopes_supported.includes(sc)).join(' ') } : {}),
  }).toString();
  console.log(`\nOpen this URL and approve access:\n\n${authUrl}\n`);
  if (!args['no-open']) openBrowser(authUrl.toString());
  const code = await waitForCode(state);
  step('consent', { ok: true });

  // 4. Token exchange and refresh
  let tokens = await tokenRequest(asMeta.token_endpoint, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: reg.client_id, code_verifier: verifier, resource: MCP_URL });
  step('token-exchange', { tokenType: tokens.token_type, expiresIn: tokens.expires_in ?? null, scope: tokens.scope ?? null, refreshTokenIssued: Boolean(tokens.refresh_token) });
  if (tokens.refresh_token) {
    const refreshed = await tokenRequest(asMeta.token_endpoint, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: reg.client_id, resource: MCP_URL }).catch((e) => ({ error: e.message }));
    step('token-refresh', { ok: Boolean(refreshed.access_token), rotatedRefreshToken: Boolean(refreshed.refresh_token && refreshed.refresh_token !== tokens.refresh_token), error: refreshed.error ?? null });
    if (refreshed.access_token) tokens = { ...tokens, ...refreshed };
  }

  // 5. MCP calls
  const mcp = new Session(MCP_URL, tokens.access_token);
  const init = await mcp.call('initialize', initParams());
  await mcp.notify('notifications/initialized');
  step('mcp-initialize', { serverInfo: init.serverInfo ?? null, protocolVersion: init.protocolVersion ?? null, sessionId: Boolean(mcp.sessionId) });
  const { tools = [] } = await mcp.call('tools/list', {});
  report.tools = tools.map((t) => ({ name: t.name, readOnly: t.annotations?.readOnlyHint ?? null, inputSchema: t.inputSchema }));
  step('tools-list', { count: tools.length, names: tools.map((t) => t.name) });

  const resources = await mcp.tool('getAccessibleAtlassianResources', {}).catch((e) => ({ error: e.message }));
  step('getAccessibleAtlassianResources', summarize(resources));
  const cloudId = findCloudId(resources);
  if (!cloudId) throw new Error('No cloudId: the token sees no Atlassian site');
  report.cloudId = cloudId;

  const jql = args.project ? `project = "${args.project}" ORDER BY created DESC` : 'created >= -30d ORDER BY created DESC';
  const search = await mcp.tool('searchJiraIssuesUsingJql', { cloudId, jql, maxResults: 3 }).catch((e) => ({ error: e.message }));
  step('searchJiraIssuesUsingJql', { jql, ...summarize(search) });

  // 6. Optional write check on one issue
  if (args['write-issue']) {
    const key = args['write-issue'];
    const commentTool = ['addCommentToJiraIssue', 'addOrEditJiraIssueComment'].find((n) => tools.some((t) => t.name === n));
    const comment = commentTool
      ? await mcp.tool(commentTool, { cloudId, issueIdOrKey: key, commentBody: 'sdlc-agent OAuth spike: this comment proves the write path. It can be deleted.' }).catch((e) => ({ error: e.message }))
      : { error: 'no comment tool' };
    step(`write:${commentTool ?? 'comment'}`, summarize(comment));
    const transitions = tools.some((t) => t.name === 'getTransitionsForJiraIssue')
      ? await mcp.tool('getTransitionsForJiraIssue', { cloudId, issueIdOrKey: key }).catch((e) => ({ error: e.message }))
      : { error: 'no getTransitionsForJiraIssue tool' };
    step('getTransitionsForJiraIssue', summarize(transitions));
  }

  report.result = 'OAuth sign-in, refresh and Jira tool calls all worked: mcp mode with OAuth can serve this organisation.';
  step('DONE', {});
  await save();
}

// ------------------------------------------------------------------ MCP over streamable HTTP

class Session {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.sessionId = null;
    this.id = 0;
  }

  async call(method, params) {
    const res = await fetch(this.url, { method: 'POST', headers: this.headers(), body: JSON.stringify(rpc(method, params, ++this.id)) });
    this.sessionId = res.headers.get('mcp-session-id') ?? this.sessionId;
    const text = await res.text();
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
    const msg = parseRpc(text, this.id);
    if (msg.error) throw new Error(`${method}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
    return msg.result ?? {};
  }

  async notify(method) {
    await fetch(this.url, { method: 'POST', headers: this.headers(), body: JSON.stringify({ jsonrpc: '2.0', method }) });
  }

  async tool(name, args) {
    const result = await this.call('tools/call', { name, arguments: args });
    const text = (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (result.isError) throw new Error(text.slice(0, 500) || 'tool error');
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }

  headers() {
    return { ...mcpHeaders(), authorization: `Bearer ${this.token}`, ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}) };
  }
}

function parseRpc(text, id) {
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  // An SSE stream: the answer is the `data:` event whose id matches.
  for (const block of t.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
    if (!data) continue;
    const msg = JSON.parse(data);
    if (msg.id === id) return msg;
  }
  throw new Error('No JSON-RPC answer in the response');
}

const mcpHeaders = () => ({ 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' });
const rpc = (method, params, id = 0) => ({ jsonrpc: '2.0', id, method, params });
const initParams = () => ({ protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sdlc-agent-spike', version: '0.0.1' } });

// ------------------------------------------------------------------ OAuth helpers

async function tokenRequest(endpoint, form) {
  const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(form) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`token endpoint ${res.status}: ${body.error ?? ''} ${body.error_description ?? ''}`.trim());
  return body;
}

function waitForCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      if (url.pathname !== '/callback') return res.writeHead(404).end();
      const error = url.searchParams.get('error');
      const ok = !error && url.searchParams.get('state') === expectedState && url.searchParams.get('code');
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain' }).end(ok ? 'Signed in. You can close this tab and go back to the terminal.' : `Sign-in failed: ${error ?? 'state mismatch'} ${url.searchParams.get('error_description') ?? ''}`);
      server.close();
      if (ok) resolve(url.searchParams.get('code'));
      else reject(new Error(`Consent failed: ${error ?? 'state mismatch'} ${url.searchParams.get('error_description') ?? ''}`.trim()));
    });
    server.listen(PORT, '127.0.0.1');
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out after 5 minutes waiting for the browser redirect'));
    }, 5 * 60_000).unref();
  });
}

function wellKnown(base, name, withPath = false) {
  const u = new URL(base);
  const path = withPath && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '';
  return `${u.origin}/.well-known/${name}${path}`;
}

/** RFC 8414 path insertion first (an issuer with a path, as Atlassian's has), then the path appended, then OpenID Connect. */
function authServerMetadataUrls(issuer) {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, '');
  return [
    `${u.origin}/.well-known/oauth-authorization-server${path}`,
    ...(path ? [`${u.origin}${path}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration${path}`] : []),
    `${u.origin}${path}/.well-known/openid-configuration`,
  ];
}

async function firstJson(urls) {
  for (const url of urls) {
    const json = await getJson(url);
    if (json?.authorization_endpoint && json?.token_endpoint) return json;
  }
  return null;
}

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function findCloudId(value) {
  const list = Array.isArray(value) ? value : (value?.data?.resources ?? value?.resources ?? []);
  return list.find((r) => r?.id || r?.cloudId)?.id ?? list.find((r) => r?.cloudId)?.cloudId ?? null;
}

// ------------------------------------------------------------------ small helpers

function summarize(value) {
  if (value?.error) return { ok: false, error: String(value.error).slice(0, 500) };
  const text = JSON.stringify(value);
  return { ok: true, preview: text.length > 1500 ? `${text.slice(0, 1500)}…` : value };
}

function step(name, data) {
  report.steps.push({ step: name, ...data });
  console.log(`[${name}]`, JSON.stringify(data));
}

async function save() {
  await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nReport written to ${OUT} (no tokens in it). Share it to finish the mcp-mode mapping.`);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const argv = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, argv, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* the URL is printed above */
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

// Started last: the helpers above are `const` and must be initialised first.
main().catch(async (err) => {
  step('FAILED', { error: err instanceof Error ? err.message : String(err) });
  await save();
  process.exitCode = 1;
});
