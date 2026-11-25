import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachmentPathsOf, loadAttachments } from './kb-attachments';
import { buildCatalog } from './kb-catalog-sync';

let ws: string;
beforeAll(() => {
  ws = mkdtempSync(path.join(tmpdir(), 'kb-att-'));
  mkdirSync(path.join(ws, 'docs/kb/billing'), { recursive: true });
  writeFileSync(path.join(ws, 'docs/kb/auth.md'), '# Auth\nlogin');
  writeFileSync(path.join(ws, 'docs/kb/billing/overview.md'), '# Billing');
  writeFileSync(path.join(ws, 'docs/kb/big.md'), Array.from({ length: 700 }, (_, i) => `line ${i}`).join('\n'));
  writeFileSync(path.join(ws, 'secret.md'), 'not a KB doc');
  symlinkSync(path.join(ws, 'secret.md'), path.join(ws, 'docs/kb/link.md'));
});
afterAll(() => rmSync(ws, { recursive: true, force: true }));

describe('attachmentPathsOf', () => {
  it('keeps valid paths only, at most five', () => {
    expect(attachmentPathsOf(['a.md', '../x.md', '/etc/passwd.md', 'b.txt', 3, 'c/d.md'])).toEqual(['a.md', 'c/d.md']);
    expect(attachmentPathsOf(Array.from({ length: 9 }, (_, i) => `d${i}.md`))).toHaveLength(5);
    expect(attachmentPathsOf(null)).toEqual([]);
  });
});

describe('loadAttachments', () => {
  it('reads the docs from the KB folder of the workspace', async () => {
    const r = await loadAttachments(ws, 'docs/kb', ['auth.md', 'billing/overview.md']);
    expect(r.docs).toEqual([{ path: 'auth.md', content: '# Auth\nlogin' }, { path: 'billing/overview.md', content: '# Billing' }]);
    expect(r.warnings).toEqual([]);
  });

  it('skips a missing doc, a path that climbs out of the KB folder, and a symlink, each with a warning', async () => {
    const r = await loadAttachments(ws, 'docs/kb', ['gone.md', '../../secret.md', 'link.md', 'auth.md']);
    expect(r.docs.map((d) => d.path)).toEqual(['auth.md']);
    expect(r.warnings).toHaveLength(3);
  });

  it('cuts the docs together at 600 lines and says so', async () => {
    const r = await loadAttachments(ws, 'docs/kb', ['big.md', 'auth.md']);
    expect(r.docs).toHaveLength(1);
    expect(r.docs[0]!.content.split('\n').length).toBeLessThan(610);
    expect(r.docs[0]!.content).toContain('cut here');
    expect(r.warnings.join(' ')).toContain('cut at 600 lines');
    expect(r.warnings.join(' ')).toContain('auth.md was left out');
  });
});

describe('buildCatalog', () => {
  it('lists the markdown docs under the KB folder, titled from the index when it names them', () => {
    const c = buildCatalog('docs/kb', ['docs/kb/features.json', 'docs/kb/auth.md', 'docs/kb/billing/overview.md', 'README.md'], [{ doc: 'auth.md', title: 'Authentication', key: 'auth' }], 'now');
    expect(c.docs).toEqual([{ path: 'auth.md', title: 'Authentication' }, { path: 'billing/overview.md', title: 'billing/overview.md' }]);
  });
});
