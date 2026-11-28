import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalService } from '../../approval/approval.service';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StateMachine } from '../../state/state-machine.service';
import { SupportRaiser } from '../../support/support-raiser';
import { SubtasksService } from '../../subtasks/subtasks.service';
import { FakeGitHub } from '../../testing/fake-github';
import { FakeJiraClients } from '../../testing/fake-jira';
import { type TestDatabase, createTestDatabase } from '../../testing/test-db';
import { GithubApprovalPoller } from './github-approval-poller';
import type { ProjectItem } from './github-client';
import { TicketComments } from './ticket-comments';

const REPO = 'acme/billing';
const draft = [{ seq: 1, title: 'Do it', description: 'd', acceptanceCriteria: ['works'], files: ['src/a.ts'], dependsOn: [] }];

describe('approval from GitHub', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let github: FakeGitHub;
  let poller: GithubApprovalPoller;
  let n = 0;
  let issue = 0;

  const project = (gh: Prisma.InputJsonObject) =>
    prisma.project.create({ data: { name: `p${++n}`, repoUrl: `https://github.com/${REPO}`, stack: 'ts_node', testCmdTemplate: 'x {files}', localKeyPrefix: `A${n}`, mirrorStatus: 'ok', settings: { github: gh } } });
  const ticket = (projectId: string, status: string, over: Record<string, unknown> = {}) =>
    prisma.ticket.create({ data: { projectId, key: `A-${++n}`, externalKey: `${REPO}#${++issue}`, source: 'github', title: 't', status: status as never, breakdownDraft: draft, ...over } });
  const reload = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });
  const onBoard = (t: { externalKey: string | null }, status: string) => {
    github.items = [...github.items, { id: `i${issue}`, status, closed: false, issue: { number: Number(t.externalKey!.split('#')[1]), title: 't', body: '', url: 'u', labels: [], repo: REPO } } satisfies ProjectItem];
  };
  const withLabel = (t: { externalKey: string | null }, label = 'sdlc:approved') => {
    github.issues = [...github.issues, { number: Number(t.externalKey!.split('#')[1]), title: 't', body: '', url: 'u', labels: [label], repo: REPO }];
  };
  const board = { mode: 'projects', project: { owner: 'acme', number: 3 }, approval: { plan: 'Plan approved', breakdown: 'Breakdown approved' }, statusMap: { AWAITING_PLAN_APPROVAL: 'Plan review' } };

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.url;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    github = new FakeGitHub();
    const clients = new FakeJiraClients();
    const approvals = new ApprovalService(prisma, new StateMachine(prisma), new SubtasksService(prisma, clients));
    poller = new GithubApprovalPoller(prisma, github, approvals, new TicketComments(prisma, github));
  }, 180_000);
  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await db?.drop();
  });
  beforeEach(async () => {
    await prisma.event.deleteMany();
    await prisma.supportTicket.deleteMany();
    await prisma.subtask.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.project.deleteMany();
    github.reset();
  });

  describe('projects mode', () => {
    it('a card moved to the plan approval column approves the plan', async () => {
      const p = await project(board);
      const t = await ticket(p.id, 'AWAITING_PLAN_APPROVAL');
      onBoard(t, 'Plan approved');
      await poller.check();
      expect((await reload(t.id)).status).toBe('BREAKDOWN');
      expect((await prisma.event.findMany({ where: { ticketId: t.id, type: 'github' } })).map((e) => e.message)).toContain('Plan approved on GitHub');
    });

    it('a card moved to the breakdown approval column creates the subtasks and starts the work', async () => {
      const p = await project(board);
      const t = await ticket(p.id, 'AWAITING_BREAKDOWN_APPROVAL');
      onBoard(t, 'breakdown approved'); // column names compare without regard to case
      await poller.check();
      expect((await reload(t.id)).status).toBe('IN_PROGRESS');
      expect(await prisma.subtask.count({ where: { ticketId: t.id } })).toBe(1);
    });

    it('a card in any other column changes nothing, and the board is read once for all tickets', async () => {
      const p = await project(board);
      const a = await ticket(p.id, 'AWAITING_PLAN_APPROVAL');
      const b = await ticket(p.id, 'AWAITING_PLAN_APPROVAL');
      onBoard(a, 'Plan review');
      onBoard(b, 'Breakdown approved'); // the wrong approval column for the state
      await poller.check();
      expect((await reload(a.id)).status).toBe('AWAITING_PLAN_APPROVAL');
      expect((await reload(b.id)).status).toBe('AWAITING_PLAN_APPROVAL');
      expect(github.calls.filter((c) => c === 'listProjectItems')).toHaveLength(1);
    });

    it('with the default columns on, the sdlc-agent columns approve', async () => {
      const p = await project({ mode: 'projects', project: { owner: 'acme', number: 3 }, useDefaultColumns: true });
      const t = await ticket(p.id, 'AWAITING_PLAN_APPROVAL');
      onBoard(t, 'Plan approved');
      await poller.check();
      expect((await reload(t.id)).status).toBe('BREAKDOWN');
    });

    it('open questions bounce the plan: a comment, the card back in review, no approval, and no repeat on the next poll', async () => {
      const p = await project(board);
      const t = await ticket(p.id, 'AWAITING_PLAN_APPROVAL');
      await new SupportRaiser(prisma).raise({ kind: 'open_question', ticketId: t.id, title: 'Which delimiter?', body: 'q', dedupeKey: 'q-Whi' });
      onBoard(t, 'Plan approved');
      github.columns = ['Plan review', 'Plan approved'];
      await poller.check();
      expect((await reload(t.id)).status).toBe('AWAITING_PLAN_APPROVAL');
      expect(github.threads.get(`${REPO}#${issue}`)![0]!.body).toContain('Answer the 1 open question of the plan in the dashboard');
      expect(github.statusMoves).toEqual([expect.objectContaining({ number: issue, option: 'Plan review' })]);
      await poller.check();
      expect(github.threads.get(`${REPO}#${issue}`)).toHaveLength(1);
    });

    it('does nothing for a project without approval columns, a Jira ticket, or a ticket not waiting', async () => {
      const none = await project({ mode: 'projects', project: { owner: 'acme', number: 3 } });
      const t = await ticket(none.id, 'AWAITING_PLAN_APPROVAL');
      onBoard(t, 'Plan approved');
      const p = await project(board);
      const jira = await ticket(p.id, 'AWAITING_PLAN_APPROVAL', { source: 'jira', externalKey: 'SDA-1' });
      const working = await ticket(p.id, 'PLANNING');
      onBoard(working, 'Plan approved');
      await poller.check();
      expect([(await reload(t.id)).status, (await reload(jira.id)).status, (await reload(working.id)).status]).toEqual(['AWAITING_PLAN_APPROVAL', 'AWAITING_PLAN_APPROVAL', 'PLANNING']);
    });
  });

  describe('issues mode', () => {
    it('the approval label approves the plan and is taken off', async () => {
      const p = await project({ mode: 'issues' });
      const t = await ticket(p.id, 'AWAITING_PLAN_APPROVAL');
      withLabel(t);
      await poller.check();
      expect((await reload(t.id)).status).toBe('BREAKDOWN');
      expect(github.labelChanges).toEqual([{ repo: REPO, number: issue, add: [], remove: ['sdlc:approved'] }]);
    });

    it('the same label approves the breakdown, and a custom label is used when set', async () => {
      const p = await project({ mode: 'issues', approval: { label: 'ok-to-go' } });
      const t = await ticket(p.id, 'AWAITING_BREAKDOWN_APPROVAL');
      withLabel(t, 'sdlc:approved');
      await poller.check();
      expect((await reload(t.id)).status).toBe('AWAITING_BREAKDOWN_APPROVAL');
      withLabel(t, 'ok-to-go');
      await poller.check();
      expect((await reload(t.id)).status).toBe('IN_PROGRESS');
    });

    it('open questions bounce the plan with a comment, and the label still comes off', async () => {
      const p = await project({ mode: 'issues' });
      const t = await ticket(p.id, 'AWAITING_PLAN_APPROVAL');
      await new SupportRaiser(prisma).raise({ kind: 'open_question', ticketId: t.id, title: 'Which?', body: 'q', dedupeKey: 'q-Whi' });
      withLabel(t);
      await poller.check();
      expect((await reload(t.id)).status).toBe('AWAITING_PLAN_APPROVAL');
      expect(github.threads.get(`${REPO}#${issue}`)![0]!.body).toContain('open question');
      expect(github.labelChanges[0]).toMatchObject({ remove: ['sdlc:approved'] });
    });

    it('an invalid proposed breakdown is not approved, with a warning', async () => {
      const p = await project({ mode: 'issues' });
      const t = await ticket(p.id, 'AWAITING_BREAKDOWN_APPROVAL', { breakdownDraft: [] });
      withLabel(t);
      await poller.check();
      expect((await reload(t.id)).status).toBe('AWAITING_BREAKDOWN_APPROVAL');
      expect((await prisma.event.findMany({ where: { ticketId: t.id, level: 'warn' } })).map((e) => e.message)).toEqual([expect.stringContaining('could not be approved on GitHub')]);
    });

    it('a GitHub problem on one project does not stop the next', async () => {
      const p = await project({ mode: 'issues' });
      const t = await ticket(p.id, 'AWAITING_PLAN_APPROVAL');
      github.failIssues = new Error('gh: HTTP 502');
      await expect(poller.check()).resolves.toBeUndefined();
      expect((await reload(t.id)).status).toBe('AWAITING_PLAN_APPROVAL');
    });
  });
});
