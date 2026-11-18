import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GitHubAuth } from './github-auth.service';

const DATA = '/data';
function setup(projects: { id: string; repoUrl: string; githubAuth: string }[]) {
  const prisma = {
    project: {
      findUnique: async ({ where }: { where: { id: string } }) => projects.find((p) => p.id === where.id) ?? null,
      findMany: async ({ where }: { where: { repoUrl: { contains: string } } }) => projects.filter((p) => p.repoUrl.toLowerCase().includes(where.repoUrl.contains.toLowerCase())),
    },
  };
  const creds = { resolve: async () => ({ github_token: 'ghp_personal', git_author_name: 'Me', git_author_email: 'me@example.com' }) };
  let n = 0;
  const broker = { token: vi.fn(async () => ({ token: `ghs_bot_${++n}`, expiresAt: new Date(clock + 60 * 60_000).toISOString(), identity: { name: 'sdlc-agent[bot]', email: '1+sdlc-agent[bot]@users.noreply.github.com' } })) };
  let clock = Date.parse('2026-11-14T12:00:00Z');
  const auth = new GitHubAuth(prisma as never, creds as never, broker as never, { dataDir: DATA } as never);
  auth.now = () => clock;
  return { auth, broker, advance: (ms: number) => (clock += ms) };
}

const BOT = { id: 'p1', repoUrl: 'https://github.com/acme/billing', githubAuth: 'bot' };
const LOOKALIKE = { id: 'p3', repoUrl: 'https://github.com/acme/billing-two', githubAuth: 'bot' };
const OWN = { id: 'p2', repoUrl: 'https://github.com/acme/shop.git', githubAuth: 'token' };

describe('GitHubAuth: which repository a call is about', () => {
  it('reads it from a URL, from -R, from a repos/ API path, and from the folder of the project', async () => {
    const { auth } = setup([BOT, OWN]);
    expect(await auth.repoOf({ args: ['clone', '--mirror', '--', 'https://github.com/acme/billing', '/x'] })).toBe('acme/billing');
    expect(await auth.repoOf({ args: ['push', 'https://github.com/acme/shop.git', 'refs/heads/a:refs/heads/a'] })).toBe('acme/shop');
    expect(await auth.repoOf({ args: ['pr', 'view', '3', '-R', 'acme/billing'] })).toBe('acme/billing');
    expect(await auth.repoOf({ args: ['api', 'repos/acme/billing/check-runs/5'] })).toBe('acme/billing');
    expect(await auth.repoOf({ args: ['status'], cwd: path.join(DATA, 'workspaces', 'p1', 'SDA-7') })).toBe('acme/billing');
    expect(await auth.repoOf({ args: ['--git-dir', '/x', 'show-ref'], cwd: path.join(DATA, 'mirrors', 'p2') })).toBe('acme/shop');
    expect(await auth.repoOf({ args: ['api', 'user'] })).toBeNull();
  });
});

describe('GitHubAuth: exact matching (scan finding L5)', () => {
  it('a repository whose name merely starts like a bot project is not a bot project', async () => {
    const { auth } = setup([LOOKALIKE, OWN]);
    expect(await auth.tokenFor({ args: ['pr', 'list', '-R', 'acme/billing'] })).not.toBe('ghs_bot_1');
  });
  it('text in an argument (such as a PR body quoting another repository) does not pick the repository', async () => {
    const { auth } = setup([BOT, OWN]);
    expect(await auth.repoOf({ args: ['pr', 'create', '--body', 'see https://github.com/evil/repo for details'], cwd: path.join(DATA, 'workspaces', 'p1', 'SDA-7') })).toBe('acme/billing');
    expect(await auth.repoOf({ args: ['pr', 'create', '--body', 'see https://github.com/evil/repo for details'] })).toBeNull();
  });
});

describe('GitHubAuth: which token', () => {
  it('a bot project gets the broker\'s token, kept until five minutes before it expires', async () => {
    const { auth, broker, advance } = setup([BOT, OWN]);
    expect(await auth.tokenFor({ args: ['pr', 'list', '-R', 'acme/billing'] })).toBe('ghs_bot_1');
    expect(await auth.tokenFor({ cwd: path.join(DATA, 'workspaces', 'p1', 'SDA-7'), args: ['fetch'] })).toBe('ghs_bot_1');
    expect(broker.token).toHaveBeenCalledTimes(1);
    advance(56 * 60_000); // under five minutes left
    expect(await auth.tokenFor({ args: ['pr', 'list', '-R', 'acme/billing'] })).toBe('ghs_bot_2');
    expect(broker.token).toHaveBeenCalledTimes(2);
  });

  it('a project with its own token, an unknown repository and a call about no repository use the personal token', async () => {
    const { auth, broker } = setup([BOT, OWN]);
    expect(await auth.tokenFor({ args: ['push', 'https://github.com/acme/shop.git', 'x'] })).toBe('ghp_personal');
    expect(await auth.tokenFor({ args: ['api', 'repos/other/repo'] })).toBe('ghp_personal');
    expect(await auth.tokenFor({ args: ['api', 'user'] })).toBe('ghp_personal');
    expect(broker.token).not.toHaveBeenCalled();
  });

  it('commits as the bot for a bot project and as the person from Settings otherwise', async () => {
    const { auth } = setup([BOT, OWN]);
    expect(await auth.identityFor('acme/billing')).toEqual({ name: 'sdlc-agent[bot]', email: '1+sdlc-agent[bot]@users.noreply.github.com' });
    expect(await auth.identityFor('acme/shop')).toEqual({ name: 'Me', email: 'me@example.com' });
  });
});
