import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialsService } from '../credentials/credentials.service';
import { type TestApp, createTestApp } from '../testing/test-app';
import { type TestDatabase, createTestDatabase } from '../testing/test-db';
import { CommitSigningCheck, keyIdentity } from './commit-signing-check';
import { SystemSettingsModule } from './system-settings.module';

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOurKey sdlc-agent commit signing';

describe('POST /system/commit-signing/test', () => {
  let db: TestDatabase;
  let t: TestApp;
  let check: CommitSigningCheck;
  let urls: string[];
  let answers: Record<string, { status: number; body?: unknown }>;

  const setKey = (signingPublicKey: string | null) => t.prisma.globalSettings.upsert({ where: { id: 'global' }, update: { signingPublicKey }, create: { id: 'global', signingPublicKey } });
  const token = (value: string | undefined) => vi.spyOn(t.app.get(CredentialsService), 'resolve').mockResolvedValue({ github_token: value } as never);
  const run = async () => (await t.agent.post('/system/commit-signing/test').expect(200)).body as { ok: boolean; message: string; login?: string };

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await createTestApp(db.url, [SystemSettingsModule]);
    check = t.app.get(CommitSigningCheck);
  }, 180_000);
  afterAll(async () => {
    await t?.close();
    await db?.drop();
  });
  beforeEach(async () => {
    urls = [];
    answers = { '/user': { status: 200, body: { login: 'octocat' } }, '/users/octocat/ssh_signing_keys': { status: 200, body: [{ key: 'ssh-rsa AAAAother other@laptop' }, { key: KEY.split(' ').slice(0, 2).join(' ') }] } };
    check.fetchImpl = (async (url: string) => {
      urls.push(String(url));
      const a = answers[new URL(String(url)).pathname] ?? { status: 404 };
      return { status: a.status, ok: a.status < 400, json: async () => a.body } as Response;
    }) as unknown as typeof fetch;
    token('ghp_personal');
    await setKey(KEY);
  });

  it('requires a session', async () => {
    await t.anonymous.post('/system/commit-signing/test').expect(401);
  });

  it('says the commits will show as Verified when the key is among the account’s signing keys, ignoring the comment on the key', async () => {
    expect(await run()).toEqual({ ok: true, message: 'Found on @octocat. Commits will show as Verified.', login: 'octocat' });
    expect(urls).toEqual(['https://api.github.com/user', 'https://api.github.com/users/octocat/ssh_signing_keys?per_page=100']);
  });

  it('says to add it when the key is not there, and that it is a Signing Key', async () => {
    answers['/users/octocat/ssh_signing_keys'] = { status: 200, body: [{ key: 'ssh-ed25519 AAAAsomeoneElse' }] };
    const res = await run();
    expect(res).toMatchObject({ ok: false, login: 'octocat' });
    expect(res.message).toBe('Not found on @octocat. Add it as a Signing Key (not an Authentication Key).');
  });

  it('an account with no signing keys at all is the same as not found', async () => {
    answers['/users/octocat/ssh_signing_keys'] = { status: 200, body: [] };
    expect((await run()).ok).toBe(false);
  });

  it('asks for the signing keys without the token: that list is public', async () => {
    let auth: (string | null)[] = [];
    check.fetchImpl = (async (url: string, init?: RequestInit) => {
      auth.push(new Headers(init?.headers).get('authorization'));
      const a = answers[new URL(String(url)).pathname]!;
      return { status: a.status, ok: true, json: async () => a.body } as Response;
    }) as unknown as typeof fetch;
    await run();
    expect(auth).toEqual(['Bearer ghp_personal', null]);
    auth = [];
  });

  it('with no personal token (sdlc-agent-bot) it explains that the App signs, and asks GitHub nothing', async () => {
    token(undefined);
    const res = await run();
    expect(res.ok).toBe(false);
    expect(res.message).toContain('sdlc-agent-bot, commits are signed by the App');
    expect(urls).toEqual([]);
  });

  it('says so when the key has not been made yet, and asks GitHub nothing', async () => {
    await setKey(null);
    expect((await run()).message).toContain('made when the worker starts');
    expect(urls).toEqual([]);
  });

  it('says what GitHub said when the token is refused or the lookup fails', async () => {
    answers['/user'] = { status: 401 };
    expect((await run()).message).toBe('GitHub rejected the token');
    answers['/user'] = { status: 502 };
    expect((await run()).message).toBe('GitHub answered 502');
    answers['/user'] = { status: 200, body: { login: 'octocat' } };
    answers['/users/octocat/ssh_signing_keys'] = { status: 403 };
    expect(await run()).toMatchObject({ ok: false, message: 'GitHub answered 403 when asked for the signing keys of @octocat', login: 'octocat' });
    answers['/user'] = { status: 200, body: {} };
    expect((await run()).message).toBe('GitHub did not say whose token this is');
  });

  it('says so when GitHub cannot be reached', async () => {
    check.fetchImpl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect(await run()).toEqual({ ok: false, message: 'Cannot reach GitHub' });
  });

  it('keyIdentity is the type and the key material, whatever follows', () => {
    expect(keyIdentity('ssh-ed25519 AAAA comment here')).toBe('ssh-ed25519 AAAA');
    expect(keyIdentity('  ssh-ed25519   AAAA\n')).toBe('ssh-ed25519 AAAA');
    expect(keyIdentity('ssh-ed25519 AAAA')).toBe(keyIdentity('ssh-ed25519 AAAA other'));
  });
});
