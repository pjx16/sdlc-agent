import { describe, expect, it } from 'vitest';
import { BrokerClient, BrokerError, DEFAULT_BROKER_URL } from './broker-client';

function setup(creds: Record<string, string | undefined>, reply: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = new BrokerClient({ resolve: async () => creds } as never);
  client.fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return reply(url, init);
  }) as never;
  return { client, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('BrokerClient', () => {
  it('asks for a token for one repository with the system key, at the configured broker', async () => {
    const { client, calls } = setup({ broker_url: 'https://broker.example.com/', broker_key: 'abcdef0123456789.secretsecretsecretsecret' }, () => json(200, { token: 'ghs_x', expiresAt: '2026-11-14T13:00:00Z', identity: null }));
    expect((await client.token('acme/billing')).token).toBe('ghs_x');
    expect(calls[0]?.url).toBe('https://broker.example.com/v1/token');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ repo: 'acme/billing' });
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer abcdef0123456789.secretsecretsecretsecret');
  });

  it('turns a broker error into a BrokerError with its message and status', async () => {
    const { client } = setup({ broker_key: 'k.k' }, () => json(404, { error: 'The sdlc-agent GitHub App is not installed on acme/billing' }));
    const err = await client.token('acme/billing').catch((e) => e);
    expect(err).toBeInstanceOf(BrokerError);
    expect(err).toMatchObject({ status: 404, message: expect.stringContaining('not installed') });
  });

  it('says so when this system has not been connected, without calling the broker', async () => {
    const { client, calls } = setup({}, () => json(200, {}));
    expect(await client.isConnected()).toBe(false);
    await expect(client.token('acme/billing')).rejects.toThrow('not connected to sdlc-agent-bot');
    await expect(client.startInstall()).rejects.toBeInstanceOf(BrokerError);
    expect(calls).toEqual([]);
  });

  it('registers a system and starts an install; the default broker is used when none is set', async () => {
    const { client, calls } = setup({ broker_key: 'k.k' }, (url) => (url.endsWith('/v1/clients') ? json(201, { key: 'new.key' }) : json(200, { url: 'https://github.com/apps/sdlc-agent/installations/new?state=s' })));
    expect(await client.register()).toEqual({ key: 'new.key' });
    expect((await client.startInstall()).url).toContain('installations/new');
    expect(calls[0]?.url).toBe(`${DEFAULT_BROKER_URL}/v1/clients`);
  });
});
