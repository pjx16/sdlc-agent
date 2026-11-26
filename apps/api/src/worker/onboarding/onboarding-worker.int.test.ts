import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { OnboardAdvice, OnboardingProposal, RepoProfile, StageEnvelope } from '@sdlc/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JiraNotConfiguredError } from '../../jira/jira-clients';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportRaiser } from '../../support/support-raiser';
import { FakeGitHub } from '../../testing/fake-github';
import { FakeJira, FakeJiraClients } from '../../testing/fake-jira';
import { type TestDatabase, createTestDatabase } from '../../testing/test-db';
import type { StageRequest, StageResult } from '../agent-runner/agent-runner';
import { WorkerConfig } from '../worker-config';
import { OnboardingWorker, factsText, sanitizeAdvice } from './onboarding-worker';

const profile: RepoProfile = { stack: 'nestjs', installCmd: 'npm ci', typecheckCmd: 'npx tsc --noEmit', testCmdTemplate: 'npx jest {files}', kbDir: 'docs/kb', testFilePattern: '**/*.spec.ts', exampleTestFile: 'src/a.spec.ts' };
const advice: OnboardAdvice = {
  statusMap: { KB: 'In Progress', PLANNING: 'In Progress', DONE: 'Done', FAILED: 'Made up status' },
  approvalStatuses: { plan: 'Plan Approved', breakdown: null },
  issueTypeRouting: { Story: 'feature', Bug: 'bug', Epic: 'ignore', 'Sub-task': 'feature' },
  intakeLabel: 'sdlc-agent',
};
const done = (data: unknown): StageResult => ({ kind: 'done', envelope: { status: 'done', summary: 's', data } as StageEnvelope, stageRunId: 'r', attempts: 1 });

