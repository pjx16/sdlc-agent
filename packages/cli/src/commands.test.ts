import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentImage, dashboardHost, parsePs, up } from './commands';
import { compose } from './compose';
import { runDoctor } from './doctor';
import { run } from './proc';

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: () => true,
  readFileSync: () => 'SDLC_VERSION=0.0.3\n',
}));
vi.mock('./compose', () => ({ compose: vi.fn() }));
vi.mock('./proc', () => ({ run: vi.fn() }));
vi.mock('./doctor', () => ({ runDoctor: vi.fn(), envFor: vi.fn(() => ({})) }));

describe('parsePs', () => {
  it('reads newline-delimited JSON and a JSON array', () => {
    expect(parsePs('{"Service":"api","State":"running"}\n{"Service":"worker","State":"exited"}\n')).toHaveLength(2);
    expect(parsePs('[{"Service":"api"}]')).toEqual([{ Service: 'api' }]);
    expect(parsePs('')).toEqual([]);
  });
});

describe('dashboardHost', () => {
  it('uses an IP address or localhost from DASHBOARD_BIND, and maps wildcards to localhost', () => {
    expect(dashboardHost('127.0.0.1')).toBe('127.0.0.1');
    expect(dashboardHost('192.168.1.20')).toBe('192.168.1.20');
    expect(dashboardHost('::1')).toBe('[::1]');
    expect(dashboardHost('localhost')).toBe('localhost');
    expect(dashboardHost('0.0.0.0')).toBe('localhost');
    expect(dashboardHost(undefined)).toBe('localhost');
    expect(dashboardHost('')).toBe('localhost');
  });
  it('never lets anything else from the .env file into the URL', () => {
    for (const bad of ['evil.example.com', 'http://evil.example.com', '127.0.0.1@evil.example.com', '127.0.0.1/../x', 'a b', '1.2.3.4:80']) expect(dashboardHost(bad)).toBe('localhost');
  });
});

describe('agentImage', () => {
  it('follows the compose default: the locally built image for the installed version, or AGENT_IMAGE', () => {
    expect(agentImage('SDLC_VERSION=0.0.3\n')).toBe('sdlc-agent/agent:0.0.3');
    expect(agentImage('SDLC_VERSION=0.0.3\nSDLC_REGISTRY=ghcr.io/me\n')).toBe('sdlc-agent/agent:0.0.3');
    expect(agentImage('SDLC_VERSION=0.0.3\nAGENT_IMAGE=my/agent:1\n')).toBe('my/agent:1');
  });
});

describe('up', () => {
  const calls: string[] = [];
  let output = '';
  const ok = { code: 0, stdout: '', stderr: '' };
  const fail = { code: 1, stdout: '', stderr: 'boom' };
  const agent = 'compose --profile build build agent-image';
  const start = 'compose up -d --wait --wait-timeout 300';

  function mockResults(results: { composePull?: typeof ok; agentBuild?: typeof ok; dockerPull?: typeof ok }): void {
    vi.mocked(compose).mockImplementation(async (_dir, args) => {
      calls.push(`compose ${args.join(' ')}`);
      if (args[0] === 'pull') return results.composePull ?? ok;
      return args.includes('agent-image') ? (results.agentBuild ?? ok) : ok;
    });
    vi.mocked(run).mockImplementation(async (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      return results.dockerPull ?? ok;
    });
  }

  beforeEach(() => {
    calls.length = 0;
    output = '';
    vi.mocked(runDoctor).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof runDoctor>>);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('pulls the compose images, then builds the agent image locally, then starts the stack', async () => {
    mockResults({});
    await up({ dir: '/x', quiet: true });
    expect(calls).toEqual(['compose pull', agent, start]);
    expect(calls.some((c) => c.startsWith('docker pull'))).toBe(false);
    expect(output).toContain('Building the agent image');
  });

  it('does not start the stack when the agent image cannot be built', async () => {
    mockResults({ agentBuild: fail });
    await expect(up({ dir: '/x', quiet: true })).rejects.toThrow('Could not build the agent image');
    expect(calls).toEqual(['compose pull', agent]);
  });

  it('throws and never pulls the agent image when compose pull fails', async () => {
    mockResults({ composePull: fail });
    await expect(up({ dir: '/x', quiet: true })).rejects.toThrow('Could not pull the images');
    expect(calls).toEqual(['compose pull']);
  });
});
