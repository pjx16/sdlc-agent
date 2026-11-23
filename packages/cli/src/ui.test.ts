import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withProgress } from './ui';

const setTty = (value: boolean) => Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });

describe('withProgress', () => {
  let written: string[];
  const original = process.stdout.isTTY;

  beforeEach(() => {
    vi.useFakeTimers();
    written = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setTty(original as boolean);
  });

  it('writes a spinner frame with the label on a TTY and clears the line when fn resolves', async () => {
    setTty(true);
    let finish!: () => void;
    const pending = withProgress('Checking Docker', () => new Promise<void>((r) => (finish = r)));
    await vi.advanceTimersByTimeAsync(500);
    const during = written.join('');
    expect(during).toContain('Checking Docker');
    expect(during).toContain('\r');
    const before = written.length;
    finish();
    await pending;
    const after = written.slice(before).join('');
    expect(after).toMatch(/\r|\x1b\[2K/);
    expect(after).not.toContain('Checking Docker');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('prints the label with an ellipsis once and no control characters on a non-TTY', async () => {
    setTty(false);
    let finish!: () => void;
    const pending = withProgress('Checking Docker', () => new Promise<void>((r) => (finish = r)));
    await vi.advanceTimersByTimeAsync(1000);
    finish();
    await pending;
    const all = written.join('');
    expect(all.split('Checking Docker…')).toHaveLength(2);
    expect(all).not.toContain('\r');
    expect(all).not.toContain('\x1b');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the interval timer and rethrows when fn throws', async () => {
    setTty(true);
    const boom = new Error('boom');
    await expect(
      withProgress('Checking', async () => {
        await vi.advanceTimersByTimeAsync(300);
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns the value fn resolves with', async () => {
    setTty(false);
    await expect(withProgress('x', async () => 42)).resolves.toBe(42);
  });
});
