import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeGitHub } from '../../testing/fake-github';
import { StepsHarness } from '../../testing/steps-harness';
import { TicketComments } from '../github/ticket-comments';
import { WorkspaceService } from './workspace.service';

describe('replacing the pipeline\'s own earlier commits is told on the ticket\'s GitHub issue', () => {
  let h: StepsHarness;
  beforeAll(async () => {
    h = await StepsHarness.create();
  }, 180_000);
  afterAll(async () => h?.close());

  /** `announceReplaced` is private and only needs the database and the comments, so it is called on a stand-in for the service. */
  const announce = (comments: TicketComments | undefined, ticket: { id: string; key: string; externalKey: string | null }, shas: string[]) =>
    (WorkspaceService.prototype as unknown as { announceReplaced: (...a: unknown[]) => Promise<void> }).announceReplaced.call({ prisma: h.prisma, comments, logger: { warn: () => undefined } }, ticket, 'sdlc/T-1', shas);

  it('writes the decision and the reason as a comment', async () => {
    const github = new FakeGitHub();
    const t = await h.ticket({ source: 'github', externalKey: 'acme/billing#120' });
    await announce(new TicketComments(h.prisma, github), t, ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
    const thread = github.threads.get('acme/billing#120') ?? [];
    expect(thread).toHaveLength(1);
    expect(thread[0]!.body).toContain('sdlc-agent decided (push): replace its own earlier commits on sdlc/T-1.');
    expect(thread[0]!.body).toContain('GitHub still held 2 earlier commits of this ticket');
    expect(thread[0]!.body).toContain('aaaaaaaa, bbbbbbbb');
    expect(await h.prisma.orchestratorDecision.count({ where: { ticketId: t.id, point: 'push_replace' } })).toBe(1);
  });

  it('a ticket that is not on GitHub, or no comments service, writes the decision and the event but nothing on GitHub', async () => {
    const github = new FakeGitHub();
    const pasted = await h.ticket({ source: 'paste', externalKey: null });
    await announce(new TicketComments(h.prisma, github), pasted, ['cccccccc']);
    const plain = await h.ticket({ source: 'github', externalKey: 'acme/billing#121' });
    await announce(undefined, plain, ['dddddddd']);
    expect(github.calls).not.toContain('upsertIssueComment');
    expect(await h.prisma.orchestratorDecision.count({ where: { ticketId: plain.id } })).toBe(1);
  });

  it('a GitHub problem does not stop the push', async () => {
    const github = new FakeGitHub();
    github.failComments = new Error('gh: HTTP 502');
    const t = await h.ticket({ source: 'github', externalKey: 'acme/billing#122' });
    await expect(announce(new TicketComments(h.prisma, github), t, ['eeeeeeee'])).resolves.toBeUndefined();
  });
});
