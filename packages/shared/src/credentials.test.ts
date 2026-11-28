import { describe, expect, it } from 'vitest';
import { CREDENTIAL_KEYS, CredentialValueSchemas, type CredentialKey } from './credentials';

const cases: Record<CredentialKey, { ok: string; bad: string }> = {
  anthropic_api_key: { ok: 'sk-ant-api03-abcdefghijkl', bad: 'abc' },
  github_token: { ok: 'ghp_abcdefghijklmnopqrstu', bad: 'ghp_short' },
  broker_url: { ok: 'https://broker.example.com', bad: 'http://broker.example.com' },
  broker_key: { ok: 'abcdef0123456789.abcdefghijklmnopqrstuvwxyz', bad: 'short' },
  git_author_name: { ok: 'Dev Bot', bad: '' },
  git_author_email: { ok: 'bot@example.com', bad: 'not-an-email' },
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
  it('also accepts github_pat_ tokens', () => {
    expect(CredentialValueSchemas.github_token.safeParse('github_pat_abcdefghijklmnopqrstu').success).toBe(true);
  });
});
