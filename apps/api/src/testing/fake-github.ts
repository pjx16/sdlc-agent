import type { GithubFacts } from '@sdlc/shared';
import type { CheckBucket, GitHubClient, GithubIssue, OpenedPr, PrCheck, PrState, ProjectItem } from '../worker/github/github-client';

/** A GitHub client that records every call and answers from a script. For tests. */
export class FakeGitHub implements GitHubClient {
  calls: string[] = [];
  opened: { repo: string; base: string; head: string; title: string; body: string }[] = [];
  edits: { number: number; body: string }[] = [];
  comments: { number: number; body: string }[] = [];
  nextNumber = 100;
  failOpenWith: Error | null = null;
  failComment: Error | null = null;
  facts: GithubFacts = { defaultBranch: 'main', languages: ['TypeScript'] };
  failFacts: Error | null = null;
  checksResult: PrCheck[] = [];
  state: PrState = { state: 'OPEN', mergedAt: null };
  failLog = '';
  failReport = '';
  ready: number[] = [];
  /** Issues by repository, and the cards of the board, as the script wants GitHub to answer. */
  issues: GithubIssue[] = [];
  items: ProjectItem[] = [];
  failIssues: Error | null = null;
  labelChanges: { repo: string; number: number; add: string[]; remove: string[] }[] = [];
  issueComments: { repo: string; number: number; body: string }[] = [];
  closed: { repo: string; number: number }[] = [];
  statusMoves: { owner: string; project: number; number: number; field: string; option: string }[] = [];
  /** Columns the board has; a move to any other returns false. */
  columns: string[] = ['Todo', 'In Progress', 'Done'];

  async listIssues(repo: string, label: string): Promise<GithubIssue[]> {
    this.calls.push('listIssues');
    if (this.failIssues) throw this.failIssues;
    return this.issues.filter((i) => i.repo === repo && i.labels.includes(label));
  }
  async listProjectItems(): Promise<ProjectItem[]> {
    this.calls.push('listProjectItems');
    if (this.failIssues) throw this.failIssues;
    return this.items;
  }
  async setProjectItemStatus(owner: string, project: number, issue: { repo: string; number: number }, field: string, option: string): Promise<boolean> {
    this.calls.push('setProjectItemStatus');
    if (!this.columns.some((c) => c.toLowerCase() === option.toLowerCase()) || !this.items.some((i) => i.issue.number === issue.number)) return false;
    this.statusMoves.push({ owner, project, number: issue.number, field, option });
    return true;
  }
  async setIssueLabels(repo: string, number: number, add: string[], remove: string[]) {
    this.calls.push('setIssueLabels');
    this.labelChanges.push({ repo, number, add, remove });
  }
  async commentIssue(repo: string, number: number, body: string) {
    this.calls.push('commentIssue');
    this.issueComments.push({ repo, number, body });
  }
  async closeIssue(repo: string, number: number) {
    this.calls.push('closeIssue');
    this.closed.push({ repo, number });
  }

  async openDraftPr(a: { repo: string; base: string; head: string; title: string; body: string }): Promise<OpenedPr> {
    this.calls.push('openDraftPr');
    if (this.failOpenWith) throw this.failOpenWith;
    this.opened.push(a);
    const number = this.nextNumber++;
    return { number, url: `https://github.com/${a.repo}/pull/${number}` };
  }
  async repoFacts(): Promise<GithubFacts> {
    this.calls.push('repoFacts');
    if (this.failFacts) throw this.failFacts;
    return this.facts;
  }
  async markReady(_repo: string, number: number) {
    this.calls.push('markReady');
    this.ready.push(number);
  }
  async comment(_repo: string, number: number, body: string) {
    this.calls.push('comment');
    if (this.failComment) throw this.failComment;
    this.comments.push({ number, body });
  }
  async checks(): Promise<PrCheck[]> {
    this.calls.push('checks');
    return this.checksResult;
  }
  async failureReport() {
    this.calls.push('failureReport');
    return this.failReport;
  }
  async failingLogTail() {
    this.calls.push('failingLogTail');
    return this.failLog;
  }
  async rerunFailed() {
    this.calls.push('rerunFailed');
  }
  async prState(): Promise<PrState> {
    this.calls.push('prState');
    return this.state;
  }
  async editBody(_repo: string, number: number, body: string) {
    this.calls.push('editBody');
    this.edits.push({ number, body });
  }
  reset() {
    this.calls = [];
    this.opened = [];
    this.edits = [];
    this.comments = [];
    this.nextNumber = 100;
    this.failOpenWith = null;
    this.checksResult = [];
    this.state = { state: 'OPEN', mergedAt: null };
    this.failLog = '';
    this.failReport = '';
    this.ready = [];
    this.issues = [];
    this.items = [];
    this.failIssues = null;
    this.labelChanges = [];
    this.issueComments = [];
    this.closed = [];
    this.statusMoves = [];
  }
  setChecks(...buckets: CheckBucket[]) {
    this.checksResult = buckets.map((bucket, i) => ({ name: `check-${i + 1}`, bucket }));
  }
}
