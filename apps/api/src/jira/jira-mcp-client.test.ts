import { describe, expect, it } from 'vitest';
import { JiraHttpError, JiraStatusNotFoundError, JiraUnavailableError, jiraMarker, markerLabel } from './jira-client';
import { JiraMcpClient } from './jira-mcp-client';
import { OAuthGrantAuth, basicAuth } from './mcp-auth';
import { McpSession, parseRpc } from './mcp-session';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolHandler = (args: Json) => unknown;

const CLOUD = '11111111-2222-3333-4444-555555555555';
const DEFAULT_TOOLS = ['getAccessibleAtlassianResources', 'searchJiraIssuesUsingJql', 'getJiraIssue', 'addCommentToJiraIssue', 'getTransitionsForJiraIssue', 'transitionJiraIssue', 'createJiraIssue', 'getVisibleJiraProjects', 'getJiraProjectIssueTypesMetadata'];

/**
 * A fake Rovo MCP server behind fetch: answers initialize and tools/list, and routes tools/call to handlers. Every tool call is
 * recorded. `sse` answers as an event stream; `status` lets a test script HTTP failures for the next requests.
 */
function fakeServer(handlers: Record<string, ToolHandler>, opts: { tools?: string[]; sse?: boolean; statuses?: number[]; sites?: Json[] } = {}) {
  const calls: { tool: string; args: Json }[] = [];
  const headers: Record<string, string>[] = [];
  const statuses = [...(opts.statuses ?? [])];
  const tools = opts.tools ?? DEFAULT_TOOLS;
  const sites = opts.sites ?? [{ id: CLOUD, url: 'https://acme.atlassian.net', name: 'acme' }];
  const impl = (async (_url: string, init: RequestInit) => {
    headers.push(init.headers as Record<string, string>);
    const status = statuses.shift();
    if (status) return new Response('nope', { status });
    const msg = JSON.parse(String(init.body)) as Json;
    if (msg.id === undefined) return new Response(null, { status: 202 });
    let result: unknown;
    if (msg.method === 'initialize') result = { protocolVersion: '2025-06-18', serverInfo: { name: 'fake' } };
    else if (msg.method === 'tools/list') result = { tools: tools.map((name) => ({ name })) };
    else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params as { name: string; arguments: Json };
      calls.push({ tool: name, args });
      try {
        const value = name === 'getAccessibleAtlassianResources' ? sites : handlers[name]?.(args);
        if (value === undefined) throw new Error(`no handler for ${name}`);
        result = { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] };
      } catch (err) {
        result = { isError: true, content: [{ type: 'text', text: (err as Error).message }] };
      }
    }
    const body = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
    const res = opts.sse ? `event: message\ndata: ${body}\n\n` : body;
    return new Response(res, { status: 200, headers: { 'mcp-session-id': 'sess-1', 'content-type': opts.sse ? 'text/event-stream' : 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls, headers };
}

const make = (handlers: Record<string, ToolHandler>, opts: Parameters<typeof fakeServer>[1] & { cloudId?: string; siteUrl?: string } = {}) => {
  const server = fakeServer(handlers, opts);
  const sleeps: number[] = [];
  const session = new McpSession('https://mcp.example/v2/mcp', basicAuth('me@acme.com', 'scoped'), { fetch: server.impl, sleep: async (ms) => void sleeps.push(ms) });
  return { client: new JiraMcpClient(session, { cloudId: opts.cloudId, siteUrl: opts.siteUrl }), ...server, sleeps };
};

const issue = (key: string, over: Json = {}) => ({ key, fields: { summary: `S ${key}`, description: `Body ${key}`, issuetype: { name: 'Story' }, labels: ['sdlc-agent'], priority: { name: 'High' }, ...over } });

describe('McpSession', () => {
  it('opens a session, keeps its id and sends Basic auth', async () => {
    const { client, headers } = make({ getJiraIssue: () => issue('A-1', { status: { name: 'To Do' } }) });
    await client.readStatus('A-1');
    expect(headers[0]?.authorization).toBe(`Basic ${Buffer.from('me@acme.com:scoped').toString('base64')}`);
    expect(headers.at(-1)?.['mcp-session-id']).toBe('sess-1');
  });

  it('reads answers sent as an SSE stream', async () => {
    const { client } = make({ getJiraIssue: () => issue('A-1', { status: { name: 'Done' } }) }, { sse: true });
    expect((await client.readStatus('A-1')).status).toBe('Done');
  });

  it('retries 5xx and 429, then gives up with JiraUnavailableError', async () => {
    const { client, sleeps } = make({}, { statuses: [503, 429, 500, 502] });
    await expect(client.readStatus('A-1')).rejects.toBeInstanceOf(JiraUnavailableError);
    expect(sleeps).toEqual([1000, 4000, 16000]);
  });

  it('turns a 401 into JiraHttpError(401) when there is nothing to refresh', async () => {
    const { client } = make({}, { statuses: [401] });
    await expect(client.readStatus('A-1')).rejects.toMatchObject({ status: 401 });
  });

  it('reports tool errors about permissions as 403', async () => {
    const { client } = make({ getJiraIssue: () => { throw new Error('You do not have permission to view this issue'); } });
    await expect(client.readStatus('A-1')).rejects.toMatchObject({ status: 403 });
  });

  it('parseRpc picks the event with the matching id', () => {
    const text = `data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n`;
    expect(parseRpc(text, 7)).toMatchObject({ result: { ok: true } });
  });
});

describe('JiraMcpClient', () => {
  it('finds the cloud ID from the configured site and passes it on every Jira call', async () => {
    const { client, calls } = make(
      { getJiraIssue: () => issue('A-1', { status: { name: 'To Do' } }) },
      { siteUrl: 'https://acme.atlassian.net/', sites: [{ id: 'other', url: 'https://other.atlassian.net' }, { id: CLOUD, url: 'https://acme.atlassian.net' }] },
    );
    await client.readStatus('A-1');
    expect(calls.find((c) => c.tool === 'getJiraIssue')?.args.cloudId).toBe(CLOUD);
  });

  it('asks for a site when the sign-in sees several and none is configured', async () => {
    const { client } = make({}, { sites: [{ id: 'a', url: 'https://a.atlassian.net' }, { id: 'b', url: 'https://b.atlassian.net' }] });
    await expect(client.readStatus('A-1')).rejects.toThrow(/sees 2 sites/);
  });

  it('searches with the default JQL, follows pages and marks sub-tasks', async () => {
    const pages = [{ issues: [issue('A-1')], nextPageToken: 'p2', isLast: false }, { issues: [issue('A-2', { parent: { key: 'A-1' } })], isLast: true }];
    const { client, calls } = make({ searchJiraIssuesUsingJql: () => pages.shift() }, { cloudId: CLOUD });
    const tickets = await client.searchTickets({ jiraProjectKey: 'A' });
    expect(tickets.map((t) => [t.key, t.description, t.isSubtask])).toEqual([['A-1', 'Body A-1', false], ['A-2', 'Body A-2', true]]);
    expect(calls[0]?.args.jql).toBe('project = "A" AND labels = "sdlc-agent" ORDER BY created ASC');
    expect(calls[1]?.args.nextPageToken).toBe('p2');
  });

  it('reads ADF descriptions too', async () => {
    const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From ADF' }] }] };
    const { client } = make({ getJiraIssue: () => issue('A-1', { description: adf, status: { name: 'To Do' } }) }, { cloudId: CLOUD });
    expect((await client.readStatus('A-1')).description).toContain('From ADF');
  });

  it('does not post a comment twice when the marker is already there', async () => {
    const marker = jiraMarker('A-1', 'plan', 'x');
    const { client, calls } = make({ getJiraIssue: () => ({ key: 'A-1', fields: { comment: { comments: [{ id: '1', body: `old\n\n${marker}` }] } } }), addCommentToJiraIssue: () => ({ id: '2' }) }, { cloudId: CLOUD });
    await client.comment('A-1', 'plan', marker);
    expect(calls.some((c) => c.tool === 'addCommentToJiraIssue')).toBe(false);
  });

  it('posts markdown with the marker appended', async () => {
    const { client, calls } = make({ getJiraIssue: () => ({ key: 'A-1', fields: { comment: { comments: [] } } }), addCommentToJiraIssue: () => ({ id: '2' }) }, { cloudId: CLOUD });
    await client.comment('A-1', '**plan**', '[m]');
    expect(calls.find((c) => c.tool === 'addCommentToJiraIssue')?.args).toEqual({ cloudId: CLOUD, issueIdOrKey: 'A-1', commentBody: '**plan**\n\n[m]' });
  });

  it('upsert edits the marked comment when an edit tool exists, and posts again when none does', async () => {
    const getJiraIssue = () => ({ key: 'A-1', fields: { comment: { comments: [{ id: '9', body: 'old\n\n[m]' }] } } });
    const withEdit = make({ getJiraIssue, editJiraIssueComment: () => ({}) }, { cloudId: CLOUD, tools: [...DEFAULT_TOOLS, 'editJiraIssueComment'] });
    await withEdit.client.upsertComment('A-1', 'new', '[m]');
    expect(withEdit.calls.find((c) => c.tool === 'editJiraIssueComment')?.args).toMatchObject({ commentId: '9', commentBody: 'new\n\n[m]' });

    const without = make({ getJiraIssue, addCommentToJiraIssue: () => ({}) }, { cloudId: CLOUD });
    await without.client.upsertComment('A-1', 'new', '[m]');
    expect(without.calls.some((c) => c.tool === 'addCommentToJiraIssue')).toBe(true);
  });

  it('transitions by target status name and lists the moves when there is none', async () => {
    const transitions = { transitions: [{ id: '31', name: 'Start', to: { name: 'In Progress' } }] };
    const { client, calls } = make({ getJiraIssue: () => issue('A-1', { status: { name: 'To Do' } }), getTransitionsForJiraIssue: () => transitions, transitionJiraIssue: () => ({}) }, { cloudId: CLOUD });
    await client.transition('A-1', 'in progress');
    expect(calls.find((c) => c.tool === 'transitionJiraIssue')?.args.transition).toEqual({ id: '31' });
    await expect(client.transition('A-1', 'Done')).rejects.toBeInstanceOf(JiraStatusNotFoundError);
  });

  it('skips a transition to the current status', async () => {
    const { client, calls } = make({ getJiraIssue: () => issue('A-1', { status: { name: 'Done' } }) }, { cloudId: CLOUD });
    await client.transition('A-1', 'Done');
    expect(calls.map((c) => c.tool)).toEqual(['getJiraIssue']);
  });

  it('creates a sub-task with the marker label, or returns the one an earlier attempt made', async () => {
    const marker = jiraMarker('A-1', 'subtask-1');
    const fresh = make({ searchJiraIssuesUsingJql: () => ({ issues: [] }), createJiraIssue: () => ({ key: 'A-7' }) }, { cloudId: CLOUD });
    expect(await fresh.client.createSubtask('A-1', { summary: 's', description: 'd', marker })).toEqual({ key: 'A-7' });
    expect(fresh.calls.find((c) => c.tool === 'createJiraIssue')?.args).toMatchObject({ projectKey: 'A', parent: 'A-1', issueTypeName: 'Sub-task', additional_fields: { labels: [markerLabel(marker)] } });

    const again = make({ searchJiraIssuesUsingJql: () => ({ issues: [{ key: 'A-7' }] }) }, { cloudId: CLOUD });
    expect(await again.client.createSubtask('A-1', { summary: 's', description: 'd', marker })).toEqual({ key: 'A-7' });
    expect(again.calls.some((c) => c.tool === 'createJiraIssue')).toBe(false);
  });

  it('builds project facts from projects, issue types, recent issues and transitions', async () => {
    const recent = { issues: [{ key: 'A-1', fields: { labels: ['x'], issuetype: { name: 'Story' }, status: { name: 'To Do', statusCategory: { key: 'new' } } } }] };
    const { client } = make(
      {
        getVisibleJiraProjects: () => ({ values: [{ key: 'A', name: 'Alpha' }] }),
        getJiraProjectIssueTypesMetadata: () => ({ issueTypes: [{ name: 'Story', subtask: false }, { name: 'Sub-task', subtask: true }] }),
        searchJiraIssuesUsingJql: () => recent,
        getTransitionsForJiraIssue: () => ({ transitions: [{ id: '2', to: { name: 'Done', statusCategory: { key: 'done' } } }] }),
      },
      { cloudId: CLOUD },
    );
    const facts = await client.projectFacts('A');
    expect(facts.projectName).toBe('Alpha');
    expect(facts.issueTypes).toEqual([{ name: 'Story', subtask: false }, { name: 'Sub-task', subtask: true }]);
    expect(facts.statusesByType).toEqual([{ type: 'Story', statuses: [{ name: 'To Do', category: 'new' }, { name: 'Done', category: 'done' }] }]);
    expect(facts.labels).toEqual(['x']);
    expect(await client.listStatuses('A')).toEqual(['Done', 'To Do']);
  });

  it('says which tool is missing', async () => {
    const { client } = make({}, { cloudId: CLOUD, tools: ['getAccessibleAtlassianResources'] });
    await expect(client.readStatus('A-1')).rejects.toThrow(/no tool for "getIssue"/);
  });
});

describe('OAuthGrantAuth', () => {
  const grant = { clientId: 'c', tokenEndpoint: 'https://auth.example/token', resource: 'https://mcp.example/v2/mcp', accessToken: 'old', refreshToken: 'r1', expiresAt: 0 };
  const tokenFetch = (replies: Json[]) => {
    const forms: URLSearchParams[] = [];
    const impl = (async (_u: string, init: RequestInit) => {
      forms.push(init.body as URLSearchParams);
      const r = replies.shift() ?? {};
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    }) as unknown as typeof fetch;
    return { impl, forms };
  };

  it('refreshes before expiry and saves the rotated grant', async () => {
    const saved: Json[] = [];
    const { impl, forms } = tokenFetch([{ body: { access_token: 'new', refresh_token: 'r2', expires_in: 3600 } }]);
    const auth = new OAuthGrantAuth({ ...grant, expiresAt: 1_000 }, async (g) => void saved.push(g), impl, () => 1_000);
    expect(await auth.header()).toBe('Bearer new');
    expect(forms[0]?.get('grant_type')).toBe('refresh_token');
    expect(forms[0]?.get('resource')).toBe(grant.resource);
    expect(saved[0]).toMatchObject({ accessToken: 'new', refreshToken: 'r2', expiresAt: 1_000 + 3_600_000 });
  });

  it('refreshes once after a 401 and retries the call', async () => {
    const saved: Json[] = [];
    const { impl: tokenImpl } = tokenFetch([{ body: { access_token: 'new', expires_in: 3600 } }]);
    const auth = new OAuthGrantAuth(grant, async (g) => void saved.push(g), tokenImpl);
    const server = fakeServer({ getJiraIssue: () => issue('A-1', { status: { name: 'To Do' } }) }, { statuses: [401] });
    const client = new JiraMcpClient(new McpSession('https://mcp.example/v2/mcp', auth, { fetch: server.impl, sleep: async () => undefined }), { cloudId: CLOUD });
    expect((await client.readStatus('A-1')).status).toBe('To Do');
    expect(server.headers[0]?.authorization).toBe('Bearer old');
    expect(server.headers[1]?.authorization).toBe('Bearer new');
    expect(saved[0]?.refreshToken).toBe('r1'); // no rotation: the old refresh token is kept
  });

  it('a refused refresh is a 401 that asks to connect again', async () => {
    const { impl } = tokenFetch([{ status: 400, body: { error: 'invalid_grant' } }]);
    const auth = new OAuthGrantAuth(grant, async () => undefined, impl);
    await expect(auth.refresh()).rejects.toSatisfy((e: unknown) => e instanceof JiraHttpError && e.status === 401 && /connect Jira again/.test(e.message));
  });
});
