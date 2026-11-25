import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_POLICY, classifyClaudeError, describeError, errorSourceOf, isNetworkErrorText, nextBackoffMin } from './error-policy';

describe('error policy table', () => {
  it.each(ERROR_CODES)('%s has a source, a message and an action', (code) => {
    const p = ERROR_POLICY[code];
    expect(p.message.length).toBeGreaterThan(5);
    expect(p.action.length).toBeGreaterThan(5);
    expect(['claude', 'agent', 'workspace', 'integration', 'user']).toContain(errorSourceOf(code));
  });

  it('fills placeholders and drops empty ones', () => {
    expect(describeError('CLAUDE_RATE_LIMIT', { n: 1, time: '14:32' })).toBe('Anthropic rate limit reached. Retry 1/3 at 14:32.');
    expect(describeError('SPEND_BUDGET_REACHED', { period: 'daily', budget: 10, time: '00:00' })).toBe('The daily budget of 10 credits is used up. Resuming at 00:00.');
    expect(describeError('CLAUDE_API_ERROR', { detail: '529', n: 1, time: '14:32' })).toBe('Claude API error (529). Retry 1/3 at 14:32.');
    expect(describeError('TURN_LIMIT', { agent: 'coder' })).toBe('coder ran out of turns.');
    expect(describeError('GIT_ERROR', { detail: 'push rejected' })).toBe('Git failed: push rejected.');
  });

  it('retries the Claude API error three times with 1, 4 and 10 minutes, then stops', () => {
    expect([1, 2, 3, 4].map((n) => nextBackoffMin('CLAUDE_API_ERROR', n))).toEqual([1, 4, 10, null]);
    expect(nextBackoffMin('TURN_LIMIT', 1)).toBe(0);
    expect(nextBackoffMin('TURN_LIMIT', 2)).toBeNull();
    expect(nextBackoffMin('CLAUDE_AUTH', 1)).toBeNull();
  });

  it('recovery rules follow the error policy table', () => {
    expect(ERROR_POLICY.CLAUDE_AUTH.recovery.kind).toBe('pause_global');
    expect(ERROR_POLICY.CLAUDE_RATE_LIMIT.recovery).toMatchObject({ kind: 'retry', retries: 3, backoffMin: [1, 2, 5], then: 'hold' });
    expect(ERROR_POLICY.CLAUDE_CREDITS.recovery.kind).toBe('pause_global');
    expect(ERROR_POLICY.SPEND_BUDGET_REACHED.recovery.kind).toBe('pause_until_reset');
    expect(ERROR_POLICY.CONTAINER_ERROR.recovery).toMatchObject({ kind: 'retry', retries: 1, then: 'fail' });
    expect(ERROR_POLICY.TIMEOUT.recovery).toMatchObject({ kind: 'retry', retries: 1, then: 'fail' });
    expect(ERROR_POLICY.TURN_LIMIT.recovery).toMatchObject({ turnFactor: 1.5 });
    expect(ERROR_POLICY.INVALID_OUTPUT.recovery).toMatchObject({ withErrors: true });
    expect(ERROR_POLICY.JIRA_ERROR.recovery.kind).toBe('retry_never_block');
    expect(ERROR_POLICY.CONFLUENCE_ERROR.recovery.kind).toBe('retry_never_block');
    expect(ERROR_POLICY.KILLED.recovery.kind).toBe('none');
  });
});

describe('classifyClaudeError', () => {
  it.each([
    ['Invalid bearer token', undefined, 'CLAUDE_AUTH'],
    ['OAuth token has expired', undefined, 'CLAUDE_AUTH'],
    ['anything', 401, 'CLAUDE_AUTH'],
    ['Your credit balance is too low to access the Anthropic API.', 400, 'CLAUDE_CREDITS'],
    ['rate limit exceeded', undefined, 'CLAUDE_RATE_LIMIT'],
    ['anything', 429, 'CLAUDE_RATE_LIMIT'],
    ['API Error: 529 overloaded_error', undefined, 'CLAUDE_API_ERROR'],
    ['anything', 503, 'CLAUDE_API_ERROR'],
    ['read ECONNRESET', undefined, 'NETWORK_ERROR'],
    ['getaddrinfo ENOTFOUND api.anthropic.com', undefined, 'NETWORK_ERROR'],
    ['API Error: fetch failed', undefined, 'NETWORK_ERROR'],
    ['Prompt is too long', undefined, 'CLAUDE_CONTEXT_TOO_LONG'],
  ] as const)('%s (%s) -> %s', (text, status, code) => {
    expect(classifyClaudeError(text, status)).toBe(code);
  });
  it('returns null for text that is not a Claude-side failure', () => {
    expect(classifyClaudeError('The stage exited with code 1')).toBeNull();
    expect(classifyClaudeError('')).toBeNull();
  });
});

describe('isNetworkErrorText', () => {
  it.each([
    "fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com",
    'connect ETIMEDOUT 140.82.112.3:443',
    'getaddrinfo EAI_AGAIN api.github.com',
    'Temporary failure in name resolution',
    'fatal: the remote end hung up unexpectedly',
    'Network is unreachable',
    'socket hang up',
  ])('is a lost connection: %s', (text) => expect(isNetworkErrorText(text)).toBe(true));

  it.each([
    'remote: Permission to a/b.git denied to someone.',
    'fatal: Authentication failed for https://github.com/a/b.git',
    'error: failed to push some refs (non-fast-forward)',
    'HTTP 404 Not Found',
    'Tests still fail after 3 fix rounds',
    '',
  ])('is not: %s', (text) => expect(isNetworkErrorText(text)).toBe(false));

  it('is not for nothing', () => {
    expect(isNetworkErrorText(null)).toBe(false);
    expect(isNetworkErrorText(undefined)).toBe(false);
  });
});

describe('NETWORK_ERROR policy', () => {
  it('is retried until the connection is back, and needs nothing from the person', () => {
    expect(ERROR_POLICY.NETWORK_ERROR.recovery.kind).toBe('retry_until_online');
    expect(nextBackoffMin('NETWORK_ERROR', 1)).toBeNull(); // it does not use the retries of the runner
  });
});
