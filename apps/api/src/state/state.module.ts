import { Global, Module } from '@nestjs/common';
import { SupportCoreModule } from '../support/support-core.module';
import { SupportTransitionListener } from '../support/support-listener';
import { StateMachine, TRANSITION_LISTENERS } from './state-machine.service';

/** The state machine, with its support tickets raised and closed after every transition. */
@Global()
@Module({
  imports: [SupportCoreModule],
  providers: [
    { provide: TRANSITION_LISTENERS, useFactory: (support: SupportTransitionListener) => [support], inject: [SupportTransitionListener] },
    StateMachine,
  ],
  exports: [StateMachine],
})
export class StateModule {}
