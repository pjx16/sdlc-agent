import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const readme = readFileSync(path.join(root, 'packages/cli/README.md'), 'utf8');
const kb = readFileSync(path.join(root, 'docs/kb/setup.md'), 'utf8');

/** Returns the numbered flow steps of the KB doc, keyed by step number. */
function flowSteps(): Map<number, string> {
  const steps = new Map<number, string>();
  for (const line of kb.split('\n')) {
    const m = /^(\d+)\.\s(.*)$/.exec(line);
    if (m) steps.set(Number(m[1]), m[2] ?? '');
  }
  return steps;
}

describe('disk space documentation', () => {
  it('states the 5 GB minimum and 10 GB recommendation in the README', () => {
    expect(readme).toMatch(/5 GB/);
    expect(readme).toMatch(/10 GB/);
    expect(readme).toMatch(/recommended/i);
  });

  it('README says the space is measured on DATA_DIR or the install folder', () => {
    expect(readme).toMatch(/DATA_DIR/);
    expect(readme).toMatch(/install folder/i);
  });

  it('KB flow steps 3-5 say under 5 GB blocks init/up/upgrade and 5-10 GB warns', () => {
    const text = [3, 4, 5].map((n) => flowSteps().get(n) ?? '').join('\n');
    expect(text).toMatch(/5 GB/);
    expect(text).toMatch(/10 GB/);
    expect(text).toMatch(/init/);
    expect(text).toMatch(/upgrade/);
    expect(text).toMatch(/block|stop/i);
    expect(text).toMatch(/warn/i);
    expect(text).not.toMatch(/`required: false`, so a low value/);
  });

  it('KB DATA_DIR edge case says space is measured on DATA_DIR when set, else the install folder', () => {
    const line = kb.split('\n').find((l) => /^- .*(disk|space).*DATA_DIR/i.test(l)) ?? '';
    expect(line).toMatch(/DATA_DIR/);
    expect(line).toMatch(/install folder/i);
    expect(line).toMatch(/when set|if set|is set/i);
    expect(line).not.toMatch(/not on `DATA_DIR`/);
  });
});
