import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Logger, Optional, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { DEFAULT_JIRA_MCP_URL, ErrorCodes } from '@sdlc/shared';
import { ApiException } from '../common/api-exception';
import { parseBody } from '../common/parse-body';
import { authorizeUrl, discoverOAuth, exchangeCode, pkce, registerClient, type PendingSignIn } from '../jira/rovo-oauth';
import { CredentialTester } from './credential-tester';
import { CredentialsService } from './credentials.service';

export const JIRA_OAUTH_FETCH = Symbol('JIRA_OAUTH_FETCH');

const PENDING_MS = 10 * 60_000;
const MAX_PENDING = 20;

/**
 * The dashboard origin the browser is on. Atlassian accepts loopback redirect URIs out of the box; any other domain must be allowed by an
 * org admin (Atlassian Administration → Rovo → Rovo MCP server), so plain http is accepted for loopback only.
 */
const StartBodySchema = z
  .object({
    origin: z
      .string()
      .trim()
      .regex(/^(https:\/\/[A-Za-z0-9.-]+(:\d+)?|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/, 'must be the dashboard origin, like http://localhost:3000'),
  })
  .strict();

/** "Connect Jira" for Rovo MCP mode: OAuth 2.1 with dynamic client registration and PKCE. Both routes need a dashboard session. */
@Controller('jira-mcp/oauth')
export class JiraOAuthController {
  private readonly logger = new Logger(JiraOAuthController.name);
  private readonly pending = new Map<string, PendingSignIn>();
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly creds: CredentialsService,
    private readonly tester: CredentialTester,
    @Optional() @Inject(JIRA_OAUTH_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  /** Registers a client for this dashboard's callback URL and returns the Atlassian consent URL to open. */
  @Post('start')
  @HttpCode(HttpStatus.OK)
  async start(@Body() body: unknown): Promise<{ authorizeUrl: string; redirectUri: string }> {
    const { origin } = parseBody(StartBodySchema, body ?? {}, 'Invalid request');
    const resource = (await this.creds.resolve()).jira_mcp_url || DEFAULT_JIRA_MCP_URL;
    const redirectUri = `${origin}/api/jira-mcp/oauth/callback`;
    try {
      const server = await discoverOAuth(resource, this.fetchImpl);
      const clientId = await registerClient(server, redirectUri, this.fetchImpl);
      const { verifier, challenge, state } = pkce();
      this.prune();
      this.pending.set(state, { clientId, tokenEndpoint: server.tokenEndpoint, resource, redirectUri, verifier, returnTo: `${origin}/setup/connections`, expiresAt: Date.now() + PENDING_MS });
      return { authorizeUrl: authorizeUrl(server, { clientId, redirectUri, resource, state, challenge }), redirectUri };
    } catch (err) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, ErrorCodes.jiraError, `Could not start the Atlassian sign-in: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Atlassian sends the browser back here. The grant is stored encrypted, then the browser returns to the Connections page. */
  @Get('callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Query('error_description') description: string | undefined, @Res() res: Response): Promise<void> {
    const pending = state ? this.pending.get(state) : undefined;
    if (state) this.pending.delete(state);
    if (!pending || pending.expiresAt < Date.now()) {
      res.status(400).type('text/plain').send('This sign-in link has expired or was already used. Start again from Settings → Connections.');
      return;
    }
    const back = (params: Record<string, string>) => res.redirect(302, `${pending.returnTo}?${new URLSearchParams(params).toString()}`);
    if (error || !code) {
      back({ jira_mcp: 'error', message: [error ?? 'no code', description].filter(Boolean).join(': ').slice(0, 300) });
      return;
    }
    try {
      const grant = await exchangeCode(pending, code, this.fetchImpl);
      await this.creds.set('jira_mcp_oauth', JSON.stringify(grant));
      const test = await this.tester.test('jira_mcp_oauth');
      back(test.ok ? { jira_mcp: 'connected', message: test.message } : { jira_mcp: 'error', message: test.message.slice(0, 300) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Rovo MCP sign-in failed: ${message}`);
      back({ jira_mcp: 'error', message: message.slice(0, 300) });
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expiresAt < now) this.pending.delete(k);
    while (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value as string);
  }
}