describe('OnboardingWorker', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let tmp: string;
  let worker: OnboardingWorker;
  let github: FakeGitHub;
  let jiraClients: FakeJiraClients;
  let jira: FakeJira;
  let requests: StageRequest[] = [];
  let agent: (req: StageRequest) => StageResult;
  let verifyCalls: { cmd: string }[] = [];
  /** Stages whose agent never answers (a hung run). */
  const hang = new Set<string>();
  let verifyOk: Record<string, boolean>;
  let n = 0;

  const project = (over: Record<string, unknown> = {}) =>
    prisma.project.create({ data: { name: `acme-${++n}`, repoUrl: 'https://github.com/acme/billing', stack: 'ts_node', testCmdTemplate: 'echo {files}', localKeyPrefix: `A${n}`, onboardingStatus: 'profiling', jiraMode: 'rest', jiraProjectKey: 'SDA', ...over } });
  const reload = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.url;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    tmp = mkdtempSync(path.join(tmpdir(), 'sdlc-onboard-'));
    const config = new WorkerConfig({ DATA_DIR: path.join(tmp, 'data'), DATABASE_URL: db.url } as NodeJS.ProcessEnv);
    github = new FakeGitHub();
    jiraClients = new FakeJiraClients();
    jira = jiraClients.jira;
    const mirrors = {
      async clone(p: { id: string }) {
        mkdirSync(config.mirrorPath(p.id), { recursive: true });
        await prisma.project.update({ where: { id: p.id }, data: { mirrorStatus: github.facts.defaultBranch === 'broken' ? 'failed' : 'ok', mirrorError: github.facts.defaultBranch === 'broken' ? 'Base branch "broken" was not found' : null } });
      },
    };
    const git = { async run(args: string[]) { mkdirSync(args[args.length - 1] as string, { recursive: true }); return { stdout: '', stderr: '' }; } };
    const runner = { async run(req: StageRequest) { requests.push(req); if (hang.has(req.stage)) return new Promise<StageResult>(() => undefined); return agent(req); } };
    const verify = {
      async runCmd(a: { cmd: string }) {
        verifyCalls.push({ cmd: a.cmd });
        const ok = verifyOk[a.cmd] ?? true;
        return { ok, exitCode: ok ? 0 : 1, timedOut: false, tail: ok ? 'ok' : 'error TS2304: Cannot find name', output: '' };
      },
    };
    worker = new OnboardingWorker(prisma, config, mirrors as never, git as never, github, jiraClients, runner as never, verify as never, new SupportRaiser(prisma));
  }, 180_000);
  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await db?.drop();
    rmSync(tmp, { recursive: true, force: true });
  });
  beforeEach(async () => {
    requests = [];
    hang.clear();
    worker.deadlineOverrideMs = undefined;
    worker.heartbeatMs = 30_000;
    verifyCalls = [];
    verifyOk = {};
    github.facts = { defaultBranch: 'main', languages: ['TypeScript'] };
    github.failFacts = null;
    jira.failWith = null;
    agent = (req) => done(req.stage === 'repoProfile' ? profile : advice);
    await prisma.supportTicket.deleteMany();
    await prisma.globalSettings.deleteMany();
    await prisma.project.deleteMany({ where: { name: { startsWith: 'acme-' } } });
  });

  it('collects the facts, runs both agents and leaves a proposal for review, with one onboarding ticket', async () => {
    const p = await project();
    await worker.check();
    const after = await reload(p.id);
    expect(after).toMatchObject({ onboardingStatus: 'proposed', onboardingError: null, baseBranch: 'main', mirrorStatus: 'ok' });
    const proposal = after.onboardingProposal as unknown as OnboardingProposal;
    expect(proposal.facts.github).toEqual({ defaultBranch: 'main', languages: ['TypeScript'] });
    expect(proposal.facts.jira?.issueTypes.map((t) => t.name)).toContain('Story');
    expect('confluence' in proposal.facts).toBe(false);
    expect(proposal.profile).toMatchObject({ stack: 'nestjs', testCmdTemplate: 'npx jest {files}', baseBranch: 'main', installCheck: { command: 'npm ci', ok: true }, typecheckCheck: { command: 'npx tsc --noEmit', ok: true } });
    expect(proposal.accepted).toEqual({});
    // The advice does not wait for the code profiling, so the two agents start in either order.
    expect(requests.map((r) => r.stage).sort()).toEqual(['onboardAdvise', 'repoProfile']);
    const profile = requests.find((r) => r.stage === 'repoProfile');
    const advise = requests.find((r) => r.stage === 'onboardAdvise');
    expect(profile?.workspacePath).toContain(path.join('onboarding', p.id));
    expect(advise?.workspacePath).toBeUndefined();
    expect(advise?.inputs.onboard?.facts).toContain('Issue types:');
    // Phase timings are kept in the proposal, and the live progress is cleared once the proposal exists.
    const done = await reload(p.id);
    expect(Object.keys((done.onboardingProposal as { timings: Record<string, number> }).timings).sort()).toEqual(['advise', 'checkout', 'facts', 'install', 'mirror', 'profile', 'typecheck']);
    expect(done.onboardingProgress).toBeNull();
    expect(await prisma.supportTicket.findMany({ where: { projectId: p.id } })).toMatchObject([{ kind: 'onboarding', status: 'open', priority: 'blocking', ticketId: null }]);
  });

  describe('the bot account gets access to the repository first', () => {
    const withAccess = (stub: { ensure: (project: never) => Promise<{ ok: boolean; message: string }> }) => {
      (worker as unknown as { access: unknown }).access = stub;
    };
    afterEach(() => {
      (worker as unknown as { access: unknown }).access = undefined;
    });

    it('stops before anything else when the bot cannot push, and tells the person what to do', async () => {
      withAccess({ ensure: async () => ({ ok: false, message: 'sdlc-agent-bot has no access to acme/billing. Install the sdlc-agent GitHub App on it.' }) });
      const p = await project();
      await worker.check();
      expect(await reload(p.id)).toMatchObject({ onboardingStatus: 'draft', onboardingError: expect.stringContaining('Install the sdlc-agent GitHub App') });
      expect(requests).toEqual([]); // no agent ran
    });

    it('goes on when the bot has access, and passes the project (with its auth mode) to the check', async () => {
      const seen: unknown[] = [];
      withAccess({ ensure: async (p: unknown) => (seen.push(p), { ok: true, message: 'sdlc-agent[bot] can work on acme/billing' }) });
      const p = await project();
      await worker.check();
      expect((await reload(p.id)).onboardingStatus).toBe('proposed');
      expect(seen[0]).toMatchObject({ repoUrl: p.repoUrl, githubAuth: 'token' });
    });
  });

  it('never leaves an invented Jira status, or issue type route in the proposal', async () => {
    const p = await project();
    agent = (req) => done(req.stage === 'repoProfile' ? profile : { ...advice, approvalStatuses: { plan: 'Plan Approved', breakdown: 'Ghost' } });
    await worker.check();
    const a = ((await reload(p.id)).onboardingProposal as unknown as OnboardingProposal).advice;
    expect(a.statusMap.FAILED).toBeNull(); // not a status of the project
    expect(a.statusMap.KB).toBe('In Progress');
    expect(a.approvalStatuses).toEqual({ plan: null, breakdown: null }); // "Plan Approved" is not in the fake project either
    expect(a.issueTypeRouting['Sub-task']).toBe('ignore'); // the sub-task type is always ignored
  });

  it('without a Jira key there is no advisor run, and the proposal still has the commands', async () => {
    const p = await project({ jiraMode: 'off', jiraProjectKey: null });
    await worker.check();
    expect(requests.map((r) => r.stage)).toEqual(['repoProfile']);
    const proposal = (await reload(p.id)).onboardingProposal as unknown as OnboardingProposal;
    expect(proposal.facts.jira).toBeNull();
    expect(proposal.advice).toMatchObject({ intakeLabel: 'sdlc-agent', issueTypeRouting: {} });
  });

  it('records a failing install and does not run the typecheck after it', async () => {
    const p = await project();
    verifyOk['npm ci'] = false;
    await worker.check();
    const proposal = (await reload(p.id)).onboardingProposal as unknown as OnboardingProposal;
    expect(proposal.profile.installCheck).toMatchObject({ ok: false, tail: expect.stringContaining('TS2304') });
    expect(proposal.profile.typecheckCheck).toBeNull();
    expect(verifyCalls.map((c) => c.cmd)).toEqual(['npm ci']);
  });

  it('skips an empty command', async () => {
    const p = await project();
    agent = (req) => done(req.stage === 'repoProfile' ? { ...profile, typecheckCmd: '' } : advice);
    await worker.check();
    expect(((await reload(p.id)).onboardingProposal as unknown as OnboardingProposal).profile.typecheckCheck).toBeNull();
    expect(verifyCalls.map((c) => c.cmd)).toEqual(['npm ci']);
  });

  describe('failure leaves the project in draft with the reason, never half-configured', () => {
    it('a GitHub problem', async () => {
      const p = await project();
      github.failFacts = new Error('gh: Not Found (HTTP 404)');
      await worker.check();
      expect(await reload(p.id)).toMatchObject({ onboardingStatus: 'draft', onboardingProposal: null, onboardingError: expect.stringContaining('gh: Not Found (HTTP 404). Check the GitHub token') });
      expect(requests).toHaveLength(0);
    });

    it('Jira not configured, or a wrong key', async () => {
      const p = await project();
      jira.failWith = new JiraNotConfiguredError();
      await worker.check();
      expect((await reload(p.id)).onboardingError).toContain('Jira is not configured');
      const q = await project();
      jira.failWith = new Error('Jira 404: No project could be found with key SDA');
      await worker.check();
      expect((await reload(q.id)).onboardingError).toContain('Check the project key');
    });

    it('a mirror that cannot be cloned', async () => {
      const p = await project();
      github.facts = { defaultBranch: 'broken', languages: [] };
      await worker.check();
      expect(await reload(p.id)).toMatchObject({ onboardingStatus: 'draft', onboardingError: 'Base branch "broken" was not found' });
    });

    it('an agent that fails, asks, or hits a limit', async () => {
      const p = await project();
      agent = () => ({ kind: 'needs_input', question: 'Which package manager?', stageRunId: 'r', attempts: 1 });
      await worker.check();
      expect((await reload(p.id)).onboardingError).toContain('Which package manager?');
      const q = await project();
      agent = () => ({ kind: 'out_of_credits', stageRunId: 'r', attempts: 1 });
      await worker.check();
      expect((await reload(q.id)).onboardingError).toContain('credit balance is too low');
    });

    it('output that does not fit the schema is refused by the runner, so the error is plain', async () => {
      const p = await project();
      agent = () => ({ kind: 'failed', reason: 'Output failed validation: data.testCmdTemplate: must contain {files}', errorCode: 'INVALID_OUTPUT', stageRunId: 'r', attempts: 2 });
      await worker.check();
      expect((await reload(p.id)).onboardingError).toContain('must contain {files}');
    });
  });

  describe('the time limit and the failed step', () => {
    it('stops a hung agent at the deadline: the project is a draft that names the step, and the checkout is gone', async () => {
      const p = await project();
      hang.add('repoProfile');
      worker.deadlineOverrideMs = 150;
      const started = Date.now();
      await worker.check();
      expect(Date.now() - started).toBeLessThan(5000);
      const after = await reload(p.id);
      expect(after).toMatchObject({ onboardingStatus: 'draft', onboardingProposal: null });
      expect(after.onboardingError).toContain('Profiling stopped after 15 minutes while "Profiling the code');
      const progress = after.onboardingProgress as { failed: { id: string; message: string }; endedAt: string; deadlineAt: string; running: string[] };
      expect(progress).toMatchObject({ failed: { id: 'profile' }, running: [] });
      expect(progress.failed.message).toBe(after.onboardingError);
      expect(progress.endedAt).toBeDefined();
      expect(progress.deadlineAt).toBeDefined();
      expect(requests.find((r) => r.stage === 'repoProfile')?.signal?.aborted).toBe(true); // the agent run was told to stop
      expect(verifyCalls).toHaveLength(0);
    });

    it('stops a GitHub call that never answers, in the facts step', async () => {
      const p = await project();
      github.repoFacts = () => new Promise(() => undefined);
      worker.deadlineOverrideMs = 150;
      await worker.check();
      const after = await reload(p.id);
      expect(after.onboardingStatus).toBe('draft');
      expect((after.onboardingProgress as { failed: { id: string } }).failed.id).toBe('facts');
      expect(after.onboardingError).toContain('Reading the repository');
      github.repoFacts = FakeGitHub.prototype.repoFacts;
    });

    it('releases the worker: the next onboarding starts after a timed-out one', async () => {
      const slow = await project();
      hang.add('repoProfile');
      worker.deadlineOverrideMs = 100;
      await worker.check();
      expect((await reload(slow.id)).onboardingStatus).toBe('draft');
      hang.clear();
      worker.deadlineOverrideMs = undefined;
      const next = await project();
      await worker.check();
      expect((await reload(next.id)).onboardingStatus).toBe('proposed');
    });

    it('keeps the failed step of an ordinary failure too, and a rerun starts clean', async () => {
      const p = await project();
      agent = (req) => (req.stage === 'repoProfile' ? ({ kind: 'failed', reason: 'The stage exited with code 1', errorCode: 'CONTAINER_ERROR', stageRunId: 'r', attempts: 1 } as StageResult) : done(advice));
      await worker.check();
      const failed = await reload(p.id);
      expect(failed.onboardingError).toBe('The stage exited with code 1');
      expect((failed.onboardingProgress as { failed: { id: string } }).failed.id).toBe('profile');
      await prisma.project.update({ where: { id: p.id }, data: { onboardingStatus: 'profiling', onboardingProgress: undefined } });
      agent = (req) => done(req.stage === 'repoProfile' ? profile : advice);
      await worker.check();
      expect((await reload(p.id)).onboardingStatus).toBe('proposed');
    });

    it('stops at the next heartbeat when the person cancelled', async () => {
      const p = await project();
      hang.add('repoProfile');
      worker.heartbeatMs = 40;
      const run = worker.check();
      // Wait until profiling is running, then ask for the cancel the way the API will.
      for (let i = 0; i < 100 && !(await reload(p.id)).onboardingProgress; i++) await new Promise((r) => setTimeout(r, 20));
      await prisma.$executeRaw`UPDATE "Project" SET "onboardingProgress" = "onboardingProgress" || '{"cancelRequested": true}'::jsonb WHERE "id" = ${p.id}`;
      await run;
      const after = await reload(p.id);
      expect(after).toMatchObject({ onboardingStatus: 'draft', onboardingError: 'Cancelled.' });
      expect((after.onboardingProgress as { failed: { id: string } }).failed.id).toBe('profile');
    });

    it('writes a sign of life while it runs', async () => {
      const p = await project();
      hang.add('repoProfile');
      worker.deadlineOverrideMs = 400;
      worker.heartbeatMs = 50;
      const run = worker.check();
      let first = '';
      for (let i = 0; i < 100 && !first; i++) {
        first = ((await reload(p.id)).onboardingProgress as { updatedAt?: string } | null)?.updatedAt ?? '';
        await new Promise((r) => setTimeout(r, 20));
      }
      await new Promise((r) => setTimeout(r, 150));
      const later = ((await reload(p.id)).onboardingProgress as { updatedAt: string }).updatedAt;
      await run;
      expect(first).not.toBe('');
      expect(new Date(later).getTime()).toBeGreaterThan(new Date(first).getTime());
    });
  });

  it('handles one project at a time and ignores projects that are not profiling', async () => {
    const a = await project();
    const b = await project();
    await project({ onboardingStatus: 'confirmed' });
    await worker.check();
    expect((await reload(a.id)).onboardingStatus).toBe('proposed');
    expect((await reload(b.id)).onboardingStatus).toBe('profiling');
    await worker.check();
    expect((await reload(b.id)).onboardingStatus).toBe('proposed');
    await worker.check(); // nothing left
    expect(requests.length).toBe(4);
  });

  it('waits while the pipeline is paused for limits, but not when paused by hand', async () => {
    const p = await project();
    await prisma.globalSettings.create({ data: { id: 'global', pipelinePaused: true, pausedReason: 'Credits', pausedCode: 'CLAUDE_CREDITS' } });
    await worker.check();
    expect((await reload(p.id)).onboardingStatus).toBe('profiling');
    await prisma.globalSettings.update({ where: { id: 'global' }, data: { pausedReason: 'manual', pausedCode: null } });
    await worker.check();
    expect((await reload(p.id)).onboardingStatus).toBe('proposed');
  });
});

describe('factsText and sanitizeAdvice (pure)', () => {
  it('writes the facts as plain text the advisor can read', () => {
    const t = factsText('billing', {
      github: { defaultBranch: 'main', languages: ['TypeScript'] },
      jira: { projectName: 'Billing', issueTypes: [{ name: 'Story', subtask: false }, { name: 'Sub-task', subtask: true }], statusesByType: [{ type: 'Story', statuses: [{ name: 'To Do', category: 'new' }] }], labels: [] },
    });
    expect(t).toContain('- Sub-task (the sub-task type)');
    expect(t).toContain('- Story: To Do [new]');
    expect(t).toContain('Labels already in use: none');
    expect(t).not.toMatch(/confluence/i);
  });

  it('with no advice at all, falls back on the default routing and label', () => {
    const jira = { projectName: 'x', issueTypes: [{ name: 'Bug', subtask: false }, { name: 'Epic', subtask: false }], statusesByType: [], labels: [] };
    expect(sanitizeAdvice(null, jira)).toEqual({ statusMap: {}, approvalStatuses: { plan: null, breakdown: null }, issueTypeRouting: { Bug: 'bug', Epic: 'ignore' }, intakeLabel: 'sdlc-agent' });
  });
});
