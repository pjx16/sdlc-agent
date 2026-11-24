import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const prismaDir = join(__dirname, '../../../prisma');
const schema = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
const migrationPath = join(prismaDir, 'migrations/20261124100000_ticket_ci_fix_rounds/migration.sql');

/** Returns the body of the `Ticket` model block of the Prisma schema. */
function ticketModel(): string {
  const match = /model Ticket \{([\s\S]*?)\n\}/.exec(schema);
  return match?.[1] ?? '';
}

describe('Ticket.ciFixRounds schema', () => {
  it('declares ciFixRounds as an Int with default 0', () => {
    expect(ticketModel()).toMatch(/^\s*ciFixRounds\s+Int\s+@default\(0\)\s*$/m);
  });

  it('documents ciFixRounds with a /// comment on the line above', () => {
    expect(ticketModel()).toMatch(/^\s*\/\/\/ .+\n\s*ciFixRounds\s/m);
  });

  it('has a migration that adds a NOT NULL INTEGER column with DEFAULT 0 to the Ticket table', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ');
    expect(sql).toContain('ALTER TABLE "Ticket" ADD COLUMN "ciFixRounds" INTEGER NOT NULL DEFAULT 0;');
  });
});
