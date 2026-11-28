import type { ProjectView } from '@/lib/types';

/** What a confirmed project is, at a glance. Everything else is under Advanced settings. */
export function ProjectSummary({ project }: { project: ProjectView }) {
  const gh = project.settings.github;
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
        <dd>{gh.mode === 'projects' && gh.project ? `GitHub board ${gh.project.owner}/${gh.project.number}, and pasted tickets` : gh.mode === 'issues' ? `GitHub issues labelled "${gh.label}", and pasted tickets` : 'Pasted tickets only'}</dd>
        <dt className="text-muted">Plans</dt>
        <dd>Committed to the knowledge-base folder of the repository</dd>
      </dl>
    </div>
  );
}
