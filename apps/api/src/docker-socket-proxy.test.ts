import { createServer, connect, type Server } from 'node:net';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildCreateOptions } from './worker/agent-runner/container-options';

const dir = path.resolve(__dirname, '../../../docker/socket-proxy');
type Opts = { bindRoots?: string[]; images?: string[]; networks?: string[] };
type Policy = {
  checkRequest: (m: string, u: string, body?: unknown, o?: Opts) => string | null;
  nonRootUser: (u: unknown) => boolean;
  normaliseImage: (r: string) => string;
  forceLabelFilter: (u: string) => string;
};
const load = async (): Promise<Policy> => (await import(pathToFileURL(path.join(dir, 'policy.mjs')).href)) as Policy;
const IMAGE = 'sdlc-agent/agent:latest';
const opts: Opts = { bindRoots: ['/data'], images: [IMAGE] };
const workerCreate = () =>
  buildCreateOptions({ name: 'sdlc-run-1', image: IMAGE, cmd: ['run-stage'], env: {}, workspace: { path: '/data/workspaces/p1/K-1', readOnly: false }, contextDir: '/data/runs/r1', memory: '4g', cpus: 2, timeoutMs: 1 }) as unknown as {
    HostConfig: Record<string, unknown>;
    User?: string;
    Image?: string;
    Labels?: Record<string, string>;
    NetworkingConfig?: unknown;
  };

