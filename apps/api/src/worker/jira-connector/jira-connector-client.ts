import { z } from 'zod';
import { DEFAULT_GLOBAL_SETTINGS, GlobalSettingsSchema, ProjectSettingsSchema, defaultJiraJql, type JiraFacts, type ModelAlias } from '@sdlc/shared';
import type { Project } from '../../generated/prisma/client';
import { JiraHttpError, JiraStatusNotFoundError, JiraUnavailableError, markerLabel, type JiraClient, type JiraIssueStatus, type JiraProjectRef, type JiraSubtaskInput, type JiraTicket } from '../../jira/jira-client';
import { JiraNotConfiguredError } from '../../jira/jira-clients';
import type { PrismaService } from '../../prisma/prisma.service';
import { JIRA_CONNECTOR_LOGIN_EXPIRED, type StageRequest, type StageResult } from '../agent-runner/agent-runner';

/** What the client needs from the agent runner (tests pass a fake). */
export interface ConnectorRunner {
  run(req: StageRequest): Promise<StageResult>;
}

/** A connector stage gets this long at most, whatever the global stage timeout: it does one Jira operation. */
const MAX_TIMEOUT_MIN = 10;
const SEARCH_LIMIT = 100;

const Ticket = z.object({
  key: z.string().min(1),
  summary: z.string().default(''),
  description: z.string().nullish().transform((v) => v ?? ''),
  issuetype: z.string().default(''),
  labels: z.array(z.string()).default([]),
  priority: z.string().nullish().transform((v) => v ?? null),
  isSubtask: z.boolean().optional(),
});
const Shapes = {
  search: z.object({ issues: z.array(Ticket) }),
  status: z.object({ key: z.string(), status: z.string(), summary: z.string().default(''), description: z.string().nullish().transform((v) => v ?? '') }),
  done: z.object({ done: z.boolean() }).passthrough(),
  transition: z.object({ done: z.boolean(), available: z.array(z.string()).default([]) }),
  created: z.object({ key: z.string().min(1) }),
  statuses: z.object({ statuses: z.array(z.string()) }),
  facts: z.object({
    projectName: z.string(),
    issueTypes: z.array(z.object({ name: z.string(), subtask: z.boolean().default(false) })),
    statusesByType: z.array(z.object({ type: z.string(), statuses: z.array(z.object({ name: z.string(), category: z.string().default('unknown') })) })),
    labels: z.array(z.string()).default([]),
  }),
};

/** The result shape the agent must fill, as plain text for the prompt. */
const SHAPE_TEXT: Record<keyof typeof Shapes, string> = {
  search: '{ issues: [{ key, summary, description (markdown), issuetype (the type name), labels: [string], priority (name or null), isSubtask (true when the type is a sub-task type or the issue has a parent) }] }',
  status: '{ key, status (the status name), summary, description (markdown) }',
  done: '{ done: true, alreadyThere: boolean }',
  transition: '{ done: boolean, available: [names of the statuses the issue can move to now] }. done is true when the issue is in the wanted status afterwards (also when it already was).',
  created: '{ key } (the sub-task, new or found by its label)',
  statuses: '{ statuses: [every status name the project uses, sorted] }',
  facts: '{ projectName, issueTypes: [{ name, subtask }], statusesByType: [{ type, statuses: [{ name, category: "new" | "indeterminate" | "done" }] }], labels: [labels used on recent issues] }',
};

/**
 * Connector mode: every Jira operation is one run of the `jiraConnector` stage, a Claude agent using the Jira connector added in claude.ai
 * (see scripts/jira-connector-login.sh). It spends Claude usage on every call, which is why intake and approvals poll connector projects
 * less often. The result is checked against the operation's shape; anything else is a Jira error, never a guess.
 */
