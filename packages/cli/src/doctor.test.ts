import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './proc';
import { out, withProgress } from './ui';
import { compareVersions, diskCheck, diskTarget, engineSupported, pickSocket, runDoctor, socketCandidates } from './doctor';

vi.mock('./proc', () => ({ run: vi.fn() }));
vi.mock('./compose', () => ({ isRunning: vi.fn(async () => false) }));
vi.mock('./ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ui')>()),
  out: vi.fn(),
  withProgress: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
}));

describe('engineSupported', () => {
  it('needs Docker Engine 26 or newer, for volume sub-path mounts', () => {
    expect(engineSupported('26.0.0')).toBe(true);
    expect(engineSupported('27.3.1\n')).toBe(true);
    expect(engineSupported('26.1.4-ce')).toBe(true);
    expect(engineSupported('25.0.5')).toBe(false);
    expect(engineSupported('')).toBe(false);
    expect(engineSupported('dev')).toBe(false);
  });
});

describe('compareVersions', () => {
  it('orders versions, ignoring a leading v', () => {
    expect(compareVersions('2.20.0', '2.20.0')).toBe(0);
    expect(compareVersions('v2.29.1', '2.20.0')).toBeGreaterThan(0);
    expect(compareVersions('2.19.9', '2.20.0')).toBeLessThan(0);
    expect(compareVersions('3.0.0', '2.99.99')).toBeGreaterThan(0);
    expect(compareVersions('2.20', '2.20.0')).toBe(0);
  });
});

describe('pickSocket', () => {
  const home = '/home/me';
  it('uses the configured socket when it exists', () => {
    expect(pickSocket('/custom.sock', (p) => p === '/custom.sock', home)).toEqual({ path: '/custom.sock', found: true, suggested: false });
  });
  it('uses the default when nothing is configured', () => {
    expect(pickSocket(undefined, (p) => p === '/var/run/docker.sock', home)).toEqual({ path: '/var/run/docker.sock', found: true, suggested: false });
  });
  it('suggests the first existing Colima / OrbStack / Docker Desktop socket otherwise', () => {
    const [colima, orbstack] = socketCandidates(home) as [string, string, string];
    expect(pickSocket(undefined, (p) => p === orbstack, home)).toEqual({ path: orbstack, found: true, suggested: true });
    expect(pickSocket(undefined, (p) => p === colima || p === orbstack, home).path).toBe(colima);
  });
  it('reports not found when there is none', () => {
    expect(pickSocket(undefined, () => false, home)).toEqual({ path: '/var/run/docker.sock', found: false, suggested: false });
  });
});

const GIB = 1024 ** 3;

describe('diskCheck', () => {
  it('fails as a required check below 5 GiB', () => {
    const c = diskCheck(4.9 * GIB, '/data');
    expect(c.required).toBe(true);
    expect(c.ok).toBe(false);
  });
  it('treats exactly 5 GiB as a non-required warning', () => {
    const c = diskCheck(5 * GIB, '/data');
    expect(c.required).toBe(false);
    expect(c.ok).toBe(false);
  });
  it('warns without being required between 5 and 10 GiB', () => {
    const c = diskCheck(7 * GIB, '/data');
    expect(c.required).toBe(false);
    expect(c.ok).toBe(false);
  });
  it('still warns at 10 GiB minus one byte', () => {
    expect(diskCheck(10 * GIB - 1, '/data').ok).toBe(false);
  });
  it('passes at exactly 10 GiB', () => {
    expect(diskCheck(10 * GIB, '/data').ok).toBe(true);
  });
  it('passes above 10 GiB', () => {
    expect(diskCheck(50 * GIB, '/data').ok).toBe(true);
  });
  it('shows the free GB and the measured path in detail', () => {
    const c = diskCheck(3.5 * GIB, '/mnt/data');
    expect(c.detail).toContain('3.5');
    expect(c.detail).toContain('/mnt/data');
  });
  it('names the path and docker system prune in the failing hint', () => {
    const c = diskCheck(1 * GIB, '/mnt/data');
    expect(c.hint).toContain('/mnt/data');
    expect(c.hint).toContain('docker system prune');
  });
});

describe('diskTarget', () => {
  it('prefers dataDir when it is set', () => {
    expect(diskTarget('/opt/app', '/data', () => true)).toBe('/data');
  });
  it('falls back to the install folder when dataDir is not set', () => {
    expect(diskTarget('/opt/app', undefined, () => true)).toBe('/opt/app');
  });
  it('walks up to the nearest existing parent when the path does not exist', () => {
    const existing = new Set(['/data']);
    expect(diskTarget('/opt/app', '/data/a/b/c', (p) => existing.has(p))).toBe('/data');
  });
  it('walks up from the install folder when dataDir is not set', () => {
    const existing = new Set(['/opt']);
    expect(diskTarget('/opt/app/x', undefined, (p) => existing.has(p))).toBe('/opt');
  });
});

describe('runDoctor', () => {
  it('skips every check when SDLC_AGENT_SKIP_DOCTOR=1', async () => {
    const prev = process.env.SDLC_AGENT_SKIP_DOCTOR;
    process.env.SDLC_AGENT_SKIP_DOCTOR = '1';
    try {
      const r = await runDoctor({ dir: '/nonexistent', env: { dataDir: '/nonexistent/data' } }, true);
      expect(r).toEqual({ ok: true, checks: [] });
    } finally {
      if (prev === undefined) delete process.env.SDLC_AGENT_SKIP_DOCTOR;
      else process.env.SDLC_AGENT_SKIP_DOCTOR = prev;
    }
  });
});

