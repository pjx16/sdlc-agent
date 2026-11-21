import { describe, expect, it } from 'vitest';
import { JiraHttpError, JiraStatusNotFoundError, JiraUnavailableError } from '../../jira/jira-client';
import { JiraNotConfiguredError } from '../../jira/jira-clients';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StageRequest, StageResult } from '../agent-runner/agent-runner';
import { JiraConnectorClient } from './jira-connector-client';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PROJECT = { id: 'p1', jiraMode: 'connector', jiraProjectKey: 'ACME', stack: 'ts_node', settings: { jiraConnector: { serverName: 'Jira' } }, createdAt: new Date() };

function fakePrisma(opts: { projects?: Json[]; global?: Json | null } = {}) {
  const projects = opts.projects ?? [PROJECT];
  return {
    project: {
      findFirst: async ({ where }: { where: Json }) =>
        projects.find((p) => p.jiraMode === where.jiraMode && (where.id === undefined || p.id === where.id) && (where.jiraProjectKey === undefined || p.jiraProjectKey === where.jiraProjectKey)) ?? null,
    },
    globalSettings: { findUnique: async () => opts.global ?? null },
  } as unknown as PrismaService;
}

const done = (data: Json): StageResult => ({ kind: 'done', envelope: { status: 'done', summary: 'ok', data } as never, stageRunId: 'r1', attempts: 1 });

function make(results: StageResult[], prismaOpts?: Parameters<typeof fakePrisma>[0]) {
  const requests: StageRequest[] = [];
  const runner = { run: async (req: StageRequest) => (requests.push(req), results.shift() as StageResult) };
  return { client: new JiraConnectorClient(fakePrisma(prismaOpts), runner), requests };
}

describe('JiraConnectorClient', () => {
  it('runs the jiraConnector stage for the issue key\'s project, with its connector name and a bounded timeout', async () => {
    const { client, requests } = make([done({ result: { key: 'ACME-1', status: 'To Do', summary: 's', description: 'd' }, error: null })]);
    expect(await client.readStatus('ACME-1')).toEqual({ key: 'ACME-1', status: 'To Do', summary: 's', description: 'd' });
    const req = requests[0] as StageRequest;
    expect(req.stage).toBe('jiraConnector');
    expect(req.projectId).toBe('p1');
    expect(req.stageTimeoutMin).toBeLessThanOrEqual(10);
    expect(req.inputs.jira).toMatchObject({ serverName: 'Jira', args: { issueKey: 'ACME-1' } });
    expect(req.workspacePath).toBeUndefined();
  });

  it('searches with the default JQL and returns typed tickets', async () => {
    const { client, requests } = make([done({ result: { issues: [{ key: 'ACME-2', summary: 'x', issuetype: 'Story', labels: ['sdlc-agent'], priority: null }] }, error: null })]);
    const tickets = await client.searchTickets({ id: 'p1', jiraProjectKey: 'ACME' });
    expect(tickets).toEqual([{ key: 'ACME-2', summary: 'x', description: '', issuetype: 'Story', labels: ['sdlc-agent'], priority: null }]);
    expect(requests[0]?.inputs.jira?.args).toMatchObject({ jql: 'project = "ACME" AND labels = "sdlc-agent" ORDER BY created ASC' });
  });

  it('passes the marker so a repeated comment is not posted twice', async () => {
    const { client, requests } = make([done({ result: { done: true, alreadyThere: false }, error: null })]);
    await client.comment('ACME-1', 'hello', '[m]');
    expect(requests[0]?.inputs.jira?.args).toEqual({ issueKey: 'ACME-1', body: 'hello\n\n[m]', marker: '[m]' });
  });

  it('a missing transition becomes JiraStatusNotFoundError with the reachable statuses', async () => {
    const { client } = make([done({ result: { done: false, available: ['In Review'] }, error: null })]);
    await expect(client.transition('ACME-1', 'Done')).rejects.toSatisfy((e: unknown) => e instanceof JiraStatusNotFoundError && e.available.join() === 'In Review');
  });

  it('an answer of the wrong shape is a Jira error, never a guess', async () => {
    const { client } = make([done({ result: { status: 'To Do' }, error: null })]);
    await expect(client.readStatus('ACME-1')).rejects.toMatchObject({ status: 502 });
  });

  it('maps a reported error to a status, so sign-in problems raise the credential item', async () => {
    const { client } = make([done({ result: null, error: 'The Jira connector is not connected' })]);
    await expect(client.readStatus('ACME-1')).rejects.toMatchObject({ status: 401 });
  });

  it('a refused claude.ai login asks to run the login script again', async () => {
    const { client } = make([{ kind: 'claude_auth', stageRunId: 'r', attempts: 1 }]);
    await expect(client.readStatus('ACME-1')).rejects.toSatisfy((e: unknown) => e instanceof JiraHttpError && e.status === 401 && /jira-connector-login/.test(e.message));
  });

  it('low credits, rate limits and container errors back intake off instead of failing', async () => {
    const limited = make([{ kind: 'out_of_credits', stageRunId: 'r', attempts: 1 }]);
    await expect(limited.client.readStatus('ACME-1')).rejects.toBeInstanceOf(JiraUnavailableError);
    const rate = make([{ kind: 'failed', reason: 'rate limited', errorCode: 'CLAUDE_RATE_LIMIT', stageRunId: 'r', attempts: 4 }]);
    await expect(rate.client.readStatus('ACME-1')).rejects.toBeInstanceOf(JiraUnavailableError);
    const broken = make([{ kind: 'failed', reason: 'no docker', errorCode: 'CONTAINER_ERROR', stageRunId: 'r', attempts: 2 }]);
    await expect(broken.client.readStatus('ACME-1')).rejects.toBeInstanceOf(JiraUnavailableError);
  });

  it('does not run while Claude is paused for credits', async () => {
    const { client, requests } = make([], { global: { pipelinePaused: true, pausedCode: 'CLAUDE_CREDITS' } });
    await expect(client.readStatus('ACME-1')).rejects.toBeInstanceOf(JiraUnavailableError);
    expect(requests).toHaveLength(0);
  });

  it('says so when no project uses connector mode', async () => {
    const { client } = make([], { projects: [] });
    await expect(client.readStatus('ACME-1')).rejects.toBeInstanceOf(JiraNotConfiguredError);
  });
});
