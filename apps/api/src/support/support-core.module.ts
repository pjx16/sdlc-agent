import { Global, Module } from '@nestjs/common';
import { PrReviewBackfill } from './pr-review-backfill';
import { SupportRaiser } from './support-raiser';
import { SupportTransitionListener } from './support-listener';

/** What raises and closes support tickets, with no controller: the state machine, the worker and the credential checks all use it. */
@Global()
@Module({ providers: [SupportRaiser, SupportTransitionListener, PrReviewBackfill], exports: [SupportRaiser, SupportTransitionListener] })
export class SupportCoreModule {}
