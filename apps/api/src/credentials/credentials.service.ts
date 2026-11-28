import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { CREDENTIAL_KEYS, CredentialValueSchemas, ErrorCodes, credentialDefinition, type CredentialKey, type CredentialView, type SetupStatus } from '@sdlc/shared';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { legacyValues } from './env-import';
import { CredentialDecryptError, decrypt, encrypt, loadKey } from './crypto';

export type ResolvedCredentials = Record<CredentialKey, string>;

const CACHE_MS = 10_000;
export const UNDECRYPTABLE = 'Cannot decrypt with the current ENCRYPTION_KEY; enter it again';

interface Loaded {
  at: number;
  db: Map<CredentialKey, { value: string; error: string | null }>;
}

/**
 * Where every credential comes from: the database, where secrets are AES-256-GCM encrypted with ENCRYPTION_KEY, then empty. Used by the API
 * and the worker. At start-up an install that still has the old environment variables gets them moved into the database, once.
 */
@Injectable()
export class CredentialsService implements OnModuleInit {
  private readonly logger = new Logger(CredentialsService.name);
  private loaded: Loaded | null = null;
  private secrets: string[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.importFromEnv().catch((err) => this.logger.warn(`Could not move the credentials from the environment: ${err instanceof Error ? err.message : String(err)}`));
    await this.resolve().catch((err) => this.logger.warn(`Could not load credentials: ${err instanceof Error ? err.message : String(err)}`));
  }

  invalidate(): void {
    this.loaded = null;
  }

  private async loadDb(): Promise<Loaded> {
    if (this.loaded && Date.now() - this.loaded.at < CACHE_MS) return this.loaded;
    const rows = await this.prisma.credential.findMany();
    const key = loadKey();
    const db = new Map<CredentialKey, { value: string; error: string | null }>();
    for (const row of rows) {
      if (!credentialDefinition(row.key)) continue;
      if (!row.isSecret) {
        db.set(row.key as CredentialKey, { value: row.value, error: null });
        continue;
      }
      try {
        if (!key) throw new CredentialDecryptError();
        db.set(row.key as CredentialKey, { value: decrypt(key, row.key, row.value), error: null });
      } catch {
        db.set(row.key as CredentialKey, { value: '', error: UNDECRYPTABLE });
      }
    }
    this.loaded = { at: Date.now(), db };
    return this.loaded;
  }

  async resolve(): Promise<ResolvedCredentials> {
    const { db } = await this.loadDb();
    const out = {} as ResolvedCredentials;
    for (const def of CREDENTIAL_KEYS) out[def.key] = db.get(def.key)?.value || '';
    this.secrets = CREDENTIAL_KEYS.filter((d) => d.secret).map((d) => out[d.key]).filter((v) => v.length > 0);
    return out;
  }

  /** Every current secret value, synchronously, for redaction. Refreshed by each resolve(). */
  secretsSnapshot(): string[] {
    return this.secrets;
  }

