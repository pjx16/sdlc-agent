import type { OnboardingProposal } from '@sdlc/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SupportRaiser } from '../support/support-raiser';
import { type TestApp, createTestApp } from '../testing/test-app';
import { type TestDatabase, createTestDatabase } from '../testing/test-db';
import { ProjectsModule } from './projects.module';

const proposalFor = (over: Partial<OnboardingProposal> = {}): OnboardingProposal => ({
  facts: {
    github: { defaultBranch: 'main', languages: ['TypeScript'] },
  },
  profile: { stack: 'nestjs', installCmd: 'npm ci', typecheckCmd: 'npx tsc --noEmit', testCmdTemplate: 'npx jest {files}', kbDir: 'docs/kb', testFilePattern: '**/*.spec.ts', exampleTestFile: null, baseBranch: 'main', installCheck: { command: 'npm ci', ok: true, tail: '' }, typecheckCheck: null },
  accepted: {},
  createdAt: '2026-11-14T10:00:00Z',
  ...over,
});

describe('Project onboarding API', () => {
  let db: TestDatabase;
  let t: TestApp;
  let raiser: SupportRaiser;
  let n = 0;

  const proposed = async (over: Partial<OnboardingProposal> = {}, projectOver: Record<string, unknown> = {}) =>
    t.prisma.project.create({ data: { name: `onb-${++n}`, repoUrl: 'https://github.com/acme/billing', stack: 'ts_node', testCmdTemplate: 'echo {files}', localKeyPrefix: `O${n}`, onboardingStatus: 'proposed', onboardingProposal: proposalFor(over) as never, ...projectOver } });
  const patch = (id: string, section: string, body: Record<string, unknown>) => t.agent.patch(`/projects/${id}/onboarding/sections/${section}`).send(body);
  const reload = (id: string) => t.prisma.project.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await createTestApp(db.url, [ProjectsModule]);
    raiser = t.app.get(SupportRaiser);
  }, 180_000);
  afterAll(async () => {
    await t?.close();
    await db?.drop();
  });
  beforeEach(async () => {
    await t.prisma.supportTicket.deleteMany();
    await t.prisma.project.deleteMany({ where: { name: { startsWith: 'onb-' } } });
  });

  describe('starting', () => {
    it('requires a session', async () => {
      await t.anonymous.post('/projects/onboard').send({ repoUrl: 'https://github.com/a/b' }).expect(401);
    });

    it('creates a profiling project from a repo URL alone', async () => {
      const res = await t.agent.post('/projects/onboard').send({ repoUrl: 'https://github.com/acme/billing' }).expect(201);
      expect(res.body).toMatchObject({ name: 'billing', onboardingStatus: 'profiling', mirrorStatus: 'pending', enabled: true });
    });

    it('the project works with the personal token unless it is started as the bot, and the choice is kept', async () => {
      expect((await t.agent.post('/projects/onboard').send({ repoUrl: 'https://github.com/acme/own' }).expect(201)).body.githubAuth).toBe('token');
      const bot = (await t.agent.post('/projects/onboard').send({ repoUrl: 'https://github.com/acme/botted', githubAuth: 'bot' }).expect(201)).body;
      expect(bot.githubAuth).toBe('bot');
      expect((await t.agent.get(`/projects/${bot.id}`).expect(200)).body.githubAuth).toBe('bot');
      await t.agent.post('/projects/onboard').send({ repoUrl: 'https://github.com/acme/bad', githubAuth: 'pat' }).expect(400);
    });

    it('a second project for another owner with the same repo name gets a distinct name', async () => {
      await t.agent.post('/projects/onboard').send({ repoUrl: 'https://github.com/acme/api' }).expect(201);
      const second = await t.agent.post('/projects/onboard').send({ repoUrl: 'https://github.com/other/api' }).expect(201);
      expect(second.body.name).toBe('other-api');
      await t.prisma.project.deleteMany({ where: { name: { in: ['api', 'other-api'] } } });
    });

    it('rejects a URL that is not an HTTPS github.com repository', async () => {
      const bad = await t.agent.post('/projects/onboard').send({ repoUrl: 'git@github.com:a/b.git' }).expect(400);
      expect(bad.body.fields).toMatchObject({ repoUrl: expect.stringContaining('github.com') });
    });

    it('the worker ignores it until confirmed, so it is also absent from nothing but its own queue', async () => {
      const res = await t.agent.post('/projects/onboard').send({ repoUrl: 'https://github.com/acme/ledger' }).expect(201);
      expect((await t.agent.get(`/projects/${res.body.id}/onboarding`).expect(200)).body).toEqual({ status: 'profiling', error: null, proposal: null, progress: null });
      await t.prisma.project.delete({ where: { id: res.body.id } });
    });
  });

  describe('reviewing a proposal', () => {
    it('shows the stored proposal, so the person can leave and come back', async () => {
      const p = await proposed();
      const res = (await t.agent.get(`/projects/${p.id}/onboarding`).expect(200)).body;
      expect(res.status).toBe('proposed');
      expect(res.proposal.profile.stack).toBe('nestjs');
    });

    it('accepting a section records it; editing records the change and counts as accepting', async () => {
      const p = await proposed();
      await patch(p.id, 'commands', { action: 'accept' }).expect(200);
      const edited = (await patch(p.id, 'commands', { action: 'edit', value: { kbDir: 'docs/kb2' } }).expect(200)).body;
      expect(edited.proposal.accepted).toEqual({ commands: true });
      expect(edited.proposal.profile.kbDir).toBe('docs/kb2');
    });

    it('edits the commands, and rejects a test command without {files}', async () => {
      const p = await proposed();
      const ok = (await patch(p.id, 'commands', { action: 'edit', value: { testCmdTemplate: 'npx vitest run {files}', baseBranch: 'dev' } }).expect(200)).body;
      expect(ok.proposal.profile).toMatchObject({ testCmdTemplate: 'npx vitest run {files}', baseBranch: 'dev', stack: 'nestjs' });
      const bad = await patch(p.id, 'commands', { action: 'edit', value: { testCmdTemplate: 'npx vitest run' } }).expect(400);
      expect(bad.body.fields.testCmdTemplate).toContain('{files}');
    });

    it('a section that is gone (the old Jira ones, Confluence) is a 404', async () => {
      const p = await proposed();
      for (const gone of ['statusMap', 'routing', 'label', 'confluence']) await patch(p.id, gone, { action: 'accept' }).expect(404);
    });

    it('404 for an unknown section or project; 409 when there is no proposal yet', async () => {
      const p = await proposed();
      await patch(p.id, 'colour', { action: 'accept' }).expect(404);
      await patch('00000000-0000-0000-0000-000000000000', 'commands', { action: 'accept' }).expect(404);
      const profiling = await proposed({}, { onboardingStatus: 'profiling', onboardingProposal: undefined });
      await patch(profiling.id, 'commands', { action: 'accept' }).expect(409);
    });
  });

  describe('the GitHub Projects board mapping', () => {
    const withBoard = (over: Record<string, unknown> = {}) =>
      proposed(
        {
          facts: { github: { defaultBranch: 'main', languages: [], board: { columns: ['Todo', 'Doing', 'Plan Approved', 'Done'] } } },
          board: { statusMap: { PLANNING: 'Doing', DONE: 'Done' }, approval: { plan: 'Plan Approved', breakdown: null }, intakeStatus: 'Todo', useDefaultColumns: false },
        },
        over,
      );

    it('has to be accepted before the project is confirmed', async () => {
      const p = await withBoard();
      const res = await t.agent.post(`/projects/${p.id}/onboarding/confirm`).expect(409);
      expect(res.body.fields).toEqual({ board: 'must be accepted' });
    });

    it('is written to the project\'s GitHub settings on confirm', async () => {
      const p = await withBoard({ settings: { github: { mode: 'projects', project: { owner: 'acme', number: 3 } } } });
      await patch(p.id, 'board', { action: 'accept' }).expect(200);
      const settings = (await t.agent.post(`/projects/${p.id}/onboarding/confirm`).expect(200)).body.project.settings;
      expect(settings.github).toMatchObject({ mode: 'projects', project: { owner: 'acme', number: 3 }, intakeStatus: 'Todo', useDefaultColumns: false, statusMap: { PLANNING: 'Doing', DONE: 'Done' }, approval: { plan: 'Plan Approved', breakdown: null, label: 'sdlc:approved' } });
    });

    it('can be edited, in the board\'s own spelling, and refuses a column the board does not have', async () => {
      const p = await withBoard();
      await patch(p.id, 'board', { action: 'edit', value: { approval: { breakdown: 'done' }, useDefaultColumns: true } }).expect(200);
      const board = ((await reload(p.id)).onboardingProposal as unknown as OnboardingProposal).board;
      expect(board).toMatchObject({ approval: { plan: 'Plan Approved', breakdown: 'Done' }, useDefaultColumns: true });
      const res = await patch(p.id, 'board', { action: 'edit', value: { statusMap: { KB: 'Shipped' } } }).expect(400);
      expect(JSON.stringify(res.body.fields)).toContain('is not a column of this board');
    });

    it('is refused for a project with no board', async () => {
      const p = await proposed();
      await patch(p.id, 'board', { action: 'accept' }).expect(400);
    });
  });

  describe('confirming', () => {
    it('applies the proposal to the project and its settings, and activates it', async () => {
      const p = await proposed();
      const res = (await t.agent.post(`/projects/${p.id}/onboarding/confirm`).expect(200)).body;
      expect(res.warnings).toEqual([]);
      expect(res.project).toMatchObject({ onboardingStatus: 'confirmed', stack: 'nestjs', testCmdTemplate: 'npx jest {files}', baseBranch: 'main' });
      const settings = res.project.settings;
      expect('confluence' in settings).toBe(false);
      expect(Object.keys(settings).filter((k) => k.startsWith('jira'))).toEqual([]);
    });

    it('starts a new project with the stage models and turn limits chosen in Settings', async () => {
      await t.prisma.globalSettings.upsert({ where: { id: 'global' }, update: { stageDefaults: { solutionDesign: { model: 'haiku', maxTurns: 6 }, implement: { model: 'opus', maxTurns: 90 } } }, create: { id: 'global', stageDefaults: { solutionDesign: { model: 'haiku', maxTurns: 6 }, implement: { model: 'opus', maxTurns: 90 } } } });
      const p = await proposed();
      const stages = (await t.agent.post(`/projects/${p.id}/onboarding/confirm`).expect(200)).body.project.settings.stages;
      expect(stages.solutionDesign).toMatchObject({ model: 'haiku', maxTurns: 6 });
      expect(stages.implement).toMatchObject({ model: 'opus', maxTurns: 90, enabled: true });
      expect(stages.prReview).toMatchObject({ model: 'sonnet', maxTurns: 10 }); // not set: the built-in default
      await t.prisma.globalSettings.deleteMany();
    });

    it('closes the onboarding ticket and resolves it as confirmed', async () => {
      const p = await proposed();
      await raiser.raise({ kind: 'onboarding', projectId: p.id, title: 'Review', body: 'b', dedupeKey: `onboarding:${p.id}` });
      await t.agent.post(`/projects/${p.id}/onboarding/confirm`).expect(200);
      expect(await t.prisma.supportTicket.findMany({ where: { projectId: p.id } })).toMatchObject([{ kind: 'onboarding', status: 'resolved', resolvedBy: 'user' }]);
    });

    it('a changed base branch queues a fresh mirror', async () => {
      const p = await proposed({}, { mirrorStatus: 'ok', baseBranch: 'main' });
      await patch(p.id, 'commands', { action: 'edit', value: { baseBranch: 'develop' } });
      await t.agent.post(`/projects/${p.id}/onboarding/confirm`).expect(200);
      expect(await reload(p.id)).toMatchObject({ baseBranch: 'develop', mirrorStatus: 'pending' });
    });

    it('409 when there is nothing to confirm, and a confirmed project cannot be confirmed twice', async () => {
      const profiling = await proposed({}, { onboardingStatus: 'profiling', onboardingProposal: undefined });
      await t.agent.post(`/projects/${profiling.id}/onboarding/confirm`).expect(409);
      const p = await proposed();
      await t.agent.post(`/projects/${p.id}/onboarding/confirm`).expect(200);
      await t.agent.post(`/projects/${p.id}/onboarding/confirm`).expect(409);
    });
  });

  describe('running it again', () => {
    it('makes a new proposal and changes nothing until it is confirmed again', async () => {
      const p = await proposed({}, { stack: 'nextjs', testCmdTemplate: 'keep {files}' });
      await raiser.raise({ kind: 'onboarding', projectId: p.id, title: 'Review', body: 'b', dedupeKey: `onboarding:${p.id}` });
      const res = (await t.agent.post(`/projects/${p.id}/onboarding/rerun`).expect(200)).body;
      expect(res).toMatchObject({ status: 'profiling', error: null });
      expect(await reload(p.id)).toMatchObject({ stack: 'nextjs', testCmdTemplate: 'keep {files}' }); // settings untouched
      expect((await t.prisma.supportTicket.findFirstOrThrow({ where: { projectId: p.id } })).status).toBe('dismissed');
      await t.agent.post(`/projects/${p.id}/onboarding/rerun`).expect(409); // already profiling
    });

    it('works from a failed draft too', async () => {
      const p = await proposed({}, { onboardingStatus: 'draft', onboardingError: 'GitHub: Not Found', onboardingProposal: undefined });
      expect((await t.agent.post(`/projects/${p.id}/onboarding/rerun`).expect(200)).body).toMatchObject({ status: 'profiling', error: null });
    });
  });

  it('the project API shows the onboarding state and does not let a PATCH change it', async () => {
    const p = await proposed();
    const got = (await t.agent.get(`/projects/${p.id}`).expect(200)).body;
    expect(got).toMatchObject({ onboardingStatus: 'proposed', onboardingError: null });
    const patched = (await t.agent.patch(`/projects/${p.id}`).send({ onboardingStatus: 'confirmed', kbDir: 'docs/kb2' }).expect(200)).body;
    expect(patched.kbDir).toBe('docs/kb2');
    expect((await reload(p.id)).onboardingStatus).toBe('proposed');
  });
});