describe('docker socket proxy policy', () => {
  it('accepts what the worker really sends: the options buildCreateOptions makes, and the calls around it', async () => {
    const { checkRequest } = await load();
    expect(checkRequest('POST', '/v1.43/containers/create?name=sdlc-run-1', workerCreate(), opts)).toBeNull();
    for (const [m, u] of [['POST', '/containers/abc123/start'], ['POST', '/containers/abc123/wait'], ['POST', '/containers/abc123/attach?stream=1&stdout=1'], ['POST', '/containers/abc123/kill'], ['DELETE', '/containers/abc123?force=1&v=1'], ['GET', '/containers/json?all=1'], ['GET', '/images/sdlc-agent%2Fagent:latest/json'], ['GET', '/images/sdlc-agent/agent/json'], ['POST', '/images/create?fromImage=sdlc-agent%2Fagent&tag=latest'], ['GET', '/_ping']] as const) expect(checkRequest(m, u, undefined, opts), `${m} ${u}`).toBeNull();
  });

  it('refuses every call that is not listed: exec, build, volumes, networks, commit, archive, prune', async () => {
    const { checkRequest } = await load();
    for (const [m, u] of [['POST', '/containers/abc/exec'], ['POST', '/build'], ['POST', '/volumes/create'], ['POST', '/networks/create'], ['POST', '/commit'], ['GET', '/containers/abc/archive'], ['POST', '/containers/prune'], ['GET', '/secrets'], ['POST', '/containers/abc/update'], ['GET', '/info']] as const) expect(checkRequest(m, u, undefined, opts), `${m} ${u}`).not.toBeNull();
  });

  it('refuses a container create that escapes the sandbox', async () => {
    const { checkRequest } = await load();
    const bad = (patch: (o: ReturnType<typeof workerCreate>) => void) => {
      const copy = JSON.parse(JSON.stringify(workerCreate())) as ReturnType<typeof workerCreate>;
      patch(copy);
      return checkRequest('POST', '/containers/create', copy, opts);
    };
    expect(bad((o) => (o.HostConfig.Privileged = true))).toContain('Privileged');
    expect(bad((o) => (o.HostConfig.NetworkMode = 'host'))).toContain('network');
    expect(bad((o) => (o.HostConfig.NetworkMode = 'sdlc_other'))).toContain('network');
    expect(bad((o) => (o.NetworkingConfig = { EndpointsConfig: { 'sdlc-agent_internal': {} } }))).toContain('sdlc-agent_internal');
    expect(bad((o) => (o.HostConfig.PidMode = 'host'))).toContain('PidMode');
    expect(bad((o) => (o.HostConfig.CapAdd = ['SYS_ADMIN']))).toContain('CapAdd');
    expect(bad((o) => (o.HostConfig.Devices = [{ PathOnHost: '/dev/sda' }]))).toContain('Devices');
    expect(bad((o) => (o.HostConfig.SecurityOpt = ['seccomp=unconfined']))).toContain('SecurityOpt');
    expect(bad((o) => (o.HostConfig.Binds = ['/:/host']))).toContain('outside the data folder');
    expect(bad((o) => (o.HostConfig.Binds = ['/var/run/docker.sock:/var/run/docker.sock']))).toContain('outside');
    expect(bad((o) => (o.HostConfig.Binds = ['/data/../etc:/x']))).toContain('normalised');
    expect(bad((o) => (o.HostConfig.Binds = ['somevolume:/x']))).toContain('not one of ours');
    expect(bad((o) => (o.HostConfig.Mounts = [{ Type: 'bind', Source: '/', Target: '/h' }]))).toContain('Mounts');
    expect(bad((o) => (o.HostConfig.MaskedPaths = []))).toContain('MaskedPaths');
    expect(bad((o) => (o.HostConfig.ReadonlyPaths = []))).toContain('ReadonlyPaths');
    expect(bad((o) => (o.HostConfig.GroupAdd = ['0']))).toContain('GroupAdd');
    expect(bad((o) => (o.HostConfig.PortBindings = { '22/tcp': [{ HostPort: '2222' }] }))).toContain('PortBindings');
    expect(bad((o) => (o.User = 'root'))).toContain('non-root');
    expect(bad((o) => delete o.User)).toContain('non-root');
  });

  it('requires the sandbox the worker asks for, instead of trusting a create that leaves it out', async () => {
    const { checkRequest } = await load();
    const without = (patch: (o: ReturnType<typeof workerCreate>) => void) => {
      const copy = JSON.parse(JSON.stringify(workerCreate())) as ReturnType<typeof workerCreate>;
      patch(copy);
      return checkRequest('POST', '/containers/create', copy, opts);
    };
    expect(without((o) => delete o.HostConfig.CapDrop)).toContain('CapDrop');
    expect(without((o) => (o.HostConfig.SecurityOpt = []))).toContain('no-new-privileges');
    expect(without((o) => delete o.HostConfig.ReadonlyRootfs)).toContain('ReadonlyRootfs');
    expect(without((o) => delete o.HostConfig.Memory)).toContain('memory');
    expect(without((o) => delete o.HostConfig.PidsLimit)).toContain('PID');
    expect(without((o) => delete o.Labels)).toContain('sdlc.agent');
    expect(without((o) => (o.Image = 'attacker/anything:latest'))).toContain('not the agent image');
  });

  it('accepts only a numeric non-root uid:gid: zero written another way is still root', async () => {
    const { nonRootUser } = await load();
    expect(nonRootUser('1000:1000')).toBe(true);
    for (const u of ['0', '00', '+0', '0:0', '00:00', '1000:0', '0:1000', 'root', 'root:root', 'node', '1000', '', undefined, ' 1000:1000']) expect(nonRootUser(u), String(u)).toBe(false);
  });

  it('allows image inspect and pull only for the agent image, and never an import', async () => {
    const { checkRequest } = await load();
    expect(checkRequest('GET', '/images/alpine/json', undefined, opts)).toContain('not the agent image');
    expect(checkRequest('GET', '/images/..%2F..%2Fcontainers%2Fx/json', undefined, opts)).toContain('not the agent image');
    expect(checkRequest('POST', '/images/create?fromImage=attacker%2Fimg&tag=latest', undefined, opts)).toContain('not the agent image');
    expect(checkRequest('POST', '/images/create?fromSrc=http%3A%2F%2Fevil%2Fx.tar&repo=sdlc-agent%2Fagent', undefined, opts)).toContain('import');
    expect(checkRequest('POST', '/images/create?fromImage=sdlc-agent%2Fagent', undefined, { ...opts, images: [] })).toContain('not the agent image');
  });

  it('adds the agent label to every container list, keeping the filters the caller sent', async () => {
    const { forceLabelFilter } = await load();
    const filters = (u: string) => JSON.parse(new URLSearchParams(u.split('?')[1]).get('filters') ?? '{}') as { label: string[]; status?: string[] };
    expect(filters(forceLabelFilter('/v1.43/containers/json?all=1')).label).toEqual(['sdlc.agent=true']);
    const kept = filters(forceLabelFilter(`/containers/json?filters=${encodeURIComponent(JSON.stringify({ status: ['exited'], label: ['x=y'] }))}`));
    expect(kept).toEqual({ status: ['exited'], label: ['x=y', 'sdlc.agent=true'] });
  });
});

