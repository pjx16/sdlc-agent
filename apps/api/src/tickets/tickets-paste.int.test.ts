import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestApp, createTestApp } from '../testing/test-app';
import { type TestDatabase, createTestDatabase } from '../testing/test-db';
import { ProjectsModule } from '../projects/projects.module';
import { TicketsModule } from './tickets.module';

describe('Pasted tickets (F3)', () => {
  let db: TestDatabase;
  let t: TestApp;
  let projectId: string;

  const makeProject = (over: Record<string, unknown> = {}) =>
    t.prisma.project.create({ data: { name: `p-${Math.random().toString(36).slice(2, 8)}`, repoUrl: 'https://x/y', stack: 'ts_node', testCmdTemplate: 'x {files}', localKeyPrefix: 'BILL', mirrorStatus: 'ok', ...over } });

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await createTestApp(db.url, [TicketsModule, ProjectsModule]);
  }, 180_000);
  afterAll(async () => {
    await t?.close();
    await db?.drop();
  });
  beforeEach(async () => {
    await t.prisma.event.deleteMany();
    await t.prisma.ticket.deleteMany();
    await t.prisma.project.deleteMany();
    projectId = (await makeProject()).id;
  });

  it('requires a session', async () => {
    await t.anonymous.post('/tickets').send({ projectId, title: 'x' }).expect(401);
  });

  it('creates a NEW ticket with the next local key', async () => {
    const res = await t.agent.post('/tickets').send({ projectId, title: 'Add export', body: 'CSV please', type: 'story', featureKey: 'export' }).expect(201);
    expect(res.body).toMatchObject({ key: 'BILL-1', source: 'paste', externalKey: null, status: 'NEW', title: 'Add export', body: 'CSV please', type: 'story', featureKey: 'export', projectId });
    const second = await t.agent.post('/tickets').send({ projectId, title: 'Fix crash', type: 'bug' }).expect(201);
    expect(second.body).toMatchObject({ key: 'BILL-2', type: 'bug', status: 'NEW' });
    expect((await t.prisma.project.findUniqueOrThrow({ where: { id: projectId } })).nextLocalNumber).toBe(3);
    expect(await t.prisma.event.count({ where: { type: 'intake' } })).toBe(2);
  });

  describe('attached KB docs', () => {
    const catalog = { docs: [{ path: 'auth.md', title: 'Auth' }, { path: 'billing/overview.md', title: 'Billing' }], updatedAt: 'now' };

    it('are stored with the ticket when they are docs of the project', async () => {
      const p = await makeProject({ kbCatalog: catalog });
      const res = await t.agent.post('/tickets').send({ projectId: p.id, title: 'x', kbAttachments: ['auth.md', 'billing/overview.md'] }).expect(201);
      expect(res.body.kbAttachments).toEqual(['auth.md', 'billing/overview.md']);
      expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: res.body.id } })).kbAttachments).toEqual(['auth.md', 'billing/overview.md']);
      expect((await t.agent.post('/tickets').send({ projectId: p.id, title: 'plain' }).expect(201)).body.kbAttachments).toEqual([]);
    });

    it('are refused when they are not KB docs of the project, are repeated, are too many, or climb out of the folder', async () => {
      const p = await makeProject({ kbCatalog: catalog });
      const post = (kbAttachments: unknown) => t.agent.post('/tickets').send({ projectId: p.id, title: 'x', kbAttachments }).expect(400);
      expect((await post(['nope.md'])).body.fields.kbAttachments).toContain('nope.md');
      expect((await post(['auth.md', 'auth.md'])).body.fields.kbAttachments).toContain('twice');
      await post(['../../etc/passwd.md']);
      await post(['auth.txt']);
      await post(Array.from({ length: 6 }, (_, i) => `d${i}.md`));
      await t.agent.post('/tickets').send({ projectId, title: 'x', kbAttachments: ['auth.md'] }).expect(400); // a project whose docs are not listed yet
    });

    it('can be changed until the ticket is coded', async () => {
      const p = await makeProject({ kbCatalog: catalog });
      const id = (await t.agent.post('/tickets').send({ projectId: p.id, title: 'x' }).expect(201)).body.id as string;
      expect((await t.agent.patch(`/tickets/${id}/kb-attachments`).send({ kbAttachments: ['auth.md'] }).expect(200)).body.kbAttachments).toEqual(['auth.md']);
      await t.prisma.ticket.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      await t.agent.patch(`/tickets/${id}/kb-attachments`).send({ kbAttachments: [] }).expect(409);
    });

    it('are listed for a project from the catalog the worker keeps', async () => {
      const p = await makeProject({ kbCatalog: catalog });
      expect((await t.agent.get(`/projects/${p.id}/kb`).expect(200)).body).toEqual({ docs: catalog.docs, updatedAt: 'now' });
      expect((await t.agent.get(`/projects/${projectId}/kb`).expect(200)).body).toEqual({ docs: [], updatedAt: null });
    });
  });

  it('the pasted-tickets switch in Settings stops pasting, with a clear message, and the other sources are not involved', async () => {
    await t.prisma.globalSettings.upsert({ where: { id: 'global' }, update: { intakePasteEnabled: false }, create: { id: 'global', intakePasteEnabled: false } });
    const res = await t.agent.post('/tickets').send({ projectId, title: 'x' }).expect(409);
    expect(res.body.message).toContain('switched off');
    expect(await t.prisma.ticket.count()).toBe(0);
    await t.prisma.globalSettings.update({ where: { id: 'global' }, data: { intakePasteEnabled: true } });
    await t.agent.post('/tickets').send({ projectId, title: 'x' }).expect(201);
  });

  it('a pasted ticket carries a kind, and the older type stays consistent with it', async () => {
    const make = async (body: Record<string, unknown>) => (await t.agent.post('/tickets').send({ projectId, title: 'x', ...body }).expect(201)).body.id as string;
    const stored = async (id: string) => t.prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(await stored(await make({}))).toMatchObject({ kind: 'feature', type: 'story' });
    expect(await stored(await make({ kind: 'bug' }))).toMatchObject({ kind: 'bug', type: 'bug' });
    expect(await stored(await make({ kind: 'chore' }))).toMatchObject({ kind: 'chore', type: 'tech' });
    expect(await stored(await make({ type: 'tech' }))).toMatchObject({ kind: 'chore', type: 'tech' }); // only the old field sent
    expect(await stored(await make({ kind: 'feature', type: 'bug' }))).toMatchObject({ kind: 'feature', type: 'story' }); // the kind wins
    const bad = await t.agent.post('/tickets').send({ projectId, title: 'x', kind: 'epic' }).expect(400);
    expect(bad.body.fields.kind).toContain('feature, bug, chore');
  });

  it('numbers each project independently', async () => {
    const other = await makeProject({ localKeyPrefix: 'OTHR' });
    await t.agent.post('/tickets').send({ projectId, title: 'a' }).expect(201);
    expect((await t.agent.post('/tickets').send({ projectId: other.id, title: 'b' }).expect(201)).body.key).toBe('OTHR-1');
  });

  it('never hands out the same key twice, even for simultaneous pastes', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => t.agent.post('/tickets').send({ projectId, title: `t${i}` })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const keys = results.map((r) => r.body.key as string).sort();
    expect(new Set(keys).size).toBe(8);
    expect(await t.prisma.ticket.count({ where: { projectId } })).toBe(8);
  });

  it('stores a ticket once per (projectId, key)', async () => {
    const first = (await t.agent.post('/tickets').send({ projectId, title: 'a' }).expect(201)).body;
    await expect(t.prisma.ticket.create({ data: { projectId, key: first.key, source: 'paste', title: 'dup' } })).rejects.toThrow(/unique/i);
  });

  it('returns field-level errors and saves nothing', async () => {
    const res = await t.agent.post('/tickets').send({ projectId, title: '', type: 'epic' }).expect(400);
    expect(res.body.fields).toMatchObject({ title: 'required', type: 'must be one of story, bug, tech' });
    expect(await t.prisma.ticket.count()).toBe(0);
    expect((await t.agent.post('/tickets').send({}).expect(400)).body.fields.projectId).toBe('required');
  });

  it('rejects an unknown field (a typo for body) and saves nothing', async () => {
    const res = await t.agent.post('/tickets').send({ projectId, title: 'x', description: 'meant body' }).expect(400);
    expect(res.body.fields).toEqual({ description: 'unknown field' });
    expect(await t.prisma.ticket.count()).toBe(0);
  });

  it('rejects an unknown, disabled or paste-disabled project', async () => {
    expect((await t.agent.post('/tickets').send({ projectId: 'nope', title: 'x' }).expect(400)).body.fields.projectId).toBe('unknown project');
    const disabled = await makeProject({ enabled: false });
    expect((await t.agent.post('/tickets').send({ projectId: disabled.id, title: 'x' }).expect(400)).body.fields.projectId).toBe('this project is disabled');
    const noPaste = await makeProject({ settings: { intake: { paste: false } } });
    expect((await t.agent.post('/tickets').send({ projectId: noPaste.id, title: 'x' }).expect(400)).body.fields.projectId).toContain('turned off');
    expect(await t.prisma.ticket.count()).toBe(0);
  });

  it('accepts tickets only when the mirror is ready (F2) and does not use up a number otherwise', async () => {
    const pending = await makeProject({ mirrorStatus: 'pending', localKeyPrefix: 'PEND' });
    const res = await t.agent.post('/tickets').send({ projectId: pending.id, title: 'x' }).expect(409);
    expect(res.body.error).toBe('conflict');
    expect(res.body.message).toContain('still being cloned');
    const failed = await makeProject({ mirrorStatus: 'failed', mirrorError: 'boom' });
    expect((await t.agent.post('/tickets').send({ projectId: failed.id, title: 'x' }).expect(409)).body.message).toContain('failed');
    expect((await t.prisma.project.findUniqueOrThrow({ where: { id: pending.id } })).nextLocalNumber).toBe(1);
  });

  describe('made from the fields of the create-ticket form', () => {
    const draft = { title: 'Add CSV export', kind: 'feature', problem: 'Finance cannot export.', expected: 'A CSV with every row.', criteria: ['Exports every row', 'Opens in Excel'], notes: 'See the March thread.' };

    it('builds the text from the fields, in the order of the team ticket format', async () => {
      const res = await t.agent.post('/tickets').send({ projectId, ...draft }).expect(201);
      expect(res.body).toMatchObject({ key: 'BILL-1', source: 'paste', type: 'story', title: 'Add CSV export', status: 'NEW', githubIssueState: 'none' });
      expect(res.body.body).toBe(
        ['## Problem', 'Finance cannot export.', '', '## Expected behaviour', 'A CSV with every row.', '', '## Acceptance criteria', '- [ ] Exports every row', '- [ ] Opens in Excel', '', '## Notes', 'See the March thread.'].join('\n'),
      );
    });

    it('a bug and a chore get the matching ticket type', async () => {
      expect((await t.agent.post('/tickets').send({ projectId, ...draft, kind: 'bug', steps: '1. Open Reports' }).expect(201)).body).toMatchObject({ type: 'bug', body: expect.stringContaining('## Steps to reproduce\n1. Open Reports') });
      expect((await t.agent.post('/tickets').send({ projectId, ...draft, kind: 'chore' }).expect(201)).body.type).toBe('tech');
    });

    it('keeps the KB docs and the feature key', async () => {
      const p = await makeProject({ kbCatalog: { docs: [{ path: 'auth.md', title: 'Auth' }], updatedAt: 'now' } });
      const res = await t.agent.post('/tickets').send({ projectId: p.id, ...draft, kbAttachments: ['auth.md'], featureKey: 'export' }).expect(201);
      expect(res.body).toMatchObject({ kbAttachments: ['auth.md'], featureKey: 'export' });
    });

    it('returns a message for each field that needs attention, and saves nothing', async () => {
      const res = await t.agent.post('/tickets').send({ projectId, title: 'x', kind: 'bug', problem: ' ', criteria: [] }).expect(400);
      expect(res.body.fields).toEqual({ problem: 'required', criteria: 'add at least one acceptance criterion', expected: 'required for a bug' });
      expect(await t.prisma.ticket.count()).toBe(0);
      expect((await t.prisma.project.findUniqueOrThrow({ where: { id: projectId } })).nextLocalNumber).toBe(1);
    });

    it('still takes the older shape (a title and a body)', async () => {
      const res = await t.agent.post('/tickets').send({ projectId, title: 'Old way', body: 'Just text' }).expect(201);
      expect(res.body).toMatchObject({ body: 'Just text', githubIssueState: 'none', githubIssueUrl: null });
    });
  });

  describe('the GitHub issue of a ticket', () => {
    const draft = { title: 'Add CSV export', kind: 'feature', problem: 'Finance cannot export.', criteria: ['Exports every row'] };
    const github = (mode: string) => ({ settings: { github: { mode } } });

    it('is only asked for when the ticket asks for it: the worker finds it pending', async () => {
      const p = await makeProject(github('issues'));
      const plain = await t.agent.post('/tickets').send({ projectId: p.id, ...draft }).expect(201);
      const no = await t.agent.post('/tickets').send({ projectId: p.id, ...draft, github: { create: false } }).expect(201);
      const yes = await t.agent.post('/tickets').send({ projectId: p.id, ...draft, github: { create: true } }).expect(201);
      expect([plain.body.githubIssueState, no.body.githubIssueState, yes.body.githubIssueState]).toEqual(['none', 'none', 'pending']);
      expect(yes.body).toMatchObject({ status: 'NEW', githubIssueError: null, githubIssueUrl: null }); // the pipeline is not held up
    });

    it('can name an issue that exists, to link it instead of making one', async () => {
      const p = await makeProject(github('projects'));
      const res = await t.agent.post('/tickets').send({ projectId: p.id, ...draft, github: { create: false, link: 42 } }).expect(201);
      expect(res.body.githubIssueState).toBe('pending');
      expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: res.body.id } })).githubIssueLink).toBe(42);
    });

    it('is refused for a project that does not use GitHub, and saves nothing', async () => {
      const res = await t.agent.post('/tickets').send({ projectId, ...draft, github: { create: true } }).expect(400);
      expect(res.body.fields.github).toContain('does not use GitHub');
      expect(await t.prisma.ticket.count()).toBe(0);
    });

    it('shows the issue address once the ticket has one', async () => {
      const p = await makeProject(github('issues'));
      const made = (await t.agent.post('/tickets').send({ projectId: p.id, ...draft, github: { create: true } }).expect(201)).body;
      await t.prisma.ticket.update({ where: { id: made.id }, data: { externalKey: 'acme/billing#7', source: 'github', githubIssueState: 'created' } });
      expect((await t.agent.get(`/tickets/${made.id}`).expect(200)).body).toMatchObject({ githubIssueState: 'created', githubIssueUrl: 'https://github.com/acme/billing/issues/7' });
    });

    it('retry puts a failed one back to pending, clears the error, and is refused in any other state', async () => {
      const p = await makeProject(github('issues'));
      const made = (await t.agent.post('/tickets').send({ projectId: p.id, ...draft, github: { create: true } }).expect(201)).body;
      await t.agent.post(`/tickets/${made.id}/github-issue/retry`).expect(409); // pending
      await t.prisma.ticket.update({ where: { id: made.id }, data: { githubIssueState: 'failed', githubIssueError: 'Not Found' } });
      const res = await t.agent.post(`/tickets/${made.id}/github-issue/retry`).expect(200);
      expect(res.body).toMatchObject({ githubIssueState: 'pending', githubIssueError: null });
      await t.agent.post(`/tickets/${made.id}/github-issue/retry`).expect(409);
      await t.agent.post('/tickets/does-not-exist/github-issue/retry').expect(404);
      await t.anonymous.post(`/tickets/${made.id}/github-issue/retry`).expect(401);
    });
  });
});
