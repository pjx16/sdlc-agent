import { Injectable, Logger } from '@nestjs/common';
import { ProjectSettingsSchema, events, stripAnsi, type DecisionOption } from '@sdlc/shared';
import { logEvent } from '../../common/event-log';
import type { Ticket } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { StepOutcome } from '../pipeline/step-handler';
import { OrchestratorService } from './orchestrator.service';

type Held = Extract<StepOutcome, { kind: 'hold' }>;

/** How many recoveries have been tried for the ticket: every recovery decision that did not hand the ticket to a person. */
const SPENT = { point: 'recovery', NOT: { chosen: { startsWith: 'ask_human' } } } as const;

/**
 * Self-recovery. When a step would stop the ticket for a person (`needs_help`), the orchestrator first looks at the failure and tries to
 * get it moving again: run the step again, or redo the stuck subtask's tests, each with a note it writes for the agent. After
 * `recovery.maxAttempts` tries, or when it judges that nothing it can do will help, the ticket goes to a person as before.
 * Every decision is stored, logged as an event and written on the Jira ticket (OrchestratorService.decide).
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  /** Returns what the loop should do instead of holding, or null to hold for a person. Never throws. */
  async attempt(ticket: Ticket, held: Held): Promise<StepOutcome | null> {
    try {
      if (held.reason !== 'needs_help') return null; // questions, manual pauses and closed PRs really are for a person
      // A rejected push (somebody else's commits are on the branch, the remote moved) is not something a note to an agent can change.
      if (/^Push of .* was rejected/.test(held.note ?? '')) return null;
      const project = await this.prisma.project.findUniqueOrThrow({ where: { id: ticket.projectId } });
      const settings = ProjectSettingsSchema.parse(project.settings);
      if (!settings.recovery.enabled || !settings.stages.orchestrate.enabled) return null;

      const spent = await this.prisma.orchestratorDecision.count({ where: { ticketId: ticket.id, ...SPENT } });
      if (spent >= settings.recovery.maxAttempts) {
        await logEvent(this.prisma, events.note({ source: 'orchestrator', type: 'orchestrator', message: `Recovery attempts used up (${spent} of ${settings.recovery.maxAttempts}): ${ticket.key} goes to a person` }), { ticketId: ticket.id });
        return null;
      }

      const subtask = ticket.status === 'IN_PROGRESS' ? await this.prisma.subtask.findFirst({ where: { ticketId: ticket.id, status: { not: 'DONE' } }, orderBy: { seq: 'asc' } }) : null;
      const options: DecisionOption[] = [
        { kind: 'retry', to: ticket.status, label: 'Run the step again with a note' },
        ...(subtask ? [{ kind: 'redo_tests', to: ticket.status, label: `Write the tests of subtask ${subtask.seq} again with a note` }] : []),
        { kind: 'ask_human', to: 'ON_HOLD', label: 'Ask a person' },
      ];
      const { option, note, fallbackUsed } = await this.orchestrator.decide(ticket, 'recovery', options, options[options.length - 1] as DecisionOption, await this.facts(ticket, held, spent, settings.recovery.maxAttempts));
      if (fallbackUsed || option.kind === 'ask_human') return null;

      const guidance = `The orchestrator's note after attempt ${spent + 1} (${held.note ? 'the step was stuck' : 'it failed'}): ${note ?? 'Try again and avoid the cause of the failure.'}`;
      if (option.kind === 'redo_tests' && subtask) {
        await this.prisma.subtask.update({ where: { id: subtask.id }, data: { status: 'TESTS', fixRounds: 0, lastFailure: guidance, retriedAt: new Date(), redoTests: true, rerunPart: 'tests' } });
      } else {
        await this.prisma.subtask.updateMany({ where: { ticketId: ticket.id, status: { not: 'DONE' } }, data: { fixRounds: 0, lastFailure: guidance, retriedAt: new Date() } });
      }
      await this.prisma.ticket.update({ where: { id: ticket.id }, data: { ciFixPending: false, ciFixDone: false, ciWaitStartedAt: null, kbUpdatePending: false } });
      await logEvent(this.prisma, events.note({ source: 'orchestrator', type: 'orchestrator', message: `Recovery ${spent + 1} of ${settings.recovery.maxAttempts} for ${ticket.key}: ${option.label}` }), { ticketId: ticket.id });
      return { kind: 'continue' };
    } catch (err) {
      this.logger.warn(`Recovery failed for ${ticket.key}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** What the orchestrator needs to judge the failure: the stuck step's own words, and what was already tried. */
  private async facts(ticket: Ticket, held: Held, spent: number, max: number): Promise<string> {
    const earlier = await this.prisma.orchestratorDecision.findMany({ where: { ticketId: ticket.id, point: 'recovery' }, orderBy: { at: 'desc' }, take: 3 });
    const tried = earlier.reverse().map((d, i) => `attempt ${i + 1}: ${d.chosen}: ${d.reason}`.slice(0, 240));
    return [
      `Step stuck in ${ticket.status}: ${stripAnsi(held.note ?? 'no detail')}`.slice(0, 1100),
      `Recovery attempts used: ${spent} of ${max}.`,
      tried.length > 0 ? `Already tried (do not repeat):\n${tried.join('\n')}` : 'Nothing has been tried yet.',
    ].join('\n');
  }
}
