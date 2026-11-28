import { apiGet } from '@/lib/server-api';
import type { GlobalSettingsView, ProjectView } from '@/lib/types';

/** What the create-ticket window needs, fetched by the page that has the button (the Tickets page, the Dashboard). */
export interface TicketFormData {
  projects: ProjectView[];
  /** The team's ticket format (guidelines/formats/ticket.md): the order of the sections of a ticket. */
  template: string;
  /** Whether a ticket also gets a GitHub issue: ask each time, always, or never. */
  githubIssueOnCreate: GlobalSettingsView['githubIssueOnCreate'];
}

export async function ticketFormData(): Promise<TicketFormData> {
  const [projects, template, system] = await Promise.all([
    apiGet<ProjectView[]>('/projects').then((r) => r ?? []),
    apiGet<{ content: string }>('/guidelines/formats/ticket.md').then((r) => r?.content ?? '', () => ''),
    apiGet<{ settings: GlobalSettingsView }>('/system').catch(() => null),
  ]);
  return { projects, template, githubIssueOnCreate: system?.settings.githubIssueOnCreate ?? 'ask' };
}
