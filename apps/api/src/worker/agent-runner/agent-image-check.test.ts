import { describe, expect, it, vi } from 'vitest';
import { AgentImageCheck } from './agent-image-check';
import { FakeEngine } from './fake-engine';

function setup(engine: FakeEngine) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const check = new AgentImageCheck({ workerStatus: { updateMany } } as never, { agentImage: 'sdlc-agent/agent:latest' } as never, engine);
  return { check, updateMany };
}

describe('AgentImageCheck', () => {
  it('records nothing wrong while the image is there', async () => {
    const { check, updateMany } = setup(new FakeEngine());
    await check.check();
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'worker' }, data: { agentImageError: null } });
  });

  it('records how to build the image when it is gone, once, and clears it when it is back', async () => {
    const engine = new FakeEngine();
    const { check, updateMany } = setup(engine);
    engine.imagePresent = false;
    await check.check();
    await check.check();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(updateMany.mock.calls[0])).toContain('docker compose --profile build build agent-image');
    engine.imagePresent = true;
    await check.check();
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: 'worker' }, data: { agentImageError: null } });
  });
});
