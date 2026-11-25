import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ERROR_POLICY, describeError, events, type ErrorCode } from '@sdlc/shared';

/** A step that fails only because of the network is tried again; after this many such failures in 24 hours the ticket is held instead (something other than an outage is wrong). */
export const MAX_NETWORK_FAILURES_PER_DAY = 2000;
import { writeEvent } from '../../common/event-log';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportRaiser } from '../../support/support-raiser';
import type { StageResult } from '../agent-runner/agent-runner';
import type { StepOutcome } from './step-handler';

/** F13: the 4th question of a stage holds the ticket for help instead. */
export const MAX_QUESTIONS_PER_STAGE = 3;

export type NonDoneResult = Exclude<StageResult, { kind: 'done' }>;

/**
 * What a ticket does when a stage did not simply succeed. `done` is the stage's own business;
 * everything else is the same for every stage, so it lives here.
 */
@Injectable()
export class StageOutcomes {
  private readonly raiser: SupportRaiser;

  constructor(
    private readonly prisma: PrismaService,
    raiser?: SupportRaiser,
  ) {
    this.raiser = raiser ?? new SupportRaiser(prisma);
  }

  async forResult(ticketId: string, stage: string, result: NonDoneResult): Promise<StepOutcome> {
    switch (result.kind) {
      case 'needs_input':
        // The stage asks the developer something: store the question and wait for the answer. A stage may ask at most 3 questions per ticket (F13).
        if ((await this.prisma.supportTicket.count({ where: { ticketId, stage, kind: 'question' } })) >= MAX_QUESTIONS_PER_STAGE) {
          return { kind: 'hold', reason: 'needs_help', note: `The ${stage} stage asked more than ${MAX_QUESTIONS_PER_STAGE} questions: ${result.question}`.slice(0, 500), stageRunId: result.stageRunId };
        }
        await this.raiser.raise({ kind: 'question', ticketId, stageRunId: result.stageRunId, stage, title: result.question.slice(0, 120), body: result.question, dedupeKey: `question:${result.stageRunId}:${createHash('sha1').update(result.question).digest('hex').slice(0, 8)}` });
        return { kind: 'hold', reason: 'awaiting_answer', note: result.question.slice(0, 200), stageRunId: result.stageRunId };
      case 'failed': {
        // The runner has used up the retries of this error's policy. The policy says whether the ticket is held or failed.
        const code = result.errorCode ?? 'INVALID_OUTPUT';
        if (code === 'NETWORK_ERROR') return this.network(ticketId, stage, result);
        const recovery = ERROR_POLICY[code].recovery;
        const note = `${stage}: ${result.reason}`.slice(0, 500);
        if (recovery.kind === 'retry' && recovery.then === 'fail') return { kind: 'fail', reason: note, stageRunId: result.stageRunId };
        return { kind: 'hold', reason: 'needs_help', note, stageRunId: result.stageRunId };
      }
      case 'turn_limit':
        return { kind: 'hold', reason: 'needs_help', note: describeError('TURN_LIMIT', { agent: stage }), stageRunId: result.stageRunId };
      case 'claude_auth': {
        await this.pause('CLAUDE_AUTH', describeError('CLAUDE_AUTH'), null, ticketId);
        await this.raiser.raise({ kind: 'credential', stage, title: 'Claude rejected the credential', body: `${describeError('CLAUDE_AUTH')}\n\nEvery Claude stage is paused until a working token is saved.`, dedupeKey: 'credential:claude' });
        return { kind: 'stay' };
      }
      case 'killed':
        return { kind: 'hold', reason: 'manual', note: `The ${stage} stage was killed from the dashboard`, stageRunId: result.stageRunId };
      case 'out_of_credits': {
        // Every stage would fail the same way: pause until someone adds credits and resumes. The stage is re-queued, not counted as an attempt.
        await this.pause('CLAUDE_CREDITS', describeError('CLAUDE_CREDITS'), null, ticketId);
        await this.prisma.event.create({ data: { ticketId, type: 'usage', message: `The ${stage} stage stopped: the Anthropic credit balance is too low, so the pipeline is paused` } });
        return { kind: 'stay' };
      }
    }
  }

  /**
   * The connection failed, not the work: the ticket stays where it is and the step is tried again soon (the loop waits, and does not start
   * steps at all once the connectivity monitor sees the outage). It uses no retry. Only a very long run of these holds the ticket.
   */
  private async network(ticketId: string, stage: string, result: Extract<NonDoneResult, { kind: 'failed' }>): Promise<StepOutcome> {
    const recent = await this.prisma.stageRun.count({ where: { ticketId, errorCode: 'NETWORK_ERROR', startedAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
    if (recent >= MAX_NETWORK_FAILURES_PER_DAY) {
      return { kind: 'hold', reason: 'needs_help', note: `${stage}: the network failed ${recent} times in 24 hours: ${result.reason}`.slice(0, 500), stageRunId: result.stageRunId };
    }
    // One line per outage, not one per attempt: the first failure after a successful step is the one that is written.
    if (recent <= 1) await writeEvent(this.prisma, events.note({ source: 'system', type: 'network', level: 'warn', message: `The ${stage} stage stopped because the network failed (${result.reason.slice(0, 200)}). It will be tried again when the connection is back` }), { ticketId });
    return { kind: 'stay', network: true };
  }

  private async pause(code: string, reason: string, resetsAt: Date | null, ticketId: string): Promise<void> {
    const data = { pipelinePaused: true, pausedReason: reason, pausedCode: code, resetsAt };
    await this.prisma.globalSettings.upsert({ where: { id: 'global' }, update: data, create: { id: 'global', ...data } });
    await writeEvent(this.prisma, events.paused({ reason, code: code as ErrorCode }), { ticketId });
  }
}
