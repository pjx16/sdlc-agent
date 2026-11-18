import { describe, expect, it, vi } from 'vitest';
import { BrokerError } from '../broker/broker-client';
import { BotController } from './bot.controller';

function setup(over: { connected?: boolean; installations?: { id: number; account: string }[]; register?: () => Promise<{ key: string }>; installError?: Error } = {}) {
  const set = vi.fn(async () => undefined);
  const remove = vi.fn(async () => undefined);
  const broker = {
    isConnected: async () => over.connected ?? false,
    installations: async () => ({ installations: over.installations ?? [] }),
    register: over.register ?? (async () => ({ key: 'abcdef0123456789.secretsecretsecretsecret' })),
    startInstall: async () => {
      if (over.installError) throw over.installError;
      return { url: 'https://github.com/apps/sdlc-agent/installations/new?state=s' };
    },
  };
  return { controller: new BotController({ set, remove } as never, broker as never), set, remove };
}

describe('BotController', () => {
  it('reports not connected, and connected with the installations', async () => {
    expect(await setup().controller.status()).toEqual({ connected: false, installations: [], error: null });
    expect(await setup({ connected: true, installations: [{ id: 1, account: 'acme' }] }).controller.status()).toMatchObject({ connected: true, installations: [{ id: 1, account: 'acme' }] });
  });

  it('connect registers this system once, saves the key, and returns the GitHub install page', async () => {
    const t = setup();
    expect(await t.controller.connect()).toEqual({ url: 'https://github.com/apps/sdlc-agent/installations/new?state=s' });
    expect(t.set).toHaveBeenCalledWith('broker_key', 'abcdef0123456789.secretsecretsecretsecret');
    const again = setup({ connected: true });
    await again.controller.connect();
    expect(again.set).not.toHaveBeenCalled(); // already registered: no second key
  });

  it('turns a broker problem into a clear error', async () => {
    const err = await setup({ installError: new BrokerError('Too many registrations from this address', 429) }).controller.connect().catch((e) => e);
    expect(err.getStatus()).toBe(429);
    const down = await setup({ register: async () => { throw new Error('fetch failed'); } }).controller.connect().catch((e) => e);
    expect(down.getStatus()).toBe(502);
  });

  it('disconnect forgets the key', async () => {
    const t = setup({ connected: true });
    await t.controller.disconnect();
    expect(t.remove).toHaveBeenCalledWith('broker_key');
  });
});
