import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SupportRaiser } from '../support/support-raiser';
import { FakeGitHub } from '../testing/fake-github';
import { StepsHarness } from '../testing/steps-harness';
import { TicketComments } from './github/ticket-comments';
import { SupportNotifier } from './support-notifier';

describe('SupportNotifier: what needs a person reaches the ticket\'s GitHub issue', () => {
  let h: StepsHarness;
  let github: FakeGitHub;
  let notifier: SupportNotifier;
  let raiser: SupportRaiser;
  let issue = 90;
  const thread = (n = issue) => github.threads.get(`acme/billing#${n}`) ?? [];
  const issueTicket = (over: Record<string, unknown> = {}) => h.ticket({ source: 'github', externalKey: `acme/billing#${++issue}`, ...over });
  const raise = (ticketId: string, over: Record<string, unknown> = {}) => raiser.raise({ kind: 'question', ticketId, title: 'Which delimiter?', body: 'The export needs a delimiter.', ...over }).then((r) => r.ticket);

  beforeAll(async () => {
    h = await StepsHarness.create();
    raiser = new SupportRaiser(h.prisma);
  }, 180_000);
  afterAll(async () => h?.close());
  beforeEach(async () => {
    github = new FakeGitHub();
    notifier = new SupportNotifier(h.prisma, github, raiser, undefined, new TicketComments(h.prisma, github));
    await h.prisma.supportTicket.deleteMany();
  });

  it('a blocking item becomes a comment on the issue, in the team\'s needs-you format', async () => {
    const t = await issueTicket();
    const s = await raise(t.id);
    await notifier.onRaised(s);
    expect(thread()).toHaveLength(1);
    expect(thread()[0]!.body).toContain('**Needs you:** Which delimiter?');
    expect(thread()[0]!.body).toContain('The export needs a delimiter.');
    expect(thread()[0]!.body).toContain(`<!-- sdlc-agent:${t.key}:support-${s.id} -->`);
  });

  it('each item is its own comment, and the same item told again is not written twice', async () => {
    const t = await issueTicket();
    const a = await raise(t.id, { title: 'First', dedupeKey: 'a' });
    const b = await raise(t.id, { title: 'Second', dedupeKey: 'b' });
    await notifier.onRaised(a);
    await notifier.onRaised(b);
    await notifier.onRaised(a);
    expect(thread()).toHaveLength(2);
  });

  it('an item that does not block is not told', async () => {
    const t = await issueTicket();
    await notifier.onRaised(await raise(t.id, { kind: 'pr_ready', priority: 'fyi', title: 'Ready' }));
    expect(thread()).toHaveLength(0);
  });

  it('the comment on the pull request is still written, as before', async () => {
    await h.setProject({ repoUrl: 'https://github.com/acme/billing' });
    const t = await issueTicket({ prNumber: 12 });
    await notifier.onRaised(await raise(t.id));
    expect(github.comments.map((c) => c.number)).toContain(12);
    expect(thread()).toHaveLength(1);
  });

  it('a GitHub problem is only noted', async () => {
    const t = await issueTicket();
    github.failComments = new Error('gh: HTTP 502');
    await expect(notifier.onRaised(await raise(t.id))).resolves.toBeUndefined();
    expect((await h.prisma.event.findMany({ where: { ticketId: t.id, level: 'warn' } })).map((e) => e.message)).toEqual(expect.arrayContaining([expect.stringContaining('could not be posted to GitHub')]));
  });
});
