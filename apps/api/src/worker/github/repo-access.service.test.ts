import { describe, expect, it, vi } from 'vitest';
import { BrokerError } from '../../broker/broker-client';
import { RepoAccessService } from './repo-access.service';

const bot = { repoUrl: 'https://github.com/acme/billing', githubAuth: 'bot' };
const own = { repoUrl: 'https://github.com/acme/billing', githubAuth: 'token' };

function setup(over: { connected?: boolean; botToken?: () => Promise<unknown>; install?: () => Promise<{ url: string }> } = {}) {
  const auth = { botToken: vi.fn(over.botToken ?? (async () => ({ token: 't', expiresAt: 'x', identity: { name: 'sdlc-agent[bot]', email: 'e' } }))) };
  const broker = { isConnected: async () => over.connected ?? true, startInstall: over.install ?? (async () => ({ url: 'https://github.com/apps/sdlc-agent/installations/new?state=abc' })) };
  return { service: new RepoAccessService(auth as never, broker as never), auth };
}

describe('RepoAccessService', () => {
  it('a project with its own token needs no access step', async () => {
    const { service, auth } = setup();
    expect(await service.ensure(own)).toMatchObject({ ok: true });
    expect(auth.botToken).not.toHaveBeenCalled();
  });

  it('a bot project is fine when the broker hands out a token for its repository', async () => {
    const { service, auth } = setup();
    expect(await service.ensure(bot)).toMatchObject({ ok: true, login: 'sdlc-agent[bot]' });
    expect(auth.botToken).toHaveBeenCalledWith('acme/billing');
  });

  it('says to connect sdlc-agent-bot first when this system is not registered with the broker', async () => {
    const r = await setup({ connected: false }).service.ensure(bot);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('not connected to sdlc-agent-bot');
  });

  it('gives the install link when the App is not installed on the repository', async () => {
    const r = await setup({ botToken: async () => { throw new BrokerError('The sdlc-agent GitHub App is not installed on acme/billing', 404); } }).service.ensure(bot);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Install the sdlc-agent GitHub App');
    expect(r.message).toContain('https://github.com/apps/sdlc-agent/installations/new?state=abc');
  });

  it('reports a broker that cannot be reached instead of throwing', async () => {
    const r = await setup({ botToken: async () => { throw new Error('fetch failed'); } }).service.ensure(bot);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Could not reach');
  });
});
