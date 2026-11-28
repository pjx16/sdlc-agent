import { describe, expect, it, vi } from 'vitest';
import { PrSizeService } from './pr-size.service';

const NUMSTAT = (n: number) => `${n}\t0\tsrc/a.ts\n`; // n added lines in one file

function setup(opts: { lines: number; level?: string | null; settings?: unknown; source?: string }) {
  const calls: string[][] = [];
  const git = {
    run: vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args.includes('--numstat') && args.includes('diff')) return { stdout: NUMSTAT(opts.lines), stderr: '' };
      if (args.includes('log')) return { stdout: '@abc1234\tfeat(SDA-7): first\n120\t8\tsrc/a.ts\n@def5678\ttest(SDA-7): tests\n40\t0\tsrc/a.test.ts\n', stderr: '' };
      return { stdout: '', stderr: '' };
    }),
  };
  const ticketUpdate = vi.fn(async () => ({}));
  const decisionCreate = vi.fn(async () => ({}));
  const eventCreate = vi.fn(async () => ({}));
  const prisma = {
    ticket: { findUniqueOrThrow: async () => ({ id: 't1', key: 'SDA-7', title: 'x', projectId: 'p1', source: opts.source ?? 'paste', externalKey: null, prSizeLevel: opts.level ?? null, project: { baseBranch: 'dev', jiraMode: 'off', settings: opts.settings ?? {} } }), update: ticketUpdate },
    orchestratorDecision: { create: decisionCreate },
    event: { create: eventCreate },
  };
  const pr = { postComment: vi.fn(async () => true) };
  const raiser = { raise: vi.fn(async () => ({})) };
  const comments = { post: vi.fn(async () => 'created') };
  const service = new PrSizeService(prisma as never, { workspacePath: () => '/ws' } as never, git as never, pr as never, raiser as never, undefined, comments as never);
  return { service, calls, ticketUpdate, decisionCreate, eventCreate, pr, raiser, comments };
}

describe('PrSizeService', () => {
  it('stores the size and says nothing while the branch is under the soft limit', async () => {
    const t = setup({ lines: 300 });
    await t.service.check('t1');
    expect(t.ticketUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { prDiffLines: 300, prSizeLevel: null } });
    expect(t.decisionCreate).not.toHaveBeenCalled();
  });

  it('leaves lockfiles and generated files out of the count', async () => {
    const t = setup({ lines: 10 });
    await t.service.check('t1');
    const diff = t.calls.find((c) => c.includes('--numstat')) as string[];
    expect(diff).toContain(':(exclude,glob)package-lock.json');
  });

  it('past the soft limit it records a decision and an event once, and does not block or comment on the PR', async () => {
    const t = setup({ lines: 700 });
    await t.service.check('t1');
    expect(t.ticketUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { prDiffLines: 700, prSizeLevel: 'soft' } });
    expect(t.decisionCreate).toHaveBeenCalledTimes(1);
    expect((t.decisionCreate.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({ data: { point: 'pr_size', chosen: 'continue IN_PROGRESS' } });
    expect(t.pr.postComment).not.toHaveBeenCalled();
    const again = setup({ lines: 750, level: 'soft' });
    await again.service.check('t1');
    expect(again.decisionCreate).not.toHaveBeenCalled(); // already reported at this level
  });

  it('past the hard limit it comments on the PR with each commit\'s size and raises a non-blocking inbox item', async () => {
    const t = setup({ lines: 1700, level: 'soft' });
    await t.service.check('t1');
    expect(t.decisionCreate).toHaveBeenCalledTimes(1);
    const body = (t.pr.postComment.mock.calls[0] as unknown as [string, string])[1];
    expect(body).toContain('1700 changed lines (limit 1500)');
    expect(body).toContain('abc1234  feat(SDA-7): first  +120 -8');
    expect((t.raiser.raise.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({ kind: 'pr_ready', priority: 'fyi', dedupeKey: 'pr-size:t1' });
  });

  it('uses the limits set for the project', async () => {
    const t = setup({ lines: 250, settings: { limits: { prSoftLines: 100, prHardLines: 200 } } });
    await t.service.check('t1');
    expect(t.ticketUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { prDiffLines: 250, prSizeLevel: 'hard' } });
  });

  it('never throws: a failing check is only logged', async () => {
    const t = setup({ lines: 10 });
    (t.service as unknown as { prisma: { ticket: { findUniqueOrThrow: () => Promise<never> } } }).prisma.ticket.findUniqueOrThrow = async () => {
      throw new Error('db down');
    };
    await expect(t.service.check('t1')).resolves.toBeUndefined();
  });

  describe('on the ticket\'s GitHub issue', () => {
    it('past the soft limit it posts one comment for the soft level, with the reason', async () => {
      const t = setup({ lines: 700, source: 'github' });
      await t.service.check('t1');
      expect(t.comments.post).toHaveBeenCalledTimes(1);
      const [ticket, purpose, text] = t.comments.post.mock.calls[0] as unknown as [{ id: string; key: string }, string, string];
      expect(ticket).toMatchObject({ id: 't1', key: 'SDA-7' });
      expect(purpose).toBe('pr-size-soft');
      expect(text).toContain('getting large (soft limit)');
      expect(text).toContain('over the soft limit of 600');
    });

    it('past the hard limit it posts for the hard level, which does not overwrite the soft one', async () => {
      const t = setup({ lines: 1700, level: 'soft', source: 'github' });
      await t.service.check('t1');
      expect((t.comments.post.mock.calls[0] as unknown as [unknown, string])[1]).toBe('pr-size-hard');
    });

    it('posts nothing under the limits, or when the level was already reported', async () => {
      const under = setup({ lines: 300, source: 'github' });
      await under.service.check('t1');
      const again = setup({ lines: 750, level: 'soft', source: 'github' });
      await again.service.check('t1');
      expect(under.comments.post).not.toHaveBeenCalled();
      expect(again.comments.post).not.toHaveBeenCalled();
    });

    it('a Jira ticket is told on Jira and not on GitHub', async () => {
      const t = setup({ lines: 700, source: 'jira' });
      await t.service.check('t1');
      expect(t.comments.post).not.toHaveBeenCalled();
    });
  });
});
