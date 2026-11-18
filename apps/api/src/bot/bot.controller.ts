import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ErrorCodes } from '@sdlc/shared';
import { ApiException } from '../common/api-exception';
import { CredentialsService } from '../credentials/credentials.service';
import { BrokerClient, BrokerError } from '../broker/broker-client';

export interface BotStatus {
  /** This system is registered with the token broker. */
  connected: boolean;
  /** GitHub accounts or organisations where the sdlc-agent App is installed for this system. */
  installations: { id: number; account: string }[];
  /** Set when the broker could not be asked. */
  error: string | null;
}

/**
 * Connecting this system to sdlc-agent-bot (the sdlc-agent GitHub App, through the token broker). Authenticated like every other route.
 * No GitHub token is involved: the person approves the App on GitHub, which repositories it may use, and the broker hands out short-lived tokens.
 */
@Controller('bot')
export class BotController {
  constructor(
    private readonly creds: CredentialsService,
    private readonly broker: BrokerClient,
  ) {}

  @Get()
  async status(): Promise<BotStatus> {
    if (!(await this.broker.isConnected())) return { connected: false, installations: [], error: null };
    try {
      return { connected: true, installations: (await this.broker.installations()).installations, error: null };
    } catch (err) {
      return { connected: true, installations: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Registers this system with the broker when it is not yet, and returns the GitHub page where the person installs the App. */
  @Post('connect')
  @HttpCode(HttpStatus.OK)
  async connect(): Promise<{ url: string }> {
    try {
      if (!(await this.broker.isConnected())) await this.creds.set('broker_key', (await this.broker.register()).key);
      return await this.broker.startInstall();
    } catch (err) {
      const tooMany = err instanceof BrokerError && err.status === 429;
      throw new ApiException(tooMany ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.BAD_GATEWAY, tooMany ? ErrorCodes.tooManyRequests : ErrorCodes.brokerError, `Could not reach the sdlc-agent-bot broker: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Finishes connecting an installation with the code GitHub's return page showed. */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Body() body: { code?: unknown }): Promise<{ account: string }> {
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!/^[A-Za-z0-9]{8}$/.test(code)) throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCodes.validation, 'The code has 8 letters and digits');
    try {
      return await this.broker.confirmInstall(code);
    } catch (err) {
      const status = err instanceof BrokerError && [404, 409, 429].includes(err.status) ? err.status : HttpStatus.BAD_GATEWAY;
      throw new ApiException(status, status === 429 ? ErrorCodes.tooManyRequests : status === 404 ? ErrorCodes.notFound : status === 409 ? ErrorCodes.conflict : ErrorCodes.brokerError, err instanceof Error ? err.message : String(err));
    }
  }

  /** Forgets the connection. Projects that work as the bot stop working until it is connected again. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(): Promise<void> {
    await this.creds.remove('broker_key');
  }
}
