import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrokerClient } from '../broker/broker-client';
import { CredentialsService } from '../credentials/credentials.service';
import { type TestApp, createTestApp } from '../testing/test-app';
import { type TestDatabase, createTestDatabase } from '../testing/test-db';
import { GithubReadService } from './github-read.service';
import { ProjectsModule } from './projects.module';

describe('GET /projects/:id/github/issues/search', () => {
  let db: TestDatabase;
  let t: TestApp;
  let reader: GithubReadService;
  let calls: { url: string; auth: string | null }[];
  let answer: { status: number; body: unknown };
  let n = 0;

  const project = (over: Record<string, unknown> = {}) =>
    t.prisma.project.create({ data: { name: `gs-${++n}`, repoUrl: 'https://github.com/acme/billing', stack: 'ts_node', testCmdTemplate: 'x {files}', localKeyPrefix: `G${n}`, ...over } });
  const search = (id: string, title?: string) => t.agent.get(`/projects/${id}/github/issues/search`).query(title === undefined ? {} : { title });

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await createTestApp(db.url, [ProjectsModule]);
    reader = t.app.get(GithubReadService);
  }, 180_000);
  afterAll(async () => {
    await t?.close();
    await db?.drop();
  });
  beforeEach(async () => {
    await t.prisma.project.deleteMany({ where: { name: { startsWith: 'gs-' } } });
    calls = [];
    answer = { status: 200, body: { items: [] } };
    reader.fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      return { ok: answer.status < 400, status: answer.status, json: async () => answer.body } as Response;
    }) as typeof fetch;
    vi.spyOn(t.app.get(CredentialsService), 'resolve').mockResolvedValue({ github_token: 'ghp_personal' } as never);
  });

  it('requires a session', async () => {
    const p = await project();
    await t.anonymous.get(`/projects/${p.id}/github/issues/search`).query({ title: 'x' }).expect(401);
  });

  it('returns the open issues with exactly this title, and only those', async () => {
    const p = await project();
    answer.body = { items: [{ number: 42, title: 'Add CSV export', html_url: 'https://github.com/acme/billing/issues/42' }, { number: 43, title: 'Add CSV export to admin', html_url: 'u43' }, { number: 44, title: ' add csv EXPORT', html_url: 'u44' }] };
    const res = await search(p.id, 'Add CSV export').expect(200);
    expect(res.body).toEqual([{ number: 42, title: 'Add CSV export', url: 'https://github.com/acme/billing/issues/42' }, { number: 44, title: ' add csv EXPORT', url: 'u44' }]);
  });

  it('asks GitHub for open issues of this repository only, with the title as a phrase', async () => {
    const p = await project();
    await search(p.id, 'Fix "quoted" thing').expect(200);
    const q = new URL(calls[0]!.url).searchParams.get('q');
    expect(q).toBe('repo:acme/billing is:issue is:open in:title "Fix  quoted  thing"');
    expect(new URL(calls[0]!.url).pathname).toBe('/search/issues');
  });

  it('uses the personal token for a project that has its own, and the bot token for one that works as the bot', async () => {
    const mine = await project();
    await search(mine.id, 'x').expect(200);
    expect(calls[0]!.auth).toBe('Bearer ghp_personal');
    const bot = await project({ githubAuth: 'bot' });
    const token = vi.spyOn(t.app.get(BrokerClient), 'token').mockResolvedValue({ token: 'ghs_bot', expiresAt: 'later' } as never);
    await search(bot.id, 'x').expect(200);
    expect(token).toHaveBeenCalledWith('acme/billing');
    expect(calls[1]!.auth).toBe('Bearer ghs_bot');
  });

  it('answers an empty list, without asking GitHub, when there is no title', async () => {
    const p = await project();
    expect((await search(p.id).expect(200)).body).toEqual([]);
    expect((await search(p.id, '   ').expect(200)).body).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('says so when the project does not exist, there is no token, or GitHub fails', async () => {
    await search('nope', 'x').expect(404);
    const p = await project();
    vi.spyOn(t.app.get(CredentialsService), 'resolve').mockResolvedValue({} as never);
    expect((await search(p.id, 'x').expect(409)).body.message).toContain('no GitHub token');
    vi.spyOn(t.app.get(CredentialsService), 'resolve').mockResolvedValue({ github_token: 'ghp_personal' } as never);
    answer = { status: 403, body: {} };
    const res = await search(p.id, 'x').expect(502);
    expect(res.body).toMatchObject({ error: 'github_error', message: 'GitHub answered 403' });
    reader.fetchImpl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect((await search(p.id, 'x').expect(502)).body.message).toBe('Cannot reach GitHub');
  });
});
