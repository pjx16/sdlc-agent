import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { createTestDatabase, type TestDatabase } from '../testing/test-db';
import { CredentialsService, UNDECRYPTABLE } from './credentials.service';

const GH = 'ghp_abcdefghijklmnopqrstuvwx';
let db: TestDatabase;
let prisma: PrismaService;
let svc: CredentialsService;
const saved = { ...process.env };

beforeAll(async () => {
  db = await createTestDatabase();
  process.env.DATABASE_URL = db.url;
  prisma = new PrismaService();
  svc = new CredentialsService(prisma);
}, 180_000);
afterAll(async () => {
  await prisma.onModuleDestroy();
  await db.drop();
});
afterEach(async () => {
  process.env = { ...saved };
  await prisma.credential.deleteMany();
  svc.invalidate();
});

describe('CredentialsService', () => {
  it('saving a new Anthropic API key ends a pause caused by CLAUDE_AUTH, and only that pause', async () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    delete process.env.ANTHROPIC_API_KEY;
    await prisma.globalSettings.upsert({ where: { id: 'global' }, update: { pipelinePaused: true, pausedCode: 'CLAUDE_CREDITS', pausedReason: 'limit' }, create: { id: 'global', pipelinePaused: true, pausedCode: 'CLAUDE_CREDITS', pausedReason: 'limit' } });
    await svc.set('anthropic_api_key', 'sk-ant-api03-' + 'a'.repeat(40));
    expect((await prisma.globalSettings.findUniqueOrThrow({ where: { id: 'global' } })).pipelinePaused).toBe(true);
    await prisma.globalSettings.update({ where: { id: 'global' }, data: { pausedCode: 'CLAUDE_AUTH' } });
    await svc.set('anthropic_api_key', 'sk-ant-api03-' + 'b'.repeat(40));
    expect(await prisma.globalSettings.findUniqueOrThrow({ where: { id: 'global' } })).toMatchObject({ pipelinePaused: false, pausedCode: null });
    await prisma.globalSettings.deleteMany();
  });

  it('stores secrets encrypted, plain values as plain text, and decrypts on resolve', async () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    delete process.env.GITHUB_TOKEN;
    await svc.set('github_token', GH);
    await svc.set('git_author_name', 'Dev Bot');
    const rows = Object.fromEntries((await prisma.credential.findMany()).map((r) => [r.key, r.value]));
    expect(rows.github_token).toMatch(/^v1\./);
    expect(rows.github_token).not.toContain(GH);
    expect(rows.git_author_name).toBe('Dev Bot');
    const resolved = await svc.resolve();
    expect(resolved.github_token).toBe(GH);
    expect(resolved.git_author_name).toBe('Dev Bot');
    expect(svc.secretsSnapshot()).toContain(GH);
  });

  it('does not read the environment: a variable changes nothing, and what is saved can always be changed', async () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.GITHUB_TOKEN = 'ghp_fromenvfromenvfromenv1234';
    expect((await svc.resolve()).github_token).toBe('');
    expect((await svc.views()).find((v) => v.key === 'github_token')).toMatchObject({ source: 'unset', hint: null });
    await svc.set('github_token', GH);
    expect((await svc.resolve()).github_token).toBe(GH);
    expect((await svc.views()).find((v) => v.key === 'github_token')).toMatchObject({ source: 'db' });
    await expect(svc.set('github_token', 'ghp_anotheranotheranother12345')).resolves.toBeUndefined();
  });

  it('refreshes the cache on set, never exposes a secret in views, and needs ENCRYPTION_KEY for secrets', async () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.GITHUB_TOKEN;
    await expect(svc.set('github_token', GH)).rejects.toThrow('ENCRYPTION_KEY is not set');
    await expect(svc.set('github_token', 'nope')).rejects.toMatchObject({ status: 400 });
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    expect((await svc.resolve()).github_token).toBe('');
    await svc.set('github_token', GH);
    expect((await svc.resolve()).github_token).toBe(GH);
    const views = JSON.stringify(await svc.views());
    expect(views).not.toContain(GH);
    expect(views).toContain('"hint":"uvwx"');
  });

  it('reports an undecryptable value instead of throwing', async () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    delete process.env.GITHUB_TOKEN;
    await svc.set('github_token', GH);
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64'); // a different key
    svc.invalidate();
    expect((await svc.resolve()).github_token).toBe('');
    expect((await svc.views()).find((v) => v.key === 'github_token')).toMatchObject({ source: 'db', verifyError: UNDECRYPTABLE });
  });

  it('reports what is missing', async () => {
    for (const k of ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'DASHBOARD_PASSWORD']) delete process.env[k];
    const status = await svc.status();
    expect(status).toMatchObject({ adminCreated: false, ready: false, missing: ['anthropic_api_key', 'github_token', 'git_author_name', 'git_author_email'] });
  });
});

