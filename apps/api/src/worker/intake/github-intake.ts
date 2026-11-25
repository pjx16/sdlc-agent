import { Injectable, Logger } from '@nestjs/common';
import { ProjectSettingsSchema } from '@sdlc/shared';
import { Prisma, type Project } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GITHUB_CLIENT, type GitHubClient, type GithubIssue, parseRepo } from '../github/github-client';
import type { Housekeeper } from '../loop/worker-loop';
import { Inject } from '@nestjs/common';

export interface GithubPollResult {
  skipped?: 'intake_paused' | 'source_off';
  projects: number;
  created: number;
  duplicates: number;
  errors: { project: string; message: string }[];
}

/** The key under which a GitHub issue is stored: `owner/name#number`. */
export const githubKey = (repo: string, number: number): string => `${repo}#${number}`;

/** What kind of ticket an issue is, from its labels: a `bug` label makes a bug, `chore` or `tech` a chore, anything else a feature. */
export function kindOfIssue(labels: string[]): 'feature' | 'bug' | 'chore' {
  const names = labels.map((l) => l.toLowerCase());
  if (names.includes('bug')) return 'bug';
  if (names.some((n) => n === 'chore' || n === 'tech' || n === 'tech-debt')) return 'chore';
  return 'feature';
}

/**
 * GitHub intake: for each project that takes tickets from GitHub, reads the issues (the open ones with the intake label, or the cards of a
 * Project (v2) board that stand in the intake column) and stores each one as a NEW ticket exactly once per (project, `owner/name#number`).
 * It obeys the intake switch and its own source switch. Only issues of the project's own repository are taken.
 */
@Injectable()
export class GithubIntake implements Housekeeper {
  readonly name = 'github-intake';
  readonly intervalMs = (pollIntervalSec: number) => pollIntervalSec;
  private readonly logger = new Logger(GithubIntake.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
  ) {}

  async check(): Promise<void> {
    await this.poll();
  }

  async poll(): Promise<GithubPollResult> {
    const result: GithubPollResult = { projects: 0, created: 0, duplicates: 0, errors: [] };
    const settings = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    if (settings?.intakePaused) return { ...result, skipped: 'intake_paused' };
    if (settings && !settings.intakeGithubEnabled) return { ...result, skipped: 'source_off' };

    const projects = await this.prisma.project.findMany({ where: { enabled: true, onboardingStatus: 'confirmed', mirrorStatus: 'ok' }, orderBy: { createdAt: 'asc' } });
    for (const project of projects) {
      const gh = ProjectSettingsSchema.parse(project.settings).github;
      if (gh.mode === 'off') continue;
      result.projects++;
      try {
        for (const issue of await this.issuesOf(project, gh)) {
          if ((await this.store(project, issue)) === 'created') result.created++;
          else result.duplicates++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({ project: project.name, message });
        this.logger.warn(`GitHub intake of "${project.name}" failed: ${message}`);
      }
    }
    return result;
  }

  private async issuesOf(project: Project, gh: ReturnType<typeof ProjectSettingsSchema.parse>['github']): Promise<GithubIssue[]> {
    const repo = parseRepo(project.repoUrl);
    if (gh.mode === 'issues') return this.github.listIssues(repo, gh.label);
    if (!gh.project) throw new Error('Choose the GitHub project (owner and number) in the project settings');
    const items = await this.github.listProjectItems(gh.project.owner, gh.project.number, gh.statusField);
    return items
      .filter((i) => !i.closed && (i.status ?? '').toLowerCase() === gh.intakeStatus.toLowerCase() && i.issue.repo.toLowerCase() === repo.toLowerCase())
      .map((i) => i.issue);
  }

  private async store(project: Project, issue: GithubIssue): Promise<'created' | 'duplicate'> {
    const externalKey = githubKey(issue.repo, issue.number);
    if (await this.prisma.ticket.findFirst({ where: { projectId: project.id, externalKey }, select: { id: true } })) return 'duplicate';
    const kind = kindOfIssue(issue.labels);
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.project.update({ where: { id: project.id }, data: { nextLocalNumber: { increment: 1 } }, select: { nextLocalNumber: true, localKeyPrefix: true } });
        const key = `${updated.localKeyPrefix}-${updated.nextLocalNumber - 1}`;
        const ticket = await tx.ticket.create({
          data: {
            projectId: project.id, key, externalKey, source: 'github', kind, type: kind === 'bug' ? 'bug' : kind === 'chore' ? 'tech' : 'story',
            title: issue.title.slice(0, 200), body: `${issue.body}\n\n---\nGitHub issue: ${issue.url}`.trim(), labels: issue.labels, status: 'NEW',
          },
        });
        await tx.event.create({ data: { ticketId: ticket.id, type: 'intake', message: `${key} picked up from GitHub issue ${externalKey}` } });
      });
      return 'created';
    } catch (err) {
      // Two polls at once: the other one stored it first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'duplicate';
      throw err;
    }
  }
}
