import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { compose } from './compose';
import { getEnv } from './envfile';
import { run } from './proc';
import { CliError, out } from './ui';

/** Repository mirrors, workspaces and run logs live in this Docker volume (inside Docker's VM), never in a host folder. */
export const DATA_VOLUME = 'sdlc_data';

/** The host DATA_DIR of an install from before 1.0.0, when that folder still exists and holds something; else null. */
export function legacyDataDir(envText: string): string | null {
  const dir = getEnv(envText, 'DATA_DIR');
  if (!dir || !path.isAbsolute(dir) || !existsSync(dir)) return null;
  return readdirSync(dir).length > 0 ? dir : null;
}

/** Comments DATA_DIR out of .env, saying where its contents went (it is kept, so nothing is lost if the folder is still needed). */
export function retireDataDir(envText: string, version: string): string {
  return envText.replace(/^DATA_DIR=(.*)$/m, (_line, value: string) => `# DATA_DIR=${value}\n# Moved into the ${DATA_VOLUME} Docker volume by sdlc-agent upgrade to ${version}. The folder above can be deleted.`);
}

/**
 * Copies the old host data folder into the data volume, with a short-lived container from an image already on the machine. The stack
 * must be stopped. Refuses when the volume already holds data, so it never overwrites anything.
 */
export async function moveIntoVolume(from: string, image: string): Promise<void> {
  const probe = await run('docker', ['run', '--rm', '-v', `${DATA_VOLUME}:/to`, image, 'sh', '-c', 'ls -A /to | head -n 1']);
  if (probe.code !== 0) throw new CliError(`Could not open the ${DATA_VOLUME} volume: ${probe.stderr.trim()}`);
  if (probe.stdout.trim() !== '') throw new CliError(`The ${DATA_VOLUME} volume already holds data, so ${from} was not copied into it. Remove DATA_DIR from .env if that data is current.`);
  out(`Moving ${from} into the ${DATA_VOLUME} volume (this can take a while for large repositories)…`);
  const copy = await run('docker', ['run', '--rm', '-v', `${from}:/from:ro`, '-v', `${DATA_VOLUME}:/to`, image, 'sh', '-c', 'cp -a /from/. /to/']);
  if (copy.code !== 0) throw new CliError(`Copying ${from} into the ${DATA_VOLUME} volume failed: ${copy.stderr.trim()}. Nothing was changed; the old version still uses ${from}.`);
}

/** A ticket key as the worker names workspace folders. */
const TICKET_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** `sdlc-agent files <ticket> [dest]`: copies a ticket's workspace out of the data volume to a host folder, on request only. */
export async function copyWorkspaceOut(dir: string, key: string | undefined, dest: string | undefined): Promise<void> {
  if (!key || !TICKET_KEY.test(key)) throw new CliError('Name a ticket: sdlc-agent files <TICKET-KEY> [destination folder].');
  const find = await compose(dir, ['exec', '-T', 'worker', 'find', '/data/workspaces', '-mindepth', '2', '-maxdepth', '2', '-type', 'd', '-name', key]);
  if (find.code !== 0) throw new CliError('The worker is not running. Start the stack with `sdlc-agent up` first.');
  const found = find.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (found.length === 0) throw new CliError(`No workspace for ${key}. Workspaces are removed some days after a ticket finishes.`);
  const target = path.resolve(dest ?? key);
  if (existsSync(target)) throw new CliError(`${target} already exists; choose another destination.`);
  const cp = await compose(dir, ['cp', `worker:${found[0]}`, target]);
  if (cp.code !== 0) throw new CliError(`Copying the workspace failed: ${cp.stderr.trim()}`);
  out(`Copied ${key}'s workspace to ${target}. It is a copy: changes there do not reach the pipeline.`);
}
