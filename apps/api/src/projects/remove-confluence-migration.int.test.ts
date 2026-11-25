import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

const MIGRATIONS = path.resolve(process.cwd(), 'prisma/migrations');
const THIS_ONE = '20261125140000_remove_confluence';

/** The Confluence integration is removed: its columns and settings go, everything else stays. */
describe('migration: remove Confluence', () => {
  let admin: Client;
  let db: Client;
  const name = `m_${randomBytes(6).toString('hex')}`;

  beforeAll(async () => {
    admin = new Client({ connectionString: inject('pgAdminUrl') });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(inject('pgAdminUrl'));
    url.pathname = `/${name}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    for (const dir of readdirSync(MIGRATIONS).filter((d) => /^\d/.test(d)).sort()) {
      if (dir >= THIS_ONE) break;
      await db.query(readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8'));
    }
    const settings = JSON.stringify({ gates: { plan: true }, confluence: { spaceKey: 'ENG', parentPageId: '123' }, jiraWriteBack: { comments: true } });
    const proposal = JSON.stringify({
      facts: { github: { defaultBranch: 'main', languages: [] }, jira: null, confluence: { spaces: [{ key: 'ENG', name: 'Engineering' }] } },
      advice: { statusMap: {}, intakeLabel: 'sdlc-agent', confluenceSpaceKey: 'ENG' },
      accepted: { label: true, confluence: true },
      createdAt: 'x',
    });
    await db.query(`INSERT INTO "Project" ("id","name","repoUrl","stack","testCmdTemplate","localKeyPrefix","settings","onboardingProposal","updatedAt") VALUES ('p1','Billing','https://x/y','ts_node','x {files}','B',$1::jsonb,$2::jsonb, now())`, [settings, proposal]);
    await db.query(`INSERT INTO "Project" ("id","name","repoUrl","stack","testCmdTemplate","localKeyPrefix","updatedAt") VALUES ('p2','Plain','https://x/z','ts_node','x {files}','P', now())`);
    await db.query(`INSERT INTO "Ticket" ("id","projectId","key","source","title","status","updatedAt") VALUES ('t1','p1','B-1','paste','A ticket','PLANNING', now())`);
    await db.query(`INSERT INTO "StageArtifact" ("id","ticketId","stage","version","data","externalUrl","externalId","externalVersion","externalSig") VALUES ('a1','t1','plan',1,'{"planMarkdown":"## Goal"}','https://acme.atlassian.net/wiki/x','99',3,'sig')`);
    await db.query(readFileSync(path.join(MIGRATIONS, THIS_ONE, 'migration.sql'), 'utf8'));
  }, 180_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('drops the page columns and keeps the plan itself', async () => {
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'StageArtifact'`)).rows.map((r) => r.column_name as string);
    expect(cols.filter((c) => c.startsWith('external'))).toEqual([]);
    expect((await db.query(`SELECT data FROM "StageArtifact" WHERE id = 'a1'`)).rows[0].data).toEqual({ planMarkdown: '## Goal' });
  });

  it('removes the Confluence setting and keeps the other settings', async () => {
    const s = (await db.query(`SELECT settings FROM "Project" WHERE id = 'p1'`)).rows[0].settings;
    expect(s).toEqual({ gates: { plan: true }, jiraWriteBack: { comments: true } });
    expect((await db.query(`SELECT settings FROM "Project" WHERE id = 'p2'`)).rows[0].settings).toEqual({});
  });

  it('removes Confluence from a proposal that was not confirmed yet, and leaves the rest', async () => {
    const p = (await db.query(`SELECT "onboardingProposal" AS p FROM "Project" WHERE id = 'p1'`)).rows[0].p;
    expect(p.facts).toEqual({ github: { defaultBranch: 'main', languages: [] }, jira: null });
    expect(p.advice).toEqual({ statusMap: {}, intakeLabel: 'sdlc-agent' });
    expect(p.accepted).toEqual({ label: true });
    expect(p.createdAt).toBe('x');
    expect((await db.query(`SELECT "onboardingProposal" AS p FROM "Project" WHERE id = 'p2'`)).rows[0].p).toBeNull();
  });
});
