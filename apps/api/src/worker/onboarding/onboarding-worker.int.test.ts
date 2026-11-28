import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { OnboardingProposal, RepoProfile, StageEnvelope } from '@sdlc/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportRaiser } from '../../support/support-raiser';
import { FakeGitHub } from '../../testing/fake-github';
import { type TestDatabase, createTestDatabase } from '../../testing/test-db';
import type { StageRequest, StageResult } from '../agent-runner/agent-runner';
import { WorkerConfig } from '../worker-config';
import { OnboardingWorker, factsText, sanitizeBoardAdvice } from './onboarding-worker';

const profile: RepoProfile = { stack: 'nestjs', installCmd: 'npm ci', typecheckCmd: 'npx tsc --noEmit', testCmdTemplate: 'npx jest {files}', kbDir: 'docs/kb', testFilePattern: '**/*.spec.ts', exampleTestFile: 'src/a.spec.ts' };
const boardAnswer = { board: { statusMap: { PLANNING: 'Doing', KB: 'Nope', DONE: 'done' }, approval: { plan: 'Approved', breakdown: 'Invented' }, intakeStatus: 'todo', useDefaultColumns: false } };
const boardSettings = { github: { mode: 'projects', project: { owner: 'acme', number: 3 } } };
const done = (data: unknown): StageResult => ({ kind: 'done', envelope: { status: 'done', summary: 's', data } as StageEnvelope, stageRunId: 'r', attempts: 1 });

