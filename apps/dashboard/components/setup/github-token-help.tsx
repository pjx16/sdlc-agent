/** GitHub's "new fine-grained token" page with the name and permissions pre-filled (the repositories are chosen on the page). */
export const GITHUB_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=sdlc-agent&description=Used+by+sdlc-agent+to+clone%2C+push+branches%2C+open+pull+requests+and+make+issues&contents=write&pull_requests=write&issues=write&metadata=read&actions=read&statuses=read';

export const GITHUB_PERMISSIONS: { name: string; level: string; why: string }[] = [
  { name: 'Contents', level: 'Read and write', why: 'clone the repository and push the ticket branch' },
  { name: 'Pull requests', level: 'Read and write', why: 'open the draft PR, mark it ready, comment on it' },
  { name: 'Issues', level: 'Read and write', why: 'make the issue of a ticket, comment on it, move it along' },
  { name: 'Projects', level: 'Read and write', why: 'only for an organisation or user board: read the cards, move them' },
  { name: 'Actions', level: 'Read', why: 'read CI results and failing logs' },
  { name: 'Commit statuses', level: 'Read', why: 'read check status on the PR' },
  { name: 'Metadata', level: 'Read', why: 'required by GitHub for every token' },
];

/** How to make the token: the link, where it may reach, and what it needs. Folded away until asked for. */
export function GithubTokenHelp() {
  return (
    <details className="mt-3 rounded-md border border-border px-3 py-2 text-sm text-muted">
      <summary className="cursor-pointer text-text">How do I create one?</summary>
      <div className="mt-3 space-y-3">
        <p>
          Create a <strong>fine-grained personal access token</strong>.{' '}
          <a href={GITHUB_TOKEN_URL} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            Open GitHub with the permissions pre-filled ↗
          </a>
        </p>
        <div>
          <p className="font-medium text-text">Repository access</p>
          <p>
            Choose <strong>Only select repositories</strong> and add every repository you will use here. The token owner must be the account or organisation that owns them. A token that cannot see a repository
            makes it fail with a 404.
          </p>
        </div>
        <div>
          <p className="font-medium text-text">Permissions</p>
          <ul className="mt-1 space-y-0.5" data-testid="github-permissions">
            {GITHUB_PERMISSIONS.map((p) => (
              <li key={p.name}>
                <span className="font-medium text-text">{p.name}</span>: {p.level} <span>— {p.why}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1">Do not grant Administration or any account permission.</p>
        </div>
        <p>A classic token also works: it needs the <code>repo</code> scope (and <code>project</code> for a board, and SSO authorisation for an organisation).</p>
      </div>
    </details>
  );
}
