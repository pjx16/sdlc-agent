import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service';
import { FakeGitHub } from '../../testing/fake-github';
import { type TestDatabase, createTestDatabase } from '../../testing/test-db';
import { TicketComments, issueMarker } from './ticket-comments';

describe('TicketComments', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let github: FakeGitHub;
  let comments: TicketComments;
  let n = 0;

  const ticket = async (over: Record<string, unknown> = {}) => {
    const p = await prisma.project.create({ data: { name: `p${++n}`, repoUrl: 'https://github.com/acme/billing', stack: 'ts_node', testCmdTemplate: 'x', localKeyPrefix: `C${n}` } });
    return prisma.ticket.create({ data: { projectId: p.id, key: `C${n}-1`, source: 'github', externalKey: 'acme/billing#7', title: 't', ...over } });
  };
  const thread = () => github.threads.get('acme/billing#7') ?? [];
  const events = (ticketId: string) => prisma.event.findMany({ where: { ticketId, type: 'github' }, orderBy: { at: 'asc' } });

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.url;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    github = new FakeGitHub();
    comments = new TicketComments(prisma, github);
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

  it('the marker of a comment is its ticket and its kind, and does not change with the text', () => {
    expect(issueMarker('ABC-12', 'plan')).toBe('sdlc-agent:ABC-12:plan');
  });

  it('posts a comment on the ticket’s GitHub issue', async () => {
    const t = await ticket();
    expect(await comments.post(t, 'plan', '## The plan\n- one')).toBe('created');
    expect(thread()).toHaveLength(1);
    expect(thread()[0]!.body).toBe(`## The plan\n- one\n\n<!-- sdlc-agent:${t.key}:plan -->`);
  });

  it('posting the same text again leaves one comment and nothing new', async () => {
    const t = await ticket();
    await comments.post(t, 'plan', 'The plan');
    expect(await comments.post(t, 'plan', 'The plan')).toBe('unchanged');
    expect(thread()).toHaveLength(1);
  });

  it('posting changed text rewrites the same comment, so a stage that runs twice never leaves two', async () => {
    const t = await ticket();
    await comments.post(t, 'plan', 'Plan v1');
    const id = thread()[0]!.id;
    expect(await comments.post(t, 'plan', 'Plan v2')).toBe('updated');
    expect(thread()).toHaveLength(1);
    expect(thread()[0]).toMatchObject({ id, body: expect.stringContaining('Plan v2') });
  });

  it('each kind of comment is its own comment', async () => {
    const t = await ticket();
    await comments.post(t, 'plan', 'The plan');
    await comments.post(t, 'breakdown', '- [ ] S1');
    expect(thread().map((c) => c.body.match(/sdlc-agent:\S+:(\w+)/)?.[1])).toEqual(['plan', 'breakdown']);
  });

  it('a ticket with no GitHub issue has nowhere to talk: nothing is sent, and the note is made once', async () => {
    const t = await ticket({ source: 'paste', externalKey: null });
    expect(await comments.post(t, 'plan', 'The plan')).toBe('no_issue');
    expect(await comments.post(t, 'plan', 'The plan again')).toBe('no_issue');
    expect(github.calls).not.toContain('upsertIssueComment');
    const notes = await events(t.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ level: 'info', message: 'The plan was not posted: this ticket has no GitHub issue to comment on' });
  });

  it('a different kind of comment on the same ticket gets its own note', async () => {
    const t = await ticket({ source: 'paste', externalKey: null });
    await comments.post(t, 'plan', 'x');
    await comments.post(t, 'breakdown', 'y');
    expect((await events(t.id)).map((e) => e.message)).toEqual(['The plan was not posted: this ticket has no GitHub issue to comment on', 'The breakdown was not posted: this ticket has no GitHub issue to comment on']);
  });

  it('a GitHub problem is noted, never thrown into the pipeline', async () => {
    const t = await ticket();
    github.failComments = new Error('gh: Resource not accessible by personal access token (HTTP 403)');
    await expect(comments.post(t, 'plan', 'The plan')).resolves.toBe('failed');
    const notes = await events(t.id);
    expect(notes).toEqual([expect.objectContaining({ level: 'warn', message: 'The plan could not be posted to GitHub: gh: Resource not accessible by personal access token (HTTP 403)' })]);
    github.failComments = null;
    expect(await comments.post(t, 'plan', 'The plan')).toBe('created'); // and the next try works
  });

  it('only the comment of this ticket is touched when another ticket shares the issue thread', async () => {
    const a = await ticket();
    const b = await ticket({ externalKey: 'acme/billing#7' });
    await comments.post(a, 'plan', 'A plan');
    await comments.post(b, 'plan', 'B plan');
    expect(thread()).toHaveLength(2);
    await comments.post(a, 'plan', 'A plan, changed');
    expect(thread().map((c) => c.body.split('\n')[0])).toEqual(['A plan, changed', 'B plan']);
  });
});
