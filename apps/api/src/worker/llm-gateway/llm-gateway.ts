import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable, Transform } from 'node:stream';
import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService } from '../../credentials/credentials.service';
import { WorkerConfig } from '../worker-config';
import { GatewayTokens } from './gateway-tokens';

/** The only calls an agent may make to Anthropic. Anything else (the Files API, batches, admin calls) is refused. */
const ALLOWED = new Set(['POST /v1/messages', 'POST /v1/messages/count_tokens']);
/** Headers never passed on: the agent's own credentials (it must not be able to use another account) and connection details. */
const DROPPED = new Set(['authorization', 'x-api-key', 'cookie', 'host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'proxy-authorization', 'upgrade', 'te', 'trailer', 'accept-encoding']);
const MAX_BODY = 64 * 1024 * 1024;
const OAUTH_BETA = 'oauth-2025-04-20';

const refuse = (res: ServerResponse, status: number, message: string): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'gateway_error', message } }));
};

/**
 * The Anthropic API key never enters an agent container. Agents call this gateway (ANTHROPIC_BASE_URL) on the agent network; it drops whatever
 * credentials the agent sent, adds the subscription token itself and forwards `POST /v1/messages` to Anthropic, nothing else.
 * An agent that reads its own environment finds no token, and cannot use the gateway for anything but messages. Each request must carry
 * the per-run key from GatewayTokens, so nothing but a running stage can use it.
 */
@Injectable()
export class LlmGateway {
  private readonly logger = new Logger(LlmGateway.name);
  private server: Server | null = null;

  constructor(
    private readonly config: WorkerConfig,
    private readonly creds: CredentialsService,
    private readonly tokens: GatewayTokens,
  ) {}

  /** Replaced in tests. (Not a constructor argument: Nest would try to inject it.) */
  fetchImpl: typeof fetch = fetch;

  async start(port = this.config.llmGatewayPort): Promise<number> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
        this.logger.warn(`Gateway request failed: ${err instanceof Error ? err.message : String(err)}${cause}`);
        if (!res.headersSent) refuse(res, 502, 'The gateway could not reach Anthropic');
        else res.end();
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(port, '0.0.0.0', resolve));
    const address = this.server.address();
    return typeof address === 'object' && address ? address.port : port;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://gateway');
    if (!ALLOWED.has(`${req.method} ${url.pathname}`)) return refuse(res, 403, 'Only POST /v1/messages is allowed');
    // The per-run key the agent runner gave this container (Claude Code sends ANTHROPIC_API_KEY as x-api-key).
    const bearer = /^Bearer (.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
    const key = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : bearer;
    if (!this.tokens.isLive(key)) return refuse(res, 401, 'Unknown or expired gateway key');
    const token = (await this.creds.resolve()).anthropic_api_key;
    if (!token) return refuse(res, 503, 'No Anthropic API key is set');

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (DROPPED.has(name) || value === undefined) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    headers.set('authorization', `Bearer ${token}`);
    const betas = (headers.get('anthropic-beta') ?? '').split(',').map((b) => b.trim()).filter(Boolean);
    if (!betas.includes(OAUTH_BETA)) betas.push(OAUTH_BETA);
    headers.set('anthropic-beta', betas.join(','));

    let size = 0;
    const body = Readable.toWeb(
      req.pipe(new Transform({
        transform(chunk: Buffer, _enc, cb) {
          size += chunk.length;
          cb(size > MAX_BODY ? new Error('The request is too large') : null, chunk);
        },
      })),
    ) as ReadableStream;
    const upstream = await this.fetchImpl(`${this.config.llmGatewayUpstream}${url.pathname}${url.search}`, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);

    const out: Record<string, string> = {};
    upstream.headers.forEach((value, name) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name)) out[name] = value;
    });
    res.writeHead(upstream.status, out);
    if (!upstream.body) return void res.end();
    Readable.fromWeb(upstream.body as never).pipe(res);
  }
}
