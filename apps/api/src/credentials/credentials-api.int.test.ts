import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { configureApp } from '../setup';
import { createTestDatabase, type TestDatabase } from '../testing/test-db';
import { TESTER_OPTIONS } from './credential-tester';
import { CredentialsService } from './credentials.service';

const PASSWORD = 'a long enough password';
const GH = 'ghp_abcdefghijklmnopqrstuvwx';
const saved = { ...process.env };
let db: TestDatabase;
let app: INestApplication;
let cookie = '';
let ghStatus = 200;
let brokerStatus = 200;
let anthropicStatus = 200;
const calls: { url: string; headers: Record<string, string> }[] = [];

const fakeFetch = (async (url: string, init: { headers: Record<string, string> }) => {
  calls.push({ url, headers: init.headers });
  if (url.includes('/v1/models')) return new Response(JSON.stringify({ data: [] }), { status: anthropicStatus });
  if (url.includes('/user')) return new Response(JSON.stringify({ login: 'octo' }), { status: ghStatus });
  return new Response(JSON.stringify({ installations: [{ id: 1 }] }), { status: brokerStatus });
}) as unknown as typeof fetch;

beforeAll(async () => {
  db = await createTestDatabase();
  process.env = { ...saved, DATABASE_URL: db.url, DASHBOARD_PASSWORD: PASSWORD, ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  for (const k of ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'BROKER_URL', 'BROKER_KEY', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL']) delete process.env[k];
  const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, AuthModule] })
    .overrideProvider(TESTER_OPTIONS)
    .useValue({ githubApiUrl: 'https://github.test', anthropicApiUrl: 'https://anthropic.test', fetch: fakeFetch })
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const login = await request(app.getHttpServer()).post('/auth/login').set('X-Forwarded-For', '10.3.0.1').send({ password: PASSWORD }).expect(200);
  cookie = ((login.headers['set-cookie'] as unknown as string[])[0] as string).split(';')[0] as string;
}, 180_000);
afterAll(async () => {
  await app?.close();
  process.env = saved;
  await db.drop();
});
beforeEach(() => {
  calls.length = 0;
  ghStatus = 200;
  brokerStatus = 200;
});

const api = () => ({
  get: (p: string) => request(app.getHttpServer()).get(p).set('Cookie', cookie),
  put: (p: string, value: string) => request(app.getHttpServer()).put(p).set('Cookie', cookie).send({ value }),
  del: (p: string) => request(app.getHttpServer()).delete(p).set('Cookie', cookie),
  post: (p: string) => request(app.getHttpServer()).post(p).set('Cookie', cookie),
});

describe('credentials API', () => {
  it('requires a session', async () => {
    await request(app.getHttpServer()).get('/credentials').expect(401);
  });

  it('never returns a secret value, only the last 4 characters', async () => {
    await api().put('/credentials/github_token', GH).expect(200);
    await api().put('/credentials/git_author_name', 'Dev Bot').expect(200);
    const res = await api().get('/credentials').expect(200);
    expect(res.text).not.toContain(GH);
    expect(res.text).not.toContain('abcdefghijklmnop');
    const byKey = Object.fromEntries((res.body as { key: string; hint: string; source: string }[]).map((v) => [v.key, v]));
    expect(byKey.github_token).toMatchObject({ source: 'db', hint: 'uvwx' });
    expect(byKey.git_author_name).toMatchObject({ source: 'db', hint: 'Dev Bot' });
    expect(byKey.anthropic_api_key).toMatchObject({ source: 'unset', hint: null });
  });

  it('validates values, 404s unknown keys, and refuses to overwrite a value set in .env', async () => {
    await api().put('/credentials/github_token', 'nope').expect(400);
    await api().put('/credentials/not_a_key', 'x').expect(404);
    await api().del('/credentials/not_a_key').expect(404);
    process.env.GIT_AUTHOR_NAME = 'Env Author';
    try {
      await api().put('/credentials/git_author_name', 'Other Author').expect(409);
      expect((await api().get('/credentials')).body.find((v: { key: string }) => v.key === 'git_author_name')).toMatchObject({ source: 'env' });
    } finally {
      delete process.env.GIT_AUTHOR_NAME;
    }
  });

  it('tests the GitHub token against GitHub: connected, then rejected', async () => {
    await api().put('/credentials/github_token', GH).expect(200);
    const ok = await api().post('/credentials/github_token/test').expect(200);
    expect(ok.body).toEqual({ ok: true, message: 'Connected as octo' });
    expect(calls[0]).toMatchObject({ url: 'https://github.test/user' });
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${GH}`);
    expect((await api().get('/credentials')).body.find((v: { key: string }) => v.key === 'github_token').verifiedAt).not.toBeNull();

    ghStatus = 401;
    const bad = await api().post('/credentials/github_token/test').expect(200);
    expect(bad.body).toEqual({ ok: false, message: 'GitHub rejected the token' });
    expect((await api().get('/credentials')).body.find((v: { key: string }) => v.key === 'github_token')).toMatchObject({ verifiedAt: null, verifyError: 'GitHub rejected the token' });
  });

  it('tests the broker with its URL and key, and says what is missing otherwise', async () => {
    expect((await api().post('/credentials/broker_key/test').expect(200)).body.ok).toBe(false);
    await api().put('/credentials/broker_url', 'https://broker.test').expect(200);
    await api().put('/credentials/broker_key', `${'a'.repeat(16)}.${'b'.repeat(24)}`).expect(200);
    expect((await api().post('/credentials/broker_key/test').expect(200)).body).toEqual({ ok: true, message: 'Connected to the broker; 1 GitHub installation' });
    expect(calls.some((c) => c.url === 'https://broker.test/v1/installations')).toBe(true);
    brokerStatus = 401;
    expect((await api().post('/credentials/broker_url/test').expect(200)).body).toEqual({ ok: false, message: 'The broker does not know this key' });
  });

  it('tests the Anthropic API key against /v1/models and deletes credentials', async () => {
    await api().put('/credentials/anthropic_api_key', 'sk-ant-api03-abcdefghij').expect(200);
    expect((await api().post('/credentials/anthropic_api_key/test').expect(200)).body).toEqual({ ok: true, message: 'Anthropic accepted the API key' });
    expect(calls.at(-1)).toMatchObject({ url: 'https://anthropic.test/v1/models?limit=1', headers: { 'x-api-key': 'sk-ant-api03-abcdefghij' } });
    anthropicStatus = 401;
    expect((await api().post('/credentials/anthropic_api_key/test').expect(200)).body).toEqual({ ok: false, message: 'Anthropic rejected the API key' });
    anthropicStatus = 200;
    await api().del('/credentials/anthropic_api_key').expect(204);
    expect((await api().post('/credentials/anthropic_api_key/test').expect(200)).body.ok).toBe(false);
    expect(await app.get(CredentialsService).resolve()).toMatchObject({ anthropic_api_key: '' });
  });
});
