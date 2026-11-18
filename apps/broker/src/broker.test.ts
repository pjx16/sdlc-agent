import { createVerify, generateKeyPairSync } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { GitHubApi } from './github';
import { appJwt } from './jwt';
import { addressKey, createBroker } from './server';
import { Store } from './store';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const APP = { appId: '42', slug: 'sdlc-agent', privateKey, clientId: 'Iv1.x', clientSecret: 'secret' };

/** A GitHub that knows one installation (77) on acme/billing, and which installations the person authorising can see. */
function fakeGitHub(opts: { userInstallations?: number[]; role?: string } = {}) {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', url, body, auth: new Headers(init?.headers).get('authorization') });
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status });
    if (url.endsWith('/login/oauth/access_token')) return json(200, { access_token: 'user-token' });
    if (url.endsWith('/app/installations/77')) return json(200, { account: { login: 'acme', type: 'Organization' } });
    if (url.endsWith('/user/memberships/orgs/acme')) return json(200, { role: opts.role ?? 'admin', state: 'active' });
    if (url.includes('/user/installations')) return json(200, { installations: (opts.userInstallations ?? [77]).map((id) => ({ id })) });
    if (url.endsWith('/repos/acme/billing/installation')) return json(200, { id: 77, account: { login: 'acme' } });
    if (url.includes('/repos/') && url.endsWith('/installation')) return json(404, {});
    if (url.endsWith('/app/installations/77/access_tokens')) return json(201, { token: 'ghs_scoped', expires_at: '2026-11-14T15:00:00Z' });
    if (url.includes('/users/sdlc-agent')) return json(200, { id: 123 });
    return json(500, {});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

let server: Server | null = null;
afterEach(() => server?.close());

async function start(gh = fakeGitHub(), now: () => number = Date.now) {
  const store = new Store(null, now);
  server = createBroker({ app: APP, publicUrl: 'http://broker.test', store, api: new GitHubApi(APP, gh.fetchImpl, now), now });
  await new Promise<void>((r) => server?.listen(0, r));
  const base = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;
  const call = (method: string, path: string, opts: { key?: string; body?: unknown } = {}) =>
    fetch(`${base}${path}`, { method, headers: { ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}), 'Content-Type': 'application/json' }, ...(opts.body ? { body: JSON.stringify(opts.body) } : {}) });
  return { call, gh, store, base };
}

/** Registers a system and installs the App for it, the way the dashboard does. */
async function connected(t: Awaited<ReturnType<typeof start>>, installationId = 77, existingKey?: string) {
  const key = existingKey ?? ((await (await t.call('POST', '/v1/clients')).json()) as { key: string }).key;
  const url = ((await (await t.call('POST', '/v1/install/start', { key })).json()) as { url: string }).url;
  const state = new URL(url).searchParams.get('state');
  const begin = await fetch(`${t.base}/install/begin?state=${state}`, { redirect: 'manual' });
  const cookie = (begin.headers.get('set-cookie') ?? '').split(';')[0] as string;
  const cb = await fetch(`${t.base}/install/callback?installation_id=${installationId}&setup_action=install&state=${state}&code=abc`, { headers: { cookie } });
  // The page shows a pairing code; the system that started the install confirms it.
  const pairing = /: ([A-Z0-9]{8})</.exec(await cb.clone().text())?.[1];
  const confirm = pairing ? await t.call('POST', '/v1/install/confirm', { key, body: { code: pairing } }) : null;
  return { key, state, cb, cookie, begin, pairing, confirm };
}

