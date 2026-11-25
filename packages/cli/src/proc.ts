import { type SpawnOptions, spawn } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  /** Stream the child's output to ours instead of capturing it. */
  inherit?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Called with every complete line the child prints (split on newline and carriage return). The output is still captured. */
  onLine?: (line: string) => void;
}

/** Runs a program with an argument array. Never uses a shell. A missing program resolves with code 127. */
export function run(command: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const options: SpawnOptions = { cwd: opts.cwd, env: opts.env ?? process.env, stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] };
    const child = spawn(command, [...args], options);
    let stdout = '';
    let stderr = '';
    const lines = opts.onLine ? lineSplitter(opts.onLine) : null;
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString();
      lines?.push(c.toString());
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
      lines?.push(c.toString());
    });
    child.on('error', (err) => resolve({ code: 127, stdout, stderr: stderr || err.message }));
    child.on('close', (code) => {
      lines?.flush();
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Turns chunks into lines. Docker redraws progress with `\r`, so both `\n` and `\r` end a line; empty lines are skipped. */
export function lineSplitter(onLine: (line: string) => void): { push: (chunk: string) => void; flush: () => void } {
  let rest = '';
  const emit = (line: string) => {
    const t = line.trim();
    if (t) onLine(t);
  };
  return {
    push(chunk) {
      const parts = (rest + chunk).split(/[\r\n]+/);
      rest = parts.pop() ?? '';
      parts.forEach(emit);
    },
    flush() {
      emit(rest);
      rest = '';
    },
  };
}
