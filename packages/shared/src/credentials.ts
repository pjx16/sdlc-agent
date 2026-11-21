import { z } from 'zod';

/** Credentials that can be entered in the dashboard (SETUP_WIZARD_PLAN). An env var, when set, always wins over the stored value. */
export const CREDENTIAL_KEYS = [
  { key: 'anthropic_api_key', env: 'ANTHROPIC_API_KEY', secret: true, required: true, label: 'Anthropic API key' },
  { key: 'github_token', env: 'GITHUB_TOKEN', secret: true, required: true, label: 'GitHub token' },
  { key: 'broker_url', env: 'BROKER_URL', secret: false, required: false, label: 'sdlc-agent-bot broker URL' },
  { key: 'broker_key', env: 'BROKER_KEY', secret: true, required: false, label: 'sdlc-agent-bot broker key' },
  { key: 'git_author_name', env: 'GIT_AUTHOR_NAME', secret: false, required: true, label: 'Git author name' },
  { key: 'git_author_email', env: 'GIT_AUTHOR_EMAIL', secret: false, required: true, label: 'Git author email' },
  { key: 'jira_base_url', env: 'JIRA_BASE_URL', secret: false, required: false, label: 'Jira base URL' },
  { key: 'jira_email', env: 'JIRA_EMAIL', secret: false, required: false, label: 'Jira email' },
  { key: 'jira_api_token', env: 'JIRA_API_TOKEN', secret: true, required: false, label: 'Jira API token' },
  // Rovo MCP mode: the server URL, and either an OAuth sign-in (stored by the dashboard's "Connect" flow) or a scoped API token used with the Jira email.
  { key: 'jira_mcp_url', env: 'JIRA_MCP_URL', secret: false, required: false, label: 'Rovo MCP server URL' },
  { key: 'jira_mcp_token', env: 'JIRA_MCP_TOKEN', secret: true, required: false, label: 'Rovo MCP scoped API token' },
  { key: 'jira_mcp_oauth', env: 'JIRA_MCP_OAUTH', secret: true, required: false, label: 'Rovo MCP OAuth sign-in' },
  { key: 'jira_cloud_id', env: 'JIRA_CLOUD_ID', secret: false, required: false, label: 'Atlassian cloud ID' },
] as const;

/** The Rovo MCP server used when no URL is set. */
export const DEFAULT_JIRA_MCP_URL = 'https://mcp.atlassian.com/v2/mcp';

/** What the OAuth "Connect" flow stores in `jira_mcp_oauth` (encrypted, as JSON). */
export interface JiraMcpOAuthGrant {
  clientId: string;
  tokenEndpoint: string;
  /** The MCP server URL the token was issued for (the OAuth `resource`). */
  resource: string;
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds; 0 when the server gave no expiry. */
  expiresAt: number;
}

export type CredentialKey = (typeof CREDENTIAL_KEYS)[number]['key'];
export type CredentialDefinition = (typeof CREDENTIAL_KEYS)[number];

export const credentialDefinition = (key: string): CredentialDefinition | undefined => CREDENTIAL_KEYS.find((c) => c.key === key);

export const CredentialValueSchemas: Record<CredentialKey, z.ZodType<string>> = {
  anthropic_api_key: z
    .string()
    .trim()
    .refine((v) => !v.startsWith('sk-ant-oat'), 'this is a Claude subscription token; paste an Anthropic API key (sk-ant-api…) from the Anthropic Console')
    .refine((v) => /^sk-ant-api\d*-[A-Za-z0-9_-]{8,}$/.test(v), 'must be an Anthropic API key (starts with sk-ant-api)'),
  github_token: z.string().trim().regex(/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/, 'must be a GitHub personal access token'),
  broker_url: z.string().trim().regex(/^https:\/\/[^\s/]+(\/\S*)?$/, 'must be an https URL').transform((v) => v.replace(/\/+$/, '')),
  broker_key: z.string().trim().regex(/^[a-f0-9]{16}\.[A-Za-z0-9_-]{20,}$/, 'must be a broker key'),
  git_author_name: z.string().trim().min(1, 'required').max(100, 'must be at most 100 characters'),
  git_author_email: z.string().trim().email('must be an email address'),
  jira_base_url: z.string().trim().regex(/^https:\/\/[a-z0-9-]+\.atlassian\.net\/?$/, 'must be a Jira Cloud URL like https://acme.atlassian.net'),
  jira_email: z.string().trim().email('must be an email address'),
  jira_api_token: z.string().trim().min(20, 'must be at least 20 characters').max(500, 'must be at most 500 characters'),
  jira_mcp_url: z.string().trim().regex(/^https:\/\/[^\s/]+(\/\S*)?$/, 'must be an https URL').transform((v) => v.replace(/\/+$/, '')),
  jira_mcp_token: z.string().trim().min(20, 'must be at least 20 characters').max(500, 'must be at most 500 characters'),
  jira_mcp_oauth: z.string().trim().refine((v) => {
    try {
      const g = JSON.parse(v) as Partial<JiraMcpOAuthGrant>;
      return typeof g.clientId === 'string' && typeof g.tokenEndpoint === 'string' && typeof g.accessToken === 'string';
    } catch {
      return false;
    }
  }, 'must be the JSON the Connect flow stores; use Connect in the dashboard'),
  jira_cloud_id: z.string().trim().regex(/^[0-9a-f-]{36}$/i, 'must be a cloud ID (a UUID)'),
};

export const CredentialValueBodySchema = z.object({ value: z.string() }).strict();

export interface CredentialView {
  key: CredentialKey;
  source: 'env' | 'db' | 'unset';
  /** Last 4 characters for secrets, the full value for non-secrets. */
  hint: string | null;
  verifiedAt: string | null;
  verifyError: string | null;
  updatedAt: string | null;
}

export interface SetupStatus {
  adminCreated: boolean;
  ready: boolean;
  missing: CredentialKey[];
  encryptionKeyOk: boolean;
  /** True when DASHBOARD_PASSWORD in .env sets the password: the admin step and password change are disabled. */
  passwordFromEnv: boolean;
}

export const SetupAdminBodySchema = z.object({ setupCode: z.string().min(1), password: z.string().min(12, 'must be at least 12 characters').max(256) }).strict();
export const ChangePasswordBodySchema = z.object({ current: z.string().min(1), next: z.string().min(12, 'must be at least 12 characters').max(256) }).strict();