describe('appJwt', () => {
  it('is an RS256 token signed with the App key, for the App id, valid for under ten minutes', () => {
    const jwt = appJwt('42', privateKey, Date.parse('2026-11-14T12:00:00Z'));
    const [h, p, s] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as { iss: string; iat: number; exp: number };
    expect(claims.iss).toBe('42');
    expect(claims.exp - claims.iat).toBeLessThan(600);
    expect(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });
});

describe('housekeeping', () => {
  it('can require a registration secret, and forgets old registrations that never connected anything', async () => {
    const store = new Store(null, () => clock);
    let clock = 1_000_000;
    server = createBroker({ app: APP, publicUrl: 'http://broker.test', store, registrationSecret: 's3cret', api: new GitHubApi(APP, fakeGitHub().fetchImpl), now: () => clock });
    await new Promise<void>((r) => server?.listen(0, r));
    const base = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/v1/clients`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`${base}/v1/clients`, { method: 'POST', headers: { 'x-registration-secret': 's3cret' } })).status).toBe(201);
    expect(store.clientCount()).toBe(1);
    clock += 31 * 24 * 3_600_000;
    store.pruneClients();
    expect(store.clientCount()).toBe(0);
  });


  it('groups IPv6 addresses by /64 and unwraps IPv4-mapped ones', () => {
    expect(addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(addressKey('2001:db8:1:2::1'));
    expect(addressKey('2001:db8:1:3::1')).not.toBe(addressKey('2001:db8:1:2::1'));
    expect(addressKey('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(addressKey('10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('token broker', () => {
  it('connects a system, then hands out a one-hour token for one repository only, with the bot identity for commits', async () => {
    const t = await start();
    const { key, cb } = await connected(t);
    expect(cb.status).toBe(200);
    expect(((await (await t.call('GET', '/v1/installations', { key })).json()) as { installations: unknown[] }).installations).toHaveLength(1);

    const res = await t.call('POST', '/v1/token', { key, body: { repo: 'acme/billing' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'ghs_scoped', expiresAt: '2026-11-14T15:00:00Z', identity: { name: 'sdlc-agent[bot]', email: '123+sdlc-agent[bot]@users.noreply.github.com' } });
    const request = t.gh.calls.find((c) => c.url.endsWith('/access_tokens'));
    expect(request?.body).toMatchObject({ repositories: ['billing'] });
    const permissions = (request?.body as { permissions: Record<string, string> }).permissions;
    expect(Object.keys(permissions)).not.toContain('administration');
    expect(Object.keys(permissions)).not.toContain('workflows');
    expect(permissions).toMatchObject({ contents: 'write', pull_requests: 'write' });
  });

  it('refuses an installation the person cannot see on their own GitHub account (a forged installation id)', async () => {
    const t = await start(fakeGitHub({ userInstallations: [5] }));
    const { key, cb } = await connected(t, 77);
    expect(cb.status).toBe(403);
    expect(await (await t.call('POST', '/v1/token', { key, body: { repo: 'acme/billing' } })).json()).toMatchObject({ error: expect.stringContaining('not connected from this system') });
  });

  it('refuses a callback from a browser that did not open the install page (an install link sent to a victim)', async () => {
    const t = await start();
    const key = ((await (await t.call('POST', '/v1/clients')).json()) as { key: string }).key;
    const url = ((await (await t.call('POST', '/v1/install/start', { key })).json()) as { url: string }).url;
    const state = new URL(url).searchParams.get('state');
    expect(new URL(url).pathname).toBe('/install/begin');
    expect((await t.call('GET', `/install/callback?installation_id=77&state=${state}&code=abc`)).status).toBe(400);
  });

  it('does not connect an installation until the system that started it confirms the code, and only that system can', async () => {
    const t = await start();
    const a = await connected(t);
    expect(a.cb.status).toBe(200);
    expect(a.pairing).toMatch(/^[A-Z0-9]{8}$/);
    expect(a.confirm?.status).toBe(200);
    // Another system cannot use a code it did not start the install for, and five wrong codes lock it out.
    const other = ((await (await t.call('POST', '/v1/clients')).json()) as { key: string }).key;
    const b = await connected(t, 77, other);
    expect(b.confirm?.status).toBe(409); // already bound to a
    for (let i = 0; i < 5; i++) expect((await t.call('POST', '/v1/install/confirm', { key: other, body: { code: 'WRONGCODE' } })).status).toBe(404);
    expect((await t.call('POST', '/v1/install/confirm', { key: other, body: { code: 'WRONGCODE' } })).status).toBe(429);
  });

  it('a stolen install page is useless without the code (the victim\'s code never reaches the attacker)', async () => {
    const t = await start();
    const attacker = ((await (await t.call('POST', '/v1/clients')).json()) as { key: string }).key;
    const url = ((await (await t.call('POST', '/v1/install/start', { key: attacker })).json()) as { url: string }).url;
    const state = new URL(url).searchParams.get('state');
    const begin = await fetch(`${t.base}/install/begin?state=${state}`, { redirect: 'manual' });
    const cookie = (begin.headers.get('set-cookie') ?? '').split(';')[0] as string;
    await fetch(`${t.base}/install/callback?installation_id=77&state=${state}&code=abc`, { headers: { cookie } }); // the victim's browser
    expect((await t.call('GET', '/v1/installations', { key: attacker })).status).toBe(200);
    expect(((await (await t.call('GET', '/v1/installations', { key: attacker })).json()) as { installations: unknown[] }).installations).toHaveLength(0);
    expect((await t.call('POST', '/v1/token', { key: attacker, body: { repo: 'acme/billing' } })).status).toBe(403);
  });

  it('refuses someone who can see the installation but is not an admin of its organisation', async () => {
    const t = await start(fakeGitHub({ role: 'member' }));
    expect((await connected(t)).cb.status).toBe(403);
  });

  it('never moves an installation that is bound to another system, and stores its account', async () => {
    const t = await start();
    const a = await connected(t);
    expect(((await (await t.call('GET', '/v1/installations', { key: a.key })).json()) as { installations: { account: string }[] }).installations[0]?.account).toBe('acme');
    expect((await connected(t)).confirm?.status).toBe(409);
    expect((await t.call('POST', '/v1/token', { key: a.key, body: { repo: 'acme/billing' } })).status).toBe(200);
  });

  it('an install link works once and expires', async () => {
    const t = await start();
    const { state, cookie } = await connected(t);
    expect((await fetch(`${t.base}/install/callback?installation_id=77&state=${state}&code=abc`, { headers: { cookie } })).status).toBe(400); // used already
    let clock = 1_000_000;
    const t2 = await start(fakeGitHub(), () => clock);
    const key = ((await (await t2.call('POST', '/v1/clients')).json()) as { key: string }).key;
    const url = ((await (await t2.call('POST', '/v1/install/start', { key })).json()) as { url: string }).url;
    clock += 16 * 60_000;
    expect((await t2.call('GET', `/install/callback?installation_id=77&state=${new URL(url).searchParams.get('state')}&code=abc`)).status).toBe(400);
  });

  it('does not give one system a token for another system\'s installation', async () => {
    const t = await start();
    await connected(t); // system A owns installation 77
    const other = ((await (await t.call('POST', '/v1/clients')).json()) as { key: string }).key;
    const res = await t.call('POST', '/v1/token', { key: other, body: { repo: 'acme/billing' } });
    expect(res.status).toBe(403);
  });

  it('rejects a missing or wrong key, a malformed repository, and a repository the App is not installed on', async () => {
    const t = await start();
    const { key } = await connected(t);
    expect((await t.call('POST', '/v1/token', { body: { repo: 'acme/billing' } })).status).toBe(401);
    expect((await t.call('POST', '/v1/token', { key: 'nope.nope', body: { repo: 'acme/billing' } })).status).toBe(401);
    expect((await t.call('POST', '/v1/token', { key, body: { repo: 'acme/billing; rm -rf' } })).status).toBe(400);
    expect((await t.call('POST', '/v1/token', { key, body: { repo: 'acme/other' } })).status).toBe(404);
  });

  it('limits how many systems one address can register in an hour', async () => {
    const t = await start();
    for (let i = 0; i < 20; i++) expect((await t.call('POST', '/v1/clients')).status).toBe(201);
    expect((await t.call('POST', '/v1/clients')).status).toBe(429);
  });

  it('stores only a hash of each key', async () => {
    const t = await start();
    const key = ((await (await t.call('POST', '/v1/clients')).json()) as { key: string }).key;
    expect(t.store.serialize()).not.toContain(key.split('.')[1] as string);
  });
});

describe('keys that are not keys', () => {
  it('a key shaped like a property name is just unknown, never a way past the check', async () => {
    const t = await start();
    await connected(t);
    for (const key of ['__proto__.x', 'constructor.aaaaaaaaaaaaaaaaaaaaaaaa', 'toString', '0123456789abcdef.', 'g'.repeat(16) + '.' + 'a'.repeat(30)]) {
      expect((await t.call('GET', '/v1/installations', { key })).status, key).toBe(401);
    }
  });

  it('an install state that is not one is refused without being looked up', async () => {
    const t = await start();
    for (const state of ['__proto__', 'constructor', 'x']) expect((await t.call('GET', `/install/callback?installation_id=77&state=${state}&code=abc`)).status, state).toBe(400);
  });
});
