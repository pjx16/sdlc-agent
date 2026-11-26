import type { CredentialKey, CredentialView } from '@sdlc/shared';
import { describe, expect, it } from 'vitest';
import { isSet, isVerified, setupProgress } from './setup-progress';

const view = (key: CredentialKey, over: Partial<CredentialView> = {}): CredentialView => ({ key, source: 'db', hint: 'abcd', verifiedAt: '2026-11-26T10:00:00Z', verifyError: null, updatedAt: null, ...over });
const unset = (key: CredentialKey): CredentialView => view(key, { source: 'unset', hint: null, verifiedAt: null });
const map = (...vs: CredentialView[]) => new Map(vs.map((v) => [v.key, v]));
const none = map(unset('github_token'), unset('git_author_name'), unset('git_author_email'), unset('anthropic_api_key'));
const bot = (n: number) => ({ connected: n > 0, installations: Array.from({ length: n }, (_, i) => ({ id: i + 1, account: `acct${i}` })) });

describe('isSet and isVerified', () => {
  it('set is saved; verified is saved, tested with success and not refused since', () => {
    expect(isSet(undefined)).toBe(false);
    expect(isSet(unset('github_token'))).toBe(false);
    expect(isSet(view('github_token', { verifiedAt: null }))).toBe(true);
    expect(isVerified(view('github_token'))).toBe(true);
    expect(isVerified(view('github_token', { verifiedAt: null }))).toBe(false); // saved, never tested
    expect(isVerified(view('github_token', { verifyError: 'GitHub rejected the token' }))).toBe(false);
    expect(isVerified(unset('github_token'))).toBe(false);
    expect(isVerified(undefined)).toBe(false);
  });
});

describe('setupProgress', () => {
  it('nothing done: nothing is ready', () => {
    expect(setupProgress(none, null, false)).toMatchObject({ githubAccess: false, identity: false, signing: false, anthropic: false, ready: false });
  });

  it('GitHub access is a working personal token, or the bot installed: either is enough', () => {
    expect(setupProgress(map(view('github_token')), null, false).githubAccess).toBe(true);
    expect(setupProgress(map(view('github_token', { verifiedAt: null })), null, false).githubAccess).toBe(false);
    expect(setupProgress(none, bot(1), false).githubAccess).toBe(true);
    expect(setupProgress(none, bot(0), false).githubAccess).toBe(false); // registered, App not installed yet
  });

  it('the identity needs both the name and the email', () => {
    expect(setupProgress(map(view('git_author_name')), null, false).identity).toBe(false);
    expect(setupProgress(map(view('git_author_name'), view('git_author_email')), null, false).identity).toBe(true);
  });

  it('with only the bot there is nothing to sign: the signing step is done by itself', () => {
    expect(setupProgress(none, bot(1), false)).toMatchObject({ botOnly: true, signing: true });
    expect(setupProgress(map(view('github_token')), bot(1), false)).toMatchObject({ botOnly: false, signing: false }); // with a token the key is for the account
  });

  it('the signing step is done once the key was checked or confirmed', () => {
    expect(setupProgress(map(view('github_token')), null, true).signing).toBe(true);
  });

  it('ready needs GitHub access, the identity and a tested Anthropic key, but not the signing key', () => {
    const all = map(view('github_token'), view('git_author_name'), view('git_author_email'), view('anthropic_api_key'));
    expect(setupProgress(all, null, false).ready).toBe(true);
    expect(setupProgress(map(view('github_token'), view('git_author_name'), view('git_author_email')), null, true).ready).toBe(false);
    expect(setupProgress(map(view('git_author_name'), view('git_author_email'), view('anthropic_api_key')), bot(1), false).ready).toBe(true);
    expect(setupProgress(map(view('github_token'), view('git_author_email'), view('anthropic_api_key')), null, false).ready).toBe(false);
  });
});
