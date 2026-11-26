import Link from 'next/link';
import { NewProjectButton } from '@/components/new-project/new-project-button';
import type { NewProjectMode } from '@/components/new-project/new-project-modal';
import { apiGet } from '@/lib/server-api';
import type { ProjectView } from '@/lib/types';

const MIRROR = {
  pending: { label: 'Cloning…', color: 'bg-grey' },
  ok: { label: 'Ready', color: 'bg-green' },
  failed: { label: 'Failed', color: 'bg-red' },
} as const;

const ONBOARDING: Record<string, string | undefined> = { profiling: 'Onboarding…', proposed: 'Waiting for your review', draft: 'Onboarding failed' };

/** The projects list. `openNewProject` opens the New project modal on load (the /projects/new link). */
export async function ProjectsView({ openNewProject }: { openNewProject?: NewProjectMode }) {
  const projects = (await apiGet<ProjectView[]>('/projects')) ?? [];
  return (
    <section>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <NewProjectButton defaultOpen={openNewProject} />
      </div>
      {projects.length === 0 ? (
        <div className="mt-6 text-sm text-muted">
          <p>No projects yet. A project is one repository sdlc-agent works on.</p>
          <p className="mt-1">Create one to start accepting tickets.</p>
        </div>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 font-normal">Name</th>
              <th className="py-2 font-normal">Repository</th>
              <th className="py-2 font-normal">Stack</th>
              <th className="py-2 font-normal">Mirror</th>
              <th className="py-2 font-normal">State</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="py-3">
                  <Link href={`/projects/${p.id}`} className="text-accent hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="py-3 text-muted">{p.repoUrl}</td>
                <td className="py-3">{p.stack}</td>
                <td className="py-3">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${MIRROR[p.mirrorStatus].color}`} />
                    {MIRROR[p.mirrorStatus].label}
                  </span>
                </td>
                <td className="py-3 text-muted">{ONBOARDING[p.onboardingStatus ?? 'confirmed'] ?? (p.enabled ? 'Enabled' : 'Disabled')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
