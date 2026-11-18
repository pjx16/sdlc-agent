import { describe, expect, it } from 'vitest';
import { compareVersions, diskCheck, diskTarget, pickSocket, runDoctor, socketCandidates } from './doctor';

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
