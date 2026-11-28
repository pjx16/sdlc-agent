import { TicketsView } from '@/components/tickets-view';

export const dynamic = 'force-dynamic';

/** The old address still works: it is the tickets list with the New ticket window open. */
export default function NewTicketPage() {
  return <TicketsView openCreate />;
}
