import { describe, expect, it } from 'vitest';
import { CredentialTester } from './credential-tester';
import type { CredentialsService } from './credentials.service';

function make(status = 200) {
  const urls: string[] = [];
  const fetchFake = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ displayName: 'Jira Dev' }), { status });
  }) as unknown as typeof fetch;
  const creds = {
    resolve: async () => ({ jira_base_url: 'https://acme.atlassian.net/', jira_email: 'me@acme.com', jira_api_token: 'tok' }),
    markVerified: async () => undefined,
  } as unknown as CredentialsService;
  return { tester: new CredentialTester(creds, { fetch: fetchFake }), urls };
}

describe('CredentialTester Jira check', () => {
  it('calls Jira only and makes no /wiki/ request', async () => {
    const { tester, urls } = make();
    await tester.test('jira_api_token');
    expect(urls).toEqual(['https://acme.atlassian.net/rest/api/3/myself']);
    expect(urls.some((u) => u.includes('/wiki/'))).toBe(false);
  });

  it('reports the connected user without any Confluence note', async () => {
    const { tester } = make();
    const result = await tester.test('jira_api_token');
    expect(result).toEqual({ ok: true, message: 'Connected as Jira Dev' });
  });

  it('reports a rejection when Jira answers 401', async () => {
    const { tester, urls } = make(401);
    expect(await tester.test('jira_email')).toEqual({ ok: false, message: 'Jira rejected the credentials' });
    expect(urls).toHaveLength(1);
  });
});
