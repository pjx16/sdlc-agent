import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { prReadyItem } from './support-listener';
import { SupportRaiser } from './support-raiser';

/**
 * A ticket in IN_HUMAN_REVIEW must always have an open "ready for human review" item, because it is how a person ends the review. Items
 * dismissed before dismissing was replaced by Mark done / Mark failed left such tickets stuck: this raises them again, once at start-up.
 */
@Injectable()
export class PrReviewBackfill implements OnApplicationBootstrap {
  private readonly logger = new Logger(PrReviewBackfill.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly raiser: SupportRaiser,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.warn(`Could not re-raise the PR review items: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Returns how many items were raised. */
  async run(): Promise<number> {
    const tickets = await this.prisma.ticket.findMany({ where: { status: 'IN_HUMAN_REVIEW', supportTickets: { none: { kind: 'pr_ready', status: 'open' } } } });
    for (const ticket of tickets) await this.raiser.raise(prReadyItem(ticket));
    return tickets.length;
  }
}
