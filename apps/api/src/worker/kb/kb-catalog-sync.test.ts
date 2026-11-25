import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GitRunner } from '../git/git-runner';
import { KbCatalogSync } from './kb-catalog-sync';

let root: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'kb-cat-'));
  const work = path.join(root, 'work');
  mkdirSync(path.join(work, 'docs/kb/billing'), { recursive: true });
  writeFileSync(path.join(work, 'docs/kb/auth.md'), '# Auth');
  writeFileSync(path.join(work, 'docs/kb/billing/overview.md'), '# Billing');
  writeFileSync(path.join(work, 'docs/kb/features.json'), JSON.stringify({ version: 1, features: [{ key: 'auth', title: 'Authentication', doc: 'auth.md', globs: [] }] }));
  writeFileSync(path.join(work, 'README.md'), 'x');
  git(root, 'init', '-q', '-b', 'main', 'work');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'init');
  mkdirSync(path.join(root, 'mirrors'));
  git(root, 'clone', '-q', '--bare', work, path.join(root, 'mirrors', 'p1.git'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('KbCatalogSync', () => {
  it('stores the KB docs of the mirror on the project, and writes nothing when they have not changed', async () => {
    const project = { id: 'p1', name: 'P', kbDir: 'docs/kb', baseBranch: 'main', kbCatalog: null as unknown };
    const update = vi.fn(async ({ data }: { data: { kbCatalog: unknown } }) => {
      project.kbCatalog = data.kbCatalog;
    });
    const prisma = { project: { findMany: vi.fn(async () => [project]), update } };
    const sync = new KbCatalogSync(prisma as never, new GitRunner({ token: async () => '' }), { mirrorPath: (id: string) => path.join(root, 'mirrors', `${id}.git`) } as never, () => new Date('2026-11-25T10:00:00Z'));
    await sync.check();
    expect(update).toHaveBeenCalledTimes(1);
    expect(project.kbCatalog).toEqual({ docs: [{ path: 'auth.md', title: 'Authentication' }, { path: 'billing/overview.md', title: 'billing/overview.md' }], updatedAt: '2026-11-25T10:00:00.000Z' });
    await sync.check();
    expect(update).toHaveBeenCalledTimes(1); // unchanged: no write
  });
});
