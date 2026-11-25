import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CredentialsService } from '../credentials/credentials.service';
import { FakeGitHub } from '../testing/fake-github';
import { SupportNotifier } from '../worker/support-notifier';
import { StageLauncher } from '../worker/pipeline/stage-launcher';
import { MAX_NETWORK_FAILURES_PER_DAY, StageOutcomes } from '../worker/pipeline/stage-outcomes';
import { WorkerConfig } from '../worker/worker-config';
import { type TestApp, createTestApp } from '../testing/test-app';
import { type TestDatabase, createTestDatabase } from '../testing/test-db';
import { StateMachine } from '../state/state-machine.service';
import { PrReviewBackfill } from './pr-review-backfill';
import { SupportRaiser } from './support-raiser';
import { SupportModule } from './support.module';

describe('Support tickets', () => {
  let db: TestDatabase;
  let t: TestApp;
  let projectId: string;
  let n = 0;
  let outcomes: StageOutcomes;
  let launcher: StageLauncher;
  let raiser: SupportRaiser;
  let states: StateMachine;
  let lastInputs: Record<string, unknown> | null = null;

  const ticket = (over: Record<string, unknown> = {}) => t.prisma.ticket.create({ data: { projectId, key: `K-${++n}`, source: 'paste', title: `title ${n}`, status: 'PLANNING', ...over } });
  const run = (ticketId: string, stage = 'solutionDesign') => t.prisma.stageRun.create({ data: { projectId, ticketId, stage: stage as never, model: 'm', attempt: 1, status: 'failed' } });
  const reload = (id: string) => t.prisma.ticket.findUniqueOrThrow({ where: { id } });
  const tickets = (ticketId: string, kind?: string) => t.prisma.supportTicket.findMany({ where: { ticketId, ...(kind ? { kind: kind as never } : {}) }, orderBy: { createdAt: 'asc' } });
  const act = (id: string, body: Record<string, unknown>) => t.agent.post(`/support-tickets/${id}/action`).send(body);
  /** A held ticket with an open question, as the worker leaves it. */
  const asked = async (stage = 'solutionDesign', question = 'Which currency?') => {
    const tk = await ticket({ status: 'ON_HOLD', holdReason: 'awaiting_answer', holdFromStatus: 'PLANNING' });
    const r = await run(tk.id, stage);
    const { ticket: q } = await raiser.raise({ kind: 'question', ticketId: tk.id, stageRunId: r.id, stage, title: question, body: question, dedupeKey: `question:${r.id}:${n}` });
    return { tk, q };
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await createTestApp(db.url, [SupportModule]);
    projectId = (await t.prisma.project.create({ data: { name: 'p', repoUrl: 'https://x/y', stack: 'ts_node', testCmdTemplate: 'x {files}', localKeyPrefix: 'P', mirrorStatus: 'ok' } })).id;
    raiser = t.app.get(SupportRaiser);
    states = t.app.get(StateMachine);
    outcomes = new StageOutcomes(t.prisma, raiser);
    launcher = new StageLauncher(t.prisma, new WorkerConfig({ DATA_DIR: '/tmp/sdlc-support-test', DATABASE_URL: db.url } as NodeJS.ProcessEnv), { run: async (req: { inputs: Record<string, unknown> }) => ((lastInputs = req.inputs), { kind: 'done' }) } as never);
  }, 180_000);
  afterAll(async () => {
    await t?.close();
    await db?.drop();
  });
  beforeEach(async () => {
    lastInputs = null;
    await t.prisma.supportTicket.deleteMany();
    await t.prisma.globalSettings.deleteMany();
    raiser.notifier = null;
  });

  it('requires a session', async () => {
    await t.anonymous.get('/support-tickets').expect(401);
    await t.anonymous.get('/support-tickets/counts').expect(401);
    await t.anonymous.post('/support-tickets/x/action').send({ action: 'dismiss' }).expect(401);
  });

  describe('raising (dedupe)', () => {
    it('the same problem never opens two tickets while one is open, and can open again after it closed', async () => {
      const tk = await ticket();
      const input = { kind: 'hold' as const, ticketId: tk.id, title: 'stuck', body: 'b', dedupeKey: `hold:${tk.id}` };
      const first = await raiser.raise(input);
      const second = await raiser.raise(input);
      expect(first.created).toBe(true);
      expect(second).toMatchObject({ created: false, ticket: { id: first.ticket.id } });
      expect(await tickets(tk.id)).toHaveLength(1);
      await raiser.close({ ticketId: tk.id }, 'resolved', 'user');
      expect((await raiser.raise(input)).created).toBe(true);
    });

    it('two raisers at once still make one ticket (the partial unique index decides)', async () => {
      const tk = await ticket();
      const input = { kind: 'hold' as const, ticketId: tk.id, title: 'race', body: 'b', dedupeKey: `race:${tk.id}` };
      const results = await Promise.all([raiser.raise(input), raiser.raise(input), raiser.raise(input)]);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(await tickets(tk.id)).toHaveLength(1);
    });

    it('fills the project, the default priority and logs one event', async () => {
      const tk = await ticket();
      const { ticket: q } = await raiser.raise({ kind: 'pr_ready', ticketId: tk.id, title: 'ready', body: 'b' });
      expect(q).toMatchObject({ projectId, priority: 'fyi', status: 'open' });
      expect(await t.prisma.event.count({ where: { ticketId: tk.id, type: 'support' } })).toBe(1);
    });
  });

  describe('a stage asks (worker side)', () => {
    it('raises one blocking question ticket and holds the ticket (awaiting_answer)', async () => {
      const tk = await ticket();
      const r = await run(tk.id);
      const out = await outcomes.forResult(tk.id, 'solutionDesign', { kind: 'needs_input', question: 'Which currency?', stageRunId: r.id } as never);
      expect(out).toMatchObject({ kind: 'hold', reason: 'awaiting_answer' });
      expect(await tickets(tk.id)).toMatchObject([{ kind: 'question', stage: 'solutionDesign', body: 'Which currency?', status: 'open', priority: 'blocking', projectId }]);
    });

    describe('a stage that failed because of the network', () => {
      const failed = (stageRunId: string) => ({ kind: 'failed', reason: 'getaddrinfo ENOTFOUND api.anthropic.com', errorCode: 'NETWORK_ERROR', stageRunId, attempts: 1 }) as never;

      it('leaves the ticket where it is: no hold, no support ticket, only one timeline line for the outage', async () => {
        const tk = await ticket({ status: 'PLANNING' });
        const r = await run(tk.id);
        expect(await outcomes.forResult(tk.id, 'solutionDesign', failed(r.id))).toEqual({ kind: 'stay', network: true });
        expect(await outcomes.forResult(tk.id, 'solutionDesign', failed(r.id))).toEqual({ kind: 'stay', network: true });
        expect((await reload(tk.id)).status).toBe('PLANNING');
        expect(await tickets(tk.id)).toEqual([]);
        expect(await t.prisma.event.count({ where: { ticketId: tk.id, type: 'network' } })).toBeLessThanOrEqual(2);
      });

      it('holds the ticket only after an outage that has gone on for a day of failures', async () => {
        const tk = await ticket({ status: 'PLANNING' });
        const r = await run(tk.id);
        await t.prisma.stageRun.createMany({ data: Array.from({ length: MAX_NETWORK_FAILURES_PER_DAY }, () => ({ projectId, ticketId: tk.id, stage: 'solutionDesign' as never, model: 'm', attempt: 1, status: 'failed' as never, errorCode: 'NETWORK_ERROR', startedAt: new Date() })) });
        expect(await outcomes.forResult(tk.id, 'solutionDesign', failed(r.id))).toMatchObject({ kind: 'hold', reason: 'needs_help' });
      });

      it('another failure still holds as before', async () => {
        const tk = await ticket({ status: 'PLANNING' });
        const r = await run(tk.id);
        expect(await outcomes.forResult(tk.id, 'solutionDesign', { kind: 'failed', reason: 'bad output', errorCode: 'INVALID_OUTPUT', stageRunId: r.id, attempts: 2 } as never)).toMatchObject({ kind: 'hold', reason: 'needs_help' });
      });
    });

    it('the same question asked twice is still one ticket', async () => {
      const tk = await ticket();
      const r = await run(tk.id);
      const ask = () => outcomes.forResult(tk.id, 'solutionDesign', { kind: 'needs_input', question: 'Same?', stageRunId: r.id } as never);
      await ask();
      await ask();
      expect(await tickets(tk.id, 'question')).toHaveLength(1);
    });

    it('the 4th question of a stage holds the ticket for help instead (max 3 per ticket and stage)', async () => {
      const tk = await ticket();
      const r = await run(tk.id);
      for (let i = 1; i <= 3; i++) {
        expect(await outcomes.forResult(tk.id, 'solutionDesign', { kind: 'needs_input', question: `q${i}`, stageRunId: r.id } as never)).toMatchObject({ reason: 'awaiting_answer' });
      }
      const fourth = await outcomes.forResult(tk.id, 'solutionDesign', { kind: 'needs_input', question: 'q4', stageRunId: r.id } as never);
      expect(fourth).toMatchObject({ kind: 'hold', reason: 'needs_help' });
      expect(await tickets(tk.id, 'question')).toHaveLength(3);
      expect(await outcomes.forResult(tk.id, 'technicalDesign', { kind: 'needs_input', question: 'other', stageRunId: r.id } as never)).toMatchObject({ reason: 'awaiting_answer' });
    });

    it('a rejected Claude credential raises one global credential ticket, however often it happens', async () => {
      const tk = await ticket();
      for (let i = 0; i < 3; i++) await outcomes.forResult(tk.id, 'solutionDesign', { kind: 'claude_auth', stageRunId: 'x', attempts: 1 } as never);
      const creds = await t.prisma.supportTicket.findMany({ where: { kind: 'credential' } });
      expect(creds).toMatchObject([{ title: 'Claude rejected the credential', priority: 'blocking', ticketId: null, status: 'open' }]);
    });
  });

  describe('state-driven tickets (the transition listener)', () => {
    it('raises an approval at the plan gate, and closes it however the ticket leaves the gate', async () => {
      const tk = await ticket({ status: 'PLANNING' });
      await states.transition(tk.id, 'AWAITING_PLAN_APPROVAL', 'system', 'Plan ready');
      expect(await tickets(tk.id, 'approval')).toMatchObject([{ stage: 'plan', status: 'open', title: `Approve the plan for ${tk.key}` }]);
      await states.transition(tk.id, 'BREAKDOWN', 'jira', 'Approved in Jira');
      expect(await tickets(tk.id, 'approval')).toMatchObject([{ status: 'resolved', resolvedBy: 'jira' }]);
    });

    it('raises an approval at the breakdown gate', async () => {
      const tk = await ticket({ status: 'BREAKDOWN' });
      await states.transition(tk.id, 'AWAITING_BREAKDOWN_APPROVAL', 'system');
      expect(await tickets(tk.id, 'approval')).toMatchObject([{ stage: 'breakdown', status: 'open' }]);
    });

    it('raises a hold ticket when the ticket goes on hold, and closes it when it resumes', async () => {
      const tk = await ticket({ status: 'IN_PROGRESS' });
      await states.hold(tk.id, 'needs_help', 'system', 'Tests still failing');
      expect(await tickets(tk.id, 'hold')).toMatchObject([{ status: 'open', priority: 'blocking', body: expect.stringContaining('Tests still failing') }]);
      await states.resume(tk.id, 'user', 'Resumed');
      expect(await tickets(tk.id, 'hold')).toMatchObject([{ status: 'resolved', resolvedBy: 'user' }]);
    });

    it('a hold that waits for an answer raises no hold ticket: the question is the ticket', async () => {
      const tk = await ticket({ status: 'PLANNING' });
      await states.hold(tk.id, 'awaiting_answer', 'system', 'Which db?');
      expect(await tickets(tk.id, 'hold')).toHaveLength(0);
    });

    it('a failed ticket raises a hold ticket too', async () => {
      const tk = await ticket({ status: 'IN_PROGRESS' });
      await states.fail(tk.id, 'The container failed');
      expect(await tickets(tk.id, 'hold')).toMatchObject([{ status: 'open', title: `${tk.key} failed` }]);
    });

    it('raises a "PR ready" note for human review and resolves it when the PR is merged', async () => {
      const tk = await ticket({ status: 'AWAITING_CI', prUrl: 'https://github.com/a/b/pull/1' });
      await states.transition(tk.id, 'IN_HUMAN_REVIEW', 'system');
      expect(await tickets(tk.id, 'pr_ready')).toMatchObject([{ priority: 'fyi', status: 'open', body: expect.stringContaining('pull/1') }]);
      await states.transition(tk.id, 'DONE', 'system', 'PR merged');
      expect(await tickets(tk.id, 'pr_ready')).toMatchObject([{ status: 'resolved', response: 'The PR was merged' }]);
    });
  });

  describe('GET /support-tickets', () => {
    it('lists open items oldest first with their actions, and the counts the badge needs', async () => {
      const a = await asked('solutionDesign', 'first');
      await asked('technicalDesign', 'second');
      const tk = await ticket({ status: 'PLANNING' });
      await states.transition(tk.id, 'AWAITING_PLAN_APPROVAL', 'system');
      await raiser.raise({ kind: 'pr_ready', ticketId: tk.id, title: 'fyi', body: 'b' });
      const res = (await t.agent.get('/support-tickets').expect(200)).body;
      expect(res.map((q: { title: string }) => q.title).slice(0, 2)).toEqual(['first', 'second']);
      expect(res.find((q: { kind: string }) => q.kind === 'approval').actions).toEqual(['approve', 'reject', 'dismiss']);
      expect(res[0]).toMatchObject({ ticketKey: a.tk.key, stage: 'solutionDesign', group: 'questions' });
      const counts = (await t.agent.get('/support-tickets/counts').expect(200)).body;
      expect(counts).toMatchObject({ badge: 3, groups: { questions: 2, approvals: 1, fyi: 1, blocking: 0 } });
    });

    it('moves answered and closed tickets to the history tab', async () => {
      const { q } = await asked();
      await act(q.id, { action: 'answer', answer: 'EUR' }).expect(200);
      expect((await t.agent.get('/support-tickets').expect(200)).body).toHaveLength(0);
      expect((await t.agent.get('/support-tickets?tab=history').expect(200)).body).toMatchObject([{ id: q.id, status: 'answered', response: 'EUR' }]);
    });
  });

  describe('actions', () => {
    it('answer: stores the answer and resumes the ticket to the state it was held from', async () => {
      const { tk, q } = await asked();
      const res = await act(q.id, { action: 'answer', answer: 'EUR' }).expect(200);
      expect(res.body).toMatchObject({ id: q.id, status: 'answered', response: 'EUR', actions: [] });
      expect(await reload(tk.id)).toMatchObject({ status: 'PLANNING', holdReason: null });
      expect((await t.prisma.stateTransition.findMany({ where: { ticketId: tk.id } })).at(-1)).toMatchObject({ fromStatus: 'ON_HOLD', toStatus: 'PLANNING', actor: 'user' });
    });

    it('409 when already answered, 404 when unknown, 400 for an empty answer or an action the kind does not have', async () => {
      const { q } = await asked();
      await act(q.id, { action: 'answer', answer: ' ' }).expect(400);
      await act(q.id, { action: 'approve' }).expect(400);
      await act(q.id, { action: 'answer', answer: 'a' }).expect(200);
      await act(q.id, { action: 'answer', answer: 'b' }).expect(409);
      await act('00000000-0000-0000-0000-000000000000', { action: 'dismiss' }).expect(404);
      expect((await t.prisma.supportTicket.findUniqueOrThrow({ where: { id: q.id } })).response).toBe('a');
    });

    it('a ticket with another open question keeps waiting until every question is answered', async () => {
      const { tk, q } = await asked();
      const r = await run(tk.id);
      const { ticket: q2 } = await raiser.raise({ kind: 'question', ticketId: tk.id, stageRunId: r.id, stage: 'solutionDesign', title: 'two', body: 'two', dedupeKey: `q2:${tk.id}` });
      await act(q.id, { action: 'answer', answer: 'a' }).expect(200);
      expect((await reload(tk.id)).status).toBe('ON_HOLD');
      await act(q2.id, { action: 'answer', answer: 'b' }).expect(200);
      expect((await reload(tk.id)).status).toBe('PLANNING');
    });

    it('approve: moves the ticket on and the listener closes the approval', async () => {
      const tk = await ticket({ status: 'PLANNING', planMarkdown: '# plan' });
      await states.transition(tk.id, 'AWAITING_PLAN_APPROVAL', 'system');
      const [approval] = await tickets(tk.id, 'approval');
      const res = await act(approval!.id, { action: 'approve' }).expect(200);
      expect(res.body).toMatchObject({ status: 'resolved', resolvedBy: 'user' });
      expect((await reload(tk.id)).status).toBe('BREAKDOWN');
    });

    it('reject: needs a note, sends the ticket back to the plan stage with it', async () => {
      const tk = await ticket({ status: 'PLANNING', planMarkdown: '# plan' });
      await states.transition(tk.id, 'AWAITING_PLAN_APPROVAL', 'system');
      const [approval] = await tickets(tk.id, 'approval');
      await act(approval!.id, { action: 'reject' }).expect(400);
      await act(approval!.id, { action: 'reject', note: 'use the existing repository' }).expect(200);
      expect((await reload(tk.id)).status).toBe('PLANNING');
      expect((await t.prisma.stateTransition.findMany({ where: { ticketId: tk.id } })).at(-1)).toMatchObject({ reason: 'use the existing repository' });
      expect((await tickets(tk.id, 'approval'))[0]).toMatchObject({ status: 'resolved', response: 'use the existing repository' });
    });

    it('hold: resume, retry and fail', async () => {
      const resume = await ticket({ status: 'IN_PROGRESS' });
      await states.hold(resume.id, 'needs_help', 'system', 'help');
      await act((await tickets(resume.id, 'hold'))[0]!.id, { action: 'resume' }).expect(200);
      expect((await reload(resume.id)).status).toBe('IN_PROGRESS');

      const retry = await ticket({ status: 'IN_PROGRESS' });
      await states.hold(retry.id, 'needs_help', 'system', 'help');
      await act((await tickets(retry.id, 'hold'))[0]!.id, { action: 'retry' }).expect(200);
      expect((await reload(retry.id)).status).toBe('IN_PROGRESS');

      const fail = await ticket({ status: 'IN_PROGRESS' });
      await states.hold(fail.id, 'needs_help', 'system', 'help');
      await act((await tickets(fail.id, 'hold'))[0]!.id, { action: 'fail', note: 'give up' }).expect(200);
      expect((await reload(fail.id)).status).toBe('FAILED');
    });

    it('ci_infra: "fixed, re-run CI" resumes the ticket and closes the ticket', async () => {
      const tk = await ticket({ status: 'AWAITING_CI' });
      await states.hold(tk.id, 'needs_help', 'system', 'CI runner is down');
      const { ticket: q } = await raiser.raise({ kind: 'ci_infra', ticketId: tk.id, title: 'CI infrastructure failed', body: 'runner down', stage: 'ci' });
      const res = await act(q.id, { action: 'fixed', note: 'runner restarted' }).expect(200);
      expect(res.body).toMatchObject({ status: 'resolved', response: 'runner restarted' });
      expect((await reload(tk.id)).status).toBe('AWAITING_CI');
    });

    it('open questions do not block; answering stores the answer, and "rerun with answers" sends them back to the plan', async () => {
      const tk = await ticket({ status: 'PLANNING', planMarkdown: '# plan' });
      const r = await run(tk.id);
      const { ticket: oq } = await raiser.raise({ kind: 'open_question', ticketId: tk.id, stageRunId: r.id, stage: 'solutionDesign', title: 'Which repository?', body: 'Which repository?', dedupeKey: `oq:${tk.id}` });
      expect(oq.priority).toBe('normal');
      await states.transition(tk.id, 'AWAITING_PLAN_APPROVAL', 'system');
      await act(oq.id, { action: 'answer', answer: 'the booking one' }).expect(200);
      expect((await reload(tk.id)).status).toBe('AWAITING_PLAN_APPROVAL'); // answering does not move the ticket
      // an answered open question stays in the inbox until it is used (asked for by kind: the open plan approval carries it in the main list)
      expect((await t.agent.get('/support-tickets?kind=open_question').expect(200)).body.some((q: { id: string }) => q.id === oq.id)).toBe(true);
      await act(oq.id, { action: 'rerun_with_answers' }).expect(200);
      expect((await reload(tk.id)).status).toBe('PLANNING');
      const last = (await t.prisma.stateTransition.findMany({ where: { ticketId: tk.id } })).at(-1);
      expect(last?.reason).toContain('Which repository?');
      expect(last?.reason).toContain('the booking one');
      expect((await t.prisma.supportTicket.findUniqueOrThrow({ where: { id: oq.id } })).status).toBe('resolved');
    });

    describe('approving a plan with open questions', () => {
      const planWithQuestions = async (n = 2) => {
        const tk = await ticket({ status: 'PLANNING', planMarkdown: '# Plan\n\nDo the thing.' });
        const r = await run(tk.id);
        const oqs = [];
        for (let i = 0; i < n; i++) oqs.push((await raiser.raise({ kind: 'open_question', ticketId: tk.id, stageRunId: r.id, stage: 'solutionDesign', title: `Question ${i + 1}?`, body: `Question ${i + 1}?`, dedupeKey: `oq:${tk.id}:${i}` })).ticket);
        await states.transition(tk.id, 'AWAITING_PLAN_APPROVAL', 'system');
        const [approval] = await tickets(tk.id, 'approval');
        return { tk, oqs, approval: approval! };
      };

      it('puts the questions on the approval and keeps them out of the main list', async () => {
        const { tk, oqs, approval } = await planWithQuestions();
        const list = (await t.agent.get('/support-tickets').expect(200)).body as { id: string; kind: string; openQuestions?: { id: string }[] }[];
        expect(list.some((q) => q.id === oqs[0]!.id)).toBe(false);
        expect(list.find((q) => q.id === approval.id)?.openQuestions?.map((q) => q.id)).toEqual(oqs.map((q) => q.id));
        expect((await t.agent.get(`/support-tickets?ticketId=${tk.id}&kind=open_question`).expect(200)).body).toHaveLength(2);
      });

      it('refuses to approve while a question has no answer, from the inbox and from the ticket', async () => {
        const { tk, oqs, approval } = await planWithQuestions();
        const res = await act(approval.id, { action: 'approve', answers: [{ id: oqs[0]!.id, answer: 'the booking one' }] }).expect(400);
        expect(res.body.fields.answers).toContain('1 open question');
        await t.agent.post(`/tickets/${tk.id}/plan/approve`).send({}).expect(400);
        expect((await reload(tk.id)).status).toBe('AWAITING_PLAN_APPROVAL');
      });

      it('approves once every question is answered, and the answers become part of the plan', async () => {
        const { tk, oqs, approval } = await planWithQuestions();
        await act(approval.id, { action: 'approve', answers: [{ id: oqs[0]!.id, answer: 'the booking one' }, { id: oqs[1]!.id, answer: 'EUR' }] }).expect(200);
        const after = await reload(tk.id);
        expect(after.status).toBe('BREAKDOWN');
        expect(after.planMarkdown).toContain('## Decisions from open questions');
        expect(after.planMarkdown).toContain('Question 1?');
        expect(after.planMarkdown).toContain('the booking one');
        expect(after.planMarkdown).toContain('EUR');
        expect((await tickets(tk.id, 'open_question')).map((q) => q.status)).toEqual(['resolved', 'resolved']);
      });

      it('accepts questions answered earlier, and a plan without questions approves as before', async () => {
        const { tk, oqs, approval } = await planWithQuestions(1);
        await act(oqs[0]!.id, { action: 'answer', answer: 'earlier answer' }).expect(200);
        await act(approval.id, { action: 'approve' }).expect(200);
        expect((await reload(tk.id)).planMarkdown).toContain('earlier answer');
        const plain = await ticket({ status: 'PLANNING', planMarkdown: '# Plan' });
        await states.transition(plain.id, 'AWAITING_PLAN_APPROVAL', 'system');
        await t.agent.post(`/tickets/${plain.id}/plan/approve`).send({}).expect(200);
        expect((await reload(plain.id)).planMarkdown).toBe('# Plan');
      });
    });

    describe('a PR in human review', () => {
      const review = async () => {
        const tk = await ticket({ status: 'AWAITING_CI', prUrl: 'https://github.com/a/b/pull/1' });
        await states.transition(tk.id, 'IN_HUMAN_REVIEW', 'system');
        const [q] = await tickets(tk.id, 'pr_ready');
        return { tk, q: q! };
      };

      it('shows the PR and the actions a person can take', async () => {
        const { q } = await review();
        expect((await t.agent.get(`/support-tickets/${q.id}`).expect(200)).body).toMatchObject({ ticketPrUrl: 'https://github.com/a/b/pull/1', actions: ['done', 'fail'] });
      });

      it('cannot be dismissed: the person must say how the review ended', async () => {
        const { tk, q } = await review();
        await act(q.id, { action: 'dismiss' }).expect(400);
        expect((await t.prisma.supportTicket.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('open');
        expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } })).status).toBe('IN_HUMAN_REVIEW');
      });

      it('is raised again at start-up for a ticket whose item was dismissed earlier', async () => {
        const { tk, q } = await review();
        await t.prisma.supportTicket.update({ where: { id: q.id }, data: { status: 'dismissed', resolvedBy: 'user', resolvedAt: new Date() } });
        const backfill = new PrReviewBackfill(t.prisma, raiser);
        expect(await backfill.run()).toBeGreaterThanOrEqual(1); // other tickets of this suite may be in review too
        expect(await tickets(tk.id, 'pr_ready')).toHaveLength(2);
        expect((await tickets(tk.id, 'pr_ready')).filter((x) => x.status === 'open')).toHaveLength(1);
        expect(await backfill.run()).toBe(0); // nothing left to do
      });

      it('a note about the PR (its size) can only be dismissed, never ended as done or failed', async () => {
        const { tk } = await review();
        const { ticket: note } = await raiser.raise({ kind: 'pr_ready', ticketId: tk.id, stage: 'pr_size', title: 'large', body: 'b' });
        expect((await t.agent.get(`/support-tickets/${note.id}`).expect(200)).body.actions).toEqual(['dismiss']);
        await act(note.id, { action: 'done' }).expect(400);
        expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } })).status).toBe('IN_HUMAN_REVIEW');
      });

      it('"done" moves the ticket to DONE and closes the item, saying it was a person', async () => {
        const { tk, q } = await review();
        await act(q.id, { action: 'done' }).expect(200);
        expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } })).status).toBe('DONE');
        expect(await tickets(tk.id, 'pr_ready')).toMatchObject([{ status: 'resolved', response: 'Marked done from the inbox' }]);
      });

      it('"fail" needs a reason, then fails the ticket', async () => {
        const { tk, q } = await review();
        await act(q.id, { action: 'fail' }).expect(400);
        await act(q.id, { action: 'fail', note: 'Rejected by the reviewers' }).expect(200);
        expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } })).status).toBe('FAILED');
      });

      it('"done" is refused once the ticket has left human review', async () => {
        const { tk, q } = await review();
        await states.transition(tk.id, 'DONE', 'system', 'PR merged');
        await t.prisma.supportTicket.update({ where: { id: q.id }, data: { status: 'open' } });
        await act(q.id, { action: 'done' }).expect(409);
      });
    });

    it('dismiss works on any open ticket', async () => {
      const tk = await ticket();
      const { ticket: q } = await raiser.raise({ kind: 'pr_ready', ticketId: tk.id, title: 'fyi', body: 'b' });
      expect((await act(q.id, { action: 'dismiss' }).expect(200)).body).toMatchObject({ status: 'dismissed', resolvedBy: 'user' });
    });
  });

  describe('credentials', () => {
    it('a credential ticket closes by itself when the credential test passes', async () => {
      await raiser.credentialFailed('claude', 'Claude rejected the token');
      await raiser.credentialFailed('github', 'GitHub refused');
      const creds = new CredentialsService(t.prisma);
      await creds.markVerified('anthropic_api_key', null);
      const open = await t.prisma.supportTicket.findMany({ where: { kind: 'credential', status: 'open' } });
      expect(open.map((x) => x.dedupeKey)).toEqual(['credential:github']);
      expect(await t.prisma.supportTicket.findFirst({ where: { dedupeKey: 'credential:claude' } })).toMatchObject({ status: 'resolved', resolvedBy: 'system', response: 'The credential test passed' });
    });
  });

  describe('notifying (worker side)', () => {
    it('a blocking ticket gets a Jira comment (once) and a PR comment; a non-blocking one gets neither', async () => {
      const github = new FakeGitHub();
      const notifier = new SupportNotifier(t.prisma, t.jira, github as never, raiser);
      notifier.onModuleInit();
      const p2 = await t.prisma.project.create({ data: { name: 'jira-project', repoUrl: 'https://github.com/a/b', stack: 'ts_node', testCmdTemplate: 'x {files}', localKeyPrefix: 'J', mirrorStatus: 'ok', jiraMode: 'rest', jiraProjectKey: 'ABC' } });
      const tk = await t.prisma.ticket.create({ data: { projectId: p2.id, key: 'ABC-1', externalKey: 'ABC-1', source: 'jira', title: 'x', status: 'IN_PROGRESS', prNumber: 7 } });
      await raiser.raise({ kind: 'question', ticketId: tk.id, title: 'Which db?', body: 'Which db?', dedupeKey: 'q-notify' });
      expect(t.jira.jira.commentBodies['ABC-1']?.[0]).toContain('Which db?');
      expect(github.comments.filter((c: { number: number }) => c.number === 7)).toHaveLength(1);
      await raiser.raise({ kind: 'pr_ready', ticketId: tk.id, title: 'ready', body: 'b', dedupeKey: 'pr-notify' });
      expect(t.jira.jira.commentBodies['ABC-1']).toHaveLength(1);
      expect(github.comments).toHaveLength(1);
    });

    it('does not repeat the PR comment of a needs_help hold: the hold notifier writes it', async () => {
      const github = new FakeGitHub();
      new SupportNotifier(t.prisma, t.jira, github as never, raiser).onModuleInit();
      const tk = await ticket({ status: 'ON_HOLD', holdReason: 'needs_help', holdFromStatus: 'IN_PROGRESS', prNumber: 9 });
      await raiser.raise({ kind: 'hold', ticketId: tk.id, title: 'on hold', body: 'b', dedupeKey: `h:${tk.id}` });
      expect(github.comments).toHaveLength(0);
    });

    it('a failing GitHub call is a warning event and never throws', async () => {
      const github = new FakeGitHub();
      github.failComment = new Error('HTTP 502');
      new SupportNotifier(t.prisma, t.jira, github as never, raiser).onModuleInit();
      const tk = await ticket({ prNumber: 3 });
      await expect(raiser.raise({ kind: 'question', ticketId: tk.id, title: 'q', body: 'q', dedupeKey: `n:${tk.id}` })).resolves.toMatchObject({ created: true });
      expect((await t.prisma.event.findMany({ where: { ticketId: tk.id, level: 'warn' } })).some((e) => e.message.includes('Could not comment on PR #3'))).toBe(true);
    });
  });

  it('the re-run stage gets every earlier question and answer of that stage (and none of another stage)', async () => {
    const { tk, q } = await asked('solutionDesign', 'Which currency?');
    await act(q.id, { action: 'answer', answer: 'EUR' }).expect(200);
    const r = await run(tk.id);
    const mk = (stage: string, title: string, extra: Record<string, unknown> = {}) => t.prisma.supportTicket.create({ data: { kind: 'question', title, body: title, ticketId: tk.id, stageRunId: r.id, stage, ...extra } });
    await mk('solutionDesign', 'Rounding?', { response: 'Half up', status: 'answered' });
    await mk('technicalDesign', 'other', { response: 'nope', status: 'answered' });
    await mk('solutionDesign', 'unanswered');
    await launcher.launch(await reload(tk.id), 'solutionDesign', { ticket: { key: tk.key, title: 't', body: 'b' } });
    expect(lastInputs?.qa).toEqual([{ question: 'Which currency?', answer: 'EUR' }, { question: 'Rounding?', answer: 'Half up' }]);
  });
});