describe('OnboardingWorker', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let tmp: string;
  let worker: OnboardingWorker;
  let github: FakeGitHub;
  let requests: StageRequest[] = [];
  let agent: (req: StageRequest) => StageResult;
  let verifyCalls: { cmd: string }[] = [];
  let verifyOk: Record<string, boolean>;
  let n = 0;

  const project = (over: Record<string, unknown> = {}) =>
    prisma.project.create({ data: { name: `acme-${++n}`, repoUrl: 'https://github.com/acme/billing', stack: 'ts_node', testCmdTemplate: 'echo {files}', localKeyPrefix: `A${n}`, onboardingStatus: 'profiling', ...over } });
  const reload = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.url;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    tmp = mkdtempSync(path.join(tmpdir(), 'sdlc-onboard-'));
    const config = new WorkerConfig({ DATA_DIR: path.join(tmp, 'data'), DATABASE_URL: db.url } as NodeJS.ProcessEnv);
    github = new FakeGitHub();
    const mirrors = {
      async clone(p: { id: string }) {
        mkdirSync(config.mirrorPath(p.id), { recursive: true });
        await prisma.project.update({ where: { id: p.id }, data: { mirrorStatus: github.facts.defaultBranch === 'broken' ? 'failed' : 'ok', mirrorError: github.facts.defaultBranch === 'broken' ? 'Base branch "broken" was not found' : null } });
      },
    };
    const git = { async run(args: string[]) { mkdirSync(args[args.length - 1] as string, { recursive: true }); return { stdout: '', stderr: '' }; } };
    const runner = { async run(req: StageRequest) { requests.push(req); return agent(req); } };
    const verify = {
      async runCmd(a: { cmd: string }) {
        verifyCalls.push({ cmd: a.cmd });
        const ok = verifyOk[a.cmd] ?? true;
        return { ok, exitCode: ok ? 0 : 1, timedOut: false, tail: ok ? 'ok' : 'error TS2304: Cannot find name', output: '' };
      },
    };
    worker = new OnboardingWorker(prisma, config, mirrors as never, git as never, github, runner as never, verify as never, new SupportRaiser(prisma));
  }, 180_000);
  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await db?.drop();
    rmSync(tmp, { recursive: true, force: true });
  });
  beforeEach(async () => {
    requests = [];
    verifyCalls = [];
    verifyOk = {};
    github.facts = { defaultBranch: 'main', languages: ['TypeScript'] };
    github.failFacts = null;
    github.ownerTypes = {};
    github.failColumns = null;
    github.columns = ['Todo', 'Doing', 'Approved', 'Done'];
    agent = (req) => done(req.stage === 'repoProfile' ? profile : boardAnswer);
    await prisma.supportTicket.deleteMany();
    await prisma.globalSettings.deleteMany();
    await prisma.project.deleteMany({ where: { name: { startsWith: 'acme-' } } });
  });

  it('collects the facts, runs both agents and leaves a proposal for review, with one onboarding ticket', async () => {
    const p = await project({ settings: boardSettings });
    await worker.check();
    const after = await reload(p.id);
    expect(after).toMatchObject({ onboardingStatus: 'proposed', onboardingError: null, baseBranch: 'main', mirrorStatus: 'ok' });
    const proposal = after.onboardingProposal as unknown as OnboardingProposal;
    expect(proposal.facts.github).toEqual({ defaultBranch: 'main', languages: ['TypeScript'], board: { columns: ['Todo', 'Doing', 'Approved', 'Done'] } });
    expect('confluence' in proposal.facts).toBe(false);
    expect(proposal.profile).toMatchObject({ stack: 'nestjs', testCmdTemplate: 'npx jest {files}', baseBranch: 'main', installCheck: { command: 'npm ci', ok: true }, typecheckCheck: { command: 'npx tsc --noEmit', ok: true } });
    expect(proposal.accepted).toEqual({});
    // The advice does not wait for the code profiling, so the two agents start in either order.
    expect(requests.map((r) => r.stage).sort()).toEqual(['onboardAdvise', 'repoProfile']);
    const profile = requests.find((r) => r.stage === 'repoProfile');
    const advise = requests.find((r) => r.stage === 'onboardAdvise');
    expect(profile?.workspacePath).toContain(path.join('onboarding', p.id));
    expect(advise?.workspacePath).toBeUndefined();
    expect(advise?.inputs.onboard?.facts).toContain('Status columns of the board: Todo, Doing, Approved, Done');
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
    agent = (req) => done(req.stage === 'repoProfile' ? { ...profile, typecheckCmd: '' } : boardAnswer);
    await worker.check();
    expect(((await reload(p.id)).onboardingProposal as unknown as OnboardingProposal).profile.typecheckCheck).toBeNull();
    expect(verifyCalls.map((c) => c.cmd)).toEqual(['npm ci']);
  });

  describe('a GitHub Projects board', () => {
    it('gets a mapping proposal from the board\'s own columns, with names the board does not have taken out', async () => {
      github.columns = ['Todo', 'Doing', 'Approved', 'Done'];
      agent = (req) => done(req.stage === 'repoProfile' ? profile : boardAnswer);
      const p = await project({ settings: boardSettings });
      await worker.check();
      const after = await reload(p.id);
      expect(after.onboardingStatus).toBe('proposed');
      const proposal = after.onboardingProposal as unknown as OnboardingProposal;
      expect(proposal.facts.github.board).toEqual({ columns: ['Todo', 'Doing', 'Approved', 'Done'] });
      expect(proposal.board).toEqual({ statusMap: { PLANNING: 'Doing', KB: null, DONE: 'Done' }, approval: { plan: 'Approved', breakdown: null }, intakeStatus: 'Todo', useDefaultColumns: false });
      const asked = requests.find((r) => r.stage === 'onboardAdvise');
      expect(JSON.stringify(asked?.inputs)).toContain('Status columns of the board: Todo, Doing, Approved, Done');
    });

    it('an issues-mode project has no board phase, and no advisor run either', async () => {
      github.calls = [];
      const p = await project({ settings: { github: { mode: 'issues' } } });
      await worker.check();
      expect((await reload(p.id)).onboardingStatus).toBe('proposed');
      expect(requests.some((r) => r.stage === 'onboardAdvise')).toBe(false);
      expect(((await reload(p.id)).onboardingProposal as unknown as OnboardingProposal).board).toBeUndefined();
      expect(github.calls).not.toContain('statusColumns');
    });

    it('a board that cannot be read stops onboarding with the reason and a way out', async () => {
      github.failColumns = new Error('Could not resolve to a ProjectV2');
      const p = await project({ settings: boardSettings });
      await worker.check();
      expect(await reload(p.id)).toMatchObject({ onboardingStatus: 'draft', onboardingError: expect.stringContaining('GitHub board acme/3: Could not resolve to a ProjectV2. Check the board number') });
    });
  });

  describe('failure leaves the project in draft with the reason, never half-configured', () => {
    it('a GitHub problem', async () => {
      const p = await project();
      github.failFacts = new Error('gh: Not Found (HTTP 404)');
      await worker.check();
      expect(await reload(p.id)).toMatchObject({ onboardingStatus: 'draft', onboardingProposal: null, onboardingError: expect.stringContaining('gh: Not Found (HTTP 404). Check the GitHub token') });
      expect(requests).toHaveLength(0);
    });

    it('a bot project whose board belongs to a user, which the GitHub App cannot read', async () => {
      const board = { github: { mode: 'projects', project: { owner: 'pjx16', number: 7 } } };
      github.ownerTypes = { pjx16: 'User' };
      const bot = await project({ githubAuth: 'bot', settings: board });
      const token = await project({ githubAuth: 'token', settings: board });
      await worker.check();
      await worker.check(); // one project at a time
      expect(await reload(bot.id)).toMatchObject({ onboardingStatus: 'draft', onboardingError: expect.stringContaining('the GitHub App cannot read a user\'s Projects boards. Use a personal access token') });
      expect((await reload(token.id)).onboardingStatus).toBe('proposed'); // a token can read it
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
    expect(requests.length).toBe(2); // one profiler run each: neither project uses a board
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

describe('factsText (pure)', () => {
  it('writes the facts as plain text the advisor can read', () => {
    const t = factsText('billing', { github: { defaultBranch: 'main', languages: ['TypeScript'], board: { columns: ['Todo', 'Done'] } } });
    expect(t).toContain('Default branch: main');
    expect(t).toContain('Status columns of the board: Todo, Done');
    expect(t).not.toMatch(/confluence/i);
  });

});

describe('sanitizeBoardAdvice and the board facts (pure)', () => {
  const columns = ['Todo', 'Doing', 'Plan Approved', 'Done'];

  it('keeps names the board has, in the board\'s spelling, and drops the rest', () => {
    expect(sanitizeBoardAdvice({ statusMap: { PLANNING: 'doing', KB: 'Made up' }, approval: { plan: 'plan approved', breakdown: null }, intakeStatus: 'TODO', useDefaultColumns: false }, columns)).toEqual({
      statusMap: { PLANNING: 'Doing', KB: null }, approval: { plan: 'Plan Approved', breakdown: null }, intakeStatus: 'Todo', useDefaultColumns: false,
    });
  });

  it('recommends the default columns when there is no answer or the board has no columns', () => {
    expect(sanitizeBoardAdvice(null, columns)).toMatchObject({ statusMap: {}, intakeStatus: null, useDefaultColumns: true });
    expect(sanitizeBoardAdvice({ statusMap: {}, approval: { plan: null, breakdown: null }, intakeStatus: null, useDefaultColumns: false }, [])).toMatchObject({ useDefaultColumns: true });
  });

  it('keeps the advisor\'s own call for the default columns', () => {
    expect(sanitizeBoardAdvice({ statusMap: {}, approval: { plan: null, breakdown: null }, intakeStatus: null, useDefaultColumns: true }, columns).useDefaultColumns).toBe(true);
  });

  it('puts the board in the facts', () => {
    const facts = { github: { defaultBranch: 'main', languages: [], board: { columns } } };
    expect(factsText('billing', facts)).toContain('Status columns of the board: Todo, Doing, Plan Approved, Done');
  });
});
