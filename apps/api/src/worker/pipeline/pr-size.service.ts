import { Injectable, Logger, Optional } from '@nestjs/common';
import { ProjectSettingsSchema, jiraOn } from '@sdlc/shared';
import { jiraMarker } from '../../jira/jira-client';
import { JiraClients } from '../../jira/jira-clients';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportRaiser } from '../../support/support-raiser';
import { GitRunner } from '../git/git-runner';
import { computeChangedLines, DIFF_EXCLUDES } from '../review/diff';
import { WorkerConfig } from '../worker-config';
import { PrService } from './pr.service';

const RANK = { soft: 1, hard: 2 } as const;
type Level = keyof typeof RANK;
const rank = (l: string | null): number => (l === 'soft' || l === 'hard' ? RANK[l] : 0);

/** One line per commit: "abc1234  feat(SDA-7): subtask title  +120 -8". */
async function perCommit(git: GitRunner, ws: string, base: string): Promise<string[]> {
  const out = (await git.run(['--no-pager', 'log', '--no-merges', '--format=@%h%x09%s', '--numstat', `origin/${base}..HEAD`, '--', '.', ...DIFF_EXCLUDES], { cwd: ws })).stdout;
  const rows: { sha: string; subject: string; added: number; deleted: number }[] = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('@')) {
      const [sha = '', subject = ''] = line.slice(1).split('\t');
      rows.push({ sha, subject, added: 0, deleted: 0 });
    } else if (line.trim() && rows.length > 0) {
      const [a, d] = line.split('\t');
      const row = rows[rows.length - 1];
      if (row) {
        row.added += Number(a) || 0;
        row.deleted += Number(d) || 0;
      }
    }
  }
  return rows.filter((r) => r.added + r.deleted > 0).map((r) => `${r.sha}  ${r.subject}  +${r.added} -${r.deleted}`);
}

/**
 * Keeps pull requests reviewable. After every subtask the size of the branch against the base is measured (added + deleted lines, lockfiles
 * and generated files left out) and stored on the ticket. It is the project's `limits.prSoftLines` and `limits.prHardLines` that matter:
 * - past the soft limit: a decision is recorded, an event is written and the Jira ticket is told, once;
 * - past the hard limit: the same, plus a comment on the PR with the size of each commit (so it can be reviewed commit by commit) and a
 *   non-blocking item in the inbox.
 * It never stops the pipeline and never throws: a PR that is large is reported, not blocked.
 */
@Injectable()
export class PrSizeService {
  private readonly logger = new Logger(PrSizeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WorkerConfig,
    private readonly git: GitRunner,
    private readonly pr: PrService,
    @Optional() private readonly raiser?: SupportRaiser,
    @Optional() private readonly jira?: JiraClients,
  ) {}

  async check(ticketId: string): Promise<void> {
    try {
      const ticket = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { project: true } });
      const { project } = ticket;
      const limits = ProjectSettingsSchema.parse(project.settings).limits;
      const soft = limits.prSoftLines;
      const hard = Math.max(limits.prHardLines, soft);
      const ws = this.config.workspacePath(ticket.projectId, ticket.key);
      const lines = await computeChangedLines(this.git, ws, { from: `origin/${project.baseBranch}`, mergeBase: true });
      const level: Level | null = lines > hard ? 'hard' : lines > soft ? 'soft' : null;
      await this.prisma.ticket.update({ where: { id: ticketId }, data: { prDiffLines: lines, prSizeLevel: level } });
      if (!level || rank(level) <= rank(ticket.prSizeLevel)) return; // under the limits, or already reported at this level

      const limit = level === 'hard' ? hard : soft;
      const reason = `The branch changes ${lines} lines against ${project.baseBranch}, over the ${level} limit of ${limit} (set in the project's limits). ${
        level === 'hard' ? 'Review it commit by commit; the PR comment lists each commit with its size.' : 'The remaining work continues; keep the next changes small.'
      }`;
      await this.prisma.orchestratorDecision.create({ data: { ticketId, point: 'pr_size', legalMoves: [{ kind: 'continue', to: 'IN_PROGRESS' }] as never, chosen: 'continue IN_PROGRESS', reason, fallbackUsed: false } });
      await this.prisma.event.create({ data: { ticketId, type: 'git', level: 'warn', source: 'system', message: `Large pull request: ${reason}`.slice(0, 500) } });
      await this.tellJira(ticket, project, `sdlc-agent noticed the pull request is getting large (${level} limit).\nWhy: ${reason}`, level);
      if (level === 'hard') await this.flagHard(ticket, project.baseBranch, ws, lines, limit);
    } catch (err) {
      this.logger.warn(`PR size check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async flagHard(ticket: { id: string; key: string; projectId: string; title: string }, base: string, ws: string, lines: number, limit: number): Promise<void> {
    const commits = await perCommit(this.git, ws, base).catch(() => [] as string[]);
    const body = [`**This pull request is large: ${lines} changed lines (limit ${limit}).**`, 'Review it commit by commit:', '', ...commits.map((c) => `- \`${c}\``), '', 'If it is too much to review at once, ask for it to be split by commit.'].join('\n');
    await this.pr.postComment(ticket.id, body);
    await this.raiser?.raise({
      kind: 'pr_ready', ticketId: ticket.id, projectId: ticket.projectId, stage: 'pr_size', priority: 'fyi', dedupeKey: `pr-size:${ticket.id}`,
      title: `${ticket.key}: the pull request is large (${lines} lines)`,
      body: `The branch is over the hard limit of ${limit} changed lines. A comment on the PR lists each commit with its size, so it can be reviewed one commit at a time. Nothing is blocked.`,
    });
  }

  private async tellJira(ticket: { key: string; source: string; externalKey: string | null }, project: { jiraMode: string; settings: unknown }, text: string, level: Level): Promise<void> {
    try {
      if (!this.jira || ticket.source !== 'jira' || !ticket.externalKey || !jiraOn(project.jiraMode) || !ProjectSettingsSchema.parse(project.settings).jiraWriteBack.comments) return;
      await (await this.jira.forMode(project.jiraMode)).comment(ticket.externalKey, text, jiraMarker(ticket.key, `pr-size-${level}`, `${Date.now()}`));
    } catch (err) {
      this.logger.warn(`Could not write the PR size note to Jira for ${ticket.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
