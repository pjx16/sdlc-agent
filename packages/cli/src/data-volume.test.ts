import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DECRYPT, DUMP, ENCRYPT } from './backup';
import { legacyDataDir, retireDataDir } from './data-volume';
import { getEnv } from './envfile';

describe('moving a 0.0.1 install into the data volume', () => {
  it('finds the old host data folder only when it exists and holds something', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'legacy-'));
    const empty = path.join(root, 'empty');
    const full = path.join(root, 'full');
    mkdirSync(empty);
    mkdirSync(path.join(full, 'mirrors'), { recursive: true });
    writeFileSync(path.join(full, 'empty-file'), '');
    expect(legacyDataDir(`DATA_DIR=${full}\n`)).toBe(full);
    expect(legacyDataDir(`DATA_DIR=${empty}\n`)).toBeNull();
    expect(legacyDataDir(`DATA_DIR=${path.join(root, 'gone')}\n`)).toBeNull();
    expect(legacyDataDir('DATA_DIR=relative/data\n')).toBeNull();
    expect(legacyDataDir('SDLC_VERSION=1.0.0\n')).toBeNull();
  });

  it('comments DATA_DIR out of .env and says where its contents went', () => {
    const env = retireDataDir('SDLC_VERSION=0.0.1\nDATA_DIR=/home/me/.sdlc-agent/data\nLOG_LEVEL=info\n', '1.0.0');
    expect(getEnv(env, 'DATA_DIR')).toBeUndefined();
    expect(env).toContain('# DATA_DIR=/home/me/.sdlc-agent/data\n# Moved into the sdlc_data Docker volume by sdlc-agent upgrade to 1.0.0.');
    expect(getEnv(env, 'LOG_LEVEL')).toBe('info');
  });
});

describe('backup commands', () => {
  it('encrypt and decrypt with the same cipher and key derivation, reading the key from the environment', () => {
    for (const cmd of [ENCRYPT, DECRYPT]) {
      expect(cmd).toContain('-aes-256-cbc -pbkdf2 -iter 200000');
      expect(cmd).toContain('-pass env:BACKUP_KEY');
    }
    expect(ENCRYPT).toContain('-salt');
    expect(DUMP).toMatch(/^set -o pipefail; pg_dump .* \| gzip \| openssl enc /);
  });
});
