import type { ProjectView } from '@/lib/types';
import { jiraModeLabel } from '@/lib/jira-modes';

/** What a confirmed project is, at a glance. Everything else is under Advanced settings. */
export function ProjectSummary({ project }: { project: ProjectView }) {
  const routing = Object.entries(project.settings.jiraIssueTypeRouting ?? {});
  return (
    <div className="panel p-4 text-sm">
      <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-1">
        <dt className="text-muted">Repository</dt>
        <dd>{project.repoUrl}</dd>
        <dt className="text-muted">GitHub access</dt>
        <dd>{project.githubAuth === 'bot' ? 'sdlc-agent-bot (GitHub App)' : 'Personal token from Settings'}</dd>
        <dt className="text-muted">Branch</dt>
        <dd className="font-mono text-xs">{project.baseBranch}</dd>
        <dt className="text-muted">Stack</dt>
        <dd>{project.stack}</dd>
        <dt className="text-muted">Tickets</dt>
        <dd>{project.jiraMode !== 'off' && project.jiraProjectKey ? `Jira ${project.jiraProjectKey} (${jiraModeLabel(project.jiraMode)}), and pasted tickets` : 'Pasted tickets only'}</dd>
        {routing.length > 0 && (
          <>
            <dt className="text-muted">Issue types</dt>
            <dd>{routing.map(([t, k]) => `${t} → ${k === 'ignore' ? 'ignored' : k}`).join(', ')}</dd>
          </>
        )}
        <dt className="text-muted">Plans</dt>
        <dd>Committed to the knowledge-base folder of the repository</dd>
      </dl>
    </div>
  );
}
