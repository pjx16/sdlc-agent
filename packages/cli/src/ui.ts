/** Errors the user should see as one line, and small output helpers. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

const tty = () => Boolean(process.stdout.isTTY);
const paint = (code: number, text: string) => (tty() ? `\x1b[${code}m${text}\x1b[0m` : text);

export const red = (t: string) => paint(31, t);
export const green = (t: string) => paint(32, t);
export const yellow = (t: string) => paint(33, t);
export const dim = (t: string) => paint(2, t);

export const out = (line = '') => process.stdout.write(`${line}\n`);

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** `SDLC_AGENT_VERBOSE=1` (or `--verbose`) shows the raw output of long steps instead of a progress line. */
export const verbose = () => process.env.SDLC_AGENT_VERBOSE === '1';

export interface StepResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** What a long step is given to run with: raw output to the terminal (verbose) or a line callback for the progress display. */
export interface StepIo {
  inherit?: boolean;
  onLine?: (line: string) => void;
}

/**
 * Runs one long step with visible progress. On a terminal: a spinner, the label, the time spent and the latest line the step printed.
 * Elsewhere (pipes, CI): plain `▸ label…` and `✔ label` lines, no control characters. A failed step prints what it wrote.
 */
export async function runStep<T extends StepResult>(label: string, run: (io: StepIo) => Promise<T>): Promise<T> {
  if (verbose()) {
    out(`${label}…`);
    return run({ inherit: true });
  }
  const started = Date.now();
  const secs = () => `${Math.round((Date.now() - started) / 1000)}s`;
  let latest = '';
  let timer: NodeJS.Timeout | undefined;
  let frame = 0;
  const width = () => Math.max(40, (process.stdout.columns ?? 100) - 4);
  const draw = () => {
    const text = `${FRAMES[frame++ % FRAMES.length]} ${label} (${secs()})${latest ? ` ${dim(`· ${latest}`)}` : ''}`;
    process.stdout.write(`\r\x1b[2K${tty() ? truncate(text, width()) : text}`);
  };
  if (tty()) {
    draw();
    timer = setInterval(draw, 100);
  } else {
    out(`▸ ${label}…`);
  }
  let result: T;
  try {
    result = await run({ onLine: (l) => (latest = l) });
  } finally {
    if (timer) clearInterval(timer);
  }
  const mark = result.code === 0 ? green('✔') : red('✖');
  if (tty()) process.stdout.write('\r\x1b[2K');
  out(`${mark} ${label} (${secs()})`);
  if (result.code !== 0) {
    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (text) out(dim(text.split('\n').slice(-40).join('\n')));
  }
  return result;
}

/** Cuts to `max` visible characters; escape sequences (colours) are not counted. */
function truncate(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
  return plain.length <= max ? text : `${plain.slice(0, max - 1)}…`;
}
