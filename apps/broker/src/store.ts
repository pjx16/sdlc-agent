import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface ClientRecord {
  secretHash: string;
  createdAt: string;
}
interface BindingRecord {
  clientId: string;
  account: string;
  boundAt: string;
}
interface StateRecord {
  clientId: string;
  expiresAt: number;
  /** Hash of the nonce held by the browser that opened the install page; null until that page was opened. */
  nonceHash?: string | null;
}
interface Saved {
  clients: Record<string, ClientRecord>;
  bindings: Record<string, BindingRecord>;
  states: Record<string, StateRecord>;
}

const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
const STATE_TTL_MS = 15 * 60_000;
/** What a system's key and an install state look like. Anything else is refused before it is looked up. */
const KEY_FORMAT = /^([a-f0-9]{16})\.([A-Za-z0-9_-]{20,128})$/;
const STATE_FORMAT = /^[a-f0-9]{32}$/;

/**
 * A small JSON file. The broker has few clients and rare writes, so nothing heavier is needed. Records live in Maps, never in plain objects
 * keyed by what a caller sent, so a key like "__proto__" can only ever be a missing entry.
 */
export class Store {
  private readonly clients = new Map<string, ClientRecord>();
  private readonly bindings = new Map<number, BindingRecord>();
  private readonly states = new Map<string, StateRecord>();
  /** Installations proven at GitHub, waiting for the system that started the install to confirm the code shown to the installer. Memory only. */
  private readonly pairings = new Map<string, { clientId: string; installationId: number; account: string; expiresAt: number }>();
  private readonly wrongCodes = new Map<string, number[]>();

  constructor(
    private readonly file: string | null,
    private readonly now: () => number = Date.now,
  ) {
    if (file && existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<Saved>;
      for (const [id, c] of Object.entries(saved.clients ?? {})) this.clients.set(id, c);
      for (const [id, b] of Object.entries(saved.bindings ?? {})) this.bindings.set(Number(id), b);
      for (const [s, v] of Object.entries(saved.states ?? {})) this.states.set(s, v);
    }
  }

  /** What is written to the file. */
  serialize(): string {
    const saved: Saved = { clients: Object.fromEntries(this.clients), bindings: Object.fromEntries([...this.bindings].map(([id, b]) => [String(id), b])), states: Object.fromEntries(this.states) };
    return JSON.stringify(saved);
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.serialize(), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** Forgets systems that registered more than 30 days ago and never connected an installation, so abandoned registrations do not fill the file. */
  pruneClients(): void {
    const bound = new Set([...this.bindings.values()].map((b) => b.clientId));
    let removed = false;
    for (const [id, c] of this.clients) {
      if (!bound.has(id) && this.now() - Date.parse(c.createdAt) > 30 * 24 * 3_600_000) {
        this.clients.delete(id);
        removed = true;
      }
    }
    if (removed) this.save();
  }

  clientCount(): number {
    return this.clients.size;
  }

  /** Registers a system and returns its key (shown once): `<id>.<secret>`. */
  createClient(): string {
    const id = randomBytes(8).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    this.clients.set(id, { secretHash: hash(secret), createdAt: new Date(this.now()).toISOString() });
    this.save();
    return `${id}.${secret}`;
  }

  /** The id of the system an `Authorization: Bearer <key>` header belongs to, or null. */
  authenticate(authorization: string | undefined): string | null {
    const header = /^Bearer (\S+)$/.exec(authorization ?? '');
    const key = KEY_FORMAT.exec(header?.[1] ?? '');
    if (!key) return null;
    const [, id, secret] = key as unknown as [string, string, string];
    const client = this.clients.get(id);
    if (!client) return null;
    const a = Buffer.from(client.secretHash);
    const b = Buffer.from(hash(secret));
    return a.length === b.length && timingSafeEqual(a, b) ? id : null;
  }

  newInstallState(clientId: string): string {
    this.prune();
    const state = randomBytes(16).toString('hex');
    this.states.set(state, { clientId, expiresAt: this.now() + STATE_TTL_MS });
    this.save();
    return state;
  }

  /** Called when the install page is opened in a browser: ties the state to that browser. Returns the nonce for its cookie, or null. */
  beginInstall(state: string): string | null {
    if (!STATE_FORMAT.test(state)) return null;
    const s = this.states.get(state);
    if (!s || s.expiresAt <= this.now() || s.nonceHash) return null;
    const nonce = randomBytes(16).toString('hex');
    s.nonceHash = hash(nonce);
    this.save();
    return nonce;
  }

  /** Uses up a state (once only) and says whose install it was. The browser must hold the nonce its install page set. */
  takeInstallState(state: string, nonce: string): string | null {
    if (!STATE_FORMAT.test(state)) return null;
    const s = this.states.get(state);
    this.states.delete(state);
    this.save();
    if (!s || s.expiresAt <= this.now() || !s.nonceHash) return null;
    const a = Buffer.from(s.nonceHash);
    const b = Buffer.from(hash(nonce));
    return a.length === b.length && timingSafeEqual(a, b) ? s.clientId : null;
  }

  /** A short code, shown on the page the person lands on after installing. Only they can read it, so only they can finish the connection. */
  createPairing(clientId: string, installationId: number, account: string): string {
    this.pruneMemory();
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    this.pairings.set(code, { clientId, installationId, account, expiresAt: this.now() + STATE_TTL_MS });
    return code;
  }

  /** The pairing for a code, used up, only when the system asking is the one that started the install. Five wrong codes in 15 minutes lock the system out. */
  takePairing(clientId: string, code: string): { installationId: number; account: string } | 'locked' | null {
    this.pruneMemory();
    const recent = (this.wrongCodes.get(clientId) ?? []).filter((t) => this.now() - t < STATE_TTL_MS);
    if (recent.length >= 5) return 'locked';
    const p = this.pairings.get(code.trim().toUpperCase());
    if (!p || p.clientId !== clientId) {
      this.wrongCodes.set(clientId, [...recent, this.now()]);
      return null;
    }
    this.pairings.delete(code.trim().toUpperCase());
    return { installationId: p.installationId, account: p.account };
  }

  private pruneMemory(): void {
    for (const [k, v] of this.pairings) if (v.expiresAt <= this.now()) this.pairings.delete(k);
  }

  /** Binds an installation to a system. An installation already bound to another system is never taken over: returns false. */
  bind(installationId: number, clientId: string, account: string): boolean {
    const existing = this.bindings.get(installationId);
    if (existing && existing.clientId !== clientId) return false;
    this.bindings.set(installationId, { clientId, account, boundAt: new Date(this.now()).toISOString() });
    this.save();
    return true;
  }

  isBoundTo(installationId: number, clientId: string): boolean {
    return this.bindings.get(installationId)?.clientId === clientId;
  }

  installationsOf(clientId: string): { id: number; account: string }[] {
    return [...this.bindings].filter(([, b]) => b.clientId === clientId).map(([id, b]) => ({ id, account: b.account }));
  }

  private prune(): void {
    for (const [k, v] of this.states) if (v.expiresAt <= this.now()) this.states.delete(k);
  }
}
