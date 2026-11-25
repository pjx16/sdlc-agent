import { Injectable, Logger } from '@nestjs/common';
import type { KbCatalog } from '@sdlc/shared';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GitRunner } from '../git/git-runner';
import type { Housekeeper } from '../loop/worker-loop';
import { WorkerConfig } from '../worker-config';
import { INDEX_FILE, KbIndexSchema } from './kb-index';

/** Titles come from the first heading of a doc, or the index. */
export function buildCatalog(kbDir: string, files: string[], index: { doc: string; title: string; key: string }[], now: string): KbCatalog {
  const prefix = `${kbDir.replace(/\/+$/, '')}/`;
  const docs = files
    .filter((f) => f.startsWith(prefix) && f.endsWith('.md'))
    .map((f) => f.slice(prefix.length))
    .map((p) => ({ path: p, title: index.find((e) => e.doc === p)?.title || index.find((e) => e.doc === p)?.key || p }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { docs, updatedAt: now };
}

/**
 * Keeps `Project.kbCatalog` (the KB docs of the repository) up to date from the mirror, so the dashboard can offer them when a ticket
 * is created. The API never reads repositories itself.
 */
@Injectable()
export class KbCatalogSync implements Housekeeper {
  readonly name = 'kb-catalog';
  readonly intervalMs = 60_000;
  private readonly logger = new Logger(KbCatalogSync.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly git: GitRunner,
    private readonly config: WorkerConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(): Promise<void> {
    const projects = await this.prisma.project.findMany({ where: { enabled: true, onboardingStatus: 'confirmed', mirrorStatus: 'ok' } });
    for (const project of projects) {
      try {
        const gitDir = this.config.mirrorPath(project.id);
        const ref = project.baseBranch;
        const tree = await this.git.out(['--git-dir', gitDir, 'ls-tree', '-r', '--name-only', ref, '--', project.kbDir]);
        const indexText = await this.git.out(['--git-dir', gitDir, 'show', `${ref}:${project.kbDir.replace(/\/+$/, '')}/${INDEX_FILE}`]).catch(() => '');
        let entries: { doc: string; title: string; key: string }[] = [];
        try {
          entries = indexText ? KbIndexSchema.parse(JSON.parse(indexText)).features : [];
        } catch {
          entries = [];
        }
        const next = buildCatalog(project.kbDir, tree.split('\n').filter(Boolean), entries, this.now().toISOString());
        const old = project.kbCatalog as KbCatalog | null;
        if (old && JSON.stringify(old.docs) === JSON.stringify(next.docs)) continue;
        await this.prisma.project.update({ where: { id: project.id }, data: { kbCatalog: next as unknown as Prisma.InputJsonValue } });
      } catch (err) {
        this.logger.warn(`KB docs of "${project.name}" could not be listed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
