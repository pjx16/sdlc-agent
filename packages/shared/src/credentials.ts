import { z } from 'zod';

/** Credentials that can be entered in the dashboard (SETUP_WIZARD_PLAN). An env var, when set, always wins over the stored value. */
export const CREDENTIAL_KEYS = [
  { key: 'anthropic_api_key', env: 'ANTHROPIC_API_KEY', secret: true, required: true, label: 'Anthropic API key' },
  { key: 'github_token', env: 'GITHUB_TOKEN', secret: true, required: true, label: 'GitHub token' },
  { key: 'broker_url', env: 'BROKER_URL', secret: false, required: false, label: 'sdlc-agent-bot broker URL' },
  { key: 'broker_key', env: 'BROKER_KEY', secret: true, required: false, label: 'sdlc-agent-bot broker key' },
  { key: 'git_author_name', env: 'GIT_AUTHOR_NAME', secret: false, required: true, label: 'Git author name' },
  { key: 'git_author_email', env: 'GIT_AUTHOR_EMAIL', secret: false, required: true, label: 'Git author email' },
] as const;

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
