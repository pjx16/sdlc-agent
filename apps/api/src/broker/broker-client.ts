import { Injectable } from '@nestjs/common';
import { CredentialsService } from '../credentials/credentials.service';

export interface BrokerToken {
  token: string;
  expiresAt: string;
  /** The name and e-mail commits made as the bot carry. */
  identity: { name: string; email: string } | null;
}

export class BrokerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BrokerError';
  }
}

/** The default broker. A deployment can point to its own with BROKER_URL or the setting. */
export const DEFAULT_BROKER_URL = 'https://broker.sdlc-agent.dev';

/**
 * Talks to the token broker: connects this system (registers it and sends the person to GitHub to install the sdlc-agent App) and asks for
 * short-lived, repository-scoped tokens, so no personal access token is needed.
 */
@Injectable()
export class BrokerClient {
  /** Replaced in tests. */
  fetchImpl: typeof fetch = fetch;

  constructor(private readonly creds: CredentialsService) {}

  private async base(): Promise<string> {
    return ((await this.creds.resolve()).broker_url || process.env.BROKER_URL || DEFAULT_BROKER_URL).replace(/\/+$/, '');
  }

  /** True when this system has been registered with the broker. */
  async isConnected(): Promise<boolean> {
    return Boolean((await this.creds.resolve()).broker_key);
  }

  private async call<T>(method: string, path: string, opts: { key?: string | null; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const res = await this.fetchImpl(`${await this.base()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}), ...opts.headers },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as { error?: string }) : {};
    if (!res.ok) throw new BrokerError(json.error ?? `The broker answered ${res.status}`, res.status);
    return json as T;
  }

  /** A token for one repository (`owner/name`) through the broker. */
  async token(repo: string): Promise<BrokerToken> {
    const key = (await this.creds.resolve()).broker_key;
    if (!key) throw new BrokerError('This system is not connected to sdlc-agent-bot yet: open Settings → Connections and connect it', 0);
    return this.call<BrokerToken>('POST', '/v1/token', { key, body: { repo } });
  }

  /** Registers this system with the broker, once, and returns the key to save. */
  register(): Promise<{ key: string }> {
    // A private broker may require a registration secret (BROKER_REGISTRATION_SECRET on both sides).
    const secret = process.env.BROKER_REGISTRATION_SECRET?.trim();
    return this.call('POST', '/v1/clients', secret ? { headers: { 'X-Registration-Secret': secret } } : {});
  }

  /** The GitHub page where the person installs the App. */
  async startInstall(): Promise<{ url: string }> {
    const key = (await this.creds.resolve()).broker_key;
    if (!key) throw new BrokerError('Register this system with the broker first', 0);
    return this.call('POST', '/v1/install/start', { key });
  }

  /** Finishes the connection with the code the person saw on the page after installing the App. */
  async confirmInstall(code: string): Promise<{ account: string }> {
    const key = (await this.creds.resolve()).broker_key;
    if (!key) throw new BrokerError('Register this system with the broker first', 0);
    return this.call('POST', '/v1/install/confirm', { key, body: { code } });
  }

  async installations(): Promise<{ installations: { id: number; account: string }[] }> {
    const key = (await this.creds.resolve()).broker_key;
    if (!key) return { installations: [] };
    return this.call('GET', '/v1/installations', { key });
  }
}
