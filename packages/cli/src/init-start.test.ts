import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { up } from './commands';
import { runDoctor } from './doctor';
import { init } from './init';

vi.mock('./commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./commands')>()),
  up: vi.fn(),
  openBrowser: vi.fn(),
}));
vi.mock('./doctor', () => ({ runDoctor: vi.fn() }));

let base: string;
beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), 'sdlc-init-start-'));
  vi.mocked(up).mockResolvedValue(undefined);
  vi.mocked(runDoctor).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof runDoctor>>);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

const opts = (dir: string) => ({ dir, bind: '127.0.0.1', start: true, open: false, force: false });

describe('init with start', () => {
  it('runs the doctor once and starts the stack with skipDoctor', async () => {
    const dir = path.join(base, 'inst');
    await init(opts(dir));
    expect(runDoctor).toHaveBeenCalledTimes(1);
    expect(up).toHaveBeenCalledWith({ dir, quiet: true, skipDoctor: true });
  });

  it('stops with the same message and does not start when the doctor has required failures', async () => {
    vi.mocked(runDoctor).mockResolvedValue({ ok: false } as Awaited<ReturnType<typeof runDoctor>>);
    await expect(init(opts(path.join(base, 'inst')))).rejects.toThrow('Fix the checks marked ✖ above, then run `sdlc-agent init` again.');
    expect(up).not.toHaveBeenCalled();
  });
});
