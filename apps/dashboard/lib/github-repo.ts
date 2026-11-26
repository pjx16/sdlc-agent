import type { ProjectView } from '@/lib/types';

/** `https://github.com/owner/name(.git)` as `owner/name`, or null when it is not a GitHub repository. */
export function repoOf(repoUrl: string): string | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(repoUrl.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Where a new ticket's issue goes on GitHub, in words: the repository, and for a Projects board its board and column. */
export function githubTarget(project: Pick<ProjectView, 'repoUrl' | 'settings'>): { repo: string | null; board: string | null; column: string | null } | null {
  const gh = project.settings.github;
  if (gh.mode === 'off') return null;
  const column = [gh.statusMap.NEW, gh.statusMap.PLANNING].find((c): c is string => typeof c === 'string' && c.trim() !== '') ?? null;
  return {
    repo: repoOf(project.repoUrl),
    board: gh.mode === 'projects' && gh.project ? `${gh.project.owner}/${gh.project.number}` : null,
    column: gh.mode === 'projects' ? column : null,
  };
}
