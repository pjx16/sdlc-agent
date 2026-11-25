import { describe, expect, it } from 'vitest';
import { FakeJira, FakeJiraClients } from '../../testing/fake-jira';
import type { FormatLoader } from '../format-loader';
import type { SupportRaiser } from '../../support/support-raiser';
import type { PrismaService } from '../../prisma/prisma.service';
import type { Ticket } from '../../generated/prisma/client';
import { PlanHandler } from './plan.handler';
import type { StageLauncher } from './stage-launcher';
import type { StageOutcomes } from './stage-outcomes';

const PLAN = { planMarkdown: 'Do the thing', risks: [], openQuestions: [] };

function make(settings: Record<string, unknown>) {
  const clients = new FakeJiraClients();
  const jira: FakeJira = clients.jira;
  const prisma = {
    project: { findUniqueOrThrow: async () => ({ id: 'p1', jiraMode: 'rest', kbDir: 'kb', settings }) },
    ticket: { update: async () => ({}) },
    stageArtifact: { count: async () => 0, create: async () => ({}), findFirst: async () => null, findMany: async () => [] },
    stateTransition: { findFirst: async () => null },
    event: { create: async () => ({}) },
  } as unknown as PrismaService;
  const launcher = {
    workspaceOf: () => '/nonexistent-workspace',
    launch: async () => ({ kind: 'done', stageRunId: 'run1', envelope: { data: PLAN } }),
  } as unknown as StageLauncher;
  const formats = { load: async () => '', fill: async (_n: string, v: Record<string, string>) => `PLAN ${v.plan}` } as unknown as FormatLoader;
  const raiser = { raise: async () => undefined, close: async () => undefined } as unknown as SupportRaiser;
  const handler = new PlanHandler(prisma, launcher, {} as StageOutcomes, clients, raiser, undefined, formats);
  const ticket = { id: 't1', key: 'T-1', projectId: 'p1', kind: 'feature', title: 'x', body: 'b', source: 'jira', externalKey: 'JIRA-1', planMarkdown: null } as unknown as Ticket;
  return { handler, jira, ticket };
}

describe('PlanHandler Jira comment', () => {
  it('posts the full plan as a Jira comment when comments are on, even if stored settings still contain a confluence key', async () => {
    const { handler, jira, ticket } = make({ confluence: { spaceKey: 'ENG', parentPageId: '99' } });
    await handler.run(ticket);
    expect(jira.calls).toContain('comment JIRA-1');
    expect(jira.commentBodies['JIRA-1']?.[0]).toContain('Do the thing');
  });

  it('posts no Jira comment when jiraWriteBack.comments is off', async () => {
    const { handler, jira, ticket } = make({ jiraWriteBack: { comments: false } });
    await handler.run(ticket);
    expect(jira.calls).toEqual([]);
  });
});
