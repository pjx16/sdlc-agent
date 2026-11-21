import { defaultJiraJql, type JiraFacts } from '@sdlc/shared';
import { adfToText } from './adf';
import {
  markerLabel, JiraHttpError, JiraStatusNotFoundError,
  type JiraClient, type JiraIssueStatus, type JiraProjectRef, type JiraSubtaskInput, type JiraTicket,
} from './jira-client';
import type { McpSession } from './mcp-session';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The Rovo tools each operation needs. The first name the server lists wins, so a renamed tool keeps working when we know both names. */
const TOOLS = {
  resources: ['getAccessibleAtlassianResources'],
  search: ['searchJiraIssuesUsingJql'],
  getIssue: ['getJiraIssue'],
  addComment: ['addCommentToJiraIssue', 'addOrEditJiraIssueComment'],
  editComment: ['editJiraIssueComment', 'addOrEditJiraIssueComment'],
  transitions: ['getTransitionsForJiraIssue'],
  transition: ['transitionJiraIssue'],
  createIssue: ['createJiraIssue'],
  projects: ['getVisibleJiraProjects'],
  issueTypes: ['getJiraProjectIssueTypesMetadata'],
} as const;
type Op = keyof typeof TOOLS;

const SEARCH_FIELDS = ['summary', 'description', 'issuetype', 'labels', 'priority', 'parent'];

export interface JiraMcpOptions {
  /** Known from the credentials; otherwise read from getAccessibleAtlassianResources (the site matching `siteUrl`, or the only one). */
  cloudId?: string;
  siteUrl?: string;
  pageSize?: number;
  maxPages?: number;
}

/**
 * Jira through the Atlassian Rovo MCP server, called by code: the same operations as JiraRestClient, as MCP tool calls. No Claude agent
 * runs, so it costs no Claude tokens. The Rovo tools take markdown and return either markdown or ADF, so both are read.
 */
export class JiraMcpClient implements JiraClient {
  private cloud: Promise<string> | null = null;
  private readonly pageSize: number;
  private readonly maxPages: number;

  constructor(
    private readonly session: McpSession,
    private readonly options: JiraMcpOptions = {},
  ) {
    this.pageSize = options.pageSize ?? 50;
    this.maxPages = options.maxPages ?? 40;
    if (options.cloudId) this.cloud = Promise.resolve(options.cloudId);
  }

  /** Who the credential can see: the sites and the tools, for the connection test. */
  async describe(): Promise<{ cloudId: string; site: string | null; tools: string[] }> {
    const tools = (await this.session.listTools()).map((t) => t.name);
    const sites = await this.sites();
    const cloudId = await this.cloudId();
    return { cloudId, site: sites.find((s) => s.id === cloudId)?.url ?? null, tools };
  }

  // ---------------------------------------------------------------- JiraClient

  async searchTickets(project: JiraProjectRef): Promise<JiraTicket[]> {
    const jql = project.jiraJql?.trim() || defaultJiraJql(project.jiraProjectKey);
    if (!jql) return [];
    const tickets: JiraTicket[] = [];
    let nextPageToken: string | undefined;
    for (let page = 0; page < this.maxPages; page++) {
      const res = await this.search(jql, SEARCH_FIELDS, this.pageSize, nextPageToken);
      for (const issue of res.issues) tickets.push(toTicket(issue));
      nextPageToken = res.nextPageToken;
      if (!nextPageToken || res.isLast) break;
    }
    return tickets;
  }

  async readStatus(key: string): Promise<JiraIssueStatus> {
    const issue = await this.issue(key, ['status', 'summary', 'description']);
    return { key: String(issue.key ?? key), status: String(issue.fields?.status?.name ?? ''), summary: String(issue.fields?.summary ?? ''), description: text(issue.fields?.description) };
  }

  async comment(key: string, markdown: string, marker?: string): Promise<void> {
    if (marker && (await this.comments(key)).some((c) => JSON.stringify(c).includes(marker))) return;
    await this.addComment(key, marker ? `${markdown}\n\n${marker}` : markdown);
  }

  async upsertComment(key: string, markdown: string, marker: string): Promise<void> {
    const body = `${markdown}\n\n${marker}`;
    const hit = (await this.comments(key)).find((c) => JSON.stringify(c).includes(marker));
    if (!hit) return this.addComment(key, body);
    if (text(hit.body).trim() === body.trim()) return;
    const edit = await this.toolName('editComment', false);
    // Without an edit tool the changed text is posted as a new comment: repeating the same text is still a no-op.
    if (!edit) return this.addComment(key, body);
    await this.call(edit, { issueIdOrKey: key, commentId: String(hit.id), commentBody: body });
  }

