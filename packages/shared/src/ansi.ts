/** Terminal colour and cursor codes ("ESC[31m"). Built from the character code so no control character sits in a regex literal. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

/** Removes terminal colour codes from command output, so it reads as text in the dashboard, on GitHub and in notes. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}
