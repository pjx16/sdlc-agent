import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_IMAGE, docker } from '../../testing/docker-fixture';
import { WorkerConfig } from '../worker-config';
import { DockerodeEngine } from './container-engine';
import { ContainerRunner } from './container-runner';

/**
 * Installs keep the data folder in a Docker volume. A real agent container, started by the worker's own code, must see its ticket's
 * folder of that volume and nothing else of it, with CLAUDE.md hidden. Needs Docker Engine 26 or later and the agent image.
 */
describe('agent containers on a data volume (real Docker)', () => {
  const volume = `sdlc_data_test_${process.pid}`;
  const config = new WorkerConfig({ DATA_DIR: '/data', DATABASE_URL: 'x', DATA_VOLUME: volume } as NodeJS.ProcessEnv);
  const runner = new ContainerRunner(new DockerodeEngine(docker), config);

  /** Seeds the volume as the worker would: two projects' workspaces, a repo CLAUDE.md, the empty file and a run folder. */
  beforeAll(async () => {
    await docker.createVolume({ Name: volume });
    const seed = 'mkdir -p /d/workspaces/p1/K-1 /d/workspaces/p2/OTHER-9 /d/runs/r1 && echo mine > /d/workspaces/p1/K-1/a.txt && echo repo > /d/workspaces/p1/K-1/CLAUDE.md && echo secret > /d/workspaces/p2/OTHER-9/b.txt && echo ctx > /d/runs/r1/task.md && : > /d/empty-file && chown -R 1000:1000 /d/workspaces/p1/K-1';
    const c = await docker.createContainer({ Image: AGENT_IMAGE, User: '0:0', Cmd: ['sh', '-c', seed], HostConfig: { Binds: [`${volume}:/d`], NetworkMode: 'none' } });
    await c.start();
    expect((await c.wait()).StatusCode).toBe(0);
    await c.remove();
  }, 120_000);

  afterAll(async () => {
    await docker.getVolume(volume).remove({ force: true }).catch(() => undefined);
  });

  const runIn = async (script: string, readOnly = false) => {
    const lines: string[] = [];
    const result = await runner.run(
      {
        name: `sdlc-test-vol-${Math.random().toString(36).slice(2, 8)}`, image: AGENT_IMAGE, cmd: ['sh', '-c', script], env: {},
        workspace: { path: '/data/workspaces/p1/K-1', readOnly, hide: { emptyFile: '/data/empty-file', names: ['CLAUDE.md'] } },
        contextDir: '/data/runs/r1', memory: '512m', cpus: 1, timeoutMs: 60_000, network: 'none',
      },
      { onLine: (l) => lines.push(l) },
    );
    return { exitCode: result.exitCode, out: lines.join('\n') };
  };

  it('sees its own ticket folder and run context, with CLAUDE.md hidden, and nothing else of the volume', async () => {
    const r = await runIn('cat /workspace/a.txt; echo "claude=[$(cat /workspace/CLAUDE.md)]"; cat /context/task.md; ls /workspace; ls /data 2>&1 | head -1; grep -rl secret / --include=b.txt 2>/dev/null | head -1; echo end');
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain('mine');
    expect(r.out).toContain('claude=[]');
    expect(r.out).toContain('ctx');
    expect(r.out).not.toContain('OTHER-9');
    expect(r.out).not.toContain('secret');
    expect(r.out).toMatch(/end$/);
  }, 120_000);

  it('can write its workspace when read-write, but not the hidden file or the context', async () => {
    const r = await runIn('echo new > /workspace/out.txt && echo wrote; echo x > /workspace/CLAUDE.md 2>/dev/null || echo hidden-ro; echo x > /context/task.md 2>/dev/null || echo context-ro');
    expect(r.out).toContain('wrote');
    expect(r.out).toContain('hidden-ro');
    expect(r.out).toContain('context-ro');
  }, 120_000);

  it('cannot write a read-only workspace', async () => {
    const r = await runIn('echo x > /workspace/nope.txt 2>/dev/null && echo wrote || echo refused', true);
    expect(r.out).toContain('refused');
  }, 120_000);
});