  async transition(key: string, statusName: string): Promise<void> {
    const current = await this.issue(key, ['status']);
    const wanted = statusName.trim().toLowerCase();
    if (String(current.fields?.status?.name ?? '').trim().toLowerCase() === wanted) return;
    const res = await this.call(await this.toolName('transitions'), { issueIdOrKey: key });
    const transitions: Json[] = Array.isArray(res) ? res : (res.transitions ?? []);
    const match = transitions.find((t) => String(t.to?.name ?? '').trim().toLowerCase() === wanted);
    if (!match) throw new JiraStatusNotFoundError(key, statusName, transitions.map((t) => String(t.to?.name ?? t.name ?? '')).filter(Boolean));
    await this.call(await this.toolName('transition'), { issueIdOrKey: key, transition: { id: String(match.id) } });
  }

  async createSubtask(parentKey: string, subtask: JiraSubtaskInput): Promise<{ key: string }> {
    const projectKey = parentKey.slice(0, parentKey.lastIndexOf('-'));
    const label = subtask.marker ? markerLabel(subtask.marker) : null;
    if (label) {
      const found = await this.search(`parent = "${parentKey}" AND labels = "${label}"`, ['summary'], 1);
      if (found.issues[0]?.key) return { key: String(found.issues[0].key) };
    }
    const created = await this.call(await this.toolName('createIssue'), {
      projectKey,
      issueTypeName: subtask.issueTypeName ?? 'Sub-task',
      summary: subtask.summary,
      description: subtask.description,
      parent: parentKey,
      ...(label ? { additional_fields: { labels: [label] } } : {}),
    });
    const key = created.key ?? created.issue?.key;
    if (!key) throw new JiraHttpError(502, `Jira (MCP createJiraIssue) returned no issue key for a sub-task of ${parentKey}`);
    return { key: String(key) };
  }

  /** The statuses seen on the project's recent issues and the moves open from them (the Rovo tools have no project-statuses call). */
  async listStatuses(projectKey: string): Promise<string[]> {
    const facts = await this.statusFacts(projectKey);
    return [...new Set(facts.flatMap((t) => t.statuses.map((s) => s.name)))].sort((a, b) => a.localeCompare(b));
  }

  async projectFacts(projectKey: string): Promise<JiraFacts> {
    const projects = await this.call(await this.toolName('projects'), { searchString: projectKey });
    const list: Json[] = Array.isArray(projects) ? projects : (projects.values ?? projects.projects ?? []);
    const project = list.find((p) => String(p.key) === projectKey) ?? list[0] ?? {};
    let types: Json[] = project.issueTypes ?? [];
    const typesTool = await this.toolName('issueTypes', false);
    if (typesTool) {
      const meta = await this.call(typesTool, { projectIdOrKey: projectKey }).catch(() => null);
      const fromMeta: Json[] | undefined = meta ? (Array.isArray(meta) ? meta : (meta.issueTypes ?? meta.values)) : undefined;
      if (fromMeta?.length) types = fromMeta;
    }
    const recent = await this.search(`project = "${projectKey.replace(/"/g, '')}" ORDER BY created DESC`, ['labels'], 100);
    const labels = new Set<string>();
    for (const issue of recent.issues) for (const l of issue.fields?.labels ?? []) labels.add(String(l));
    return {
      projectName: String(project.name ?? projectKey),
      issueTypes: types.map((t) => ({ name: String(t.name), subtask: t.subtask === true })),
      statusesByType: await this.statusFacts(projectKey),
      labels: [...labels].sort((a, b) => a.localeCompare(b)),
    };
  }

  // ---------------------------------------------------------------- internals

