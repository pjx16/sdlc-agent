import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { CredentialsService } from '../../credentials/credentials.service';
import { WorkerConfig } from '../worker-config';
import { LlmGateway } from './llm-gateway';

let upstream: Server;
let gateway: LlmGateway;
const seen: { url: string; method: string; headers: Record<string, string | string[] | undefined>; body: string }[] = [];

async function start(token: string | null = 'sk-ant-oat-secret') {
  upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      seen.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => upstream.listen(0, r));
  const config = new WorkerConfig({ DATA_DIR: '/tmp/x', DATABASE_URL: 'x', LLM_GATEWAY_UPSTREAM: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}` } as NodeJS.ProcessEnv);
  gateway = new LlmGateway(config, { resolve: async () => ({ claude_token: token }) } as unknown as CredentialsService);
  return `http://127.0.0.1:${await gateway.start(0)}`;
}

afterEach(() => {
  gateway?.stop();
  upstream?.close();
  seen.length = 0;
});

describe('LlmGateway (scan finding 1)', () => {
  it('forwards POST /v1/messages with the token it holds, dropping the agent\'s own credentials', async () => {
    const base = await start();
    const res = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'x-api-key': 'attacker-key', authorization: 'Bearer attacker', 'anthropic-version': '2023-06-01', 'anthropic-beta': 'foo', 'content-type': 'application/json' }, body: '{"model":"m"}' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers['x-api-key']).toBeUndefined();
    expect(seen[0]?.headers.authorization).toBe('Bearer sk-ant-oat-secret');
    expect(seen[0]?.headers['anthropic-beta']).toBe('foo,oauth-2025-04-20');
    expect(seen[0]?.headers['anthropic-version']).toBe('2023-06-01');
    expect(seen[0]?.body).toBe('{"model":"m"}');
  });

  it('refuses everything else: other paths, the Files API, other methods', async () => {
    const base = await start();
    for (const [method, path] of [['GET', '/v1/messages'], ['POST', '/v1/files'], ['POST', '/v1/messages/batches'], ['GET', '/v1/models'], ['POST', '/']] as const) {
      expect((await fetch(`${base}${path}`, { method, ...(method === 'POST' ? { body: '{}' } : {}) })).status, `${method} ${path}`).toBe(403);
    }
    expect(seen).toHaveLength(0);
  });

  it('answers 503 and sends nothing upstream when no token is set', async () => {
    const base = await start(null);
    expect((await fetch(`${base}/v1/messages`, { method: 'POST', body: '{}' })).status).toBe(503);
    expect(seen).toHaveLength(0);
  });
});

describe('agent environment', () => {
  it('has no Claude token and points at the gateway and the mirror', () => {
    const config = new WorkerConfig({ DATA_DIR: '/tmp/x', DATABASE_URL: 'x' } as NodeJS.ProcessEnv);
    expect(config.llmGatewayUrl).toBe('http://llm-gateway:8080');
    expect(config.npmRegistryUrl).toBe('http://npm-mirror:4873/');
  });
});