describe('docker socket proxy server', () => {
  /** A fake daemon that answers each request once and honours `Connection: close`, like Docker's Go HTTP server. */
  async function harness(labels: Record<string, Record<string, string>> = {}) {
    const tmp = mkdtempSync(path.join(tmpdir(), 'sdlc-dp-'));
    const sock = path.join(tmp, 'd.sock');
    const seen: string[] = [];
    const daemon: Server = createServer((s) => {
      let buf = '';
      s.on('data', (d) => {
        buf += d.toString('latin1');
        for (let end = buf.indexOf('\r\n\r\n'); end >= 0; end = buf.indexOf('\r\n\r\n')) {
          const head = buf.slice(0, end);
          const len = Number(/content-length: *(\d+)/i.exec(head)?.[1] ?? 0);
          if (buf.length < end + 4 + len) return;
          buf = buf.slice(end + 4 + len);
          seen.push(head);
          const line = head.split('\r\n')[0] ?? '';
          const inspect = /^GET \/containers\/([^/]+)\/json /.exec(line);
          let status = '200 OK';
          let body = 'ok';
          if (inspect) {
            const l = labels[inspect[1] ?? ''];
            if (l) body = JSON.stringify({ Config: { Labels: l } });
            else [status, body] = ['404 Not Found', '{}'];
          }
          const close = /^connection: *close/im.test(head);
          s.write(`HTTP/1.1 ${status}\r\nContent-Length: ${body.length}\r\n${close ? 'Connection: close\r\n' : ''}\r\n${body}`);
          if (close) return void s.end();
        }
      });
    });
    await new Promise<void>((r) => daemon.listen(sock, r));
    const port = 20000 + Math.floor(Math.random() * 20000);
    const proc: ChildProcess = spawn('node', [path.join(dir, 'server.mjs')], { env: { ...process.env, DOCKER_SOCKET: sock, PORT: String(port), ALLOWED_BIND_ROOTS: '/data', ALLOWED_IMAGES: IMAGE }, stdio: 'pipe' });
    await new Promise<void>((r) => proc.stdout?.on('data', () => r()));
    const ask = (...parts: string[]) =>
      new Promise<string>((resolve) => {
        const c = connect(port, '127.0.0.1', () => parts.forEach((p) => c.write(p)));
        let out = '';
        c.on('data', (d) => (out += d.toString()));
        c.on('error', () => undefined);
        c.on('close', () => resolve(out));
      });
    const lines = () => seen.map((h) => h.split('\r\n')[0]);
    const stop = () => {
      proc.kill();
      daemon.close();
      rmSync(tmp, { recursive: true, force: true });
    };
    return { ask, seen, lines, stop };
  }

  it('forwards an allowed call to the socket with Connection: close, and refuses a forbidden one without touching it', async () => {
    const h = await harness();
    try {
      expect(await h.ask('GET /_ping HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n')).toContain('200 OK');
      expect(await h.ask('POST /containers/abc/exec HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n')).toContain('403 Forbidden');
      const body = JSON.stringify({ User: 'root', HostConfig: {} });
      expect(await h.ask(`POST /containers/create HTTP/1.1\r\nHost: x\r\nContent-Length: ${body.length}\r\n\r\n${body}`)).toContain('403 Forbidden');
      expect(h.lines()).toEqual(['GET /_ping HTTP/1.1']);
      expect(h.seen[0]).toMatch(/\r\nConnection: close$/);
      expect(h.seen[0]).not.toMatch(/keep-alive/i);
    } finally {
      h.stop();
    }
  }, 20_000);

  it('never lets a second request ride on an allowed one, even one that asks to upgrade', async () => {
    const h = await harness();
    const evil = JSON.stringify({ Image: IMAGE, User: '1000:1000', HostConfig: { Privileged: true, Binds: ['/:/host'], NetworkMode: 'host' } });
    const smuggled = `POST /containers/create HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${evil.length}\r\n\r\n${evil}`;
    try {
      await h.ask('GET /_ping HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n', smuggled);
      await h.ask(`GET /_ping HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n${smuggled}`);
      await h.ask('GET /_ping HTTP/1.1\r\nHost: x\r\n\r\n', smuggled);
      expect(h.lines().filter((l) => l?.includes('/containers/create'))).toEqual([]);
      for (const head of h.seen) expect(head).toMatch(/\r\nConnection: close$/);
    } finally {
      h.stop();
    }
  }, 20_000);

  it('acts only on containers carrying the agent label, and reports a missing one as missing', async () => {
    const h = await harness({ agent1: { 'sdlc.agent': 'true' }, worker: { 'com.docker.compose.service': 'worker' } });
    try {
      expect(await h.ask('POST /containers/agent1/kill HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n')).toContain('200 OK');
      expect(await h.ask('GET /containers/worker/json HTTP/1.1\r\nHost: x\r\n\r\n')).toContain('403 Forbidden');
      expect(await h.ask('POST /containers/worker/kill HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n')).toContain('403 Forbidden');
      expect(await h.ask('DELETE /containers/gone HTTP/1.1\r\nHost: x\r\n\r\n')).toContain('404 Not Found');
      expect(h.lines().filter((l) => !l?.startsWith('GET /containers/') || !l.includes('/json'))).toEqual(['POST /containers/agent1/kill HTTP/1.1']);
    } finally {
      h.stop();
    }
  }, 20_000);

  it('lists only agent containers', async () => {
    const h = await harness();
    try {
      await h.ask('GET /v1.43/containers/json?all=1 HTTP/1.1\r\nHost: x\r\n\r\n');
      const url = h.lines()[0]?.split(' ')[1] ?? '';
      expect(JSON.parse(new URLSearchParams(url.split('?')[1]).get('filters') ?? '{}')).toEqual({ label: ['sdlc.agent=true'] });
    } finally {
      h.stop();
    }
  }, 20_000);
});