  async views(): Promise<CredentialView[]> {
    await this.loadDb();
    const rows = new Map((await this.prisma.credential.findMany()).map((r) => [r.key, r]));
    const { db } = await this.loadDb();
    return CREDENTIAL_KEYS.map((def): CredentialView => {
      const row = rows.get(def.key);
      if (!row) return { key: def.key, source: 'unset', hint: null, verifiedAt: null, verifyError: null, updatedAt: null };
      return {
        key: def.key,
        source: 'db',
        hint: row.hint,
        verifiedAt: row.verifiedAt?.toISOString() ?? null,
        verifyError: db.get(def.key)?.error ?? row.verifyError,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async set(key: CredentialKey, raw: string): Promise<void> {
    const def = credentialDefinition(key);
    if (!def) throw new ApiException(HttpStatus.NOT_FOUND, ErrorCodes.notFound, 'Unknown credential');
    const parsed = CredentialValueSchemas[key].safeParse(raw);
    if (!parsed.success) throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCodes.validation, 'Invalid value', { value: parsed.error.issues[0]?.message ?? 'invalid' });
    const value = parsed.data;
    let stored = value;
    if (def.secret) {
      const encryptionKey = loadKey();
      if (!encryptionKey) throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCodes.validation, 'ENCRYPTION_KEY is not set');
      stored = encrypt(encryptionKey, key, value);
    }
    const hint = def.secret ? value.slice(-4) : value;
    const data = { value: stored, isSecret: def.secret, hint, verifiedAt: null, verifyError: null };
    await this.prisma.credential.upsert({ where: { key }, update: data, create: { key, ...data } });
    this.invalidate();
    await this.resolve();
    if (key === 'anthropic_api_key') await this.resumeAfterAuthPause();
  }

  /**
   * An install made when credentials lived in the environment: each variable that is set, and has no value in the dashboard yet, is saved
   * there (validated like anything typed, secrets encrypted), once, and the person is told to take it out of the environment. A value that
   * is already in the dashboard is left alone, and a value that does not pass the checks is skipped with a warning.
   */
  async importFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<number> {
    const present = legacyValues(env);
    if (present.length === 0) return 0;
    const have = new Set((await this.prisma.credential.findMany({ select: { key: true } })).map((r) => r.key));
    let imported = 0;
    for (const { key, envName, value } of present) {
      if (have.has(key)) continue;
      try {
        await this.set(key, value);
        imported++;
        this.logger.warn(`${envName} was moved from the environment into the dashboard (Settings → Connections). Remove it from your environment: it is not read any more.`);
      } catch (err) {
        const why = err instanceof ApiException ? JSON.stringify(err.getResponse()) : err instanceof Error ? err.message : String(err);
        this.logger.warn(`${envName} was not moved into the dashboard (${why}). Enter it in Settings → Connections.`);
      }
    }
    return imported;
  }

  /** A new Anthropic API key replaces the one Claude rejected: the pause that rejection caused ends. */
  private async resumeAfterAuthPause(): Promise<void> {
    const r = await this.prisma.globalSettings.updateMany({ where: { pausedCode: 'CLAUDE_AUTH' }, data: { pipelinePaused: false, pausedReason: null, pausedCode: null, resetsAt: null } });
    if (r.count > 0) await this.prisma.event.create({ data: { type: 'usage', message: 'A new Claude credential was saved: the pipeline resumes' } }).catch(() => undefined);
  }

  async remove(key: CredentialKey): Promise<void> {
    await this.prisma.credential.deleteMany({ where: { key } });
    this.invalidate();
    await this.resolve();
  }

  async markVerified(key: CredentialKey, error: string | null): Promise<void> {
    await this.prisma.credential.updateMany({ where: { key }, data: { verifiedAt: error ? null : new Date(), verifyError: error } });
    this.invalidate();
    if (!error) await this.resolveCredentialTickets(key);
  }

  /** The credential test passed: its support ticket closes by itself. */
  private async resolveCredentialTickets(key: CredentialKey): Promise<void> {
    const group = key === 'anthropic_api_key' ? 'claude' : key === 'github_token' ? 'github' : key.startsWith('jira_') ? 'jira' : null;
    if (!group) return;
    await this.prisma.supportTicket
      .updateMany({ where: { kind: 'credential', status: 'open', dedupeKey: `credential:${group}` }, data: { status: 'resolved', resolvedBy: 'system', resolvedAt: new Date(), response: 'The credential test passed' } })
      .catch(() => undefined);
  }

  async status(): Promise<SetupStatus> {
    const resolved = await this.resolve();
    // A system connected to the broker works as the bot and needs no personal GitHub token.
    const missing = CREDENTIAL_KEYS.filter((d) => d.required && !resolved[d.key] && !(d.key === 'github_token' && resolved.broker_key)).map((d) => d.key);
    const adminCreated = Boolean(process.env.DASHBOARD_PASSWORD?.trim()) || (await this.prisma.adminAccount.count()) > 0;
    const encryptionKeyOk = (() => {
      try {
        return loadKey() !== null;
      } catch {
        return false;
      }
    })();
    return { adminCreated, ready: adminCreated && missing.length === 0, missing, encryptionKeyOk, passwordFromEnv: Boolean(process.env.DASHBOARD_PASSWORD?.trim()) };
  }
}
