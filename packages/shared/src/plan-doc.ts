/** Where a ticket's plan is kept in the repository: `<kbDir>/plans/<KEY>.md`. */
export function planDocPath(kbDir: string, ticketKey: string): string {
  return `${kbDir.replace(/\/+$/, '')}/plans/${ticketKey.replace(/[^A-Za-z0-9._-]/g, '_')}.md`;
}

/** The states in which the plan file is on the ticket's branch (it is committed when the ticket reaches the KB update). */
const PLAN_FILE_STATES: readonly string[] = ['AWAITING_CI', 'IN_HUMAN_REVIEW'];

/** A link to the plan file on GitHub, or null when it is not there (yet, or any more) or the repository is not on github.com. */
export function planFileUrl(args: { repoUrl: string; branch: string | null; kbDir: string; key: string; status: string }): string | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(args.repoUrl.trim());
  if (!m || !args.branch || !PLAN_FILE_STATES.includes(args.status)) return null;
  return `https://github.com/${m[1]}/${m[2]}/blob/${args.branch.split('/').map(encodeURIComponent).join('/')}/${planDocPath(args.kbDir, args.key).split('/').map(encodeURIComponent).join('/')}`;
}
