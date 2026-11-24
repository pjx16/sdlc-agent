import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.join(__dirname, '..', '..', 'prisma');
const schema = readFileSync(path.join(dir, 'schema.prisma'), 'utf8');
const migrationsDir = path.join(dir, 'migrations');

function migrationsAddingStep(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readFileSync(path.join(migrationsDir, d.name, 'migration.sql'), 'utf8'))
    .filter((sql) => /onboardingStep/.test(sql));
}

describe('Project.onboardingStep', () => {
  it('is a nullable String on the Project model', () => {
    const model = /model Project \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? '';
    expect(model).toMatch(/^\s*onboardingStep\s+String\?\s*$/m);
  });

  it('is added by exactly one additive migration without backfill', () => {
    const sqls = migrationsAddingStep();
    expect(sqls).toHaveLength(1);
    const sql = sqls[0] ?? '';
    expect(sql).toMatch(/ALTER TABLE "Project" ADD COLUMN\s+"onboardingStep" TEXT\s*;/i);
    expect(sql).not.toMatch(/NOT NULL|DEFAULT|UPDATE |DROP /i);
  });
});
