import { describe, expect, it } from 'vitest';
import { stripAnsi } from './ansi';

describe('stripAnsi', () => {
  it('removes colour codes and keeps the text', () => {
    const esc = String.fromCharCode(27);
    expect(stripAnsi(`${esc}[31m${esc}[2mTest Files${esc}[22m ${esc}[1m${esc}[31m1 failed${esc}[39m (1)`)).toBe('Test Files 1 failed (1)');
    expect(stripAnsi('plain text')).toBe('plain text');
  });
});
