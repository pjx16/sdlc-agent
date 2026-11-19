import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/**
 * Keys for the LLM gateway, one per running agent container. The agent runner issues one before a container starts and revokes it when
 * the container is gone, so only a live stage can spend the Claude account: not another container on the agent network, not a finished
 * run, and not anything else that reaches the worker.
 */
@Injectable()
export class GatewayTokens {
  private readonly live = new Set<string>();

  issue(): string {
    const token = `sdlc-gw-${randomBytes(32).toString('base64url')}`;
    this.live.add(token);
    return token;
  }

  revoke(token: string): void {
    this.live.delete(token);
  }

  isLive(token: string | undefined): boolean {
    return !!token && this.live.has(token);
  }
}
