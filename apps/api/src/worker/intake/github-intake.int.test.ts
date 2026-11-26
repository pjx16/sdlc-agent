import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FakeGitHub } from '../../testing/fake-github';
import { type TestDatabase, createTestDatabase } from '../../testing/test-db';
import type { GithubIssue, ProjectItem } from '../github/github-client';
import { GithubIntake, githubKey, kindOfIssue } from './github-intake';

const REPO = 'acme/billing';
const issue = (number: number, labels: string[] = ['sdlc-agent'], repo = REPO): GithubIssue => ({ number, title: `Issue ${number}`, body: `Body ${number}`, url: `https://github.com/${repo}/issues/${number}`, labels, repo });
const card = (id: string, status: string | null, i: GithubIssue, closed = false): ProjectItem => ({ id, status, issue: i, closed });

describe('GitHub intake', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let github: FakeGitHub;
  let intake: GithubIntake;
  let n = 0;

  const project = (github: Prisma.InputJsonObject | null, over: Record<string, unknown> = {}) =>
    prisma.project.create({ data: { name: `p${++n}`, repoUrl: `https://github.com/${REPO}`, stack: 'ts_node', testCmdTemplate: 'x {files}', localKeyPrefix: `G${n}`, mirrorStatus: 'ok', settings: github ? { github } : {}, ...over } });

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.url;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    github = new FakeGitHub();
    intake = new GithubIntake(prisma, github);
  }, 180_000);
  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await db?.drop();
  });
  beforeEach(async () => {
    await prisma.event.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.project.deleteMany();
    await prisma.globalSettings.deleteMany();
    github.reset();
  });

  it('reads the kind of an issue from its labels', () => {
    expect(kindOfIssue(['bug'])).toBe('bug');
    expect(kindOfIssue(['Bug', 'x'])).toBe('bug');
    expect(kindOfIssue(['chore'])).toBe('chore');
    expect(kindOfIssue(['tech-debt'])).toBe('chore');
    expect(kindOfIssue(['enhancement'])).toBe('feature');
    expect(githubKey('a/b', 5)).toBe('a/b#5');
  });

  it('issues mode: stores each labelled issue once, as the next local ticket, with a link back', async () => {
    const p = await project({ mode: 'issues', label: 'sdlc-agent' });
    github.issues = [issue(7, ['sdlc-agent', 'bug']), issue(8), issue(9, ['other'])];
    const first = await intake.poll();
    expect(first).toMatchObject({ projects: 1, created: 2, duplicates: 0, errors: [] });
    const tickets = await prisma.ticket.findMany({ where: { projectId: p.id }, orderBy: { key: 'asc' } });
    expect(tickets.map((t) => [t.key, t.externalKey, t.source, t.kind, t.status])).toEqual([[`${p.localKeyPrefix}-1`, 'acme/billing#7', 'github', 'bug', 'NEW'], [`${p.localKeyPrefix}-2`, 'acme/billing#8', 'github', 'feature', 'NEW']]);
    expect(tickets[0]).toMatchObject({ title: 'Issue 7', type: 'bug' });
    expect(tickets[0]?.body).toContain('Body 7');
    expect(tickets[0]?.body).toContain('https://github.com/acme/billing/issues/7');
    expect(await prisma.event.count({ where: { type: 'intake' } })).toBe(2);
    // The next poll finds the same issues and stores nothing.
    expect(await intake.poll()).toMatchObject({ created: 0, duplicates: 2 });
    expect(await prisma.ticket.count({ where: { projectId: p.id } })).toBe(2);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).nextLocalNumber).toBe(3);
  });

  it('projects mode: takes the open cards of this repository that stand in the intake column', async () => {
    const p = await project({ mode: 'projects', project: { owner: 'acme', number: 3 }, intakeStatus: 'Todo' });
    github.items = [
      card('c1', 'Todo', issue(1)),
      card('c2', 'todo', issue(2)), // the column name is compared without regard to case
      card('c3', 'In Progress', issue(3)),
      card('c4', null, issue(4)),
      card('c5', 'Todo', issue(5, [], 'acme/other')), // another repository's issue is not this project's
      card('c6', 'Todo', issue(6), true), // closed on GitHub
    ];
    expect(await intake.poll()).toMatchObject({ created: 2 });
    expect((await prisma.ticket.findMany({ where: { projectId: p.id }, orderBy: { key: 'asc' } })).map((t) => t.externalKey)).toEqual(['acme/billing#1', 'acme/billing#2']);
  });

  it('projects mode without a board says what to set, and the other projects are still read', async () => {
    await project({ mode: 'projects' });
    const ok = await project({ mode: 'issues' });
    github.issues = [issue(1)];
    const r = await intake.poll();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toContain('Choose the GitHub Projects board');
    expect(r.created).toBe(1);
    expect(await prisma.ticket.count({ where: { projectId: ok.id } })).toBe(1);
  });

  it('a GitHub problem is a result, not a crash, and the next poll tries again', async () => {
    await project({ mode: 'issues' });
    github.failIssues = new Error('HTTP 502');
    expect((await intake.poll()).errors[0]?.message).toBe('HTTP 502');
    github.failIssues = null;
    github.issues = [issue(1)];
    expect((await intake.poll()).created).toBe(1);
  });

  it('skips projects that use no GitHub, are disabled, or whose mirror is not ready', async () => {
    await project(null);
    await project({ mode: 'issues' }, { enabled: false });
    await project({ mode: 'issues' }, { mirrorStatus: 'pending' });
    github.issues = [issue(1)];
    expect(await intake.poll()).toMatchObject({ projects: 0, created: 0 });
    expect(github.calls).not.toContain('listIssues');
  });

  describe('the switches', () => {
    it('the intake switch stops it, and so does the GitHub switch alone', async () => {
      await project({ mode: 'issues' });
      github.issues = [issue(1)];
      await prisma.globalSettings.create({ data: { id: 'global', intakePaused: true } });
      expect(await intake.poll()).toMatchObject({ skipped: 'intake_paused', created: 0 });
      await prisma.globalSettings.update({ where: { id: 'global' }, data: { intakePaused: false, intakeGithubEnabled: false } });
      expect(await intake.poll()).toMatchObject({ skipped: 'source_off', created: 0 });
      expect(await prisma.ticket.count()).toBe(0);
      await prisma.globalSettings.update({ where: { id: 'global' }, data: { intakeGithubEnabled: true } });
      expect(await intake.poll()).toMatchObject({ created: 1 });
    });
  });
});
