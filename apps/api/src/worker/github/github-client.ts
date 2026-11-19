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

/** What the pipeline needs from GitHub. `repo` is `owner/name`. */
export interface GitHubClient {
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
