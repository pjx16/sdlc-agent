import { spawn } from 'node:child_process';
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { compose, composeArgs } from './compose';
import { getEnv } from './envfile';
import { confirm } from './prompt';
import { CliError, out, yellow } from './ui';

/**
 * Database backups: `pg_dump`, gzipped, then encrypted with AES-256 (OpenSSL, a PBKDF2 key from the install's ENCRYPTION_KEY with a
 * fresh salt per file). Everything runs inside the postgres container, so only the encrypted file reaches the host. gzip's checksum
 * makes a damaged or wrong-key file fail to restore instead of loading garbage. The daily backups use the same commands (backup.sh).
 */
export const ENCRYPT = 'openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_KEY';
export const DECRYPT = 'openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_KEY';
export const DUMP = `set -o pipefail; pg_dump -U sdlc -d sdlc --no-owner | gzip | ${ENCRYPT}`;
export const BACKUP_SUFFIX = '.sql.gz.enc';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** The key that opens this install's backups: its ENCRYPTION_KEY (which also encrypts the tokens inside the database). */
export function backupKey(dir: string): string {
  const envFile = path.join(dir, '.env');
  const key = existsSync(envFile) ? getEnv(readFileSync(envFile, 'utf8'), 'ENCRYPTION_KEY') : undefined;
  if (!key) throw new CliError(`No ENCRYPTION_KEY in ${envFile}: backups cannot be encrypted or opened without it.`);
  return key;
}

/** Writes an encrypted backup of the running database to backups/<prefix>-<time>.sql.gz.enc and returns its path. */
export async function writeBackup(dir: string, prefix: string): Promise<string> {
  const file = path.join(dir, 'backups', `${prefix}-${stamp()}${BACKUP_SUFFIX}`);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const part = `${file}.part`;
  const child = spawn('docker', composeArgs(dir, ['exec', '-T', '-e', 'BACKUP_KEY', 'postgres', 'bash', '-c', DUMP]), {
    stdio: ['ignore', 'pipe', 'pipe'],
    // The key goes in through the environment, never on a command line that `ps` would show.
    env: { ...process.env, BACKUP_KEY: backupKey(dir) },
  });
  let stderr = '';
  child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
  const exited = new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? 1)));
  await pipeline(child.stdout, createWriteStream(part, { mode: 0o600 }));
  if ((await exited) !== 0) {
    rmSync(part, { force: true });
    throw new CliError(`The database backup failed: ${stderr.trim().split('\n').pop() ?? 'pg_dump error'}`);
  }
  chmodSync(part, 0o600);
  renameSync(part, file);
  return file;
}

/** `sdlc-agent backup`: an encrypted backup now. */
export async function backupNow(dir: string): Promise<void> {
  const file = await writeBackup(dir, 'manual');
  out(`Encrypted database backup written to ${file}`);
  out(yellow(`Keep ${path.join(dir, '.env')} safe as well: its ENCRYPTION_KEY is the only way to open this backup.`));
}

/** `sdlc-agent restore <file>`: replaces the database with a backup, recreating the database volume if it was deleted. */
export async function restore(dir: string, file: string | undefined, yes: boolean): Promise<void> {
  if (!file) throw new CliError('Name the backup to restore: sdlc-agent restore <file> (see the backups folder of the installation).');
  const source = path.resolve(file);
  if (!existsSync(source)) throw new CliError(`No such file: ${source}`);
  const encrypted = source.endsWith('.enc');
  if (!encrypted && !source.endsWith('.sql.gz')) throw new CliError('A backup is a .sql.gz.enc file (or a .sql.gz one from before 1.0.0).');
  if (!yes && !(await confirm(`Replace the current database with ${path.basename(source)}? Everything since that backup is lost.`))) throw new CliError('Cancelled.');

  const key = encrypted ? backupKey(dir) : '';
  out('Stopping the app and starting the database…');
  await compose(dir, ['stop', 'api', 'worker', 'dashboard', 'backup']);
  if ((await compose(dir, ['up', '-d', '--wait', 'postgres'])).code !== 0) throw new CliError('The database did not start. See `sdlc-agent logs postgres`.');

  const recreate = await compose(dir, ['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'sdlc', '-d', 'postgres', '-c', 'DROP DATABASE IF EXISTS sdlc WITH (FORCE)', '-c', 'CREATE DATABASE sdlc OWNER sdlc']);
  if (recreate.code !== 0) throw new CliError(`Could not reset the database: ${recreate.stderr.trim()}`);

  const load = `set -o pipefail; ${encrypted ? `${DECRYPT} | ` : ''}gunzip | psql -q -v ON_ERROR_STOP=1 -U sdlc -d sdlc >/dev/null`;
  const child = spawn('docker', composeArgs(dir, ['exec', '-T', '-e', 'BACKUP_KEY', 'postgres', 'bash', '-c', load]), {
    stdio: ['pipe', 'ignore', 'pipe'],
    env: { ...process.env, BACKUP_KEY: key },
  });
  let stderr = '';
  child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
  const exited = new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? 1)));
  await pipeline(createReadStream(source), child.stdin);
  if ((await exited) !== 0) {
    const why = /bad decrypt|wrong final block|not in gzip format|invalid compressed data/i.test(stderr)
      ? 'it could not be decrypted with this installation\'s ENCRYPTION_KEY, or the file is damaged'
      : (stderr.trim().split('\n').pop() ?? 'psql error');
    throw new CliError(`The restore failed: ${why}. The database is now empty; restore another backup, then run \`sdlc-agent up\`.`);
  }
  if ((await compose(dir, ['up', '-d'])).code !== 0) throw new CliError('Restored, but the stack did not start. Run `sdlc-agent up`.');
  out(`Restored ${path.basename(source)}. Repository mirrors that are missing are cloned again by themselves.`);
}
