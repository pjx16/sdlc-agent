import { execFile } from 'node:child_process';
import { minimalGitEnv } from '../git/git-runner';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { GithubFacts } from '@sdlc/shared';

const exec = promisify(execFile);

export type CheckBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';

export interface PrCheck {
  name: string;
  bucket: CheckBucket;
  /** Where the check's details are (a workflow job, or a check run such as CodeQL's). */
  link?: string;
}

export interface PrState {
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergedAt: string | null;
  /** Size of the PR; present when GitHub reports it. */
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
}

export interface OpenedPr {
  number: number;
  url: string;
}

/** An issue as intake sees it. */
export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  /** owner/name of the repository the issue is in. */
  repo: string;
}

/** A comment on an issue. */
export interface IssueComment {
  id: number;
  body: string;
}

/** What `upsertIssueComment` did. */
export type CommentOutcome = 'created' | 'updated' | 'unchanged';

/** An issue that was just made. `nodeId` is what GitHub's GraphQL API calls the issue (to add it to a board). */
export interface CreatedIssue {
  number: number;
  nodeId: string;
  url: string;
}

/** An issue as it is on GitHub now. */
export interface IssueInfo extends CreatedIssue {
  state: 'open' | 'closed';
  title: string;
}

/** An open issue found by its title. */
export interface FoundIssue {
  number: number;
  title: string;
  url: string;
}

/** One issue on a GitHub Project (v2) board, with the value of its status column. */
export interface ProjectItem {
  id: string;
  status: string | null;
  issue: GithubIssue;
  /** An issue that is closed on GitHub is not taken. */
  closed: boolean;
}

/** What the pipeline needs from GitHub. `repo` is `owner/name`. */
export interface GitHubClient {
  /** Open issues of a repository that carry a label, newest first, at most 100. */
  listIssues(repo: string, label: string): Promise<GithubIssue[]>;
  /** The issues of a Project (v2) board (pull requests and draft items are left out). `owner` is a user or an organization. */
  listProjectItems(owner: string, number: number, statusField: string): Promise<ProjectItem[]>;
  /** Moves an issue's card to the column called `optionName` (compared without regard to case). False when the board has no such column. */
  setProjectItemStatus(owner: string, number: number, issue: { repo: string; number: number }, statusField: string, optionName: string): Promise<boolean>;
  /** The names of a board's Status columns, or null when the board or the field cannot be found. */
  statusColumns(owner: string, number: number, statusField: string): Promise<string[] | null>;
  /** Whether `owner` is a user or an organization (a GitHub App's token cannot read a user's Projects boards). Null when GitHub does not know it. */
  ownerType(owner: string): Promise<'User' | 'Organization' | null>;
  /**
   * Adds the columns of a board's status field that are missing (compared without regard to case) and leaves every existing one as it is.
   * Returns the names it added. The existing options are sent back with their ids: GitHub keeps a card in its column only when the
   * option keeps its id (checked: without ids every card loses its column). False when the board or the field cannot be found.
   */
  ensureStatusOptions(owner: string, number: number, statusField: string, names: string[]): Promise<string[] | false>;
  /** Adds and removes labels on an issue, creating the ones that do not exist yet. */
  setIssueLabels(repo: string, number: number, add: string[], remove: string[]): Promise<void>;
  commentIssue(repo: string, number: number, body: string): Promise<void>;
  closeIssue(repo: string, number: number): Promise<void>;
  /** The comments of an issue, oldest first, at most 300. */
  listIssueComments(repo: string, number: number): Promise<IssueComment[]>;
  /**
   * Writes a comment that can be written again: the comment carrying `marker` (a hidden line at its end) is changed when the text is
   * different and left alone when it is the same; with none, a new one is made.
   */
  upsertIssueComment(repo: string, number: number, body: string, marker: string): Promise<CommentOutcome>;
  /** Makes an issue. Labels that do not exist yet are made with it. */
  createIssue(repo: string, title: string, body: string, labels: string[]): Promise<CreatedIssue>;
  /** An issue as it is now. Throws when the number is a pull request, or does not exist. */
  getIssue(repo: string, number: number): Promise<IssueInfo>;
  /** The open issues of the repository whose title is exactly this one (compared without regard to case or surrounding spaces). */
  searchOpenIssuesByTitle(repo: string, title: string): Promise<FoundIssue[]>;
  /** Puts an issue on a Project (v2) board and returns the card's id. `owner` is a user or an organization. */
  addIssueToProject(owner: string, number: number, issueNodeId: string): Promise<string>;
  openDraftPr(args: { repo: string; base: string; head: string; title: string; body: string }): Promise<OpenedPr>;
  markReady(repo: string, number: number): Promise<void>;
  comment(repo: string, number: number, body: string): Promise<void>;
  checks(repo: string, number: number): Promise<PrCheck[]>;
  /**
   * Everything that explains why the PR's checks fail, as text for an agent: each failing check by name, the log of a failing workflow job,
   * the output and annotations of a check that is not a workflow (for example CodeQL's), and the open code-scanning alerts of the PR.
   * '' when nothing is failing or nothing could be read.
   */
  failureReport(repo: string, number: number): Promise<string>;
  /** The last 60 lines of the failing log of the branch's latest failed run, or '' if there is none. */
  failingLogTail(repo: string, branch: string): Promise<string>;
  /** Runs the failed jobs of the branch's latest failed run again (a flaky test). */
  rerunFailed(repo: string, branch: string): Promise<void>;
  prState(repo: string, number: number): Promise<PrState>;
  editBody(repo: string, number: number, body: string): Promise<void>;
  /** Default branch and languages of a repository, which also proves the token can reach it (onboarding). */
  repoFacts(repo: string): Promise<GithubFacts>;
}

