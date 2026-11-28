import type { PrismaService } from '../prisma/prisma.service';
import { BILLED_RUNS } from './spend';
import type { TicketCost } from './spend-analytics';

/**
 * Credits per ticket for the tickets that reached DONE since `since`: a ticket counts once however often it reached DONE, and its cost
 * is every billed stage run of its whole life (also the runs before `since`). Shared by the Usage page and the dashboard summary so
 * both show the same numbers.
 */
export async function finishedTicketCosts(prisma: PrismaService, since: Date): Promise<TicketCost[]> {
  const done = await prisma.stateTransition.findMany({ where: { toStatus: 'DONE', at: { gte: since } }, select: { ticketId: true }, distinct: ['ticketId'] });
  const ids = done.map((d) => d.ticketId);
  if (ids.length === 0) return [];
  const [tickets, costs] = await Promise.all([
    prisma.ticket.findMany({ where: { id: { in: ids } }, select: { id: true, key: true, title: true, kind: true } }),
    prisma.stageRun.groupBy({ by: ['ticketId'], where: { ...BILLED_RUNS, ticketId: { in: ids } }, _sum: { costUsd: true } }),
  ]);
  const byTicket = new Map(costs.map((c) => [c.ticketId, Number(c._sum.costUsd ?? 0)]));
  return tickets.map((t) => ({ ...t, credits: byTicket.get(t.id) ?? 0 }));
}
