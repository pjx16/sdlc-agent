import path from 'node:path';
import { Injectable } from '@nestjs/common';
import type { Ticket } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PolicyError } from '../common/retry-policy';
import { readTextNoFollow, writeTextNoFollow } from '../fs/safe-fs';
import { PushRejectedError } from '../git/commit';
import { CommitGuardError } from '../git/commit-guard';
import { WorkspaceService } from '../git/workspace.service';
import { StageLauncher } from './stage-launcher';
import type { StepOutcome } from './step-handler';

/** Where a ticket's plan is kept in the repository: `<kbDir>/plans/<KEY>.md`. */
export function planDocPath(kbDir: string, ticketKey: string): string {
  return `${kbDir.replace(/\/+$/, '')}/plans/${ticketKey.replace(/[^A-Za-z0-9._-]/g, '_')}.md`;
}

/** The plan as the document committed to the repository. */
export function planDocText(ticket: Pick<Ticket, 'key' | 'title'>, plan: string): string {
  return `# ${ticket.key}: ${ticket.title}\n\n_The approved plan for this ticket, committed by sdlc-agent._\n\n${plan.trim()}\n`;
}

/**
 * The plan of a ticket is part of the repository: written to `<kbDir>/plans/<KEY>.md` and committed on the ticket's branch, always, so it
 * reaches the pull request. The same file is rewritten if the plan changes (a rerun), and nothing is committed when it did not.
 */
@Injectable()
export class PlanDocService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly launcher: StageLauncher,
    private readonly workspaces: WorkspaceService,
  ) {}

  /** Returns a hold outcome when the commit or the push was refused; null when the plan is in the branch (or there is no plan). */
  async commit(ticket: Ticket): Promise<StepOutcome | null> {
    const fresh = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const plan = fresh.planMarkdown?.trim();
    if (!plan) return null;
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: ticket.projectId } });
    const ws = this.launcher.workspaceOf(ticket);
    const rel = planDocPath(project.kbDir, ticket.key);
    const text = planDocText(fresh, plan);
    if ((await readTextNoFollow(ws, rel).catch(() => null)) === text) return null;
    await writeTextNoFollow(ws, rel, text);
    try {
      const result = await this.workspaces.commit(ticket.id, `docs(${ticket.key}): add the plan`, { paths: [path.dirname(rel)] });
      if (result.committed) await this.workspaces.push(ticket.id);
    } catch (err) {
      if (err instanceof CommitGuardError || err instanceof PushRejectedError || err instanceof PolicyError) return { kind: 'hold', reason: 'needs_help', note: err.message.slice(0, 500) };
      throw err;
    }
    await this.prisma.event.create({ data: { ticketId: ticket.id, type: 'git', message: `The plan was committed to ${rel}` } });
    return null;
  }
}
