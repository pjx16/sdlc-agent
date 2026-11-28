import { describe, expect, it } from 'vitest';
import { GitError, GitRunner } from './git-runner';

describe('GitRunner abort', () => {
  const git = new GitRunner({ token: async () => 'tok' });

  it('does not start git when the signal is already aborted', async () => {
    const started = Date.now();
    const err = await git.run(['--version'], { signal: AbortSignal.abort() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).message).toBe('git was stopped');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('stops a running git process when aborted', async () => {
    // `git hash-object --stdin` waits for input forever, so only the abort can end it.
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    const started = Date.now();
    const err = await git.run(['hash-object', '--stdin'], { signal: ctrl.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).message).toBe('git was stopped');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('behaves as before without a signal', async () => {
    expect((await git.out(['--version'])).startsWith('git version')).toBe(true);
  });
});
