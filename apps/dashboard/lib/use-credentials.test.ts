import { act, renderHook } from '@testing-library/react';
import type { CredentialKey, CredentialView } from '@sdlc/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialValue, useCredentials } from './use-credentials';

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const view = (key: CredentialKey, over: Partial<CredentialView> = {}): CredentialView => ({ key, source: 'unset', hint: null, verifiedAt: null, verifyError: null, updatedAt: null, ...over });
const views = (...vs: CredentialView[]) => new Map(vs.map((v) => [v.key, v]));
const GITHUB = ['github_token', 'git_author_name', 'git_author_email'] as const;

describe('initialValue', () => {
  it('shows a saved plain value so it can be edited, and never a secret', () => {
    expect(initialValue(view('git_author_name', { source: 'db', hint: 'Ada Lovelace' }), false)).toBe('Ada Lovelace');
    expect(initialValue(view('github_token', { source: 'db', hint: 'abcd' }), true)).toBe('');
    expect(initialValue(view('git_author_name'), false)).toBe('');
  });
});

describe('useCredentials', () => {
  const setup = (onSaved = vi.fn()) =>
    renderHook(() => useCredentials(GITHUB, views(view('github_token'), view('git_author_name', { source: 'db', hint: 'Ada' }), view('git_author_email')), onSaved));

  it('starts with the saved plain values, and nothing changed', () => {
    const { result } = setup();
    expect(result.current.fields.map((f) => f.key)).toEqual(['github_token', 'git_author_name', 'git_author_email']);
    expect(result.current.values).toMatchObject({ github_token: '', git_author_name: 'Ada', git_author_email: '' });
    expect(result.current.changed).toEqual([]);
  });

  it('what is typed is changed; putting the saved value back is not', () => {
    const { result } = setup();
    act(() => result.current.setValue('git_author_name', 'Grace'));
    expect(result.current.changed.map((f) => f.key)).toEqual(['git_author_name']);
    act(() => result.current.setValue('git_author_name', 'Ada'));
    expect(result.current.changed).toEqual([]);
    act(() => result.current.setValue('github_token', '  '));
    expect(result.current.changed).toEqual([]); // blank is nothing
  });

  it('Save sends only the changed values, one request each, and tells the page what was saved', async () => {
    fetchMock.mockImplementation(async (url: string) => reply(view(url.split('/').pop() as CredentialKey, { source: 'db', hint: 'x' })));
    const onSaved = vi.fn();
    const { result } = setup(onSaved);
    act(() => {
      result.current.setValue('github_token', 'ghp_secret');
      result.current.setValue('git_author_email', 'ada@example.com');
    });
    let ok = false;
    await act(async () => void (ok = await result.current.save()));
    expect(ok).toBe(true);
    expect(fetchMock.mock.calls.map(([u, init]) => [u, JSON.parse(String((init as RequestInit).body))])).toEqual([
      ['/api/credentials/github_token', { value: 'ghp_secret' }],
      ['/api/credentials/git_author_email', { value: 'ada@example.com' }],
    ]);
    expect(onSaved).toHaveBeenCalledWith([expect.objectContaining({ key: 'github_token' }), expect.objectContaining({ key: 'git_author_email' })]);
    expect(result.current.message).toBe('Saved 2 values.');
    expect(result.current.values.github_token).toBe(''); // a secret is cleared once saved
  });

  it('a value that is refused shows its message at its field, and the others are still saved', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('github_token') ? reply({ fields: { value: 'must be a GitHub personal access token' } }, 400) : reply(view('git_author_email', { source: 'db', hint: 'a@b.c' }))));
    const { result } = setup();
    act(() => {
      result.current.setValue('github_token', 'nope');
      result.current.setValue('git_author_email', 'a@b.c');
    });
    let ok = true;
    await act(async () => void (ok = await result.current.save()));
    expect(ok).toBe(false);
    expect(result.current.errors).toEqual({ github_token: 'must be a GitHub personal access token' });
    expect(result.current.message).toBeNull();
  });

  it('says when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();
    act(() => result.current.setValue('github_token', 'ghp_x'));
    await act(async () => void (await result.current.save()));
    expect(result.current.errors.github_token).toBe('Cannot reach the server.');
  });

  it('a test reports the result with the time, and a save forgets it', async () => {
    fetchMock.mockResolvedValueOnce(reply({ ok: true, message: 'Connected as octocat' })).mockResolvedValue(reply(view('github_token', { source: 'db' })));
    const { result } = setup();
    let got: unknown;
    await act(async () => void (got = await result.current.runTest('github_token')));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/credentials/github_token/test');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('POST');
    expect(got).toMatchObject({ ok: true, message: 'Connected as octocat' });
    expect(result.current.test).toMatchObject({ ok: true, message: 'Connected as octocat', at: expect.any(String) });
    act(() => result.current.setValue('github_token', 'ghp_new'));
    await act(async () => void (await result.current.save()));
    expect(result.current.test).toBeNull();
  });

  it('a test that cannot run says so', async () => {
    fetchMock.mockResolvedValueOnce(reply({ message: 'The test failed to run.' }, 500)).mockRejectedValueOnce(new Error('offline'));
    const { result } = setup();
    await act(async () => void (await result.current.runTest('github_token')));
    expect(result.current.message).toBe('The test failed to run.');
    await act(async () => void (await result.current.runTest('github_token')));
    expect(result.current.message).toBe('Cannot reach the server.');
    expect(result.current.test).toBeNull();
  });
});
