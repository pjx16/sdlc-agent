import { Injectable } from '@nestjs/common';
import { CredentialValueSchemas, type CredentialKey } from '@sdlc/shared';
import { JiraClients } from '../jira/jira-clients';
import { CredentialsService } from './credentials.service';

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface TesterOptions {
  githubApiUrl?: string;
  /** Where the Anthropic API is reached: LLM_GATEWAY_UPSTREAM, the same upstream the worker's LLM gateway uses. */
  anthropicApiUrl?: string;
  fetch?: typeof fetch;
  /** What the Rovo MCP sign-in can see; tests replace it. */
  describeMcp?: () => Promise<{ cloudId: string; site: string | null; tools: string[] }>;
}

export const TESTER_OPTIONS = Symbol('TESTER_OPTIONS');

const TIMEOUT_MS = 10_000;

/** Connection tests run in the API (it has outbound internet). */
@Injectable()
export class CredentialTester {
  private readonly githubApi: string;
  private readonly anthropicApi: string;
  private readonly fetchImpl: typeof fetch;
  private readonly describeMcp: NonNullable<TesterOptions['describeMcp']>;

  constructor(
    private readonly creds: CredentialsService,
    options: TesterOptions = {},
  ) {
    this.githubApi = (options.githubApiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.anthropicApi = (options.anthropicApiUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    // A fresh client each time: the test must use the credentials as they are now.
    this.describeMcp = options.describeMcp ?? (async () => (await new JiraClients(this.creds).mcpClient()).describe());
  }

  async test(key: CredentialKey): Promise<TestResult> {
    const result = await this.run(key).catch((err): TestResult => ({ ok: false, message: `Could not reach the service: ${err instanceof Error ? err.message : String(err)}` }));
    // Only the stored value carries a verification state; an env value has no row, so this is a no-op for it.
    await this.creds.markVerified(key, result.ok ? null : result.message);
    return result;
  }

  private get(url: string, headers: Record<string, string>): Promise<Response> {
    return this.fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  private async run(key: CredentialKey): Promise<TestResult> {
    const c = await this.creds.resolve();
    switch (key) {
      case 'github_token': {
        const token = c.github_token;
        if (!token) return { ok: false, message: 'No GitHub token is set' };
        const res = await this.get(`${this.githubApi}/user`, {
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'sdlc-agent',
          Accept: 'application/vnd.github+json',
        });
        if (res.status === 200) return { ok: true, message: `Connected as ${((await res.json()) as { login?: string }).login ?? 'unknown'}` };
        if (res.status === 401) return { ok: false, message: 'GitHub rejected the token' };
        return { ok: false, message: `GitHub answered ${res.status}` };
      }
      case 'jira_base_url':
      case 'jira_email':
      case 'jira_api_token': {
        if (!c.jira_base_url || !c.jira_email || !c.jira_api_token) return { ok: false, message: 'Set the Jira base URL, email and API token first' };
        const res = await this.get(`${c.jira_base_url.replace(/\/+$/, '')}/rest/api/3/myself`, {
          Authorization: `Basic ${Buffer.from(`${c.jira_email}:${c.jira_api_token}`).toString('base64')}`,
          Accept: 'application/json',
        });
        if (res.status === 200) {
          return { ok: true, message: `Connected as ${((await res.json()) as { displayName?: string }).displayName ?? 'unknown'}` };
        }
        if (res.status === 401 || res.status === 403) return { ok: false, message: 'Jira rejected the credentials' };
        return { ok: false, message: `Jira answered ${res.status}` };
      }
      case 'anthropic_api_key': {
        if (!c.anthropic_api_key) return { ok: false, message: 'No Anthropic API key is set' };
        if (!CredentialValueSchemas.anthropic_api_key.safeParse(c.anthropic_api_key).success) return { ok: false, message: 'The value does not look like an Anthropic API key' };
        // Listing the models is free and needs only a valid key.
        const res = await this.get(`${this.anthropicApi}/v1/models?limit=1`, { 'x-api-key': c.anthropic_api_key, 'anthropic-version': '2023-06-01', Accept: 'application/json' });
        if (res.ok) return { ok: true, message: 'Anthropic accepted the API key' };
        if (res.status === 401 || res.status === 403) return { ok: false, message: 'Anthropic rejected the API key' };
        return { ok: false, message: `Anthropic answered ${res.status}` };
      }
      case 'broker_url':
      case 'broker_key': {
        if (!c.broker_url || !c.broker_key) return { ok: false, message: 'Set the broker URL and the broker key first' };
        const res = await this.get(`${c.broker_url.replace(/\/+$/, '')}/v1/installations`, { Authorization: `Bearer ${c.broker_key}`, Accept: 'application/json' });
        if (res.status === 200) {
          const n = ((await res.json()) as { installations?: unknown[] }).installations?.length ?? 0;
          return { ok: true, message: n > 0 ? `Connected to the broker; ${n} GitHub installation${n === 1 ? '' : 's'}` : 'Connected to the broker; the GitHub App is not installed yet' };
        }
        return res.status === 401 ? { ok: false, message: 'The broker does not know this key' } : { ok: false, message: `The broker answered ${res.status}` };
      }
      case 'jira_mcp_url':
      case 'jira_mcp_token':
      case 'jira_mcp_oauth':
      case 'jira_cloud_id': {
        if (!c.jira_mcp_oauth && !(c.jira_email && c.jira_mcp_token)) return { ok: false, message: 'Connect with OAuth, or set the Jira email and a scoped Rovo MCP API token first' };
        try {
          const seen = await this.describeMcp();
          const jiraTools = seen.tools.filter((t) => /jira/i.test(t)).length;
          return { ok: true, message: `Connected to ${seen.site ?? `cloud ${seen.cloudId}`} through the Rovo MCP server (${jiraTools} Jira tools)` };
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'git_author_name':
      case 'git_author_email':
        return CredentialValueSchemas[key].safeParse(c[key]).success ? { ok: true, message: 'OK' } : { ok: false, message: 'Not set or invalid' };
    }
  }
}