  /** Statuses per issue type, from up to 100 recent issues plus the transitions open from one issue of each type. */
  private async statusFacts(projectKey: string): Promise<JiraFacts['statusesByType']> {
    const recent = await this.search(`project = "${projectKey.replace(/"/g, '')}" ORDER BY updated DESC`, ['status', 'issuetype'], 100);
    const byType = new Map<string, Map<string, string>>();
    const sample = new Map<string, string>();
    for (const issue of recent.issues) {
      const type = String(issue.fields?.issuetype?.name ?? 'Unknown');
      const status = issue.fields?.status;
      if (!byType.has(type)) byType.set(type, new Map());
      if (status?.name) byType.get(type)?.set(String(status.name), String(status.statusCategory?.key ?? 'unknown'));
      if (!sample.has(type) && issue.key) sample.set(type, String(issue.key));
    }
    const transitionsTool = await this.toolName('transitions', false);
    if (transitionsTool) {
      for (const [type, key] of sample) {
        const res = await this.call(transitionsTool, { issueIdOrKey: key }).catch(() => null);
        const transitions: Json[] = res ? (Array.isArray(res) ? res : (res.transitions ?? [])) : [];
        for (const t of transitions) if (t.to?.name) byType.get(type)?.set(String(t.to.name), String(t.to.statusCategory?.key ?? 'unknown'));
      }
    }
    return [...byType].map(([type, statuses]) => ({ type, statuses: [...statuses].map(([name, category]) => ({ name, category })) }));
  }

  private async search(jql: string, fields: string[], maxResults: number, nextPageToken?: string): Promise<{ issues: Json[]; nextPageToken?: string; isLast: boolean }> {
    const res = await this.call(await this.toolName('search'), { jql, fields, maxResults, ...(nextPageToken ? { nextPageToken } : {}) });
    const issues: Json[] = Array.isArray(res) ? res : (res.issues ?? res.values ?? []);
    return { issues, nextPageToken: typeof res.nextPageToken === 'string' ? res.nextPageToken : undefined, isLast: res.isLast !== false };
  }

  private async issue(key: string, fields: string[]): Promise<Json> {
    return this.call(await this.toolName('getIssue'), { issueIdOrKey: key, fields });
  }

  private async comments(key: string): Promise<Json[]> {
    const issue = await this.issue(key, ['comment']);
    return issue.fields?.comment?.comments ?? issue.comments ?? [];
  }

  private async addComment(key: string, body: string): Promise<void> {
    await this.call(await this.toolName('addComment'), { issueIdOrKey: key, commentBody: body });
  }

  /** Every Jira tool takes the site's cloud ID. */
  private async call(tool: string, args: Json): Promise<Json> {
    return this.session.tool(tool, { cloudId: await this.cloudId(), ...args });
  }

  private cloudId(): Promise<string> {
    this.cloud ??= (async () => {
      const sites = await this.sites();
      const wanted = this.options.siteUrl?.replace(/\/+$/, '').toLowerCase();
      const site = (wanted && sites.find((s) => s.url.toLowerCase() === wanted)) || (sites.length === 1 ? sites[0] : undefined);
      if (!site) {
        throw new JiraHttpError(
          sites.length === 0 ? 403 : 400,
          sites.length === 0
            ? 'Jira (MCP): this sign-in can see no Atlassian site'
            : `Jira (MCP): the sign-in sees ${sites.length} sites (${sites.map((s) => s.url).join(', ')}); set the Jira base URL or the cloud ID to choose one`,
        );
      }
      return site.id;
    })().catch((err: unknown) => {
      this.cloud = null;
      throw err;
    });
    return this.cloud;
  }

  private async sites(): Promise<{ id: string; url: string }[]> {
    const res = await this.session.tool(await this.toolName('resources'), {});
    const list: Json[] = Array.isArray(res) ? res : (res.data?.resources ?? res.resources ?? []);
    return list.map((r) => ({ id: String(r.id ?? r.cloudId ?? ''), url: String(r.url ?? '').replace(/\/+$/, '') })).filter((r) => r.id);
  }

  private async toolName(op: Op): Promise<string>;
  private async toolName(op: Op, required: false): Promise<string | null>;
  private async toolName(op: Op, required = true): Promise<string | null> {
    const listed = new Set((await this.session.listTools()).map((t) => t.name));
    const name = TOOLS[op].find((n) => listed.has(n)) ?? null;
    if (!name && required) throw new JiraHttpError(501, `Jira (MCP): the server has no tool for "${op}" (looked for ${TOOLS[op].join(', ')})`);
    return name;
  }
}

/** Rovo returns descriptions and comment bodies as markdown text or as ADF. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  return value && typeof value === 'object' ? adfToText(value) : '';
}

function toTicket(issue: Json): JiraTicket {
  const f = issue.fields ?? {};
  return {
    key: String(issue.key),
    summary: String(f.summary ?? ''),
    description: text(f.description),
    issuetype: String(f.issuetype?.name ?? ''),
    labels: Array.isArray(f.labels) ? f.labels.map(String) : [],
    priority: f.priority?.name ? String(f.priority.name) : null,
    isSubtask: f.issuetype?.subtask === true || Boolean(f.parent),
  };
}
