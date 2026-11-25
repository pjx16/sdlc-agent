import { afterEach, describe, expect, it, vi } from 'vitest';
import { lineSplitter } from './proc';
import { runStep } from './ui';

describe('lineSplitter', () => {
  it('splits on newlines and carriage returns, joins partial chunks, skips empty lines', () => {
    const lines: string[] = [];
    const s = lineSplitter((l) => lines.push(l));
    s.push('Pulling a 10%\rPulling a 50%\r\nDone\n\npart');
    s.push('ial');
    s.flush();
    expect(lines).toEqual(['Pulling a 10%', 'Pulling a 50%', 'Done', 'partial']);
  });
});

describe('runStep', () => {
  let output = '';
  const spy = () =>
    vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
      output += String(c);
      return true;
    });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SDLC_AGENT_VERBOSE;
    output = '';
  });

  it('prints plain lines without control characters when not a terminal', async () => {
    spy();
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const r = await runStep('Pulling images', async (io) => {
      io.onLine?.('layer 1');
      return { code: 0, stdout: '', stderr: '' };
    });
    expect(r.code).toBe(0);
    expect(output).toContain('▸ Pulling images…');
    expect(output).toContain('✔ Pulling images');
    expect(output).not.toContain('\x1b');
    expect(output).not.toContain('\r');
  });

  it('prints what a failed step wrote', async () => {
    spy();
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const r = await runStep('Building', async () => ({ code: 1, stdout: '', stderr: 'no space left' }));
    expect(r.code).toBe(1);
    expect(output).toContain('✖ Building');
    expect(output).toContain('no space left');
  });

  it('hands the raw terminal to the step in verbose mode', async () => {
    spy();
    process.env.SDLC_AGENT_VERBOSE = '1';
    let seen: { inherit?: boolean; onLine?: unknown } = {};
    await runStep('x', async (io) => {
      seen = io;
      return { code: 0, stdout: '', stderr: '' };
    });
    expect(seen.inherit).toBe(true);
    expect(seen.onLine).toBeUndefined();
  });
});
