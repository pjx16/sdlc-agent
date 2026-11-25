import { staticCredentials } from '../../testing/static-credentials';
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Ticket } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { type TestDatabase, createTestDatabase } from '../../testing/test-db';
import type { StageRequest, StageResult } from '../agent-runner/agent-runner';
import { ContainerRunner } from '../agent-runner/container-runner';
import { FakeEngine } from '../agent-runner/fake-engine';
import { GitRunner } from '../git/git-runner';
import { MirrorService } from '../git/mirror.service';
import { WorkspaceService } from '../git/workspace.service';
import { VerifyService } from '../verify/verify.service';
import { WorkerConfig } from '../worker-config';
import { KbUpdateHandler } from './kb-update.handler';
import { KbUpdateService } from './kb-update.service';
import { PlanDocService, planDocPath, planDocText } from './plan-doc.service';
import { StageLauncher } from './stage-launcher';
import { StageOutcomes } from './stage-outcomes';

const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

describe('the plan is committed to the repository', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let tmp: string;
  let projectId: string;
  let workspaces: WorkspaceService;
  let planDocs: PlanDocService;
  let handler: KbUpdateHandler;
  let n = 0;

  const wsOf = (t: Ticket) => path.join(tmp, 'data', 'workspaces', projectId, t.key);
  const ticket = async (planMarkdown: string | null) => {
    const t = await prisma.ticket.create({ data: { projectId, key: `ABC-${++n}`, source: 'paste', title: 'Export bookings', status: 'KB_UPDATE', planMarkdown } });
    await workspaces.prepare(t.id);
    writeFileSync(path.join(wsOf(t), 'src/app.ts'), 'changed');
    await workspaces.commit(t.id, `feat(${t.key}): change app`);
    return prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    process.env.DATABASE_URL = db.url;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    tmp = mkdtempSync(path.join(tmpdir(), 'sdlc-plandoc-'));
    const source = path.join(tmp, 'source');
    execFileSync('git', ['init', '-q', '-b', 'dev', source]);
    mkdirSync(path.join(source, 'src'), { recursive: true });
    writeFileSync(path.join(source, 'package.json'), '{}');
    writeFileSync(path.join(source, 'src/app.ts'), 'original');
    sh(source, 'add', '.');
    sh(source, 'commit', '-q', '-m', 'init');
    const config = new WorkerConfig({ DATA_DIR: path.join(tmp, 'data'), DATABASE_URL: db.url, TEST_PUSH_URL_PREFIXES: 'file://', GIT_AUTHOR_NAME: 'Dev Bot', GIT_AUTHOR_EMAIL: 'bot@example.com', GUIDELINES_DIR: path.resolve(__dirname, '../../../../../guidelines') } as NodeJS.ProcessEnv);
    const project = await prisma.project.create({ data: { name: 'p', repoUrl: `file://${source}`, baseBranch: 'dev', stack: 'ts_node', installCmd: '', testCmdTemplate: 'x {files}', localKeyPrefix: 'P', mirrorStatus: 'pending' } });
    projectId = project.id;
    await new MirrorService(prisma, config, staticCredentials()).clone(project);
    const git = new GitRunner({ token: async () => '' });
    workspaces = new WorkspaceService(prisma, config, git, new VerifyService(new ContainerRunner(new FakeEngine()), config), staticCredentials());
    const runner = { async run(_req: StageRequest): Promise<StageResult> { throw new Error('no agent should run'); } };
    const launcher = new StageLauncher(prisma, config, runner as never);
    planDocs = new PlanDocService(prisma, launcher, workspaces);
    handler = new KbUpdateHandler(new KbUpdateService(prisma, launcher, new StageOutcomes(prisma), workspaces, git, config), planDocs);
  }, 180_000);
  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await db?.drop();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('names the file after the ticket, inside the KB folder, and keeps the key safe', () => {
    expect(planDocPath('docs/kb', 'ABC-12')).toBe('docs/kb/plans/ABC-12.md');
    expect(planDocPath('docs/kb/', '../../etc/x')).toBe('docs/kb/plans/.._.._etc_x.md');
    expect(planDocText({ key: 'ABC-1', title: 'T' }, '## Goal\nDo it\n')).toBe('# ABC-1: T\n\n_The approved plan for this ticket, committed by sdlc-agent._\n\n## Goal\nDo it\n');
  });

  it('commits the plan on the ticket branch and pushes it, even for a ticket with no KB doc', async () => {
    const t = await ticket('## Goal\nExport the bookings.\n\n## Decisions from open questions\n\n1. **Format?**\n   CSV\n');
    const out = await handler.run(t); // the KB update has nothing to do (no KB doc), the plan is still committed
    expect(out).toMatchObject({ kind: 'transition', to: 'AWAITING_CI' });
    const ws = wsOf(t);
    expect(sh(ws, 'log', '-1', '--format=%s')).toBe(`docs(${t.key}): add the plan`);
    expect(sh(ws, 'show', '--name-only', '--format=', 'HEAD')).toBe(`docs/kb/plans/${t.key}.md`);
    expect(readFileSync(path.join(ws, `docs/kb/plans/${t.key}.md`), 'utf8')).toContain('Export the bookings.');
    expect(sh(ws, 'rev-parse', 'HEAD')).toBe(sh(path.join(tmp, 'source'), 'rev-parse', t.branch as string)); // pushed
    expect(await prisma.event.count({ where: { ticketId: t.id, message: { contains: 'plan was committed' } } })).toBe(1);
  });

  it('changes nothing when the plan file is already there, and rewrites it when the plan changed', async () => {
    const t = await ticket('## Goal\nFirst.\n');
    await planDocs.commit(t);
    const ws = wsOf(t);
    const head = sh(ws, 'rev-parse', 'HEAD');
    expect(await planDocs.commit(t)).toBeNull();
    expect(sh(ws, 'rev-parse', 'HEAD')).toBe(head);
    await prisma.ticket.update({ where: { id: t.id }, data: { planMarkdown: '## Goal\nSecond.\n' } });
    await planDocs.commit(t);
    expect(sh(ws, 'rev-parse', 'HEAD')).not.toBe(head);
    expect(readFileSync(path.join(ws, `docs/kb/plans/${t.key}.md`), 'utf8')).toContain('Second.');
  });

  it('does nothing for a ticket with no plan', async () => {
    const t = await ticket(null);
    const head = sh(wsOf(t), 'rev-parse', 'HEAD');
    expect(await planDocs.commit(t)).toBeNull();
    expect(sh(wsOf(t), 'rev-parse', 'HEAD')).toBe(head);
  });
});
