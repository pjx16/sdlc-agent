import type { GithubFacts } from '@sdlc/shared';
import type { CheckBucket, CreatedIssue, FoundIssue, GitHubClient, GithubIssue, IssueInfo, OpenedPr, PrCheck, PrState, ProjectItem } from '../worker/github/github-client';

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

  /** What `createIssue` made, in order. The numbers follow `nextIssueNumber`. */
  createdIssues: { repo: string; number: number; title: string; body: string; labels: string[] }[] = [];
  nextIssueNumber = 500;
  failCreateIssue: Error | null = null;
  /** Issues as GitHub knows them by number (for `getIssue`), and the open ones a search finds. */
  knownIssues = new Map<string, IssueInfo>();
  /** Cards `addIssueToProject` put on a board. */
  addedToBoard: { owner: string; project: number; nodeId: string }[] = [];
  failAddToBoard: Error | null = null;

  async createIssue(repo: string, title: string, body: string, labels: string[]): Promise<CreatedIssue> {
    this.calls.push('createIssue');
    if (this.failCreateIssue) throw this.failCreateIssue;
    const number = this.nextIssueNumber++;
    this.createdIssues.push({ repo, number, title, body, labels });
    const made = { number, nodeId: `node-${number}`, url: `https://github.com/${repo}/issues/${number}` };
    this.knownIssues.set(`${repo}#${number}`, { ...made, state: 'open', title });
    return made;
  }
  async getIssue(repo: string, number: number): Promise<IssueInfo> {
    this.calls.push('getIssue');
    const known = this.knownIssues.get(`${repo}#${number}`);
    if (!known) throw new Error(`gh: Not Found (HTTP 404) for ${repo}#${number}`);
    return known;
  }
  async searchOpenIssuesByTitle(repo: string, title: string): Promise<FoundIssue[]> {
    this.calls.push('searchOpenIssuesByTitle');
    return [...this.knownIssues.entries()]
      .filter(([key, i]) => key.startsWith(`${repo}#`) && i.state === 'open' && i.title.trim().toLowerCase() === title.trim().toLowerCase())
      .map(([, i]) => ({ number: i.number, title: i.title, url: i.url }));
  }
  async addIssueToProject(owner: string, project: number, nodeId: string): Promise<string> {
    this.calls.push('addIssueToProject');
    if (this.failAddToBoard) throw this.failAddToBoard;
    this.addedToBoard.push({ owner, project, nodeId });
    return `item-${nodeId}`;
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
    this.createdIssues = [];
    this.nextIssueNumber = 500;
    this.failCreateIssue = null;
    this.knownIssues = new Map();
    this.addedToBoard = [];
    this.failAddToBoard = null;
  }
  setChecks(...buckets: CheckBucket[]) {
    this.checksResult = buckets.map((bucket, i) => ({ name: `check-${i + 1}`, bucket }));
  }
}
