import { TicketsView } from '@/components/tickets-view';

export const dynamic = 'force-dynamic';

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ project?: string; status?: string }> }) {
  const { project, status } = await searchParams;
  return <TicketsView project={project} status={status} />;
}
