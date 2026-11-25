import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { decrypt, encrypt, loadKey } from '../../credentials/crypto';
import { PrismaService } from '../../prisma/prisma.service';

const exec = promisify(execFile);
const KEY_NAME = 'commit-signing-key';

/** Signing a commit failed. The step stops: an unsigned commit is never pushed. */
export class SigningError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`Commit signing failed: ${message}`, options);
    this.name = 'SigningError';
  }
}

/** The git settings that make one commit signed with the SSH key at `keyFile`. */
export const signingConfig = (keyFile: string): string[] => ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${keyFile}`, '-c', 'commit.gpgsign=true'];

/**
 * The key that signs every commit the pipeline makes. It is an ed25519 SSH key made by the worker once; the public half is shown in the
 * dashboard to be added to GitHub as a signing key, the private half is stored encrypted with ENCRYPTION_KEY. It only ever exists as a file
 * for the length of one commit, in a private folder, in the worker: it is never given to an agent container.
 */
@Injectable()
export class CommitSigner implements OnApplicationBootstrap {
  private readonly logger = new Logger(CommitSigner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tmp: string = tmpdir(),
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureKey();
    } catch (err) {
      this.logger.error(`The commit signing key could not be made: ${err instanceof Error ? err.message : String(err)}. Commits will stop until it can be.`);
    }
  }

  /** The public key, made on the first call. */
  async ensureKey(): Promise<string> {
    const row = await this.prisma.globalSettings.findUnique({ where: { id: 'global' } });
    if (row?.signingPublicKey && row.signingPrivateKeyEnc) return row.signingPublicKey;
    const key = loadKey();
    if (!key) throw new SigningError('ENCRYPTION_KEY is not set, so the signing key cannot be stored');
    const dir = await mkdtemp(path.join(this.tmp, 'sdlc-keygen-'));
    try {
      const file = path.join(dir, 'key');
      await exec('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'sdlc-agent commit signing', '-f', file]);
      const publicKey = (await readFile(`${file}.pub`, 'utf8')).trim();
      const privateKey = await readFile(file, 'utf8');
      const data = { signingPublicKey: publicKey, signingPrivateKeyEnc: encrypt(key, KEY_NAME, privateKey) };
      await this.prisma.globalSettings.upsert({ where: { id: 'global' }, update: {}, create: { id: 'global' } });
      // Two processes may start together: only the first to write wins, the other reads the winner's key.
      const { count } = await this.prisma.globalSettings.updateMany({ where: { id: 'global', signingPublicKey: null }, data });
      if (count === 0) return (await this.prisma.globalSettings.findUniqueOrThrow({ where: { id: 'global' } })).signingPublicKey as string;
      this.logger.log('Made the key that signs the pipeline\'s commits. Add its public part to GitHub as a signing key (Settings → Connections).');
      return publicKey;
    } catch (err) {
      if (err instanceof SigningError) throw err;
      throw new SigningError(err instanceof Error ? err.message : String(err), { cause: err });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Runs `fn` with the git settings that sign a commit. The private key is a 0600 file in a private folder for exactly that long. */
  async withSigning<T>(fn: (gitConfig: string[]) => Promise<T>): Promise<T> {
    await this.ensureKey();
    const key = loadKey();
    const row = await this.prisma.globalSettings.findUniqueOrThrow({ where: { id: 'global' } });
    if (!key || !row.signingPrivateKeyEnc) throw new SigningError('the signing key is not available');
    let privateKey: string;
    try {
      privateKey = decrypt(key, KEY_NAME, row.signingPrivateKeyEnc);
    } catch (err) {
      throw new SigningError('the stored key cannot be decrypted with the current ENCRYPTION_KEY', { cause: err });
    }
    const dir = await mkdtemp(path.join(this.tmp, 'sdlc-sign-'));
    try {
      await chmod(dir, 0o700);
      const file = path.join(dir, 'key');
      await writeFile(file, privateKey, { mode: 0o600 });
      return await fn(signingConfig(file));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
