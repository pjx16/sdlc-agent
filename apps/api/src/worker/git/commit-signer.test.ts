import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitAll } from './commit';
import { CommitSigner, SigningError } from './commit-signer';
import { GitRunner } from './git-runner';

let root: string;
const ENV = process.env.ENCRYPTION_KEY;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' }).toString();
const runner = new GitRunner({ token: async () => '' });
const identity = { name: 'Bot', email: 'bot@example.test' };

function fakePrisma() {
  const row: { id: string; signingPublicKey: string | null; signingPrivateKeyEnc: string | null } = { id: 'global', signingPublicKey: null, signingPrivateKeyEnc: null };
  return {
    row,
    prisma: {
      globalSettings: {
        findUnique: vi.fn(async () => ({ ...row })),
        findUniqueOrThrow: vi.fn(async () => ({ ...row })),
        upsert: vi.fn(async () => row),
        updateMany: vi.fn(async ({ where, data }: { where: { signingPublicKey: null }; data: typeof row }) => {
          if (where.signingPublicKey === null && row.signingPublicKey !== null) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
    },
  };
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'signer-'));
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  if (ENV === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ENV;
});

describe('CommitSigner', () => {
  let repo: string;
  let tmp: string;
  beforeEach(() => {
    repo = mkdtempSync(path.join(root, 'repo-'));
    tmp = mkdtempSync(path.join(root, 'tmp-'));
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(repo, 'a.txt'), 'a');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '--no-gpg-sign', '-m', 'init');
  });

  it('makes one key, keeps the private half encrypted, and reuses it', async () => {
    const { prisma, row } = fakePrisma();
    const signer = new CommitSigner(prisma as never, tmp);
    const pub = await signer.ensureKey();
    expect(pub).toMatch(/^ssh-ed25519 AAAA/);
    expect(row.signingPrivateKeyEnc).toMatch(/^v1\./);
    expect(row.signingPrivateKeyEnc).not.toContain('OPENSSH');
    expect(await signer.ensureKey()).toBe(pub);
    expect(prisma.globalSettings.updateMany).toHaveBeenCalledTimes(1);
    expect(readdirSync(tmp)).toEqual([]); // no key file is left behind
  });

  it('signs a commit that verifies against the public key, and leaves no key file behind', async () => {
    const { prisma } = fakePrisma();
    const signer = new CommitSigner(prisma as never, tmp);
    const pub = await signer.ensureKey();
    writeFileSync(path.join(repo, 'b.txt'), 'b');
    const result = await commitAll(runner, repo, 'feat: add b', identity, { signer });
    expect(result.committed).toBe(true);
    expect(git(repo, 'cat-file', 'commit', 'HEAD')).toContain('-----BEGIN SSH SIGNATURE-----');
    const allowed = path.join(root, `allowed-${path.basename(repo)}`);
    writeFileSync(allowed, `${identity.email} namespaces="git" ${pub}\n`);
    expect(git(repo, '-c', 'gpg.format=ssh', '-c', `gpg.ssh.allowedSignersFile=${allowed}`, 'log', '-1', '--format=%G?')).toBe('G\n');
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('gives the key file to git as 0600 in a private folder, only while signing', async () => {
    const { prisma } = fakePrisma();
    const signer = new CommitSigner(prisma as never, tmp);
    let seen = '';
    await signer.withSigning(async (cfg) => {
      seen = cfg.find((c) => c.startsWith('user.signingkey='))!.split('=')[1]!;
      expect(statSync(seen).mode & 0o777).toBe(0o600);
      expect(statSync(path.dirname(seen)).mode & 0o777).toBe(0o700);
      expect(cfg).toContain('commit.gpgsign=true');
    });
    expect(existsSync(seen)).toBe(false);
  });

  it('fails closed: no unsigned commit when the key cannot be used, and the change stays staged', async () => {
    const { prisma, row } = fakePrisma();
    const signer = new CommitSigner(prisma as never, tmp);
    await signer.ensureKey();
    row.signingPrivateKeyEnc = 'v1.broken.broken.broken';
    writeFileSync(path.join(repo, 'c.txt'), 'c');
    const before = git(repo, 'rev-parse', 'HEAD');
    await expect(commitAll(runner, repo, 'feat: add c', identity, { signer })).rejects.toBeInstanceOf(SigningError);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(repo, 'diff', '--cached', '--name-only')).toContain('c.txt');
  });

  it('cannot make a key without ENCRYPTION_KEY', async () => {
    const { prisma } = fakePrisma();
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      await expect(new CommitSigner(prisma as never, tmp).ensureKey()).rejects.toThrow(/ENCRYPTION_KEY/);
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });

  it('without a signer a commit is made as before (tests and tools only; the worker always has one)', async () => {
    writeFileSync(path.join(repo, 'd.txt'), 'd');
    await commitAll(runner, repo, 'feat: add d', identity, {});
    expect(git(repo, 'cat-file', 'commit', 'HEAD')).not.toContain('SSH SIGNATURE');
  });
});
