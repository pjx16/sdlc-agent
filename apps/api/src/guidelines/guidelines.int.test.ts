import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EDITABLE_GUIDELINES, GUIDELINE_CATALOGUE, READABLE_GUIDELINES, formatSpec } from '@sdlc/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestApp, createTestApp } from '../testing/test-app';
import { type TestDatabase, createTestDatabase } from '../testing/test-db';
import { GuidelinesModule } from './guidelines.module';

describe('Guidelines API over HTTP', () => {
  let db: TestDatabase;
  let t: TestApp;
  let tmp: string;
  let root: string;
  let shipped: string;

  const put = (rel: string, text: string, where = root) => {
    mkdirSync(path.dirname(path.join(where, rel)), { recursive: true });
    writeFileSync(path.join(where, rel), text);
  };
  /** The shipped copy and the live copy both start with the same text for every file the catalogue names. */
  const seed = () => {
    for (const dir of [root, shipped]) for (const entry of ['agents', 'formats', 'stacks', 'default-CLAUDE.md', 'review-checklist.md', 'kb-doc-template.md']) rmSync(path.join(dir, entry), { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    mkdirSync(shipped, { recursive: true });
    for (const p of READABLE_GUIDELINES) {
      put(p, `# ${p}\n`, root);
      put(p, `# ${p}\n`, shipped);
    }
    // Files the catalogue does not name: they exist on disk, and must not be reachable.
    for (const p of ['agents/plugin/coder.md', 'agents/plugin-preamble.md', 'default-CLAUDE.md', 'stacks/nestjs.md']) put(p, '# hidden\n', root);
  };

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'sdlc-gl-http-'));
    root = path.join(tmp, 'guidelines');
    shipped = path.join(tmp, 'guidelines.default');
    writeFileSync(path.join(tmp, 'secret.md'), 'secret');
    process.env.GUIDELINES_DIR = root;
    process.env.GUIDELINES_DEFAULT_DIR = shipped;
    seed(); // the folder must exist when the app starts: the service resolves its real path then
    db = await createTestDatabase();
    t = await createTestApp(db.url, [GuidelinesModule]);
  }, 180_000);
  afterAll(async () => {
    delete process.env.GUIDELINES_DEFAULT_DIR;
    await t?.close();
    await db?.drop();
    rmSync(tmp, { recursive: true, force: true });
  });
  beforeEach(seed);

  it('requires a session for every route', async () => {
    await t.anonymous.get('/guidelines').expect(401);
    await t.anonymous.get('/guidelines/catalogue').expect(401);
    await t.anonymous.get('/guidelines/agents/base/coder.md').expect(401);
    await t.anonymous.put('/guidelines/agents/base/coder.md').send({ content: 'x' }).expect(401);
    await t.anonymous.post('/guidelines/reset/agents/base/coder.md').expect(401);
  });

  describe('what is hidden', () => {
    it.each(['agents/plugin/coder.md', 'agents/plugin-preamble.md', 'default-CLAUDE.md', 'stacks/nestjs.md'])('%s cannot be read or written, and answers as if it did not exist', async (rel) => {
      expect((await t.agent.get(`/guidelines/${rel}`).expect(404)).body.error).toBe('not_found');
      await t.agent.put(`/guidelines/${rel}`).send({ content: 'pwned' }).expect(404);
      await t.agent.post(`/guidelines/reset/${rel}`).expect(404);
      expect(readFileSync(path.join(root, rel), 'utf8')).toBe('# hidden\n');
    });

    it('the pipeline part of an agent can be read but not written or reset', async () => {
      expect((await t.agent.get('/guidelines/agents/pipeline/coder.md').expect(200)).body.content).toBe('# agents/pipeline/coder.md\n');
      await t.agent.put('/guidelines/agents/pipeline/coder.md').send({ content: 'x' }).expect(404);
      await t.agent.post('/guidelines/reset/agents/pipeline/coder.md').expect(404);
      expect(readFileSync(path.join(root, 'agents/pipeline/coder.md'), 'utf8')).toBe('# agents/pipeline/coder.md\n');
    });

    it('the tree lists only what can be edited, with no empty folders', async () => {
      const tree = (await t.agent.get('/guidelines').expect(200)).body as { path: string; type: string; children?: unknown[] }[];
      const files: string[] = [];
      const walk = (nodes: { path: string; type: string; children?: unknown[] }[]) => nodes.forEach((n) => (n.type === 'file' ? files.push(n.path) : walk((n.children ?? []) as never)));
      walk(tree);
      expect(files.sort()).toEqual([...EDITABLE_GUIDELINES].sort());
      expect(tree.map((n) => n.path)).not.toContain('stacks');
      expect(files).not.toContain('agents/pipeline/coder.md');
    });
  });

  describe('reading and editing', () => {
    it('reads and edits a catalogue file through the wildcard route', async () => {
      expect((await t.agent.get('/guidelines/agents/base/coder.md').expect(200)).body).toEqual({ path: 'agents/base/coder.md', content: '# agents/base/coder.md\n' });
      await t.agent.put('/guidelines/agents/base/coder.md').send({ content: '# Coder v2' }).expect(200);
      expect(readFileSync(path.join(root, 'agents/base/coder.md'), 'utf8')).toBe('# Coder v2');
    });

    it('404s for a file the catalogue names but the folder lacks', async () => {
      rmSync(path.join(root, 'agents/base/coder.md'));
      expect((await t.agent.get('/guidelines/agents/base/coder.md').expect(404)).body.error).toBe('not_found');
    });

    it('rejects traversal attempts, including encoded ones, and never touches files outside the folder', async () => {
      for (const attack of ['..%2Fsecret.md', '%2e%2e/secret.md', 'agents/base/..%2F..%2F..%2Fsecret.md', '..%5Csecret.md']) {
        const get = await t.agent.get(`/guidelines/${attack}`);
        expect([400, 404], `GET ${attack}`).toContain(get.status);
        const write = await t.agent.put(`/guidelines/${attack}`).send({ content: 'pwned' });
        expect([400, 404], `PUT ${attack}`).toContain(write.status);
      }
      expect(readFileSync(path.join(tmp, 'secret.md'), 'utf8')).toBe('secret');
    });

    it('validates the body', async () => {
      expect((await t.agent.put('/guidelines/agents/base/coder.md').send({}).expect(400)).body.fields.content).toBe('required');
      expect((await t.agent.put('/guidelines/notes.txt').send({ content: 'x' }).expect(404)).body.error).toBe('not_found');
    });
  });

  describe('the catalogue', () => {
    it('lists every item, in order, with its label, its files, its model and its tweaks', async () => {
      const items = (await t.agent.get('/guidelines/catalogue').expect(200)).body as { id: string; label: string; editable: string; readonly?: string; model?: string; tweaks: string[]; customised: boolean; updatedAt: string | null }[];
      expect(items.map((i) => i.id)).toEqual(GUIDELINE_CATALOGUE.map((i) => i.id));
      expect(items.find((i) => i.id === 'agent:coder')).toMatchObject({ label: 'Coder', editable: 'agents/base/coder.md', readonly: 'agents/pipeline/coder.md', model: 'sonnet', customised: false });
      expect(items.find((i) => i.id === 'agent:coder')!.tweaks.length).toBeGreaterThan(0);
      expect(items.every((i) => typeof i.updatedAt === 'string')).toBe(true);
    });

    it('marks an item customised once its file differs from the shipped copy, and not for a trailing newline', async () => {
      const flag = async (id: string) => ((await t.agent.get('/guidelines/catalogue').expect(200)).body as { id: string; customised: boolean }[]).find((i) => i.id === id)!.customised;
      expect(await flag('agent:coder')).toBe(false);
      put('agents/base/coder.md', '# agents/base/coder.md');
      expect(await flag('agent:coder')).toBe(false); // only a newline differs
      put('agents/base/coder.md', '# agents/base/coder.md\r\n');
      expect(await flag('agent:coder')).toBe(false);
      await t.agent.put('/guidelines/agents/base/coder.md').send({ content: '# Coder, my way\n' }).expect(200);
      expect(await flag('agent:coder')).toBe(true);
      expect(await flag('agent:fixer')).toBe(false);
    });

    it('a format is compared with its default in the code', async () => {
      const flag = async () => ((await t.agent.get('/guidelines/catalogue').expect(200)).body as { id: string; customised: boolean }[]).find((i) => i.id === 'format:plan')!.customised;
      put('formats/plan.md', formatSpec('plan')!.default);
      expect(await flag()).toBe(false);
      put('formats/plan.md', `${formatSpec('plan')!.default}\n\nMy extra line.`);
      expect(await flag()).toBe(true);
    });

    it('reports when each file last changed', async () => {
      utimesSync(path.join(root, 'agents/base/coder.md'), new Date('2026-01-02T03:04:05Z'), new Date('2026-01-02T03:04:05Z'));
      const coder = ((await t.agent.get('/guidelines/catalogue').expect(200)).body as { id: string; updatedAt: string }[]).find((i) => i.id === 'agent:coder')!;
      expect(coder.updatedAt).toBe('2026-01-02T03:04:05.000Z');
    });

    it('a file that is missing is not reported as customised', async () => {
      rmSync(path.join(root, 'agents/base/coder.md'));
      const coder = ((await t.agent.get('/guidelines/catalogue').expect(200)).body as { id: string; customised: boolean; updatedAt: string | null }[]).find((i) => i.id === 'agent:coder')!;
      expect(coder).toMatchObject({ customised: false, updatedAt: null });
    });
  });

  describe('going back to the shipped text', () => {
    it('puts the shipped text back in an agent file, and the item is no longer customised', async () => {
      await t.agent.put('/guidelines/agents/base/coder.md').send({ content: '# changed' }).expect(200);
      const res = await t.agent.post('/guidelines/reset/agents/base/coder.md').expect(200);
      expect(res.body).toEqual({ path: 'agents/base/coder.md', content: '# agents/base/coder.md\n' });
      expect(readFileSync(path.join(root, 'agents/base/coder.md'), 'utf8')).toBe('# agents/base/coder.md\n');
      const coder = ((await t.agent.get('/guidelines/catalogue').expect(200)).body as { id: string; customised: boolean }[]).find((i) => i.id === 'agent:coder')!;
      expect(coder.customised).toBe(false);
    });

    it('puts a format back to its default in the code, even when the folder has no shipped copy of it', async () => {
      rmSync(path.join(shipped, 'formats/plan.md'));
      put('formats/plan.md', '# mine');
      const res = await t.agent.post('/guidelines/reset/formats/plan.md').expect(200);
      expect(res.body.content).toBe(formatSpec('plan')!.default);
      expect(readFileSync(path.join(root, 'formats/plan.md'), 'utf8')).toBe(formatSpec('plan')!.default);
    });

    it('says so when there is nothing shipped to go back to', async () => {
      rmSync(path.join(shipped, 'agents/base/coder.md'));
      const res = await t.agent.post('/guidelines/reset/agents/base/coder.md').expect(409);
      expect(res.body.message).toContain('no shipped copy');
    });
  });
});
