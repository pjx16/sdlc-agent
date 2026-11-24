import 'reflect-metadata';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import type { OnboardAdvice, OnboardingProposal, RepoProfile, StageEnvelope } from '@sdlc/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JiraNotConfiguredError } from '../../jira/jira-clients';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportRaiser } from '../../support/support-raiser';
import { FakeConfluence, FakeConfluenceClients } from '../../testing/fake-confluence';
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
  confluenceSpaceKey: 'ENG',
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
  let confluence: FakeConfluence;
  let requests: StageRequest[] = [];
  let agent: (req: StageRequest) => StageResult | Promise<StageResult>;
  let verifyCalls: { cmd: string }[] = [];
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
    const confluenceClients = new FakeConfluenceClients();
    confluence = confluenceClients.confluence;
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
    worker = new OnboardingWorker(prisma, config, mirrors as never, git as never, github, jiraClients, confluenceClients, runner as never, verify as never, new SupportRaiser(prisma));
  }, 180_000);
  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await db?.drop();
    rmSync(tmp, { recursive: true, force: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(async () => {
    requests = [];
    verifyCalls = [];
    verifyOk = {};
    github.facts = { defaultBranch: 'main', languages: ['TypeScript'] };
    github.failFacts = null;
    jira.failWith = null;
    confluence.failWith = null;
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
    expect(proposal.facts.confluence).toEqual({ spaces: [{ key: 'ENG', name: 'Engineering' }, { key: 'SDA', name: 'SDA Platform' }] });
    expect(proposal.profile).toMatchObject({ stack: 'nestjs', testCmdTemplate: 'npx jest {files}', baseBranch: 'main', installCheck: { command: 'npm ci', ok: true }, typecheckCheck: { command: 'npx tsc --noEmit', ok: true } });
    expect(proposal.accepted).toEqual({});
    expect(requests.map((r) => r.stage)).toEqual(['repoProfile', 'onboardAdvise']);
    expect(requests[0]?.workspacePath).toContain(path.join('onboarding', p.id));
    expect(requests[1]?.workspacePath).toBeUndefined();
    expect(requests[1]?.inputs.onboard?.facts).toContain('Issue types:');
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

  it('never leaves an invented Jira status, issue type route or Confluence space in the proposal', async () => {
    const p = await project();
    agent = (req) => done(req.stage === 'repoProfile' ? profile : { ...advice, confluenceSpaceKey: 'NOPE', approvalStatuses: { plan: 'Plan Approved', breakdown: 'Ghost' } });
    await worker.check();
    const a = ((await reload(p.id)).onboardingProposal as unknown as OnboardingProposal).advice;
    expect(a.statusMap.FAILED).toBeNull(); // not a status of the project
    expect(a.statusMap.KB).toBe('In Progress');
    expect(a.approvalStatuses).toEqual({ plan: null, breakdown: null }); // "Plan Approved" is not in the fake project either
    expect(a.confluenceSpaceKey).toBeNull();
    expect(a.issueTypeRouting['Sub-task']).toBe('ignore'); // the sub-task type is always ignored
  });

  it('without a Jira key there is no advisor run, and the proposal still has the commands', async () => {
    const p = await project({ jiraMode: 'off', jiraProjectKey: null });
    await worker.check();
    expect(requests.map((r) => r.stage)).toEqual(['repoProfile']);
    const proposal = (await reload(p.id)).onboardingProposal as unknown as OnboardingProposal;
    expect(proposal.facts.jira).toBeNull();
    expect(proposal.advice).toMatchObject({ intakeLabel: 'sdlc-agent', issueTypeRouting: {}, confluenceSpaceKey: null });
  });

  it('works when Confluence cannot be reached, and says why', async () => {
    const p = await project();
    confluence.failWith = new Error('Confluence 401: Unauthorized');
    await worker.check();
    const proposal = (await reload(p.id)).onboardingProposal as unknown as OnboardingProposal;
    expect(proposal.facts.confluence).toEqual({ spaces: null, reason: 'Confluence 401: Unauthorized' });
    expect(proposal.advice.confluenceSpaceKey).toBeNull();
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

  describe('speed and progress', () => {
    const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    /** True once `cond` holds, false after `ms`: a missing concurrency fails the test instead of hanging it. */
    const until = async (cond: () => boolean, ms = 2000) => {
      const end = Date.now() + ms;
      while (!cond()) {
        if (Date.now() > end) return false;
        await tick(5);
      }
      return true;
    };
    /** Every `onboardingStep` value the worker writes, in order. */
    const recordSteps = () => {
      const steps: (string | null)[] = [];
      const original = prisma.project.update.bind(prisma.project);
      vi.spyOn(prisma.project, 'update').mockImplementation(((args: { data: Record<string, unknown> }) => {
        if (args.data && 'onboardingStep' in args.data) steps.push(args.data.onboardingStep as string | null);
        return original(args as never);
      }) as never);
      return steps;
    };
    const checkoutOf = (id: string) => path.join(tmp, 'data', 'onboarding', id);

    it('looks up GitHub, Jira and Confluence at the same time', async () => {
      const p = await project();
      const started: string[] = [];
      let othersStartedBeforeGithubEnded = false;
      vi.spyOn(github, 'repoFacts').mockImplementation(async () => {
        started.push('github');
        othersStartedBeforeGithubEnded = await until(() => started.includes('jira') && started.includes('confluence'));
        return { defaultBranch: 'main', languages: ['TypeScript'] };
      });
      const projectFacts = jira.projectFacts.bind(jira);
      vi.spyOn(jira, 'projectFacts').mockImplementation(async (key: string) => (started.push('jira'), projectFacts(key)));
      const listSpaces = confluence.listWritableSpaces.bind(confluence);
      vi.spyOn(confluence, 'listWritableSpaces').mockImplementation(async () => (started.push('confluence'), listSpaces()));
      await worker.check();
      expect(othersStartedBeforeGithubEnded).toBe(true);
      expect((await reload(p.id)).onboardingStatus).toBe('proposed');
    });

    it('starts the advisor before the profiler has finished', async () => {
      const p = await project();
      const events: string[] = [];
      agent = async (req) => {
        events.push(`${req.stage}:start`);
        if (req.stage === 'repoProfile') {
          await until(() => events.includes('onboardAdvise:start'));
          events.push('repoProfile:end');
          return done(profile);
        }
        return done(advice);
      };
      await worker.check();
      expect(events).toContain('onboardAdvise:start');
      expect(events.indexOf('onboardAdvise:start')).toBeLessThan(events.indexOf('repoProfile:end'));
      expect((await reload(p.id)).onboardingStatus).toBe('proposed');
    });

    it('fails as one unit when the advisor fails while the profiler succeeds: draft, error, checkout removed, step null', async () => {
      const p = await project();
      agent = (req) => (req.stage === 'onboardAdvise' ? { kind: 'out_of_credits', stageRunId: 'r', attempts: 1 } : done(profile));
      await worker.check();
      expect(await reload(p.id)).toMatchObject({ onboardingStatus: 'draft', onboardingProposal: null, onboardingStep: null, onboardingError: expect.stringContaining('credit balance is too low') });
      expect(existsSync(checkoutOf(p.id))).toBe(false);
    });

    it('fails as one unit when the profiler fails while the advisor succeeds: draft, error, checkout removed, step null', async () => {
      const p = await project();
      agent = async (req) => {
        if (req.stage === 'repoProfile') return { kind: 'failed', reason: 'profiler broke', errorCode: 'INVALID_OUTPUT', stageRunId: 'r', attempts: 1 };
        await tick(20);
        return done(advice);
      };
      await worker.check();
      expect(await reload(p.id)).toMatchObject({ onboardingStatus: 'draft', onboardingProposal: null, onboardingStep: null, onboardingError: expect.stringContaining('profiler broke') });
      expect(existsSync(checkoutOf(p.id))).toBe(false);
    });

    it('keeps the GitHub and Jira error messages when the lookups run together', async () => {
      const p = await project();
      github.failFacts = new Error('gh: Not Found (HTTP 404)');
      await worker.check();
      expect((await reload(p.id)).onboardingError).toBe('GitHub: gh: Not Found (HTTP 404). Check the GitHub token in Settings → Connections and the repository URL.');
      const q = await project();
      github.failFacts = null;
      jira.failWith = new Error('Jira 404: No project could be found with key SDA');
      await worker.check();
      expect((await reload(q.id)).onboardingError).toBe('Jira: Jira 404: No project could be found with key SDA. Check the project key and the Jira credential.');
    });

    it('still tolerates a Confluence failure while the other lookups succeed', async () => {
      const p = await project();
      confluence.failWith = new Error('Confluence 500');
      await worker.check();
      const after = await reload(p.id);
      expect(after.onboardingStatus).toBe('proposed');
      expect((after.onboardingProposal as unknown as OnboardingProposal).facts.confluence).toEqual({ spaces: null, reason: 'Confluence 500' });
    });

    it('writes the step at each stage in order and clears it when the proposal is ready', async () => {
      const steps = recordSteps();
      const p = await project();
      await worker.check();
      const order = ['access', 'facts', 'clone', 'analyse', 'verify', 'saving'];
      const positions = order.map((s) => steps.indexOf(s));
      expect(positions.every((i) => i >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      expect(steps[steps.length - 1]).toBeNull();
      expect(await reload(p.id)).toMatchObject({ onboardingStatus: 'proposed', onboardingStep: null });
    });

    it('shows the analyse step on the project while the profiler runs', async () => {
      const p = await project();
      const seen: Record<string, string | null> = {};
      agent = async (req) => {
        seen[req.stage] = (await reload(p.id)).onboardingStep;
        return done(req.stage === 'repoProfile' ? profile : advice);
      };
      await worker.check();
      expect(seen.repoProfile).toBe('analyse');
    });

    it('sets the step to null when the onboarding fails', async () => {
      const steps = recordSteps();
      const p = await project();
      github.failFacts = new Error('gh: Not Found (HTTP 404)');
      await worker.check();
      expect(steps.length).toBeGreaterThan(0);
      expect(steps[steps.length - 1]).toBeNull();
      expect(await reload(p.id)).toMatchObject({ onboardingStatus: 'draft', onboardingStep: null });
    });

    it('logs how long each step took', async () => {
      const lines: string[] = [];
      for (const level of ['log', 'debug', 'verbose'] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation((msg: unknown) => void lines.push(String(msg)));
      }
      await project();
      await worker.check();
      for (const step of ['facts', 'clone', 'analyse', 'verify', 'saving']) {
        expect(lines.some((l) => l.includes(step) && /\d+(\.\d+)?\s?m?s\b/.test(l)), `no duration logged for ${step}`).toBe(true);
      }
    });
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
      confluence: { spaces: null, reason: 'no access' },
    });
    expect(t).toContain('- Sub-task (the sub-task type)');
    expect(t).toContain('- Story: To Do [new]');
    expect(t).toContain('Labels already in use: none');
    expect(t).toContain('Confluence is not available: no access');
  });

  it('with no advice at all, falls back on the default routing and label', () => {
    const jira = { projectName: 'x', issueTypes: [{ name: 'Bug', subtask: false }, { name: 'Epic', subtask: false }], statusesByType: [], labels: [] };
    expect(sanitizeAdvice(null, jira, [])).toEqual({ statusMap: {}, approvalStatuses: { plan: null, breakdown: null }, issueTypeRouting: { Bug: 'bug', Epic: 'ignore' }, intakeLabel: 'sdlc-agent', confluenceSpaceKey: null });
  });
});
