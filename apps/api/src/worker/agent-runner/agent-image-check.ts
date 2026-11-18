import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Housekeeper } from '../loop/worker-loop';
import { WorkerConfig } from '../worker-config';
import { CONTAINER_ENGINE, type ContainerEngine, missingImageMessage } from './container-engine';

/**
 * Looks for the agent image every minute and records the answer on the worker status, so the dashboard can say so when it is
 * gone (a prune, a fresh Docker) instead of the first ticket failing with a Docker error. It never pulls or builds anything.
 */
@Injectable()
export class AgentImageCheck implements Housekeeper {
  readonly name = 'agent-image';
  readonly intervalMs = 60_000;
  private readonly logger = new Logger(AgentImageCheck.name);
  private last: string | null | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WorkerConfig,
    @Inject(CONTAINER_ENGINE) private readonly engine: ContainerEngine,
  ) {}

  async check(): Promise<void> {
    let error: string | null;
    try {
      error = (await this.engine.imageExists(this.config.agentImage)) ? null : missingImageMessage(this.config.agentImage);
    } catch (err) {
      error = `Docker could not be asked about the agent image: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (error === this.last) return;
    this.last = error;
    if (error) this.logger.error(error);
    else this.logger.log(`Agent image ${this.config.agentImage} is available`);
    await this.prisma.workerStatus.updateMany({ where: { id: 'worker' }, data: { agentImageError: error } });
  }
}
