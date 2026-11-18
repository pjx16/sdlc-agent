import { describe, expect, it } from 'vitest';
import { GitRunner } from './git-runner';

describe('GitRunner token per call', () => {
  it('tells the token source which folder and arguments the call has, so it can pick the repository\'s token', async () => {
    const seen: { cwd?: string; args: readonly string[] }[] = [];
    const git = new GitRunner({ token: async (ctx) => (seen.push(ctx), 'tok') });
    await git.run(['--version'], { cwd: process.cwd() });
    expect(seen).toEqual([{ cwd: process.cwd(), args: ['--version'] }]);
  });
});