describe('moving an older install\'s environment variables into the dashboard (once, at start)', () => {
  const encrypted = () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  };
  const rows = async () => Object.fromEntries((await prisma.credential.findMany()).map((r) => [r.key, r]));

  it('saves each variable that is set, checked like anything typed, with secrets encrypted', async () => {
    encrypted();
    const env = { GITHUB_TOKEN: GH, GIT_AUTHOR_NAME: ' Dev Bot ', GIT_AUTHOR_EMAIL: 'dev@example.com', ANTHROPIC_API_KEY: '' } as NodeJS.ProcessEnv;
    expect(await svc.importFromEnv(env)).toBe(3);
    const saved_ = await rows();
    expect(Object.keys(saved_).sort()).toEqual(['git_author_email', 'git_author_name', 'github_token']);
    expect(saved_.github_token?.value).toMatch(/^v1\./);
    expect(saved_.github_token?.value).not.toContain(GH);
    expect(saved_.git_author_name?.value).toBe('Dev Bot');
    expect((await svc.resolve()).github_token).toBe(GH);
    expect((await svc.views()).find((v) => v.key === 'github_token')).toMatchObject({ source: 'db', hint: 'uvwx' });
  });

  it('is done once: a second start moves nothing, and a value changed in the dashboard since is not put back', async () => {
    encrypted();
    const env = { GIT_AUTHOR_NAME: 'Old Name' } as NodeJS.ProcessEnv;
    expect(await svc.importFromEnv(env)).toBe(1);
    await svc.set('git_author_name', 'New Name');
    expect(await svc.importFromEnv(env)).toBe(0);
    expect((await svc.resolve()).git_author_name).toBe('New Name');
  });

  it('never replaces a value that is already in the dashboard', async () => {
    encrypted();
    await svc.set('github_token', GH);
    expect(await svc.importFromEnv({ GITHUB_TOKEN: 'ghp_fromenvfromenvfromenv1234' } as NodeJS.ProcessEnv)).toBe(0);
    expect((await svc.resolve()).github_token).toBe(GH);
  });

  it('skips a value that does not pass the checks, and still moves the others', async () => {
    encrypted();
    expect(await svc.importFromEnv({ GITHUB_TOKEN: 'not-a-token', GIT_AUTHOR_EMAIL: 'dev@example.com' } as NodeJS.ProcessEnv)).toBe(1);
    expect(Object.keys(await rows())).toEqual(['git_author_email']);
  });

  it('without ENCRYPTION_KEY a secret cannot be moved, and a plain value still can', async () => {
    delete process.env.ENCRYPTION_KEY;
    expect(await svc.importFromEnv({ GITHUB_TOKEN: GH, GIT_AUTHOR_NAME: 'Dev Bot' } as NodeJS.ProcessEnv)).toBe(1);
    expect(Object.keys(await rows())).toEqual(['git_author_name']);
  });

  it('with no variables set it does nothing', async () => {
    encrypted();
    expect(await svc.importFromEnv({} as NodeJS.ProcessEnv)).toBe(0);
    expect(await prisma.credential.count()).toBe(0);
  });

  it('runs when the service starts, with the real environment', async () => {
    encrypted();
    process.env.GIT_AUTHOR_NAME = 'From Start';
    await svc.onModuleInit();
    expect((await svc.resolve()).git_author_name).toBe('From Start');
  });
});