type Reply = { code: number; stdout: string; stderr: string };
const reply = (code: number, stdout = ''): Reply => ({ code, stdout, stderr: '' });
const key = (args: readonly string[]) => args.slice(0, 2).join(' ');

/** Fakes docker: every call succeeds unless `overrides` replies for its first two arguments. */
function fakeDocker(overrides: Record<string, () => Promise<Reply> | Reply> = {}, onCall?: (args: readonly string[]) => void) {
  vi.mocked(run).mockImplementation(async (_cmd, args) => {
    onCall?.(args);
    const o = overrides[key(args)];
    if (o) return o();
    if (key(args) === 'version --format') return reply(0, '27.0.0\n');
    if (key(args) === 'compose version') return reply(0, '2.29.1\n');
    return reply(0);
  });
}
const calls = () => vi.mocked(run).mock.calls;
const isPull = (args: readonly string[]) => args[0] === 'pull';

describe('runDoctor progress and probe image', () => {
  beforeEach(() => {
    delete process.env.SDLC_AGENT_SKIP_DOCTOR;
    vi.mocked(run).mockReset();
    vi.mocked(out).mockClear();
    vi.mocked(withProgress).mockClear();
  });
  afterEach(() => {
    delete process.env.SDLC_AGENT_SKIP_DOCTOR;
  });

  it('shows the progress label before any docker check runs', async () => {
    const events: string[] = [];
    vi.mocked(withProgress).mockImplementationOnce(async (label, fn) => {
      events.push(`progress:${label}`);
      return fn();
    });
    fakeDocker({}, (args) => events.push(`run:${key(args)}`));
    await runDoctor({ dir: '/nonexistent' }, true);
    expect(events[0]).toBe('progress:Checking Docker, ports and disk space');
    expect(events.some((e) => e.startsWith('run:'))).toBe(true);
  });

  it('prints no label and runs nothing when SDLC_AGENT_SKIP_DOCTOR=1', async () => {
    process.env.SDLC_AGENT_SKIP_DOCTOR = '1';
    fakeDocker();
    const r = await runDoctor({ dir: '/nonexistent' }, true);
    expect(r).toEqual({ ok: true, checks: [] });
    expect(withProgress).not.toHaveBeenCalled();
    expect(out).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('prints the pull notice and pulls with inherited output before the probe when the image is missing', async () => {
    fakeDocker({ 'image inspect': () => reply(1) });
    await runDoctor({ dir: '/nonexistent' }, true);
    const pullIdx = calls().findIndex(([, a]) => isPull(a));
    expect(pullIdx).toBeGreaterThanOrEqual(0);
    const [, pullArgs, pullOpts] = calls()[pullIdx] as [string, readonly string[], { inherit?: boolean } | undefined];
    const image = pullArgs[1] as string;
    expect(image).toMatch(/^postgres:/);
    expect(pullOpts?.inherit).toBe(true);
    expect(calls().some(([, a]) => key(a) === 'image inspect' && a[2] === image)).toBe(true);
    expect(out).toHaveBeenCalledWith(`Pulling ${image} for the Docker check…`);
    const firstRun = calls().findIndex(([, a]) => a[0] === 'run');
    expect(firstRun).toBeGreaterThan(pullIdx);
  });

  it('does not pull when the image exists locally', async () => {
    fakeDocker();
    await runDoctor({ dir: '/nonexistent' }, true);
    expect(calls().some(([, a]) => key(a) === 'image inspect')).toBe(true);
    expect(calls().some(([, a]) => isPull(a))).toBe(false);
    expect(vi.mocked(out).mock.calls.some(([l]) => String(l).startsWith('Pulling '))).toBe(false);
  });

  it('starts docker compose version while docker version is still pending', async () => {
    let release: (r: Reply) => void = () => {};
    fakeDocker({ 'version --format': () => new Promise<Reply>((res) => (release = res)) });
    const pending = runDoctor({ dir: '/nonexistent' }, true);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls().some(([, a]) => key(a) === 'compose version')).toBe(true);
    release(reply(0, '27.0.0'));
    await pending;
  });

  it('still reports a failing docker version with the same check name and hint', async () => {
    fakeDocker({ 'version --format': () => reply(1) });
    const r = await runDoctor({ dir: '/nonexistent' }, true);
    const c = r.checks.find((x) => x.name === 'Docker is running');
    expect(c?.ok).toBe(false);
    expect(c?.hint).toContain('Docker is not running or not installed');
    expect(r.ok).toBe(false);
  });

  it('still reports a failing docker compose version with the same check name and hint', async () => {
    fakeDocker({ 'compose version': () => reply(1) });
    const r = await runDoctor({ dir: '/nonexistent' }, true);
    const c = r.checks.find((x) => x.name === 'Docker Compose 2.20 or newer');
    expect(c?.ok).toBe(false);
    expect(c?.hint).toContain('Install Docker Compose v2.20');
    expect(r.ok).toBe(false);
  });
});
