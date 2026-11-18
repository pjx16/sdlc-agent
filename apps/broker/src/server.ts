import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { GitHubApi, GitHubApiError, type AppConfig } from './github';
import { Store } from './store';

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_BODY = 4096;
const REGISTRATIONS_PER_HOUR = 20;
/** The store file is one JSON document; registration stops here so it cannot grow without limit. */
export const MAX_CLIENTS = 1000;

/** The rate-limit key of an address: IPv6 addresses are grouped by their /64, since one machine owns billions of them. */
export function addressKey(ip: string): string {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4) return v4[1] as string;
  if (!ip.includes(':')) return ip;
  const [head = ''] = ip.split('::');
  const groups = head.split(':').slice(0, 4);
  while (groups.length < 4) groups.push('0');
  return groups.map((g) => g || '0').join(':');
}

export interface BrokerOptions {
  app: AppConfig;
  /** Where GitHub sends people after installing the App, as the browser sees it. */
  publicUrl: string;
  store: Store;
  /** When set, `POST /v1/clients` needs this value in the `X-Registration-Secret` header: a private broker that is not open to everyone. */
  registrationSecret?: string;
  api?: GitHubApi;
  now?: () => number;
}

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const page = (res: ServerResponse, status: number, title: string, text: string): void => {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${esc(title)}</h1><p>${esc(text)}</p></body>`);
};

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'The request is too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'The body is not JSON');
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The token broker. A system registers once and gets a key; it installs the GitHub App through the broker (which checks that the person who
 * installed it can really see that installation); after that it can ask for a token for any repository of its installations. A token lasts an
 * hour and works on that one repository only. The App's private key never leaves this service.
 */
export function createBroker(opts: BrokerOptions): Server {
  const now = opts.now ?? Date.now;
  const api = opts.api ?? new GitHubApi(opts.app, fetch, now);
  const store = opts.store;
  const registrations = new Map<string, number[]>();
  let identity: { name: string; email: string } | null = null;

  /** The system a request comes from; anything without a valid key stops here with 401. */
  const client = (req: IncomingMessage): string => {
    const id = store.authenticate(req.headers.authorization);
    if (id === null) throw new HttpError(401, 'Unknown or missing key');
    return id;
  };

  const routes: Record<string, Handler> = {
    'GET /health': async (_req, res) => send(res, 200, { ok: true }),

    'POST /v1/clients': async (req, res) => {
      const ip = addressKey(req.socket.remoteAddress ?? 'unknown');
      if (opts.registrationSecret && req.headers['x-registration-secret'] !== opts.registrationSecret) throw new HttpError(401, 'Registration needs the registration secret');
      store.pruneClients();
      if (store.clientCount() >= MAX_CLIENTS) throw new HttpError(503, 'Registration is closed');
      const recent = (registrations.get(ip) ?? []).filter((t) => now() - t < 3_600_000);
      if (recent.length >= REGISTRATIONS_PER_HOUR) throw new HttpError(429, 'Too many registrations from this address');
      registrations.set(ip, [...recent, now()]);
      send(res, 201, { key: store.createClient() });
    },

    'POST /v1/install/start': async (req, res) => {
      const state = store.newInstallState(client(req));
      send(res, 200, { url: `${opts.publicUrl.replace(/\/$/, '')}/install/begin?state=${state}` });
    },

    // The install page: it ties the state to this browser with an HttpOnly cookie, then sends the person to GitHub. A link that skips this
    // page (state sent straight to someone else) arrives at the callback without the cookie and is refused.
    'GET /install/begin': async (_req, res, url) => {
      const state = url.searchParams.get('state') ?? '';
      const nonce = store.beginInstall(state);
      if (!nonce) return page(res, 400, 'This link has expired', 'Start the connection again from the dashboard.');
      const secure = opts.publicUrl.startsWith('https:') ? '; Secure' : '';
      res.writeHead(302, {
        Location: `https://github.com/apps/${opts.app.slug}/installations/new?state=${state}`,
        'Set-Cookie': `sdlc_install=${nonce}; HttpOnly; SameSite=Lax; Path=/install; Max-Age=900${secure}`,
        'Cache-Control': 'no-store',
      });
      res.end();
    },

    'GET /install/callback': async (req, res, url) => {
      const installationId = Number(url.searchParams.get('installation_id'));
      const state = url.searchParams.get('state') ?? '';
      const code = url.searchParams.get('code') ?? '';
      const nonce = /(?:^|;\s*)sdlc_install=([a-f0-9]{32})/.exec(req.headers.cookie ?? '')?.[1] ?? '';
      const clientId = store.takeInstallState(state, nonce);
      if (!clientId || !Number.isInteger(installationId) || !code) return page(res, 400, 'This link has expired', 'Start the connection again from the dashboard, in the same browser.');
      let installer: { account: string } | null;
      try {
        // The id in the address can be forged, and seeing an installation is not owning it: the person must be its account or an org admin.
        installer = await api.verifyInstaller(code, installationId);
      } catch {
        return page(res, 502, 'Could not check with GitHub', 'Try again in a moment.');
      }
      if (!installer) return page(res, 403, 'Not your installation', 'Only the account that owns the installation, or an admin of its organisation, can connect it.');
      // Not bound yet: the person reads a code here and types it into the dashboard of the system that started the install. A link sent
      // to somebody else's browser therefore cannot connect their installation to the sender's system.
      const pairingCode = store.createPairing(clientId, installationId, installer.account);
      page(res, 200, 'One more step', `Enter this code in the sdlc-agent dashboard to finish connecting: ${pairingCode}`);
    },

    'POST /v1/install/confirm': async (req, res) => {
      const clientId = client(req);
      const taken = store.takePairing(clientId, String((await readJson(req)).code ?? ''));
      if (taken === 'locked') throw new HttpError(429, 'Too many wrong codes. Start the connection again later.');
      if (!taken) throw new HttpError(404, 'That code is wrong or has expired. Start the connection again.');
      if (!store.bind(taken.installationId, clientId, taken.account)) throw new HttpError(409, 'This installation is connected to another system. Disconnect it there first.');
      send(res, 200, { account: taken.account });
    },

    'GET /v1/installations': async (req, res) => send(res, 200, { installations: store.installationsOf(client(req)) }),

    'POST /v1/token': async (req, res) => {
      const clientId = client(req);
      const repo = String((await readJson(req)).repo ?? '');
      if (!REPO.test(repo)) throw new HttpError(400, 'repo must look like owner/name');
      const installation = await api.repoInstallation(repo);
      if (!installation) throw new HttpError(404, `The sdlc-agent GitHub App is not installed on ${repo}`);
      if (!store.isBoundTo(installation.id, clientId)) throw new HttpError(403, `${repo} belongs to an installation that was not connected from this system`);
      const { token, expiresAt } = await api.installationToken(installation.id, repo.split('/')[1] as string);
      identity ??= await api.botIdentity().catch(() => null);
      send(res, 200, { token, expiresAt, identity });
    },
  };

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', opts.publicUrl);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'not_found' });
    handler(req, res, url).catch((err: unknown) => {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      if (err instanceof GitHubApiError) return send(res, 502, { error: 'GitHub could not be reached' });
      send(res, 500, { error: 'The broker failed' });
    });
  });
}
