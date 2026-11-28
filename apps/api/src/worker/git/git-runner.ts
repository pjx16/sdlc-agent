import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Used when GIT_ASKPASS is not set (local development); the worker image sets it. */
export const DEFAULT_ASKPASS = path.resolve(__dirname, '../../../../../docker/worker/git-askpass-token');

/**
 * Prepended to every worker git call. The workspace is written by agents, so nothing in its git config is trusted:
 * no hooks (including pre-commit, commit-msg and pre-push), no fsmonitor, no credential helpers, and only https
 * (remote) and file (the mirror to workspace clone) transports.
 */
export const HARDENING_FLAGS: readonly string[] = [
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '-c', 'credential.helper=',
  '-c', 'protocol.allow=never',
  '-c', 'protocol.https.allow=always',
  '-c', 'protocol.file.allow=always',
  // A nested repository (sub/.git/config) written by an agent must not make a worker git call run anything or report on it.
  '-c', 'submodule.recurse=false',
  '-c', 'diff.ignoreSubmodules=all',
  '-c', 'status.submoduleSummary=false',
  '-c', 'core.pager=cat',
];

/** `safe.directory` for one folder only (the system-wide `*` is gone), so git does not refuse an agent-written workspace as "dubious ownership". */
export const safeDirectory = (cwd: string | undefined): string[] => (cwd ? ['-c', `safe.directory=${path.resolve(cwd)}`] : []);

/** The few variables git and gh children get. Never the worker's own environment: it holds ENCRYPTION_KEY, DATABASE_URL and the tokens. */
const PASSED_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'GIT_ASKPASS'];
export function minimalGitEnv(extra: Record<string, string> = {}, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of PASSED_ENV) if (source[k] !== undefined) env[k] = source[k] as string;
  // The operator's own git config through the environment (GIT_CONFIG_COUNT, _KEY_n, _VALUE_n). The worker's environment is trusted; the agent's is not and never reaches here.
  for (const [k, v] of Object.entries(source)) if (v !== undefined && /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(k)) env[k] = v;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', ...extra };
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface GitRunOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Extra environment (for example the commit identity). */
  env?: Record<string, string>;
  /** Run repository hooks. Always false for the worker: hooks of a target repository never run there (F5, 6.2). */
  hooks?: boolean;
  /** Stops the git process when aborted (onboarding's deadline or a cancel). */
  signal?: AbortSignal;
}

export interface GitRunnerConfig {
  /** The GitHub token for the call (its folder and arguments say which repository), looked up every time so a token entered in the dashboard takes effect without a restart. */
  token: (ctx: { cwd?: string; args: readonly string[] }) => Promise<string>;
}

/**
 * Runs the git CLI. The GitHub token only ever reaches git through the GIT_ASKPASS helper's environment:
 * never in a URL, never in a git config file.
 */
export class GitRunner {
  constructor(private readonly config: GitRunnerConfig) {}

  async run(args: readonly string[], opts: GitRunOptions = {}): Promise<{ stdout: string; stderr: string }> {
    const token = await this.config.token({ cwd: opts.cwd, args });
    const full = opts.hooks ? [...safeDirectory(opts.cwd), ...args] : [...HARDENING_FLAGS, ...safeDirectory(opts.cwd), ...args];
    try {
      const { stdout, stderr } = await exec('git', full, {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 10 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
        signal: opts.signal,
        env: minimalGitEnv({ GIT_ASKPASS: process.env.GIT_ASKPASS ?? DEFAULT_ASKPASS, GITHUB_TOKEN: token, ...opts.env }),
      });
      return { stdout, stderr };
    } catch (err) {
      const e = err as { stderr?: string; code?: number | string; killed?: boolean; message?: string; name?: string };
      if (opts.signal?.aborted || e.name === 'AbortError') throw new GitError('git was stopped', args, '', null);
      let stderr = (e.stderr ?? e.message ?? '').toString().trim();
      if (token) stderr = stderr.split(token).join('***');
      const first = stderr.split('\n').find((l) => /^(fatal|error|remote):/i.test(l.trim())) ?? stderr.split('\n')[0] ?? 'git failed';
      throw new GitError(e.killed ? 'git timed out' : first.slice(0, 500), args, stderr, typeof e.code === 'number' ? e.code : null);
    }
  }

  async out(args: readonly string[], opts: GitRunOptions = {}): Promise<string> {
    return (await this.run(args, opts)).stdout.trim();
  }
}
