import { AutoRefresh } from '@/components/auto-refresh';
import { CreateTicketButton } from '@/components/create-ticket/create-ticket-button';
import { TicketFilters, TicketsTable } from '@/components/tickets-table';
import { apiGet } from '@/lib/server-api';
import { ticketFormData } from '@/lib/ticket-form-data';
import type { ProjectView, TicketListItem } from '@/lib/types';

/** The tickets list. `openCreate` opens the New ticket window on load (the /tickets/new address). */
export async function TicketsView({ project, status, openCreate = false }: { project?: string; status?: string; openCreate?: boolean }) {
  const query = new URLSearchParams();
  if (project) query.set('projectId', project);
  if (status) query.set('status', status);
  const [tickets, projects, formData] = await Promise.all([
    apiGet<TicketListItem[]>(`/tickets${query.size > 0 ? `?${query}` : ''}`).then((r) => r ?? []),
    apiGet<ProjectView[]>('/projects').then((r) => r ?? []),
    ticketFormData(),
  ]);
  return (
    <section>
      <AutoRefresh />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tickets</h1>
        <CreateTicketButton data={formData} defaultOpen={openCreate} />
      </div>
      <div className="mt-6">
        <TicketFilters projects={projects.map((p) => ({ id: p.id, name: p.name }))} filters={{ projectId: project, status }} />
      </div>
      <TicketsTable tickets={tickets} filtered={Boolean(project || status)} />
    </section>
  );
}
