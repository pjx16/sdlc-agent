import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportRaiser } from '../../support/support-raiser';
import { FakeGitHub } from '../../testing/fake-github';
import { type TestDatabase, createTestDatabase } from '../../testing/test-db';
import { GithubIntake } from '../intake/github-intake';
import { GithubSync } from './github-sync';
import { GithubIssueCreator, issueFooter } from './github-issue-creator';

const REPO = 'acme/billing';
const BOARD = { mode: 'projects', project: { owner: 'acme', number: 3 }, intakeStatus: 'Todo', statusMap: { NEW: 'Backlog', PLANNING: 'Planning' } } as const;

describe('GithubIssueCreator', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let github: FakeGitHub;
  let creator: GithubIssueCreator;
  let intake: GithubIntake;
  let n = 0;

  const project = (gh: Prisma.InputJsonObject | null) =>
    prisma.project.create({ data: { name: `p${++n}`, repoUrl: `https://github.com/${REPO}`, stack: 'ts_node', testCmdTemplate: 'x {files}', localKeyPrefix: `K${n}`, mirrorStatus: 'ok', onboardingStatus: 'confirmed', settings: gh ? { github: gh } : {} } });
  const ticket = (projectId: string, over: Record<string, unknown> = {}) =>
    prisma.ticket.create({ data: { projectId, key: `T-${++n}`, source: 'paste', title: 'Add CSV export', body: '## Problem\nFinance cannot export.', kind: 'feature', githubIssueState: 'pending', ...over } });
  const reload = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.url;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    github = new FakeGitHub();
    creator = new GithubIssueCreator(prisma, github, new SupportRaiser(prisma));
    intake = new GithubIntake(prisma, github);
  }, 180_000);
  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await db?.drop();
  });
  beforeEach(async () => {
    await prisma.supportTicket.deleteMany();
    await prisma.event.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.project.deleteMany();
    await prisma.globalSettings.deleteMany();
    github.reset();
    github.columns = ['Todo', 'Backlog', 'Planning', 'In Progress', 'Done'];
  });

  describe('issues mode', () => {
    it('makes the issue with the ticket text and a footer, links it to the ticket, and leaves the intake label off', async () => {
      const p = await project({ mode: 'issues', label: 'sdlc-agent' });
      const t = await ticket(p.id, { kind: 'bug' });
      await creator.check();
      expect(github.createdIssues).toEqual([{ repo: REPO, number: 500, title: 'Add CSV export', body: `## Problem\nFinance cannot export.${issueFooter(t.key)}`, labels: ['sdlc:new', 'bug'] }]);
      expect(await reload(t.id)).toMatchObject({ externalKey: `${REPO}#500`, source: 'github', githubIssueState: 'created', githubIssueError: null, externalStatus: 'NEW' });
      expect(await prisma.event.count({ where: { ticketId: t.id, message: `Created GitHub issue ${REPO}#500` } })).toBe(1);
    });

    it('intake does not import the issue it made as a second ticket', async () => {
      const p = await project({ mode: 'issues', label: 'sdlc-agent' });
      await ticket(p.id);
      await creator.check();
      // Even if someone adds the intake label to it, the issue is already a ticket.
      github.issues = [{ number: 500, title: 'Add CSV export', body: 'x', url: 'u', labels: ['sdlc-agent'], repo: REPO }];
      expect(await intake.poll()).toMatchObject({ created: 0, duplicates: 1 });
      expect(await prisma.ticket.count()).toBe(1);
    });

    it('does not write "picked up" over an issue it made itself, but the sync still follows the ticket', async () => {
      const p = await project({ mode: 'issues', label: 'sdlc-agent' });
      const t = await ticket(p.id);
      await creator.check();
      await prisma.ticket.update({ where: { id: t.id }, data: { status: 'PLANNING' } });
      await new GithubSync(prisma, github).check();
      expect(github.issueComments).toEqual([]);
      expect(github.labelChanges.at(-1)).toMatchObject({ number: 500, add: ['sdlc:planning'], remove: ['sdlc:new'] });
    });
  });

  describe('projects mode', () => {
    it('puts the card on the board, in the column mapped for NEW', async () => {
      const p = await project(BOARD);
      const t = await ticket(p.id);
      github.items = [{ id: 'c', status: null, closed: false, issue: { number: 500, title: 't', body: '', url: 'u', labels: [], repo: REPO } }];
      await creator.check();
      expect(github.addedToBoard).toEqual([{ owner: 'acme', project: 3, nodeId: 'node-500' }]);
      expect(github.statusMoves).toEqual([{ owner: 'acme', project: 3, number: 500, field: 'Status', option: 'Backlog' }]);
      expect(await reload(t.id)).toMatchObject({ githubIssueState: 'created', externalKey: `${REPO}#500` });
    });

    it('uses the PLANNING column when NEW has none, and leaves the card where the board puts it when neither is mapped', async () => {
      const planning = await project({ ...BOARD, statusMap: { PLANNING: 'Planning' } });
      await ticket(planning.id);
      github.items = [{ id: 'c', status: null, closed: false, issue: { number: 500, title: 't', body: '', url: 'u', labels: [], repo: REPO } }];
      await creator.check();
      expect(github.statusMoves.map((m) => m.option)).toEqual(['Planning']);
      await prisma.ticket.deleteMany();
      await prisma.project.deleteMany();
      github.reset();
      const none = await project({ ...BOARD, statusMap: {} });
      const t = await ticket(none.id);
      await creator.check();
      expect(github.addedToBoard).toHaveLength(1);
      expect(github.statusMoves).toEqual([]);
      expect((await reload(t.id)).githubIssueState).toBe('created');
    });

    it('intake does not import it even when the column it lands in is the intake column', async () => {
      const p = await project({ ...BOARD, statusMap: { NEW: 'Todo' } }); // New = Todo = where intake looks
      await ticket(p.id);
      const found = { number: 500, title: 'Add CSV export', body: 'b', url: 'u', labels: [], repo: REPO };
      github.items = [{ id: 'c', status: 'Todo', closed: false, issue: found }];
      await creator.check();
      expect(github.statusMoves.at(-1)?.option).toBe('Todo');
      expect(await intake.poll()).toMatchObject({ created: 0, duplicates: 1, errors: [] });
      expect(await prisma.ticket.count()).toBe(1);
    });

    it('when only the card fails, the issue still belongs to the ticket, and the person is told', async () => {
      const p = await project(BOARD);
      const t = await ticket(p.id);
      github.failAddToBoard = new Error('GitHub Projects board acme/3 was not found');
      await creator.check();
      expect(await reload(t.id)).toMatchObject({ githubIssueState: 'created', externalKey: `${REPO}#500` });
      expect(await prisma.event.findFirst({ where: { ticketId: t.id, level: 'warn' } })).toMatchObject({ message: expect.stringContaining('could not be put on the board') });
      expect(await prisma.supportTicket.findMany({ where: { ticketId: t.id } })).toMatchObject([{ kind: 'credential', priority: 'fyi', status: 'open', body: expect.stringContaining('Projects board') }]);
    });
  });

  describe('linking an issue that exists', () => {
    const known = (state: 'open' | 'closed', number = 42) => github.knownIssues.set(`${REPO}#${number}`, { number, nodeId: `node-${number}`, url: `https://github.com/${REPO}/issues/${number}`, state, title: 'Add CSV export' });

    it('links an open issue and makes no new one', async () => {
      const p = await project({ mode: 'issues', label: 'sdlc-agent' });
      known('open');
      const t = await ticket(p.id, { githubIssueLink: 42 });
      await creator.check();
      expect(github.createdIssues).toEqual([]);
      expect(await reload(t.id)).toMatchObject({ externalKey: `${REPO}#42`, githubIssueState: 'created' });
      expect(await prisma.event.count({ where: { ticketId: t.id, message: `Linked GitHub issue ${REPO}#42` } })).toBe(1);
    });

    it('makes a new issue, and says why, when the one named is closed or does not exist', async () => {
      const p = await project({ mode: 'issues', label: 'sdlc-agent' });
      known('closed');
      const closed = await ticket(p.id, { githubIssueLink: 42 });
      const missing = await ticket(p.id, { githubIssueLink: 77 });
      await creator.check();
      expect((await reload(closed.id)).externalKey).toBe(`${REPO}#500`);
      expect((await reload(missing.id)).externalKey).toBe(`${REPO}#501`);
      expect((await prisma.event.findFirst({ where: { ticketId: closed.id, level: 'warn' } }))?.message).toContain('is closed');
      expect((await prisma.event.findFirst({ where: { ticketId: missing.id, level: 'warn' } }))?.message).toContain('was not found');
    });

    it('does not make a duplicate when GitHub cannot be asked: it fails, so it can be retried', async () => {
      const p = await project({ mode: 'issues', label: 'sdlc-agent' });
      github.getIssue = async () => {
        throw new Error('gh: HTTP 502');
      };
      const t = await ticket(p.id, { githubIssueLink: 42 });
      await creator.check();
      expect(github.createdIssues).toEqual([]);
      expect(await reload(t.id)).toMatchObject({ githubIssueState: 'failed', githubIssueError: 'gh: HTTP 502' });
      github.getIssue = FakeGitHub.prototype.getIssue;
    });

    it('fails clearly when the issue is already another ticket of the project', async () => {
      const p = await project({ mode: 'issues', label: 'sdlc-agent' });
      known('open');
      await ticket(p.id, { githubIssueState: 'created', externalKey: `${REPO}#42`, source: 'github' });
      const t = await ticket(p.id, { githubIssueLink: 42 });
      await creator.check();
      expect(await reload(t.id)).toMatchObject({ githubIssueState: 'failed', githubIssueError: `${REPO}#42 is already a ticket in this project` });
    });
  });

  describe('when it cannot be made', () => {
    it('marks it failed with the reason, tells the inbox once, and goes on with the next ticket', async () => {
      const p = await project({ mode: 'issues', label: 'sdlc-agent' });
      github.failCreateIssue = new Error('gh: Resource not accessible by personal access token (HTTP 403)');
      const first = await ticket(p.id);
      await creator.check();
      expect(await reload(first.id)).toMatchObject({ githubIssueState: 'failed', githubIssueError: 'gh: Resource not accessible by personal access token (HTTP 403)', status: 'NEW', source: 'paste', externalKey: null });
      await creator.check(); // nothing pending any more: no second item
      const items = await prisma.supportTicket.findMany({ where: { ticketId: first.id } });
      expect(items).toMatchObject([{ kind: 'credential', priority: 'fyi', status: 'open', title: `${first.key}: the GitHub issue could not be made` }]);
      expect(items[0]?.body).toContain('Retry it from the ticket page');
      // The next ticket is not held up by the one that failed.
      github.failCreateIssue = null;
      const second = await ticket(p.id);
      await creator.check();
      expect((await reload(second.id)).githubIssueState).toBe('created');
    });

    it('a retry that works closes the inbox item', async () => {
      const p = await project({ mode: 'issues', label: 'sdlc-agent' });
      github.failCreateIssue = new Error('boom');
      const t = await ticket(p.id);
      await creator.check();
      expect(await prisma.supportTicket.count({ where: { ticketId: t.id, status: 'open' } })).toBe(1);
      github.failCreateIssue = null;
      await prisma.ticket.update({ where: { id: t.id }, data: { githubIssueState: 'pending', githubIssueError: null } }); // what POST /tickets/:id/github-issue/retry does
      await creator.check();
      expect(await reload(t.id)).toMatchObject({ githubIssueState: 'created', githubIssueError: null });
      expect(await prisma.supportTicket.findMany({ where: { ticketId: t.id } })).toMatchObject([{ status: 'resolved', resolvedBy: 'system' }]);
    });

    it('the pipeline is not held: the ticket stays NEW and runnable while the issue is pending or failed', async () => {
      const p = await project({ mode: 'issues', label: 'sdlc-agent' });
      github.failCreateIssue = new Error('boom');
      const t = await ticket(p.id);
      expect((await reload(t.id)).status).toBe('NEW');
      await creator.check();
      expect((await reload(t.id)).status).toBe('NEW');
    });

    it('fails when the project stopped using GitHub after the ticket was made', async () => {
      const p = await project(null);
      const t = await ticket(p.id);
      await creator.check();
      expect(await reload(t.id)).toMatchObject({ githubIssueState: 'failed', githubIssueError: expect.stringContaining('no longer uses GitHub') });
      expect(github.createdIssues).toEqual([]);
    });
  });

  it('leaves a ticket that came from a GitHub issue alone: that is its issue', async () => {
    const p = await project({ mode: 'issues', label: 'sdlc-agent' });
    const t = await ticket(p.id, { source: 'github', externalKey: `${REPO}#9` });
    await creator.check();
    expect(github.createdIssues).toEqual([]);
    expect(await reload(t.id)).toMatchObject({ githubIssueState: 'none', externalKey: `${REPO}#9` });
  });

  it('ignores tickets that did not ask for an issue, and tickets of a disabled project', async () => {
    const p = await project({ mode: 'issues', label: 'sdlc-agent' });
    const plain = await ticket(p.id, { githubIssueState: 'none' });
    const off = await prisma.project.create({ data: { name: 'off', repoUrl: `https://github.com/${REPO}`, stack: 'ts_node', testCmdTemplate: 'x', localKeyPrefix: 'OFF', enabled: false, settings: { github: { mode: 'issues' } } } });
    const disabled = await ticket(off.id);
    await creator.check();
    expect(github.createdIssues).toEqual([]);
    expect((await reload(plain.id)).githubIssueState).toBe('none');
    expect((await reload(disabled.id)).githubIssueState).toBe('pending');
  });

  it('makes at most 20 a round, oldest first', async () => {
    const p = await project({ mode: 'issues', label: 'sdlc-agent' });
    for (let i = 0; i < 22; i++) await ticket(p.id, { title: `T${i}`, createdAt: new Date(Date.now() + i * 1000) });
    await creator.check();
    expect(github.createdIssues).toHaveLength(20);
    expect(github.createdIssues[0]?.title).toBe('T0');
    expect(await prisma.ticket.count({ where: { githubIssueState: 'pending' } })).toBe(2);
  });

  it('checks every 15 seconds: a person waits to see the issue appear', () => {
    expect(creator.name).toBe('github-issue-creator');
    expect(creator.intervalMs).toBe(15_000);
  });
});