export class JiraConnectorClient implements JiraClient {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: ConnectorRunner,
  ) {}

  async searchTickets(project: JiraProjectRef): Promise<JiraTicket[]> {
    const jql = project.jiraJql?.trim() || defaultJiraJql(project.jiraProjectKey);
    if (!jql) return [];
    const r = await this.op(project.id ?? project.jiraProjectKey ?? '', 'Search issues with this JQL, at most `maxResults` of them, in the order the JQL gives.', { jql, maxResults: SEARCH_LIMIT }, 'search');
    return r.issues;
  }

  async readStatus(key: string): Promise<JiraIssueStatus> {
    return this.op(key, 'Read one issue: its status, summary and description.', { issueKey: key }, 'status');
  }

  async comment(key: string, markdown: string, marker?: string): Promise<void> {
    await this.op(
      key,
      marker ? 'Add a comment to the issue, unless a comment containing the marker already exists (then do nothing).' : 'Add a comment to the issue.',
      { issueKey: key, body: marker ? `${markdown}\n\n${marker}` : markdown, ...(marker ? { marker } : {}) },
      'done',
    );
  }

  async upsertComment(key: string, markdown: string, marker: string): Promise<void> {
    await this.op(
      key,
      'Find the comment on the issue that contains the marker. None: add the body as a new comment. Found with the same text: do nothing. Found with other text: replace its text with the body (if the connector cannot edit comments, add the body as a new comment).',
      { issueKey: key, body: `${markdown}\n\n${marker}`, marker },
      'done',
    );
  }

  async transition(key: string, statusName: string): Promise<void> {
    const r = await this.op(key, 'Move the issue to the status with this name (any case) by the transition that leads there. If it is already in that status, do nothing.', { issueKey: key, status: statusName }, 'transition');
    if (!r.done) throw new JiraStatusNotFoundError(key, statusName, r.available);
  }

  async createSubtask(parentKey: string, subtask: JiraSubtaskInput): Promise<{ key: string }> {
    const label = subtask.marker ? markerLabel(subtask.marker) : undefined;
    return this.op(
      parentKey,
      label
        ? 'Create a sub-task under the parent issue with this summary, description (markdown), issue type and label, unless a sub-task of the parent already has the label (then return that one).'
        : 'Create a sub-task under the parent issue with this summary, description (markdown) and issue type.',
      { parentKey, summary: subtask.summary, description: subtask.description, issueType: subtask.issueTypeName ?? 'Sub-task', ...(label ? { label, marker: subtask.marker } : {}) },
      'created',
    );
  }

  async listStatuses(projectKey: string): Promise<string[]> {
    return (await this.op(projectKey, 'List every status name used by the project, across its issue types.', { projectKey }, 'statuses')).statuses;
  }

  async projectFacts(projectKey: string): Promise<JiraFacts> {
    return this.op(projectKey, 'Describe the project: its name, its issue types (and which is the sub-task type), the statuses of each issue type with their category, and the labels used on its 100 most recent issues.', { projectKey }, 'facts');
  }

  // ---------------------------------------------------------------- internals

  private async op<S extends keyof typeof Shapes>(keyOrProject: string, operation: string, args: Record<string, unknown>, shape: S): Promise<z.infer<(typeof Shapes)[S]>> {
    const project = await this.projectFor(keyOrProject);
    await this.refuseWhenPaused();
    const settings = ProjectSettingsSchema.parse(project.settings);
    const global = await this.global();
    const stage = settings.stages.jiraConnector;
    const result = await this.runner.run({
      projectId: project.id,
      stage: 'jiraConnector',
      stack: project.stack,
      claudeMdMode: 'theirs',
      modelAlias: stage.model as ModelAlias,
      modelAliases: global.modelAliases,
      maxTurns: stage.maxTurns,
      stageTimeoutMin: Math.min(global.stageTimeoutMin, MAX_TIMEOUT_MIN),
      inputs: { jira: { serverName: settings.jiraConnector.serverName, operation, args, resultShape: SHAPE_TEXT[shape] } },
    });
    const data = this.dataOf(result);
    const parsed = Shapes[shape].safeParse(data.result);
    if (!parsed.success) throw new JiraHttpError(502, `Jira (connector): the agent's answer did not have the expected shape (${parsed.error.issues[0]?.message ?? 'invalid'})`);
    return parsed.data as z.infer<(typeof Shapes)[S]>;
  }

  /** The stage's outcome as Jira errors: auth problems raise the credential support item, a usage pause backs intake off. */
  private dataOf(result: StageResult): { result: unknown } {
    switch (result.kind) {
      case 'done': {
        const data = (result.envelope.data ?? {}) as { result?: unknown; error?: string | null };
        if (data.result === null || data.result === undefined) {
          const why = data.error || 'the agent could not do the operation';
          throw new JiraHttpError(errorStatus(why), `Jira (connector): ${why}`);
        }
        return { result: data.result };
      }
      case 'claude_auth':
        throw new JiraHttpError(401, JIRA_CONNECTOR_LOGIN_EXPIRED);
      case 'out_of_credits':
        throw new JiraUnavailableError('Jira (connector): Claude usage is limited right now', result.attempts);
      case 'needs_input':
        throw new JiraHttpError(400, `Jira (connector): ${result.question}`);
      case 'failed':
        if (result.errorCode === 'CONTAINER_ERROR' || result.errorCode === 'TIMEOUT' || result.errorCode === 'CLAUDE_RATE_LIMIT') throw new JiraUnavailableError(`Jira (connector): ${result.reason}`, result.attempts);
        throw new JiraHttpError(502, `Jira (connector): ${result.reason}`);
      default:
        throw new JiraHttpError(502, `Jira (connector): the agent stopped (${result.kind})`);
    }
  }

  /** The connector project an issue or project key belongs to; a project id is accepted too (searchTickets passes it). */
  private async projectFor(keyOrProject: string): Promise<Project> {
    const byId = keyOrProject ? await this.prisma.project.findFirst({ where: { id: keyOrProject, jiraMode: 'connector' } }) : null;
    if (byId) return byId;
    const projectKey = /^([A-Z][A-Z0-9_]*)(-\d+)?$/.exec(keyOrProject)?.[1];
    const match = projectKey ? await this.prisma.project.findFirst({ where: { jiraMode: 'connector', jiraProjectKey: projectKey }, orderBy: { createdAt: 'asc' } }) : null;
    const project = match ?? (await this.prisma.project.findFirst({ where: { jiraMode: 'connector' }, orderBy: { createdAt: 'asc' } }));
    if (!project) throw new JiraNotConfiguredError('No project uses the Claude Jira connector');
    return project;
  }

  /** While Claude is paused, connector calls wait too. */
  private async refuseWhenPaused(): Promise<void> {
    const g = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    if (g?.pipelinePaused && (g.pausedCode === 'CLAUDE_CREDITS' || g.pausedCode === 'SPEND_BUDGET_REACHED' || g.pausedCode === 'CLAUDE_AUTH')) {
      throw new JiraUnavailableError(`Jira (connector): waiting while Claude is paused (${g.pausedCode})`, 0);
    }
  }

  private async global(): Promise<typeof DEFAULT_GLOBAL_SETTINGS> {
    const row = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    if (!row) return DEFAULT_GLOBAL_SETTINGS;
    return GlobalSettingsSchema.parse({ stageTimeoutMin: row.stageTimeoutMin, verifyTimeoutSec: row.verifyTimeoutSec, modelAliases: row.modelAliases });
  }
}

function errorStatus(why: string): number {
  if (/not signed|log ?in|unauthori[sz]ed|authenticat|connector (is )?(not|un)available|no (such )?connector|not connected/i.test(why)) return 401;
  if (/permission|forbidden|not allowed/i.test(why)) return 403;
  if (/not found|does not exist|no such issue/i.test(why)) return 404;
  return 400;
}
