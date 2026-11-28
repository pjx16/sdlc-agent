import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FakeGitHub } from '../../testing/fake-github';
import { type TestDatabase, createTestDatabase } from '../../testing/test-db';
import { GithubSync, defaultColumn, parseGithubKey, stateLabel } from './github-sync';

const REPO = 'acme/billing';

describe('GitHub write-back', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let github: FakeGitHub;
  let sync: GithubSync;
  let n = 0;

  const project = (github: Prisma.InputJsonObject) =>
    prisma.project.create({ data: { name: `p${++n}`, repoUrl: `https://github.com/${REPO}`, stack: 'ts_node', testCmdTemplate: 'x {files}', localKeyPrefix: `G${n}`, mirrorStatus: 'ok', settings: { github } } });
  const ticket = (projectId: string, over: Record<string, unknown> = {}) =>
    prisma.ticket.create({ data: { projectId, key: `G-${++n}`, externalKey: 'acme/billing#7', source: 'github', title: 't', status: 'PLANNING', ...over } });
  const reload = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.url;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    github = new FakeGitHub();
    sync = new GithubSync(prisma, github);
  }, 180_000);
  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await db?.drop();
  });
  beforeEach(async () => {
    await prisma.event.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.project.deleteMany();
    github.reset();
  });

  it('knows its labels, its default columns and its keys', () => {
    expect(stateLabel('AWAITING_PLAN_APPROVAL')).toBe('sdlc:awaiting-plan-approval');
    expect([defaultColumn('NEW'), defaultColumn('PLANNING'), defaultColumn('IN_HUMAN_REVIEW'), defaultColumn('DONE'), defaultColumn('ON_HOLD'), defaultColumn('FAILED')]).toEqual([null, 'In Progress', 'In Progress', 'Done', null, null]);
    expect(parseGithubKey('acme/billing#7')).toEqual({ repo: 'acme/billing', number: 7 });
    expect(parseGithubKey('ABC-1')).toBeNull();
    expect(parseGithubKey(null)).toBeNull();
  });

  describe('issues mode', () => {
    it('labels the issue with the state, says it was picked up, and swaps the label as the state changes', async () => {
      const p = await project({ mode: 'issues' });
      const t = await ticket(p.id);
      await sync.check();
      expect(github.labelChanges).toEqual([{ repo: REPO, number: 7, add: ['sdlc:planning'], remove: [] }]);
      expect(github.issueComments.map((c) => c.body)).toEqual([`Picked up by sdlc-agent as **${t.key}**.`]);
      expect((await reload(t.id)).externalStatus).toBe('PLANNING');
      await sync.check(); // nothing changed: nothing written
      expect(github.labelChanges).toHaveLength(1);
      await prisma.ticket.update({ where: { id: t.id }, data: { status: 'AWAITING_PLAN_APPROVAL' } });
      await sync.check();
      expect(github.labelChanges.at(-1)).toEqual({ repo: REPO, number: 7, add: ['sdlc:awaiting-plan-approval'], remove: ['sdlc:planning'] });
      expect(github.issueComments).toHaveLength(1); // the pick-up comment is written once
    });

    it('closes the issue when the ticket is done, with a link to the PR', async () => {
      const p = await project({ mode: 'issues' });
      const t = await ticket(p.id, { status: 'DONE', prUrl: 'https://github.com/acme/billing/pull/9', externalStatus: 'IN_HUMAN_REVIEW' });
      await sync.check();
      expect(github.closed).toEqual([{ repo: REPO, number: 7 }]);
      expect(github.issueComments.at(-1)?.body).toContain('pull/9');
      expect((await reload(t.id)).externalStatus).toBe('DONE');
      await sync.check();
      expect(github.closed).toHaveLength(1); // done and written as done: left alone
    });
  });

  describe('projects mode', () => {
    const board = { mode: 'projects', project: { owner: 'acme', number: 3 } };
    const onBoard = () => (github.items = [{ id: 'c1', status: 'Todo', closed: false, issue: { number: 7, title: 't', body: '', url: '', labels: [], repo: REPO } }]);

    it('moves the card: In Progress while the pipeline works, Done at the end', async () => {
      const p = await project(board);
      onBoard();
      const t = await ticket(p.id);
      await sync.check();
      expect(github.statusMoves).toEqual([{ owner: 'acme', project: 3, number: 7, field: 'Status', option: 'In Progress' }]);
      await prisma.ticket.update({ where: { id: t.id }, data: { status: 'DONE' } });
      await sync.check();
      expect(github.statusMoves.at(-1)?.option).toBe('Done');
      expect(github.closed).toEqual([{ repo: REPO, number: 7 }]);
    });

    it('uses the column the project mapped, and leaves the card alone for a state mapped to null', async () => {
      const p = await project({ ...board, statusMap: { PLANNING: 'Todo', BREAKDOWN: null } });
      onBoard();
      const t = await ticket(p.id);
      await sync.check();
      expect(github.statusMoves.at(-1)?.option).toBe('Todo');
      await prisma.ticket.update({ where: { id: t.id }, data: { status: 'BREAKDOWN' } });
      const moves = github.statusMoves.length;
      await sync.check();
      expect(github.statusMoves).toHaveLength(moves);
      expect((await reload(t.id)).externalStatus).toBe('BREAKDOWN');
    });

    it('with the default columns on, the missing ones are made on the board and the card then moves', async () => {
      const p = await project({ ...board, useDefaultColumns: true });
      onBoard();
      const t = await ticket(p.id, { status: 'AWAITING_PLAN_APPROVAL' });
      await sync.check();
      expect(github.calls).toContain('ensureStatusOptions');
      expect(github.columns).toEqual(expect.arrayContaining(['Plan review', 'Plan approved', 'Breakdown review', 'Breakdown approved']));
      expect(github.statusMoves.at(-1)?.option).toBe('Plan review');
      expect((await reload(t.id)).externalStatus).toBe('AWAITING_PLAN_APPROVAL');
    });

    it('without the default columns, a missing column is not created', async () => {
      const p = await project({ ...board, statusMap: { PLANNING: 'Shipped' } });
      onBoard();
      await ticket(p.id);
      await sync.check();
      expect(github.calls).not.toContain('ensureStatusOptions');
    });

    it('a column the board does not have is a warning on the ticket, not a failure', async () => {
      const p = await project({ ...board, statusMap: { PLANNING: 'Shipped' } });
      onBoard();
      const t = await ticket(p.id);
      await sync.check();
      expect(await prisma.event.findFirst({ where: { ticketId: t.id, type: 'github' } })).toMatchObject({ level: 'warn', message: expect.stringContaining('"Shipped"') });
      expect((await reload(t.id)).externalStatus).toBe('PLANNING');
    });
  });

  it('a GitHub problem leaves the state unwritten for the next poll; other sources and projects without GitHub are not touched', async () => {
    const p = await project({ mode: 'issues' });
    const t = await ticket(p.id);
    const off = await project({ mode: 'off' });
    const o = await ticket(off.id);
    const jira = await prisma.ticket.create({ data: { projectId: p.id, key: 'ABC-1', externalKey: 'ABC-1', source: 'jira', title: 'j', status: 'PLANNING' } });
    const failing = Object.assign(Object.create(github) as FakeGitHub, { setIssueLabels: async () => Promise.reject(new Error('HTTP 502')) });
    await new GithubSync(prisma, failing).check();
    expect((await reload(t.id)).externalStatus).toBeNull();
    await sync.check();
    expect((await reload(t.id)).externalStatus).toBe('PLANNING');
    expect((await reload(o.id)).externalStatus).toBe('PLANNING'); // nothing to write for a project that does not use GitHub: counted as written
    expect((await reload(jira.id)).externalStatus).toBeNull();
    expect(github.labelChanges).toHaveLength(1);
  });
});
