import { ProjectsView } from '@/components/projects-view';

export const dynamic = 'force-dynamic';

/** The old address still works: it is the projects list with the New project modal open (`?manual=1` opens it in manual mode). */
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ manual?: string }> }) {
  const { manual } = await searchParams;
  return <ProjectsView openNewProject={manual === '1' ? 'manual' : 'quick'} />;
}
