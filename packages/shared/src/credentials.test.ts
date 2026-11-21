import { describe, expect, it } from 'vitest';
import { CREDENTIAL_KEYS, CredentialValueSchemas, type CredentialKey } from './credentials';

const cases: Record<CredentialKey, { ok: string; bad: string }> = {
  anthropic_api_key: { ok: 'sk-ant-api03-abcdefghijkl', bad: 'abc' },
  github_token: { ok: 'ghp_abcdefghijklmnopqrstu', bad: 'ghp_short' },
  broker_url: { ok: 'https://broker.example.com', bad: 'http://broker.example.com' },
  broker_key: { ok: 'abcdef0123456789.abcdefghijklmnopqrstuvwxyz', bad: 'short' },
  git_author_name: { ok: 'Dev Bot', bad: '' },
  git_author_email: { ok: 'bot@example.com', bad: 'not-an-email' },
  jira_base_url: { ok: 'https://acme.atlassian.net', bad: 'https://evil.example.com' },
  jira_email: { ok: 'me@example.com', bad: 'me' },
  jira_api_token: { ok: 'x'.repeat(24), bad: 'short' },
  jira_mcp_url: { ok: 'https://mcp.atlassian.com/v2/mcp', bad: 'http://mcp.atlassian.com/v2/mcp' },
  jira_mcp_token: { ok: 'y'.repeat(24), bad: 'short' },
  jira_mcp_oauth: { ok: JSON.stringify({ clientId: 'c', tokenEndpoint: 'https://auth.example/token', resource: 'https://mcp.example', accessToken: 'a', refreshToken: 'r', expiresAt: 0 }), bad: '{"clientId":"c"}' },
  jira_cloud_id: { ok: '1324a887-45db-1bf4-1e99-ef0ff456d421', bad: 'acme' },
};

describe('credential schemas', () => {
  for (const { key } of CREDENTIAL_KEYS) {
    it(`${key}: accepts a valid value and rejects an invalid one`, () => {
      expect(CredentialValueSchemas[key].safeParse(cases[key].ok).success).toBe(true);
      expect(CredentialValueSchemas[key].safeParse(cases[key].bad).success).toBe(false);
    });
  }
  it('rejects a Claude subscription token in the API key field, with a message that says so', () => {
    const r = CredentialValueSchemas.anthropic_api_key.safeParse('sk-ant-oat01-abcdefghijkl');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/subscription token/);
  });
  it('also accepts github_pat_ tokens and rejects other Jira hosts with a path', () => {
    expect(CredentialValueSchemas.github_token.safeParse('github_pat_abcdefghijklmnopqrstu').success).toBe(true);
    expect(CredentialValueSchemas.jira_base_url.safeParse('https://acme.atlassian.net.evil.io').success).toBe(false);
  });
});
