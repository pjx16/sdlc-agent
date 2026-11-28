import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

const MIGRATIONS = path.resolve(process.cwd(), 'prisma/migrations');
const THIS_ONE = '20261128100000_remove_jira';

/** Jira is removed: its credentials, columns and settings go, and what history needs stays. Run on a database that holds Jira data. */
describe('migration: remove Jira', () => {
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
    const settings = JSON.stringify({
      gates: { plan: true },
      stages: { jiraConnector: { enabled: true, model: 'haiku', maxTurns: 8 }, implement: { maxTurns: 55 } },
      jiraWriteBack: { comments: true }, jiraSubtaskTypeName: 'Sub-task', jiraConnector: { serverName: 'Atlassian' }, jiraIssueTypeRouting: { Story: 'feature' },
      jiraStatusMap: { DONE: 'Closed' }, jiraApprovalStatuses: { plan: 'Plan OK' },
      github: { mode: 'projects', approval: { plan: 'Plan approved' } },
    });
    const proposal = JSON.stringify({
      facts: { github: { defaultBranch: 'main', languages: [], board: { columns: ['Todo'] } }, jira: { projectName: 'Billing' } },
      profile: { stack: 'nestjs' },
      advice: { statusMap: {}, intakeLabel: 'sdlc-agent' },
      board: { statusMap: {}, approval: { plan: null, breakdown: null }, intakeStatus: 'Todo', useDefaultColumns: true },
      accepted: { commands: true, statusMap: true, routing: true, label: true, board: true },
      createdAt: 'x',
    });
    await db.query(`INSERT INTO "Project" ("id","name","repoUrl","stack","testCmdTemplate","localKeyPrefix","jiraMode","jiraProjectKey","jiraJql","settings","onboardingProposal","updatedAt") VALUES ('p1','Billing','https://x/y','ts_node','x {files}','B','rest','BILL','project = BILL',$1::jsonb,$2::jsonb, now())`, [settings, proposal]);
    await db.query(`INSERT INTO "Project" ("id","name","repoUrl","stack","testCmdTemplate","localKeyPrefix","updatedAt") VALUES ('p2','Plain','https://x/z','ts_node','x {files}','P', now())`);
    await db.query(`INSERT INTO "Ticket" ("id","projectId","key","source","externalKey","title","status","updatedAt") VALUES ('t1','p1','BILL-1','jira','BILL-1','From Jira','PLANNING', now())`);
    await db.query(`INSERT INTO "StateTransition" ("id","ticketId","fromStatus","toStatus","actor","jiraStatusApplied","jiraSyncResult","jiraSyncError") VALUES ('s1','t1','NEW','KB','jira','In Progress','failed','boom')`);
    await db.query(`INSERT INTO "Credential" ("key","value","isSecret","updatedAt") VALUES ('jira_api_token','x',true, now()), ('jira_email','y',false, now()), ('github_token','keep',true, now())`);
    await db.query(`INSERT INTO "WorkerStatus" ("id","heartbeatAt","tickOutcome") VALUES ('intake-rest', now(), 'intake'), ('worker', now(), 'idle')`);
    await db.query(`INSERT INTO "Event" ("id","type","source","message") VALUES ('e1','jira','jira','Jira (REST) intake: 1 new ticket')`);
    await db.query(readFileSync(path.join(MIGRATIONS, THIS_ONE, 'migration.sql'), 'utf8'));
  }, 180_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  const columns = async (table: string) => (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table])).rows.map((r) => r.column_name as string);

  it('deletes the Jira credentials and keeps the others', async () => {
    expect((await db.query(`SELECT key FROM "Credential" ORDER BY key`)).rows.map((r) => r.key)).toEqual(['github_token']);
  });

  it('clears the old per-mode intake rows and keeps the worker row', async () => {
    expect((await db.query(`SELECT id FROM "WorkerStatus" ORDER BY id`)).rows.map((r) => r.id)).toEqual(['worker']);
  });

  it('drops the Jira columns, the sync bookkeeping, the intake switch and the two enums', async () => {
    expect((await columns('Project')).filter((c) => c.toLowerCase().includes('jira'))).toEqual([]);
    expect((await columns('StateTransition')).filter((c) => c.toLowerCase().includes('jira'))).toEqual([]);
    expect((await columns('GlobalSettings')).filter((c) => c.toLowerCase().includes('jira'))).toEqual([]);
    const types = (await db.query(`SELECT typname FROM pg_type WHERE typname IN ('JiraMode', 'JiraSyncResult')`)).rows;
    expect(types).toEqual([]);
  });

  it('strips the jira settings and the connector stage, and keeps everything else', async () => {
    const s = (await db.query(`SELECT settings FROM "Project" WHERE id = 'p1'`)).rows[0].settings;
    expect(s).toEqual({ gates: { plan: true }, stages: { implement: { maxTurns: 55 } }, github: { mode: 'projects', approval: { plan: 'Plan approved' } } });
    expect((await db.query(`SELECT settings FROM "Project" WHERE id = 'p2'`)).rows[0].settings).toEqual({});
  });

  it('takes the Jira advice and facts out of a proposal that was not confirmed, and keeps the board mapping', async () => {
    const p = (await db.query(`SELECT "onboardingProposal" AS p FROM "Project" WHERE id = 'p1'`)).rows[0].p;
    expect(p.advice).toBeUndefined();
    expect(p.facts).toEqual({ github: { defaultBranch: 'main', languages: [], board: { columns: ['Todo'] } } });
    expect(p.accepted).toEqual({ commands: true, board: true });
    expect(p.board).toMatchObject({ useDefaultColumns: true });
    expect((await db.query(`SELECT "onboardingProposal" AS p FROM "Project" WHERE id = 'p2'`)).rows[0].p).toBeNull();
  });

  it('keeps what history needs: a ticket that came from Jira, the old actor and the old events', async () => {
    expect((await db.query(`SELECT source FROM "Ticket" WHERE id = 't1'`)).rows[0].source).toBe('jira');
    expect((await db.query(`SELECT actor FROM "StateTransition" WHERE id = 's1'`)).rows[0].actor).toBe('jira');
    expect((await db.query(`SELECT source FROM "Event" WHERE id = 'e1'`)).rows[0].source).toBe('jira');
  });
});