export const GITHUB_CLIENT = Symbol('GITHUB_CLIENT');

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/** `https://github.com/owner/repo(.git)` -> `owner/repo`. Anything else is not a GitHub repository. */
export function parseRepo(repoUrl: string): string {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(repoUrl.trim());
  if (!m) throw new GitHubError(`"${repoUrl}" is not a github.com repository URL`, []);
  return `${m[1]}/${m[2]}`;
}

/** The search for open issues with this title. The search is by words, so the exact match is checked afterwards; quotes would end the phrase early. */
export function issueSearchQuery(repo: string, title: string): string {
  return `repo:${repo} is:issue is:open in:title "${title.replace(/["\\]/g, ' ').trim()}"`;
}

/** Of what a search found, the issues whose title is this one: compared without regard to case or surrounding spaces. */
export function exactTitleMatches(items: { number: number; title: string; html_url: string }[], title: string): FoundIssue[] {
  const wanted = title.trim().toLowerCase();
  return items.filter((i) => wanted !== '' && i.title.trim().toLowerCase() === wanted).map((i) => ({ number: i.number, title: i.title, url: i.html_url }));
}

const MAX_COMMENTS = 300;

/** The hidden line that tells a comment of ours from any other: an HTML comment, which GitHub does not show. */
export const markerLine = (marker: string): string => `<!-- ${marker} -->`;
export const withMarker = (body: string, marker: string): string => `${body.trimEnd()}\n\n${markerLine(marker)}`;

const FAILED_LOG_LINES = 60;

export interface GhCliOptions {
  /** Looked up on every call; the arguments say which repository the call is about. */
  token: (ctx: { args: readonly string[] }) => Promise<string>;
  /** The gh executable (replaced by a stub in tests). */
  binary?: string;
  /** Where temporary body files go. */
  tmpDir?: string;
  /** Extra environment for the gh process (tests). gh otherwise gets only the minimal environment, never the worker's own. */
  extraEnv?: () => Record<string, string>;
}

/** GitHub through the `gh` CLI with `GH_TOKEN`. Bodies are passed as files, never on the command line. */
export class GhCliClient implements GitHubClient {
  private readonly binary: string;

  constructor(private readonly opts: GhCliOptions) {
    this.binary = opts.binary ?? 'gh';
  }

