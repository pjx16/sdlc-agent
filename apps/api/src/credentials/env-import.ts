import { type CredentialKey } from '@sdlc/shared';

/**
 * The environment variables that older installs used for the credentials. Nothing reads them any more except `importCredentialsFromEnv`,
 * once, to move an existing install's values into the dashboard (its database) when it starts. Delete this file when no install can still be
 * older than that.
 */
export const LEGACY_CREDENTIAL_ENV: Record<CredentialKey, string> = {
  anthropic_api_key: 'ANTHROPIC_API_KEY',
  github_token: 'GITHUB_TOKEN',
  broker_url: 'BROKER_URL',
  broker_key: 'BROKER_KEY',
  git_author_name: 'GIT_AUTHOR_NAME',
  git_author_email: 'GIT_AUTHOR_EMAIL',
  jira_base_url: 'JIRA_BASE_URL',
  jira_email: 'JIRA_EMAIL',
  jira_api_token: 'JIRA_API_TOKEN',
  jira_mcp_url: 'JIRA_MCP_URL',
  jira_mcp_token: 'JIRA_MCP_TOKEN',
  jira_mcp_oauth: 'JIRA_MCP_OAUTH',
  jira_cloud_id: 'JIRA_CLOUD_ID',
};

/** The legacy variables that are set (non-empty) in this environment. */
export function legacyValues(env: NodeJS.ProcessEnv = process.env): { key: CredentialKey; envName: string; value: string }[] {
  return (Object.entries(LEGACY_CREDENTIAL_ENV) as [CredentialKey, string][]).flatMap(([key, envName]) => {
    const value = (env[envName] ?? '').trim();
    return value ? [{ key, envName, value }] : [];
  });
}
