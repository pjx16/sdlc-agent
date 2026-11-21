import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_JIRA_MCP_URL, type JiraMcpOAuthGrant } from '@sdlc/shared';
import { CredentialsService, type ResolvedCredentials } from '../credentials/credentials.service';
import type { JiraClient } from './jira-client';
import { JiraMcpClient } from './jira-mcp-client';
import { JiraRestClient } from './jira-rest-client';
import { OAuthGrantAuth, basicAuth } from './mcp-auth';
import { McpSession, type McpAuth } from './mcp-session';

const REST_MISSING = 'Jira is not configured: add the Jira base URL, email and API token in the dashboard (Settings → Connections) or set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN';
const MCP_MISSING = 'The Rovo MCP connection is not configured: use Connect in Settings → Connections (OAuth), or set the Jira email and a scoped Rovo MCP API token';

/** The credentials a project's Jira mode needs are missing. */
export class JiraNotConfiguredError extends Error {
  constructor(message = REST_MISSING) {
    super(message);
    this.name = 'JiraNotConfiguredError';
  }
}

/** Gives out the Jira client for a mode, rebuilt whenever its credentials change. Tests replace this provider with a fake. */
@Injectable()
export class JiraClients {
  private readonly logger = new Logger(JiraClients.name);
  private readonly cache = new Map<string, { key: string; client: JiraClient }>();
  /** Connector mode runs Claude agents, which only the worker can start: the worker module plugs its client in here. */
  private connector: JiraClient | null = null;

  constructor(private readonly creds: CredentialsService) {}

  /** The client for a project's `jiraMode`. */
  async forMode(mode: string = 'rest'): Promise<JiraClient> {
    if (mode === 'mcp') return this.forMcp();
    if (mode === 'rest') return this.forRest();
    if (mode === 'connector') {
      if (!this.connector) throw new JiraNotConfiguredError('The Claude Jira connector runs in the worker only; this step needs the worker');
      return this.connector;
    }
    throw new JiraNotConfiguredError(`Jira mode "${mode}" has no client here`);
  }

  useConnector(client: JiraClient): void {
    this.connector = client;
  }

  async forRest(): Promise<JiraClient> {
    const c = await this.creds.resolve();
    return this.cached('rest', [c.jira_base_url, c.jira_email, c.jira_api_token], () => {
      if (!c.jira_base_url || !c.jira_email || !c.jira_api_token) throw new JiraNotConfiguredError();
      return JiraRestClient.fromCredentials(c);
    });
  }

  async forMcp(): Promise<JiraClient> {
    return this.mcpClient();
  }

  /** The Rovo MCP client itself, for the connection test (it can describe what the sign-in sees). */
  async mcpClient(): Promise<JiraMcpClient> {
    const c = await this.creds.resolve();
    const client = this.cached('mcp', [c.jira_mcp_url, c.jira_mcp_oauth, c.jira_email, c.jira_mcp_token, c.jira_cloud_id, c.jira_base_url], () => {
      const url = c.jira_mcp_url || DEFAULT_JIRA_MCP_URL;
      return new JiraMcpClient(new McpSession(url, this.mcpAuth(c)), { cloudId: c.jira_cloud_id || undefined, siteUrl: c.jira_base_url || undefined });
    });
    return client as JiraMcpClient;
  }

  /** An OAuth sign-in wins over a scoped token. */
  private mcpAuth(c: ResolvedCredentials): McpAuth {
    if (c.jira_mcp_oauth) {
      const grant = JSON.parse(c.jira_mcp_oauth) as JiraMcpOAuthGrant;
      return new OAuthGrantAuth(grant, async (next) => {
        // Rotated refresh tokens must be kept, or the next refresh fails and Jira has to be connected again.
        await this.creds.set('jira_mcp_oauth', JSON.stringify(next)).catch((err: unknown) => this.logger.warn(`Could not save the refreshed Rovo MCP sign-in: ${err instanceof Error ? err.message : String(err)}`));
      });
    }
    if (c.jira_email && c.jira_mcp_token) return basicAuth(c.jira_email, c.jira_mcp_token);
    throw new JiraNotConfiguredError(MCP_MISSING);
  }

  private cached(mode: string, parts: string[], build: () => JiraClient): JiraClient {
    const key = parts.join('\n');
    const hit = this.cache.get(mode);
    if (hit && hit.key === key) return hit.client;
    const client = build();
    this.cache.set(mode, { key, client });
    return client;
  }
}
