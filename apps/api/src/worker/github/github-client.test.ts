import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GhCliClient, GitHubError, parseRepo } from './github-client';

/**
 * A stand-in for the `gh` executable. It records its arguments (and the body file it was given), answers from FAKE_GH_REPLIES
 * (a JSON map from "<cmd> <sub>" to { stdout, stderr, exit }), and checks that GH_TOKEN is set.
 */
const STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const bodyIdx = args.indexOf('--body-file');
const record = { args, token: process.env.GH_TOKEN, body: bodyIdx >= 0 ? fs.readFileSync(args[bodyIdx + 1], 'utf8') : null };
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(record) + '\\n');
const replies = JSON.parse(process.env.FAKE_GH_REPLIES || '{}');
const r = replies[args.slice(0, 2).join(' ')] || { stdout: '' };
if (r.stderr) process.stderr.write(r.stderr);
if (r.stdout) process.stdout.write(r.stdout);
process.exit(r.exit || 0);
`;

let tmp: string;
let log: string;
let client: GhCliClient;
const reply = (replies: Record<string, { stdout?: string; stderr?: string; exit?: number }>) => {
  process.env.FAKE_GH_REPLIES = JSON.stringify(replies);
};
const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { args: string[]; token: string; body: string | null });

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'sdlc-gh-'));
  const bin = path.join(tmp, 'gh');
  writeFileSync(bin, STUB);
  chmodSync(bin, 0o755);
  log = path.join(tmp, 'calls.log');
  process.env.FAKE_GH_LOG = log;
  client = new GhCliClient({ token: async () => 'ghs_secret_token_value', binary: bin, tmpDir: tmp, extraEnv: () => ({ FAKE_GH_LOG: log, FAKE_GH_REPLIES: process.env.FAKE_GH_REPLIES ?? '{}' }) });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => {
  writeFileSync(log, '');
  reply({});
});

describe('parseRepo', () => {
  it('extracts owner/name from a github.com URL', () => {
    expect(parseRepo('https://github.com/acme/billing')).toBe('acme/billing');
    expect(parseRepo('https://github.com/acme/billing.git')).toBe('acme/billing');
    expect(parseRepo('https://github.com/acme/billing/')).toBe('acme/billing');
    expect(parseRepo('https://github.com/a-b/c_d.e')).toBe('a-b/c_d.e');
  });
  it('rejects anything else', () => {
    for (const bad of ['https://gitlab.com/a/b', 'git@github.com:a/b.git', 'http://github.com/a/b', 'https://github.com/a', 'https://github.com/a/b/c/d', 'file:///tmp/x.git', '']) expect(() => parseRepo(bad), bad).toThrow(GitHubError);
  });
});

describe('GhCliClient', () => {
  it('opens a draft PR with gh pr create --draft, passing the body as a file, and reads the number from the URL', async () => {
    reply({ 'pr create': { stdout: 'Creating draft pull request...\nhttps://github.com/acme/billing/pull/42\n' } });
    const pr = await client.openDraftPr({ repo: 'acme/billing', base: 'dev', head: 'feature/ABC-1-x', title: 'ABC-1: Export', body: '## Summary\nhello `code` $(not run)' });
    expect(pr).toEqual({ number: 42, url: 'https://github.com/acme/billing/pull/42' });
    const [c] = calls();
    expect(c?.args.slice(0, 3)).toEqual(['pr', 'create', '--draft']);
    expect(c?.args).toEqual(expect.arrayContaining(['-R', 'acme/billing', '--base', 'dev', '--head', 'feature/ABC-1-x', '--title', 'ABC-1: Export']));
    expect(c?.args).toContain('--body-file');
    expect(c?.body).toBe('## Summary\nhello `code` $(not run)');
    expect(c?.args.join(' ')).not.toContain('hello'); // the body is never on the command line
    expect(c?.token).toBe('ghs_secret_token_value');
  });

  it('adopts the open PR of the branch when gh says one already exists', async () => {
    reply({
      'pr create': { stderr: 'a pull request for branch "feature/ABC-1-x" into branch "dev" already exists:\nhttps://github.com/acme/billing/pull/48\n', exit: 1 },
      'pr list': { stdout: '[{"number":48,"url":"https://github.com/acme/billing/pull/48"}]' },
    });
    expect(await client.openDraftPr({ repo: 'acme/billing', base: 'dev', head: 'feature/ABC-1-x', title: 'ABC-1: Export', body: 'b' })).toEqual({ number: 48, url: 'https://github.com/acme/billing/pull/48' });
    const list = calls().find((c) => c.args[1] === 'list');
    expect(list?.args).toEqual(expect.arrayContaining(['--head', 'feature/ABC-1-x', '--state', 'open']));
  });

  describe('failureReport', () => {
    const checks = JSON.stringify([
      { name: 'CodeQL', bucket: 'fail', link: 'https://github.com/acme/billing/runs/555' },
      { name: 'checks', bucket: 'fail', link: 'https://github.com/acme/billing/actions/runs/777/job/888' },
      { name: 'audit', bucket: 'pass', link: 'https://github.com/acme/billing/actions/runs/777/job/999' },
    ]);
    it('explains a failing CodeQL check with its output, annotations and the PR\'s alerts, and a failing job with its log', async () => {
      reply({
        'pr checks': { stdout: checks },
        'api repos/acme/billing/check-runs/555': { stdout: JSON.stringify({ output: { title: '1 new alert including 1 high severity security vulnerability', summary: 'Security Alerts: 1 high', text: '' } }) },
        'api repos/acme/billing/check-runs/555/annotations': { stdout: JSON.stringify([{ path: 'src/a.test.ts', start_line: 38, title: 'Incomplete URL substring sanitization', message: 'github.com may be at an arbitrary position' }]) },
        'api repos/acme/billing/code-scanning/alerts?ref=refs/pull/48/merge&state=open&per_page=30': { stdout: JSON.stringify([{ rule: { id: 'js/incomplete-url-substring-sanitization', description: 'Incomplete URL substring sanitization', security_severity_level: 'high' }, most_recent_instance: { location: { path: 'src/a.test.ts', start_line: 38 } } }]) },
        'run view': { stdout: 'line 1\nTest failed: expected 1 to be 2\n' },
      });
      const report = await client.failureReport('acme/billing', 48);
      expect(report).toContain('Failing checks: CodeQL, checks');
      expect(report).toContain('1 new alert including 1 high severity');
      expect(report).toContain('- src/a.test.ts:38 Incomplete URL substring sanitization');
      expect(report).toContain('js/incomplete-url-substring-sanitization (high): Incomplete URL substring sanitization at src/a.test.ts:38');
      expect(report).toContain('Test failed: expected 1 to be 2');
      expect(report).not.toContain('audit'); // a passing check is left out
    });
    it('is empty when nothing is failing, and still names the failing checks when their details cannot be read', async () => {
      reply({ 'pr checks': { stdout: JSON.stringify([{ name: 'checks', bucket: 'pass', link: 'x' }]) } });
      expect(await client.failureReport('acme/billing', 1)).toBe('');
      reply({ 'pr checks': { stdout: checks }, 'api repos/acme/billing/check-runs/555': { stderr: 'HTTP 403', exit: 1 }, 'run view': { stderr: 'HTTP 404', exit: 1 } });
      const report = await client.failureReport('acme/billing', 48);
      expect(report).toContain('Failing checks: CodeQL, checks');
      expect(report).toContain('could not read');
    });
  });

  it('fails clearly when gh does not print a PR URL, and redacts the token from errors', async () => {
    reply({ 'pr create': { stdout: 'something odd\n' } });
    await expect(client.openDraftPr({ repo: 'a/b', base: 'dev', head: 'h', title: 't', body: 'b' })).rejects.toThrow(/could not read the pull request URL/);
    reply({ 'pr create': { stderr: 'HTTP 401: bad credentials ghs_secret_token_value\n', exit: 1 } });
    const err = await client.openDraftPr({ repo: 'a/b', base: 'dev', head: 'h', title: 't', body: 'b' }).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.message).toContain('bad credentials');
    expect(err.message).not.toContain('ghs_secret_token_value');
  });

  it('marks ready, comments and edits the body with the documented commands', async () => {
    await client.markReady('acme/billing', 42);
    await client.comment('acme/billing', 42, '## Review — round 1');
    await client.editBody('acme/billing', 42, 'new body');
    const [ready, comment, edit] = calls();
    expect(ready?.args).toEqual(['pr', 'ready', '42', '-R', 'acme/billing']);
    expect(comment?.args.slice(0, 4)).toEqual(['pr', 'comment', '42', '-R']);
    expect(comment?.body).toBe('## Review — round 1');
    expect(edit?.args.slice(0, 2)).toEqual(['pr', 'edit']);
    expect(edit?.body).toBe('new body');
  });

  it('reads checks as name and bucket, including when gh exits non-zero for pending or failing checks', async () => {
    reply({ 'pr checks': { stdout: JSON.stringify([{ name: 'build', bucket: 'pass' }, { name: 'lint', bucket: 'fail' }, { name: 'e2e', bucket: 'pending' }]), exit: 8 } });
    expect(await client.checks('acme/billing', 42)).toEqual([{ name: 'build', bucket: 'pass' }, { name: 'lint', bucket: 'fail' }, { name: 'e2e', bucket: 'pending' }]);
    expect(calls()[0]?.args).toEqual(['pr', 'checks', '42', '-R', 'acme/billing', '--json', 'name,bucket,link']);
  });

  it('a PR with no checks is an empty list (it counts as passing)', async () => {
    reply({ 'pr checks': { stderr: "no checks reported on the 'feature/x' branch", exit: 1 } });
    expect(await client.checks('acme/billing', 42)).toEqual([]);
    reply({ 'pr checks': { stdout: '[]' } });
    expect(await client.checks('acme/billing', 42)).toEqual([]);
  });

  it('reads the PR state and merge time', async () => {
    reply({ 'pr view': { stdout: JSON.stringify({ state: 'MERGED', mergedAt: '2026-11-12T10:00:00Z', additions: 120, deletions: 30, changedFiles: 4 }) } });
    expect(await client.prState('acme/billing', 42)).toEqual({ state: 'MERGED', mergedAt: '2026-11-12T10:00:00Z', additions: 120, deletions: 30, changedFiles: 4 });
    reply({ 'pr view': { stdout: JSON.stringify({ state: 'OPEN', mergedAt: null }) } });
    expect(await client.prState('acme/billing', 42)).toEqual({ state: 'OPEN', mergedAt: null, additions: null, deletions: null, changedFiles: null });
    expect(calls().at(-1)?.args).toEqual(['pr', 'view', '42', '-R', 'acme/billing', '--json', 'state,mergedAt,additions,deletions,changedFiles']);
  });

  it('returns the last 60 lines of the latest failed run, found with gh run list', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `log line ${i + 1}`).join('\n');
    reply({
      'run list': { stdout: JSON.stringify([{ databaseId: 9, conclusion: 'success' }, { databaseId: 8, conclusion: 'failure' }, { databaseId: 7, conclusion: 'failure' }]) },
      'run view': { stdout: lines },
    });
    const tail = await client.failingLogTail('acme/billing', 'feature/x');
    expect(tail.split('\n')).toHaveLength(60);
    expect(tail.startsWith('log line 41')).toBe(true);
    const [list, view] = calls();
    expect(list?.args).toEqual(['run', 'list', '-R', 'acme/billing', '--branch', 'feature/x', '--json', 'databaseId,conclusion', '--limit', '5']);
    expect(view?.args).toEqual(['run', 'view', '8', '-R', 'acme/billing', '--log-failed']);
  });

  it('returns an empty tail when no run failed', async () => {
    reply({ 'run list': { stdout: JSON.stringify([{ databaseId: 1, conclusion: 'success' }]) } });
    expect(await client.failingLogTail('a/b', 'x')).toBe('');
    expect(calls()).toHaveLength(1);
  });
});

describe('repoFacts (onboarding)', () => {
  it('reports the default branch and the languages, biggest first', async () => {
    reply({
      'api repos/acme/billing': { stdout: JSON.stringify({ default_branch: 'main', private: true }) },
      'api repos/acme/billing/languages': { stdout: JSON.stringify({ JavaScript: 1200, TypeScript: 90000, Shell: 40 }) },
    });
    expect(await client.repoFacts('acme/billing')).toEqual({ defaultBranch: 'main', languages: ['TypeScript', 'JavaScript', 'Shell'] });
    expect(calls().map((c) => c.args.slice(0, 2).join(' '))).toEqual(['api repos/acme/billing', 'api repos/acme/billing/languages']);
    expect(calls()[0]?.token).toBe('ghs_secret_token_value');
  });

  it('fails with the first line of the error when the token cannot reach the repository', async () => {
    reply({ 'api repos/acme/secret': { stderr: 'gh: Not Found (HTTP 404)\nmore', exit: 1 } });
    await expect(client.repoFacts('acme/secret')).rejects.toThrow('gh: Not Found (HTTP 404)');
  });

  it('fails clearly when GitHub reports no default branch', async () => {
    reply({ 'api repos/acme/empty': { stdout: '{}' }, 'api repos/acme/empty/languages': { stdout: '{}' } });
    await expect(client.repoFacts('acme/empty')).rejects.toThrow(/default branch/);
  });
});

describe('GhCliClient: GitHub issues and Projects', () => {
  const board = (items: unknown[], extra: { nextPage?: boolean } = {}) => ({
    stdout: JSON.stringify({
      data: {
        repositoryOwner: {
          projectV2: {
            id: 'PVT_1',
            fields: { nodes: [{}, { id: 'F_status', name: 'Status', options: [{ id: 'O_todo', name: 'Todo' }, { id: 'O_prog', name: 'In Progress' }, { id: 'O_done', name: 'Done' }] }, { id: 'F_other', name: 'Priority' }] },
            items: { pageInfo: { hasNextPage: Boolean(extra.nextPage), endCursor: 'c1' }, nodes: items },
          },
        },
      },
    }),
  });
  const card = (id: string, status: string | null, content: unknown) => ({ id, fieldValueByName: status ? { name: status } : null, content });
  const issue = (number: number, repo = 'acme/billing', over: Record<string, unknown> = {}) => ({ __typename: 'Issue', number, title: `Issue ${number}`, body: 'b', url: `https://github.com/${repo}/issues/${number}`, state: 'OPEN', repository: { nameWithOwner: repo }, labels: { nodes: [{ name: 'bug' }] }, ...over });

  it('lists the open issues with a label, as the repository they belong to', async () => {
    reply({ 'issue list': { stdout: JSON.stringify([{ number: 7, title: 'Export', body: null, url: 'https://github.com/acme/billing/issues/7', labels: [{ name: 'sdlc-agent' }, { name: 'bug' }] }]) } });
    const issues = await client.listIssues('acme/billing', 'sdlc-agent');
    expect(issues).toEqual([{ number: 7, title: 'Export', body: '', url: 'https://github.com/acme/billing/issues/7', labels: ['sdlc-agent', 'bug'], repo: 'acme/billing' }]);
    const c = calls().at(-1)!;
    expect(c.args).toEqual(expect.arrayContaining(['issue', 'list', '-R', 'acme/billing', '--label', 'sdlc-agent', '--state', 'open']));
    expect(c.token).toBe('ghs_secret_token_value');
  });

  it('reads the cards of a Projects board: issues only, with their column, through the GraphQL API without a repository', async () => {
    reply({ 'api graphql': board([card('I1', 'Todo', issue(7)), card('I2', null, issue(8)), card('I3', 'Todo', { __typename: 'PullRequest' }), card('I4', 'Todo', null), card('I5', 'Done', issue(9, 'acme/billing', { state: 'CLOSED' }))]) });
    const items = await client.listProjectItems('acme', 3, 'Status');
    expect(items.map((i) => [i.id, i.status, i.issue.number, i.closed])).toEqual([['I1', 'Todo', 7, false], ['I2', null, 8, false], ['I5', 'Done', 9, true]]);
    expect(items[0]?.issue).toMatchObject({ repo: 'acme/billing', labels: ['bug'], url: 'https://github.com/acme/billing/issues/7' });
    const c = calls().at(-1)!;
    expect(c.args.slice(0, 2)).toEqual(['api', 'graphql']);
    expect(c.args).toEqual(expect.arrayContaining(['-f', 'owner=acme', '-F', 'number=3', '-f', 'field=Status']));
    expect(c.args.some((a) => a === '-R')).toBe(false); // a board belongs to an owner, so no repository token is looked up
  });

  it('says what is wrong when the board cannot be read', async () => {
    reply({ 'api graphql': { stdout: JSON.stringify({ data: { repositoryOwner: { projectV2: null } } }) } });
    await expect(client.listProjectItems('acme', 99, 'Status')).rejects.toThrow(/GitHub Projects board acme\/99 was not found.*"project" scope/);
    reply({ 'api graphql': { stdout: JSON.stringify({ errors: [{ message: 'Resource not accessible' }] }) } });
    await expect(client.listProjectItems('acme', 3, 'Status')).rejects.toThrow('Resource not accessible');
  });

  it('moves a card to a column, comparing names without regard to case, and does nothing when it is there already', async () => {
    reply({ 'api graphql': board([card('I1', 'Todo', issue(7)), card('I2', 'In Progress', issue(8))]) });
    expect(await client.setProjectItemStatus('acme', 3, { repo: 'acme/billing', number: 7 }, 'Status', 'in progress')).toBe(true);
    const mutation = calls().at(-1)!.args.find((a) => a.includes('updateProjectV2ItemFieldValue'));
    expect(mutation).toBeDefined();
    expect(calls().at(-1)!.args).toEqual(expect.arrayContaining(['-f', 'project=PVT_1', '-f', 'item=I1', '-f', 'field=F_status', '-f', 'option=O_prog']));
    const before = calls().length;
    expect(await client.setProjectItemStatus('acme', 3, { repo: 'acme/billing', number: 8 }, 'Status', 'In Progress')).toBe(true);
    expect(calls().length - before).toBe(1); // only the read: already in that column
  });

  it('says false for a column the board does not have, or a card that is not on it', async () => {
    reply({ 'api graphql': board([card('I1', 'Todo', issue(7))]) });
    expect(await client.setProjectItemStatus('acme', 3, { repo: 'acme/billing', number: 7 }, 'Status', 'Shipped')).toBe(false);
    expect(await client.setProjectItemStatus('acme', 3, { repo: 'acme/billing', number: 99 }, 'Status', 'Done')).toBe(false);
  });

  it('creates the labels it adds, then edits the issue', async () => {
    reply({});
    await client.setIssueLabels('acme/billing', 7, ['sdlc:planning'], ['sdlc:new']);
    const all = calls();
    expect(all.at(-2)!.args).toEqual(expect.arrayContaining(['api', '-X', 'POST', 'repos/acme/billing/labels', '-f', 'name=sdlc:planning']));
    expect(all.at(-1)!.args).toEqual(['issue', 'edit', '7', '-R', 'acme/billing', '--add-label', 'sdlc:planning', '--remove-label', 'sdlc:new']);
  });

  it('comments with the body in a file, and closes an issue', async () => {
    reply({});
    await client.commentIssue('acme/billing', 7, 'Done: $(not run)');
    const c = calls().at(-1)!;
    expect(c.args.slice(0, 3)).toEqual(['issue', 'comment', '7']);
    expect(c.body).toBe('Done: $(not run)');
    await client.closeIssue('acme/billing', 7);
    expect(calls().at(-1)!.args).toEqual(['issue', 'close', '7', '-R', 'acme/billing']);
  });
});
