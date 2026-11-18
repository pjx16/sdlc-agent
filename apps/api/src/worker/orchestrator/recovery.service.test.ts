import { describe, expect, it, vi } from 'vitest';
import { RecoveryService } from './recovery.service';

const ticket = { id: 't1', key: 'SDA-7', status: 'IN_PROGRESS', projectId: 'p1' } as never;
const held = { kind: 'hold', reason: 'needs_help', note: 'Verify-red is still invalid: Cannot find module' } as never;

function setup(over: { spent?: number; settings?: unknown; decision?: unknown; subtask?: unknown } = {}) {
  const subtaskUpdate = vi.fn(async () => ({}));
  const subtaskUpdateMany = vi.fn(async () => ({ count: 1 }));
  const prisma = {
    project: { findUniqueOrThrow: async () => ({ settings: over.settings ?? {} }) },
    orchestratorDecision: { count: async () => over.spent ?? 0, findMany: async () => [] },
    subtask: { findFirst: async () => (over.subtask === undefined ? { id: 's1', seq: 1 } : over.subtask), update: subtaskUpdate, updateMany: subtaskUpdateMany },
    ticket: { update: vi.fn(async () => ({})) },
    event: { create: vi.fn(async () => ({})) },
  };
  const decide = vi.fn(async () => over.decision ?? { option: { kind: 'redo_tests', to: 'IN_PROGRESS', label: 'Write the tests of subtask 1 again with a note' }, reason: 'wrong import', note: 'Import only vitest and node:fs.', fallbackUsed: false });
  const service = new RecoveryService(prisma as never, { decide } as never);
  return { service, decide, subtaskUpdate, subtaskUpdateMany };
}

describe('RecoveryService', () => {
  it('redoes the stuck subtask\'s tests with the orchestrator\'s note instead of holding', async () => {
    const { service, decide, subtaskUpdate } = setup();
    expect(await service.attempt(ticket, held)).toEqual({ kind: 'continue' });
    const args = decide.mock.calls[0] as unknown as [unknown, string, { kind: string }[]];
    expect(args[1]).toBe('recovery');
    const options = args[2].map((o) => o.kind);
    expect(options).toEqual(['retry', 'redo_tests', 'ask_human']);
    expect(subtaskUpdate).toHaveBeenCalledWith({ where: { id: 's1' }, data: expect.objectContaining({ status: 'TESTS', redoTests: true, rerunPart: 'tests', fixRounds: 0, lastFailure: expect.stringContaining('Import only vitest and node:fs.') }) });
  });

  it('a plain retry resets the open subtasks and carries the note', async () => {
    const { service, subtaskUpdateMany } = setup({ decision: { option: { kind: 'retry', to: 'IN_PROGRESS', label: 'Run the step again with a note' }, reason: 'flaky', note: 'Run it again.', fallbackUsed: false } });
    expect(await service.attempt(ticket, held)).toEqual({ kind: 'continue' });
    expect(subtaskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fixRounds: 0, lastFailure: expect.stringContaining('Run it again.') }) }));
  });

  it('only offers redo_tests when there is an open subtask', async () => {
    const { service, decide } = setup({ subtask: null, decision: { option: { kind: 'ask_human', to: 'ON_HOLD', label: 'Ask a person' }, reason: 'x', fallbackUsed: false } });
    await service.attempt(ticket, held);
    expect((decide.mock.calls[0] as unknown as [unknown, unknown, { kind: string }[]])[2].map((o) => o.kind)).toEqual(['retry', 'ask_human']);
  });

  it('hands the ticket to a person when the orchestrator says so, when it gave no usable answer, or when the attempts are used up', async () => {
    expect(await setup({ decision: { option: { kind: 'ask_human', to: 'ON_HOLD', label: 'Ask a person' }, reason: 'needs access', fallbackUsed: false } }).service.attempt(ticket, held)).toBeNull();
    expect(await setup({ decision: { option: { kind: 'ask_human', to: 'ON_HOLD', label: 'Ask a person' }, reason: '', fallbackUsed: true } }).service.attempt(ticket, held)).toBeNull();
    const used = setup({ spent: 3 });
    expect(await used.service.attempt(ticket, held)).toBeNull();
    expect(used.decide).not.toHaveBeenCalled();
  });

  it('leaves questions, manual pauses and a switched-off recovery to a person', async () => {
    const a = setup();
    expect(await a.service.attempt(ticket, { kind: 'hold', reason: 'awaiting_answer' } as never)).toBeNull();
    expect(a.decide).not.toHaveBeenCalled();
    const off = setup({ settings: { recovery: { enabled: false } } });
    expect(await off.service.attempt(ticket, held)).toBeNull();
    expect(off.decide).not.toHaveBeenCalled();
  });

  it('does not give a rejected push to the orchestrator: no note can change it', async () => {
    const { service, decide } = setup();
    expect(await service.attempt(ticket, { kind: 'hold', reason: 'needs_help', note: 'Push of tech/SDA-7 was rejected: the remote branch has commits not made by sdlc-agent (1a2b3c4d)' } as never)).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it('respects a lower attempt limit from the project settings', async () => {
    const s = setup({ spent: 1, settings: { recovery: { maxAttempts: 1 } } });
    expect(await s.service.attempt(ticket, held)).toBeNull();
    expect(s.decide).not.toHaveBeenCalled();
  });
});
