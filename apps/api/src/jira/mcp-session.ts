import { JiraHttpError, JiraUnavailableError } from './jira-client';

/** How a session authenticates: a header value, and a way to get a fresh one after a 401 (OAuth refresh). */
export interface McpAuth {
  header(): Promise<string>;
  /** Called once after a 401. Returns true when a new credential is ready and the call should be tried again. */
  refresh?(): Promise<boolean>;
}

export interface McpSessionOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Backoff between retries: 1 s, 4 s, 16 s. */
  backoffMs?: readonly number[];
  timeoutMs?: number;
}

export interface McpTool {
  name: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PROTOCOL = '2025-06-18';
const DEFAULT_BACKOFF = [1000, 4000, 16000] as const;
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * A Model Context Protocol client over streamable HTTP (JSON-RPC by POST; answers come as JSON or as an SSE stream), with plain fetch.
 * Failures map onto the Jira errors the pipeline already handles: network errors, 429 and 5xx are retried and end in
 * JiraUnavailableError (intake pauses); other HTTP errors and tool errors are JiraHttpError (401/403 raise a credential support item).
 */
export class McpSession {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly backoff: readonly number[];
  private readonly timeoutMs: number;
  private sessionId: string | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private tools: McpTool[] | null = null;

  constructor(
    private readonly url: string,
    private readonly auth: McpAuth,
    options: McpSessionOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.backoff = options.backoffMs ?? DEFAULT_BACKOFF;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  /** The server's tools, read once per session. */
  async listTools(): Promise<McpTool[]> {
    if (!this.tools) this.tools = ((await this.call('tools/list', {})).tools ?? []) as McpTool[];
    return this.tools;
  }

  /** Calls a tool and returns its text content parsed as JSON (or `{ text }` when it is not JSON). A tool error throws JiraHttpError. */
  async tool<T = Json>(name: string, args: Json): Promise<T> {
    const result = await this.call('tools/call', { name, arguments: args });
    const text = ((result.content ?? []) as Json[]).filter((c) => c.type === 'text').map((c) => String(c.text)).join('\n');
    if (result.isError) throw new JiraHttpError(toolErrorStatus(text), `Jira (MCP ${name}): ${text.slice(0, 300) || 'tool error'}`);
    if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return { text } as T;
    }
  }

  /** One JSON-RPC request; opens the session first. A session the server forgot (404) is opened again once. */
  async call(method: string, params: Json): Promise<Json> {
    if (method !== 'initialize') await this.open();
    try {
      return await this.send(method, params);
    } catch (err) {
      if (err instanceof JiraHttpError && err.status === 404 && this.sessionId && method !== 'initialize') {
        this.reset();
        await this.open();
        return this.send(method, params);
      }
      throw err;
    }
  }

  private open(): Promise<void> {
    this.ready ??= (async () => {
      await this.send('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'sdlc-agent', version: '1' } });
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => undefined);
    })().catch((err: unknown) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  private reset(): void {
    this.sessionId = null;
    this.ready = null;
    this.tools = null;
  }

  private async send(method: string, params: Json): Promise<Json> {
    const id = this.nextId++;
    const text = await this.post({ jsonrpc: '2.0', id, method, params });
    const msg = parseRpc(text, id);
    if (msg.error) throw new JiraHttpError(400, `Jira (MCP ${method}): ${String(msg.error.message ?? JSON.stringify(msg.error))}`);
    return (msg.result ?? {}) as Json;
  }

  /** POST with retries; a 401 asks the auth for a fresh credential once. */
  private async post(body: Json): Promise<string> {
    const attempts = this.backoff.length + 1;
    let refreshed = false;
    let lastProblem = '';
    for (let attempt = 0; attempt < attempts; attempt++) {
      let res: Response | undefined;
      try {
        res = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: {
            authorization: await this.auth.header(),
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': PROTOCOL,
            ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (err instanceof JiraHttpError) throw err;
        lastProblem = `network error: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (res) {
        const sid = res.headers.get('mcp-session-id');
        if (sid) this.sessionId = sid;
        if (res.ok) return res.status === 202 || res.status === 204 ? '' : await res.text();
        if (res.status === 401 && !refreshed && this.auth.refresh) {
          refreshed = true;
          if (await this.auth.refresh()) {
            attempt--; // a refresh is not a failed attempt
            continue;
          }
        }
        if (res.status !== 429 && res.status < 500) throw new JiraHttpError(res.status, `Jira (MCP) ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
        lastProblem = `HTTP ${res.status}`;
      }
      if (attempt < attempts - 1) await this.sleep((res?.status === 429 ? retryAfterMs(res) : null) ?? (this.backoff[attempt] as number));
    }
    throw new JiraUnavailableError(`The Jira MCP server is unavailable after ${attempts} attempts (${lastProblem})`, attempts);
  }
}

/** A JSON answer, or the SSE `data:` event whose id matches. */
export function parseRpc(text: string, id: number): Json {
  const t = text.trim();
  if (!t) throw new JiraHttpError(502, 'Jira (MCP): empty answer');
  if (t.startsWith('{')) return JSON.parse(t) as Json;
  for (const block of t.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!data) continue;
    const msg = JSON.parse(data) as Json;
    if (msg.id === id) return msg;
  }
  throw new JiraHttpError(502, 'Jira (MCP): no JSON-RPC answer in the response');
}

/** Tool errors arrive as text: a permission or sign-in problem must still raise a credential support item. */
function toolErrorStatus(text: string): number {
  if (/\b401\b|unauthori[sz]ed|not authenticated|token (is )?(expired|invalid)|permission to connect via api token/i.test(text)) return 401;
  if (/\b403\b|forbidden|do(?:es)? not have permission|insufficient scope/i.test(text)) return 403;
  if (/\b404\b|does not exist|not found/i.test(text)) return 404;
  return 400;
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : null;
}