  private async gh(args: readonly string[], opts: { allowFailure?: boolean } = {}): Promise<string> {
    const token = await this.opts.token({ args });
    try {
      const { stdout } = await exec(this.binary, [...args], { env: minimalGitEnv({ ...this.opts.extraEnv?.(), GH_TOKEN: token, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }), timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      // `gh pr checks` exits non-zero while checks are pending or failing, but still prints the JSON.
      if (opts.allowFailure && e.stdout && e.stdout.trim()) return e.stdout;
      let text = (e.stderr || e.message || 'gh failed').trim();
      if (token) text = text.split(token).join('***');
      throw new GitHubError(text.split('\n')[0]?.slice(0, 300) ?? 'gh failed', args);
    }
  }

  private async withBodyFile<T>(body: string, fn: (file: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(this.opts.tmpDir ?? tmpdir(), 'sdlc-gh-'));
    const file = path.join(dir, 'body.md');
    await writeFile(file, body, 'utf8');
    try {
      return await fn(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** The open PR for a branch, if there is one (a rerun can leave the PR of an earlier attempt behind). */
  private async openPrOf(repo: string, head: string): Promise<OpenedPr | null> {
    const out = await this.gh(['pr', 'list', '-R', repo, '--head', head, '--state', 'open', '--json', 'number,url', '--limit', '1']);
    try {
      const [first] = JSON.parse(out) as { number: number; url: string }[];
      return first && Number.isInteger(first.number) ? { number: first.number, url: first.url } : null;
    } catch {
      return null;
    }
  }

  async openDraftPr(a: { repo: string; base: string; head: string; title: string; body: string }): Promise<OpenedPr> {
    let out: string;
    try {
      out = await this.withBodyFile(a.body, (file) => this.gh(['pr', 'create', '--draft', '-R', a.repo, '--base', a.base, '--head', a.head, '--title', a.title, '--body-file', file]));
    } catch (err) {
      // The branch already has an open PR (from an earlier attempt of the ticket): that is the PR, not a failure to retry for minutes.
      if (err instanceof GitHubError && /already exists/i.test(err.message)) {
        const existing = await this.openPrOf(a.repo, a.head);
        if (existing) return existing;
      }
      throw err;
    }
    const url = out.split('\n').map((l) => l.trim()).find((l) => /\/pull\/\d+/.test(l));
    const number = url ? Number(/\/pull\/(\d+)/.exec(url)?.[1]) : Number.NaN;
    if (!url || !Number.isInteger(number)) throw new GitHubError(`could not read the pull request URL from: ${out.trim().slice(0, 200)}`, ['pr', 'create']);
    return { number, url };
  }

  async markReady(repo: string, number: number): Promise<void> {
    await this.gh(['pr', 'ready', String(number), '-R', repo]);
  }

  async comment(repo: string, number: number, body: string): Promise<void> {
    await this.withBodyFile(body, (file) => this.gh(['pr', 'comment', String(number), '-R', repo, '--body-file', file]));
  }

  async listIssues(repo: string, label: string): Promise<GithubIssue[]> {
    const out = await this.gh(['issue', 'list', '-R', repo, '--label', label, '--state', 'open', '--limit', '100', '--json', 'number,title,body,labels,url']);
    const rows = JSON.parse(out || '[]') as { number: number; title: string; body?: string | null; url: string; labels?: { name: string }[] }[];
    return rows.map((r) => ({ number: r.number, title: r.title, body: r.body ?? '', url: r.url, labels: (r.labels ?? []).map((l) => l.name), repo }));
  }

  /** Projects belong to a user or an organization, not to a repository: these calls use the personal token (it needs the `project` scope). */
  private async graphql<T>(query: string, vars: Record<string, string | number>): Promise<T> {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [k, v] of Object.entries(vars)) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`);
    const parsed = JSON.parse(await this.gh(args)) as { data?: T; errors?: { message: string }[] };
    if (parsed.errors?.length) throw new GitHubError(parsed.errors.map((e) => e.message).join('; ').slice(0, 300), ['api', 'graphql']);
    return parsed.data as T;
  }

  /** The board with its status column's options: one query per 100 items, at most 5 pages. */
  private async board(owner: string, number: number, statusField: string): Promise<{ id: string; fieldId: string | null; options: { id: string; name: string }[]; items: ProjectItem[] }> {
    const query = `query($owner:String!,$number:Int!,$field:String!,$after:String){ repositoryOwner(login:$owner){ ... on ProjectV2Owner { projectV2(number:$number){ id
      fields(first:50){ nodes{ ... on ProjectV2SingleSelectField{ id name options{ id name } } } }
      items(first:100, after:$after){ pageInfo{ hasNextPage endCursor } nodes{ id
        fieldValueByName(name:$field){ ... on ProjectV2ItemFieldSingleSelectValue{ name } }
        content{ __typename ... on Issue{ number title body url state repository{ nameWithOwner } labels(first:20){ nodes{ name } } } } } } } } } }`;
    type Page = { repositoryOwner: { projectV2: null | { id: string; fields: { nodes: ({ id?: string; name?: string; options?: { id: string; name: string }[] } | null)[] }; items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; fieldValueByName?: { name?: string } | null; content?: { __typename: string; number?: number; title?: string; body?: string; url?: string; state?: string; repository?: { nameWithOwner: string }; labels?: { nodes: { name: string }[] } } | null }[] } } } | null };
    let after: string | null = null;
    let id = '';
    let fieldId: string | null = null;
    let options: { id: string; name: string }[] = [];
    const items: ProjectItem[] = [];
    for (let page = 0; page < 5; page++) {
      const data: Page = await this.graphql<Page>(query, { owner, number, field: statusField, ...(after ? { after } : {}) });
      const project = data.repositoryOwner?.projectV2;
      if (!project) throw new GitHubError(`project ${owner}/${number} was not found, or the token cannot read projects (it needs the "project" scope)`, ['api', 'graphql']);
      id = project.id;
      const field = project.fields.nodes.find((f) => f?.name?.toLowerCase() === statusField.toLowerCase() && f.options);
      if (field) {
        fieldId = field.id ?? null;
        options = field.options ?? [];
      }
      for (const n of project.items.nodes) {
        const c = n.content;
        if (!c || c.__typename !== 'Issue' || c.number === undefined || !c.repository) continue;
        items.push({ id: n.id, status: n.fieldValueByName?.name ?? null, closed: c.state === 'CLOSED', issue: { number: c.number, title: c.title ?? '', body: c.body ?? '', url: c.url ?? '', labels: (c.labels?.nodes ?? []).map((l) => l.name), repo: c.repository.nameWithOwner } });
      }
      if (!project.items.pageInfo.hasNextPage) break;
      after = project.items.pageInfo.endCursor;
    }
    return { id, fieldId, options, items };
  }

  async listProjectItems(owner: string, number: number, statusField: string): Promise<ProjectItem[]> {
    return (await this.board(owner, number, statusField)).items;
  }

  async setProjectItemStatus(owner: string, number: number, issue: { repo: string; number: number }, statusField: string, optionName: string): Promise<boolean> {
    const board = await this.board(owner, number, statusField);
    const item = board.items.find((i) => i.issue.number === issue.number && i.issue.repo.toLowerCase() === issue.repo.toLowerCase());
    const option = board.options.find((o) => o.name.toLowerCase() === optionName.toLowerCase());
    if (!item || !option || !board.fieldId) return false;
    if ((item.status ?? '').toLowerCase() === option.name.toLowerCase()) return true;
    await this.graphql(`mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){ updateProjectV2ItemFieldValue(input:{ projectId:$project, itemId:$item, fieldId:$field, value:{ singleSelectOptionId:$option } }){ projectV2Item{ id } } }`, { project: board.id, item: item.id, field: board.fieldId, option: option.id });
    return true;
  }

  async statusColumns(owner: string, number: number, statusField: string): Promise<string[] | null> {
    const board = await this.board(owner, number, statusField);
    return board.fieldId ? board.options.map((o) => o.name) : null;
  }

  async ownerType(owner: string): Promise<'User' | 'Organization' | null> {
    const out = (await this.gh(['api', `users/${owner}`, '--jq', '.type']).catch(() => '')).trim();
    return out === 'User' || out === 'Organization' ? out : null;
  }

  async ensureStatusOptions(owner: string, number: number, statusField: string, names: string[]): Promise<string[] | false> {
    type Field = { id?: string; name?: string; options?: { id: string; name: string; color: string; description: string }[] };
    const data = await this.graphql<{ repositoryOwner: { projectV2: null | { fields: { nodes: (Field | null)[] } } } | null }>(
      `query($owner:String!,$number:Int!){ repositoryOwner(login:$owner){ ... on ProjectV2Owner { projectV2(number:$number){ fields(first:50){ nodes{ ... on ProjectV2SingleSelectField{ id name options{ id name color description } } } } } } } }`,
      { owner, number },
    );
    const field = data.repositoryOwner?.projectV2?.fields.nodes.find((f) => f?.name?.toLowerCase() === statusField.toLowerCase() && f.options);
    if (!field?.id || !field.options) return false;
    const have = new Set(field.options.map((o) => o.name.toLowerCase()));
    const missing = [...new Set(names.map((n) => n.trim()).filter(Boolean))].filter((n) => !have.has(n.toLowerCase()));
    if (missing.length === 0) return [];
    await this.graphql(statusOptionsMutation(field.id, field.options, missing), {});
    return missing;
  }

  async setIssueLabels(repo: string, number: number, add: string[], remove: string[]): Promise<void> {
    for (const name of add) {
      // A label that exists already answers 422: that is fine.
      await this.gh(['api', '-X', 'POST', `repos/${repo}/labels`, '-f', `name=${name}`, '-f', 'color=0e8a16']).catch((err: unknown) => {
        if (!(err instanceof GitHubError && /already_exists|already exists|422/i.test(err.message))) throw err;
      });
    }
    const args = ['issue', 'edit', String(number), '-R', repo];
    for (const a of add) args.push('--add-label', a);
    for (const r of remove) args.push('--remove-label', r);
    if (args.length > 5) await this.gh(args);
  }

  async commentIssue(repo: string, number: number, body: string): Promise<void> {
    await this.withBodyFile(body, (file) => this.gh(['issue', 'comment', String(number), '-R', repo, '--body-file', file]));
  }

  async closeIssue(repo: string, number: number): Promise<void> {
    await this.gh(['issue', 'close', String(number), '-R', repo]);
  }

  async listIssueComments(repo: string, number: number): Promise<IssueComment[]> {
    // One JSON object per line, whatever the number of pages.
    const out = await this.gh(['api', `repos/${repo}/issues/${number}/comments?per_page=100`, '--paginate', '--jq', '.[] | {id: .id, body: .body}']);
    return out.split('\n').filter((l) => l.trim()).slice(0, MAX_COMMENTS).map((l) => JSON.parse(l) as IssueComment);
  }

  async upsertIssueComment(repo: string, number: number, body: string, marker: string): Promise<CommentOutcome> {
    const full = withMarker(body, marker);
    const existing = (await this.listIssueComments(repo, number)).find((c) => c.body.includes(markerLine(marker)));
    if (existing && existing.body.trim() === full.trim()) return 'unchanged';
    // The text goes in through a file, never on the command line.
    await this.withBodyFile(full, (file) =>
      existing ? this.gh(['api', `repos/${repo}/issues/comments/${existing.id}`, '-X', 'PATCH', '-F', `body=@${file}`]) : this.gh(['api', `repos/${repo}/issues/${number}/comments`, '-X', 'POST', '-F', `body=@${file}`]),
    );
    return existing ? 'updated' : 'created';
  }

  async createIssue(repo: string, title: string, body: string, labels: string[]): Promise<CreatedIssue> {
    // The body goes in through a file, never on the command line (`-F body=@file` reads the value from it).
    const out = await this.withBodyFile(body, (file) => this.gh(['api', `repos/${repo}/issues`, '-X', 'POST', '-f', `title=${title}`, '-F', `body=@${file}`, ...labels.flatMap((l) => ['-f', `labels[]=${l}`])]));
    const made = JSON.parse(out) as { number?: number; node_id?: string; html_url?: string };
    if (!Number.isInteger(made.number) || !made.node_id || !made.html_url) throw new GitHubError('GitHub did not return the issue it made', ['api', `repos/${repo}/issues`]);
    return { number: made.number as number, nodeId: made.node_id, url: made.html_url };
  }

  async getIssue(repo: string, number: number): Promise<IssueInfo> {
    const issue = JSON.parse(await this.gh(['api', `repos/${repo}/issues/${number}`])) as { number: number; state: string; title: string; node_id: string; html_url: string; pull_request?: unknown };
    if (issue.pull_request) throw new GitHubError(`${repo}#${number} is a pull request, not an issue`, ['api', `repos/${repo}/issues/${number}`]);
    return { number: issue.number, state: issue.state === 'closed' ? 'closed' : 'open', title: issue.title, nodeId: issue.node_id, url: issue.html_url };
  }

  async searchOpenIssuesByTitle(repo: string, title: string): Promise<FoundIssue[]> {
    if (!title.trim()) return [];
    const found = JSON.parse(await this.gh(['api', 'search/issues', '-X', 'GET', '-f', `q=${issueSearchQuery(repo, title)}`, '-f', 'per_page=30'])) as { items?: { number: number; title: string; html_url: string }[] };
    return exactTitleMatches(found.items ?? [], title);
  }

  async addIssueToProject(owner: string, number: number, issueNodeId: string): Promise<string> {
    const found = await this.graphql<{ repositoryOwner: { projectV2: { id: string } | null } | null }>(`query($owner:String!,$number:Int!){ repositoryOwner(login:$owner){ ... on ProjectV2Owner { projectV2(number:$number){ id } } } }`, { owner, number });
    const projectId = found.repositoryOwner?.projectV2?.id;
    if (!projectId) throw new GitHubError(`GitHub Projects board ${owner}/${number} was not found, or the token cannot read Projects boards (it needs the "project" scope)`, ['api', 'graphql']);
    const added = await this.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(`mutation($project:ID!,$content:ID!){ addProjectV2ItemById(input:{ projectId:$project, contentId:$content }){ item{ id } } }`, { project: projectId, content: issueNodeId });
    return added.addProjectV2ItemById.item.id;
  }

  async checks(repo: string, number: number): Promise<PrCheck[]> {
    // A PR with no checks counts as passing: gh reports "no checks reported", which is an empty list here.
    let out: string;
    try {
      out = await this.gh(['pr', 'checks', String(number), '-R', repo, '--json', 'name,bucket,link'], { allowFailure: true });
    } catch (err) {
      if (err instanceof GitHubError && /no checks reported/i.test(err.message)) return [];
      throw err;
    }
    const parsed = JSON.parse(out) as { name: string; bucket: CheckBucket; link?: string }[];
    return parsed.map((c) => ({ name: c.name, bucket: c.bucket, ...(c.link ? { link: c.link } : {}) }));
  }

  async failureReport(repo: string, number: number): Promise<string> {
    const failing = (await this.checks(repo, number)).filter((c) => c.bucket === 'fail');
    if (failing.length === 0) return '';
    const parts: string[] = [`Failing checks: ${failing.map((c) => c.name).join(', ')}`];
    const seenRuns = new Set<string>();
    const safe = async (what: string, fn: () => Promise<string>): Promise<void> => {
      try {
        const text = (await fn()).trim();
        if (text) parts.push(text);
      } catch (err) {
        parts.push(`(could not read ${what}: ${err instanceof Error ? err.message : String(err)})`);
      }
    };
    for (const c of failing) {
      const job = /\/actions\/runs\/(\d+)/.exec(c.link ?? '');
      const checkRun = /\/runs\/(\d+)$/.exec(c.link ?? '');
      if (job?.[1]) {
        if (seenRuns.has(job[1])) continue;
        seenRuns.add(job[1]);
        await safe(`the log of ${c.name}`, async () => `Log of ${c.name} (last ${FAILED_LOG_LINES} lines):\n${(await this.gh(['run', 'view', job[1] as string, '-R', repo, '--log-failed'])).trimEnd().split('\n').slice(-FAILED_LOG_LINES).join('\n')}`);
      } else if (checkRun?.[1]) {
        await safe(`the output of ${c.name}`, async () => {
          const run = JSON.parse(await this.gh(['api', `repos/${repo}/check-runs/${checkRun[1]}`])) as { output?: { title?: string | null; summary?: string | null; text?: string | null } };
          const notes = JSON.parse(await this.gh(['api', `repos/${repo}/check-runs/${checkRun[1]}/annotations`]).catch(() => '[]')) as { path: string; start_line: number; message: string; title?: string | null }[];
          return [`${c.name}: ${run.output?.title ?? ''}`, run.output?.summary ?? '', run.output?.text ?? '', ...notes.slice(0, 20).map((a) => `- ${a.path}:${a.start_line} ${a.title ? `${a.title}: ` : ''}${a.message}`)].filter(Boolean).join('\n');
        });
      }
    }
    if (failing.some((c) => /codeql|code.?scanning/i.test(c.name))) {
      await safe('the code-scanning alerts', async () => {
        const alerts = JSON.parse(await this.gh(['api', `repos/${repo}/code-scanning/alerts?ref=refs/pull/${number}/merge&state=open&per_page=30`])) as { rule: { id: string; description: string; security_severity_level?: string | null }; most_recent_instance?: { location?: { path?: string; start_line?: number } } }[];
        return alerts.length === 0 ? '' : `Open code-scanning alerts on this PR (fix each one in the code):\n${alerts.map((a) => `- ${a.rule.id} (${a.rule.security_severity_level ?? 'no severity'}): ${a.rule.description} at ${a.most_recent_instance?.location?.path ?? '?'}:${a.most_recent_instance?.location?.start_line ?? '?'}`).join('\n')}`;
      });
    }
    return parts.join('\n\n').slice(0, 8000);
  }

  async repoFacts(repo: string): Promise<GithubFacts> {
    const info = JSON.parse(await this.gh(['api', `repos/${repo}`])) as { default_branch?: string };
    const languages = JSON.parse(await this.gh(['api', `repos/${repo}/languages`])) as Record<string, number>;
    if (!info.default_branch) throw new GitHubError(`GitHub did not report a default branch for ${repo}`, ['api', `repos/${repo}`]);
    return { defaultBranch: info.default_branch, languages: Object.entries(languages).sort((a, b) => b[1] - a[1]).map(([name]) => name) };
  }

  async failingLogTail(repo: string, branch: string): Promise<string> {
    const runs = JSON.parse(await this.gh(['run', 'list', '-R', repo, '--branch', branch, '--json', 'databaseId,conclusion', '--limit', '5'])) as { databaseId: number; conclusion: string }[];
    const failed = runs.find((r) => r.conclusion === 'failure');
    if (!failed) return '';
    const log = await this.gh(['run', 'view', String(failed.databaseId), '-R', repo, '--log-failed']);
    return log.trimEnd().split('\n').slice(-FAILED_LOG_LINES).join('\n');
  }

  async rerunFailed(repo: string, branch: string): Promise<void> {
    const runs = JSON.parse(await this.gh(['run', 'list', '-R', repo, '--branch', branch, '--json', 'databaseId,conclusion', '--limit', '5'])) as { databaseId: number; conclusion: string }[];
    const failed = runs.find((r) => r.conclusion === 'failure');
    if (failed) await this.gh(['run', 'rerun', String(failed.databaseId), '-R', repo, '--failed']);
  }

  async prState(repo: string, number: number): Promise<PrState> {
    const parsed = JSON.parse(await this.gh(['pr', 'view', String(number), '-R', repo, '--json', 'state,mergedAt,additions,deletions,changedFiles'])) as {
      state: PrState['state'];
      mergedAt: string | null;
      additions?: number;
      deletions?: number;
      changedFiles?: number;
    };
    return { state: parsed.state, mergedAt: parsed.mergedAt ?? null, additions: parsed.additions ?? null, deletions: parsed.deletions ?? null, changedFiles: parsed.changedFiles ?? null };
  }

  async editBody(repo: string, number: number, body: string): Promise<void> {
    await this.withBodyFile(body, (file) => this.gh(['pr', 'edit', String(number), '-R', repo, '--body-file', file]));
  }
}

/**
 * The mutation that sets a status field's options to the existing ones, with their ids, colours and descriptions, followed by `missing`.
 * The options are written into the query because `gh` cannot send a list of objects as a variable; JSON.stringify makes a safe GraphQL string.
 */
export function statusOptionsMutation(fieldId: string, existing: { id: string; name: string; color: string; description: string }[], missing: string[]): string {
  const kept = existing.map((o) => `{id:${JSON.stringify(o.id)},name:${JSON.stringify(o.name)},color:${o.color},description:${JSON.stringify(o.description ?? '')}}`);
  const added = missing.map((n) => `{name:${JSON.stringify(n)},color:GRAY,description:""}`);
  return `mutation{ updateProjectV2Field(input:{fieldId:${JSON.stringify(fieldId)},singleSelectOptions:[${[...kept, ...added].join(',')}]}){ projectV2Field{ ... on ProjectV2SingleSelectField{ id } } } }`;
}
