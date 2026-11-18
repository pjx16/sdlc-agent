import { createServer, connect, type Server } from 'node:net';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCreateOptions } from './worker/agent-runner/container-options';

const dir = path.resolve(__dirname, '../../../docker/socket-proxy');
type Policy = { checkRequest: (m: string, u: string, body?: unknown, o?: { bindRoots?: string[] }) => string | null };
const load = async (): Promise<Policy> => (await import(pathToFileURL(path.join(dir, 'policy.mjs')).href)) as Policy;
const opts = { bindRoots: ['/data'] };

describe('docker socket proxy policy (scan finding 5)', () => {
  it('accepts what the worker really sends: the options buildCreateOptions makes, and the calls around it', async () => {
    const { checkRequest } = await load();
    const create = buildCreateOptions({ name: 'sdlc-run-1', image: 'img', cmd: ['run-stage'], env: {}, workspace: { path: '/data/workspaces/p1/K-1', readOnly: false }, contextDir: '/data/runs/r1', memory: '4g', cpus: 2, timeoutMs: 1 });
    expect(checkRequest('POST', '/v1.43/containers/create?name=sdlc-run-1', create, opts)).toBeNull();
    for (const [m, u] of [['POST', '/containers/abc123/start'], ['POST', '/containers/abc123/wait'], ['POST', '/containers/abc123/attach?stream=1&stdout=1'], ['POST', '/containers/abc123/kill'], ['DELETE', '/containers/abc123?force=1&v=1'], ['GET', '/containers/json?all=1'], ['GET', '/images/sdlc-agent%2Fagent:latest/json'], ['POST', '/images/create?fromImage=x'], ['GET', '/_ping']] as const) expect(checkRequest(m, u, undefined, opts), `${m} ${u}`).toBeNull();
  });

  it('refuses every call that is not listed: exec, build, volumes, networks, commit, archive, prune', async () => {
    const { checkRequest } = await load();
    for (const [m, u] of [['POST', '/containers/abc/exec'], ['POST', '/build'], ['POST', '/volumes/create'], ['POST', '/networks/create'], ['POST', '/commit'], ['GET', '/containers/abc/archive'], ['POST', '/containers/prune'], ['GET', '/secrets'], ['POST', '/containers/abc/update'], ['GET', '/info']] as const) expect(checkRequest(m, u, undefined, opts), `${m} ${u}`).not.toBeNull();
  });

  it('refuses a container create that escapes the sandbox', async () => {
    const { checkRequest } = await load();
    const ok = buildCreateOptions({ name: 'n', image: 'img', cmd: ['x'], env: {}, workspace: { path: '/data/workspaces/p/k', readOnly: false }, memory: '1g', cpus: 1, timeoutMs: 1 }) as { HostConfig: Record<string, unknown>; User?: string };
    const bad = (patch: (o: typeof ok) => void) => {
      const copy = JSON.parse(JSON.stringify(ok)) as typeof ok;
      patch(copy);
      return checkRequest('POST', '/containers/create', copy, opts);
    };
    expect(bad((o) => (o.HostConfig.Privileged = true))).toContain('privileged');
    expect(bad((o) => (o.HostConfig.NetworkMode = 'host'))).toContain('network');
    expect(bad((o) => (o.HostConfig.PidMode = 'host'))).toContain('PidMode');
    expect(bad((o) => (o.HostConfig.CapAdd = ['SYS_ADMIN']))).toContain('capabilities');
    expect(bad((o) => (o.HostConfig.Devices = [{ PathOnHost: '/dev/sda' }]))).toContain('Devices');
    expect(bad((o) => (o.HostConfig.SecurityOpt = ['seccomp=unconfined']))).toContain('SecurityOpt');
    expect(bad((o) => (o.HostConfig.Binds = ['/:/host']))).toContain('outside the data folder');
    expect(bad((o) => (o.HostConfig.Binds = ['/var/run/docker.sock:/var/run/docker.sock']))).toContain('outside');
    expect(bad((o) => (o.HostConfig.Binds = ['/data/../etc:/x']))).toContain('normalised');
    expect(bad((o) => (o.HostConfig.Binds = ['somevolume:/x']))).toContain('not one of ours');
    expect(bad((o) => (o.HostConfig.Mounts = [{ Type: 'bind', Source: '/', Target: '/h' }]))).toContain('Mounts');
    expect(bad((o) => (o.User = 'root'))).toContain('non-root');
    expect(bad((o) => delete o.User)).toContain('non-root');
  });
});

describe('docker socket proxy server', () => {
  it('forwards an allowed call to the socket, and refuses a forbidden one without touching it', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'sdlc-dp-'));
    const sock = path.join(tmp, 'docker.sock');
    const seen: string[] = [];
    const daemon: Server = createServer((s) => s.on('data', (d) => { seen.push(d.toString().split('\r\n')[0] ?? ''); s.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'); }));
    await new Promise<void>((r) => daemon.listen(sock, r));
    const { spawn } = await import('node:child_process');
    const port = 20000 + Math.floor(Math.random() * 20000);
    const proc = spawn('node', [path.join(dir, 'server.mjs')], { env: { ...process.env, DOCKER_SOCKET: sock, PORT: String(port), ALLOWED_BIND_ROOTS: '/data' }, stdio: 'pipe' });
    await new Promise<void>((r) => proc.stdout.on('data', () => r()));
    const ask = (req: string) => new Promise<string>((resolve) => { const c = connect(port, '127.0.0.1', () => c.write(req)); let out = ''; c.on('data', (d) => (out += d.toString())); c.on('close', () => resolve(out)); });
    try {
      expect(await ask('GET /_ping HTTP/1.1\r\nHost: x\r\n\r\n')).toContain('200 OK');
      expect(await ask('POST /containers/abc/exec HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n')).toContain('403 Forbidden');
      const body = JSON.stringify({ User: 'root', HostConfig: {} });
      expect(await ask(`POST /containers/create HTTP/1.1\r\nHost: x\r\nContent-Length: ${body.length}\r\n\r\n${body}`)).toContain('403 Forbidden');
      expect(seen).toEqual(['GET /_ping HTTP/1.1']);
    } finally {
      proc.kill();
      daemon.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 20_000);
});
