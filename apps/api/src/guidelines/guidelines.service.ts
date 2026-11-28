import { createHash, randomBytes } from 'node:crypto';
import { lstat, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpStatus, Injectable } from '@nestjs/common';
import { EDITABLE_GUIDELINES, ErrorCodes, GUIDELINE_CATALOGUE, READABLE_GUIDELINES, formatSpec, type GuidelineItem } from '@sdlc/shared';
import { ApiException } from '../common/api-exception';

export const MAX_GUIDELINE_BYTES = 200_000;

/** One entry of the guidelines page: what the catalogue says, whether the file differs from the one that shipped, and when it last changed. */
export type CatalogueEntry = GuidelineItem & { customised: boolean; updatedAt: string | null };

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, ErrorCodes.notFound, 'Guideline not found');
/** Line endings and trailing space are not a customisation. */
const normalise = (text: string): string => text.replace(/\r\n/g, '\n').trimEnd();
const digest = (text: string): string => createHash('sha256').update(normalise(text)).digest('hex');

export interface TreeNode {
  name: string;
  /** Path relative to the guidelines directory, with `/` separators. */
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
}

const invalid = (message: string) => new ApiException(HttpStatus.BAD_REQUEST, ErrorCodes.validation, message, { path: message });

/**
 * Turns a request path into a path inside `root`, or throws. Only markdown files below the guidelines directory are
 * reachable: no absolute paths, no `..`, no backslashes, no NUL bytes, no hidden segments, and a `.md` extension.
 */
export function resolveGuidelinePath(root: string, rel: string): string {
  if (typeof rel !== 'string' || rel.trim() === '') throw invalid('a path is required');
  if (rel.includes('\0')) throw invalid('invalid path');
  if (rel.includes('\\')) throw invalid('use / as the path separator');
  if (path.isAbsolute(rel) || rel.startsWith('/')) throw invalid('the path must be relative to the guidelines directory');
  const segments = rel.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) throw invalid('the path must not contain empty, . or .. segments');
  if (segments.some((s) => s.startsWith('.'))) throw invalid('hidden files are not available');
  if (!rel.endsWith('.md')) throw invalid('only .md files can be read or written');
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, rel);
  if (!full.startsWith(resolvedRoot + path.sep)) throw invalid('the path leaves the guidelines directory');
  return full;
}

/** Wildcard route parameters arrive as an array of segments (Express 5) or as one string. */
export function wildcardToPath(param: string | string[] | undefined): string {
  return Array.isArray(param) ? param.join('/') : (param ?? '');
}

/** Reads and edits the markdown files under `guidelines/`. Changes apply from the next stage run. */
@Injectable()
export class GuidelinesService {
  readonly root = path.resolve(process.env.GUIDELINES_DIR || path.join(__dirname, '../../../../guidelines'));
  /**
   * The guidelines as they shipped, from the image (GUIDELINES_DEFAULT_DIR). The folder people edit is a mounted copy, so it cannot say what
   * the original was. Without it (development) the same folder is used, and nothing counts as customised.
   */
  readonly defaultsRoot = path.resolve(process.env.GUIDELINES_DEFAULT_DIR || this.root);

  /** The file tree: directories first, then markdown files, each sorted by name. Symlinks and hidden entries are skipped. */
  async tree(dir = this.root, prefix = ''): Promise<TreeNode[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const nodes: TreeNode[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) nodes.push({ name: e.name, path: rel, type: 'dir', children: await this.tree(path.join(dir, e.name), rel) });
      else if (e.isFile() && e.name.endsWith('.md')) nodes.push({ name: e.name, path: rel, type: 'file' });
    }
    return nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  }

  /** What a person may read: the files of the catalogue. Any other file (the plugin, the stack guides) is not there, whatever the path. */
  async readGuideline(rel: string): Promise<{ path: string; content: string }> {
    if (!READABLE_GUIDELINES.has(rel)) throw notFound();
    return this.read(rel);
  }

  /** What a person may change: the editable files of the catalogue. The pipeline part of an agent is not among them. */
  async writeGuideline(rel: string, content: unknown): Promise<{ path: string; bytes: number }> {
    if (!EDITABLE_GUIDELINES.has(rel)) throw notFound();
    return this.write(rel, content);
  }

  /** The tree of what a person may edit: no other file, and no folder left empty by that. */
  async editableTree(): Promise<TreeNode[]> {
    const prune = (nodes: TreeNode[]): TreeNode[] =>
      nodes.flatMap((n) => (n.type === 'file' ? (EDITABLE_GUIDELINES.has(n.path) ? [n] : []) : (() => { const children = prune(n.children ?? []); return children.length > 0 ? [{ ...n, children }] : []; })()));
    return prune(await this.tree());
  }

  /** The text a file shipped with: from the image, or for a format the default in the code. Null when there is none to go back to. */
  private async shippedText(rel: string): Promise<string | null> {
    const format = /^formats\/([^/]+)\.md$/.exec(rel);
    if (format?.[1]) return formatSpec(format[1])?.default ?? null;
    if (this.defaultsRoot === this.root) return null; // development: there is no separate copy
    return readFile(resolveGuidelinePath(this.defaultsRoot, rel), 'utf8').catch(() => null);
  }

  /** GET /guidelines/catalogue: every item the page shows, with whether it was changed and when. */
  async catalogue(): Promise<CatalogueEntry[]> {
    return Promise.all(
      GUIDELINE_CATALOGUE.map(async (item) => {
        const file = resolveGuidelinePath(this.root, item.editable);
        const [current, shipped, info] = await Promise.all([readFile(file, 'utf8').catch(() => null), this.shippedText(item.editable), stat(file).catch(() => null)]);
        return { ...item, customised: current !== null && shipped !== null && digest(current) !== digest(shipped), updatedAt: info?.mtime.toISOString() ?? null };
      }),
    );
  }

  /** POST /guidelines/reset/*path: puts the shipped text back in an editable file, and returns it. */
  async reset(rel: string): Promise<{ path: string; content: string }> {
    if (!EDITABLE_GUIDELINES.has(rel)) throw notFound();
    const shipped = await this.shippedText(rel);
    if (shipped === null) throw new ApiException(HttpStatus.CONFLICT, ErrorCodes.conflict, 'There is no shipped copy of this file to go back to in this install');
    await this.write(rel, shipped);
    return { path: rel, content: shipped };
  }

  async read(rel: string): Promise<{ path: string; content: string }> {
    const full = resolveGuidelinePath(this.root, rel);
    const real = await realpath(full).catch(() => null);
    if (!real) throw new ApiException(HttpStatus.NOT_FOUND, ErrorCodes.notFound, 'Guideline not found');
    this.assertInside(real, 'the file is outside the guidelines directory');
    if (!(await stat(real)).isFile()) throw new ApiException(HttpStatus.NOT_FOUND, ErrorCodes.notFound, 'Guideline not found');
    return { path: rel, content: await readFile(real, 'utf8') };
  }

  /** Writes a file. It may be new, but its directory must already exist: the tree structure is not edited here. */
  async write(rel: string, content: unknown): Promise<{ path: string; bytes: number }> {
    const full = resolveGuidelinePath(this.root, rel);
    if (typeof content !== 'string') throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCodes.validation, 'content must be a string', { content: 'required' });
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_GUIDELINE_BYTES) throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCodes.validation, 'the file is too large', { content: `must be at most ${MAX_GUIDELINE_BYTES} bytes` });

    const dir = await realpath(path.dirname(full)).catch(() => null);
    if (!dir) throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCodes.validation, 'the directory does not exist', { path: 'the directory does not exist' });
    this.assertInside(path.join(dir, path.basename(full)), 'the path leaves the guidelines directory');
    const existing = await lstat(full).catch(() => null);
    if (existing && !existing.isFile()) throw invalid('the path is not a regular file'); // a symlink or directory

    // Write to a temporary file and rename it, so a reader never sees a half-written guideline.
    const tmp = path.join(dir, `.${path.basename(full)}.${randomBytes(4).toString('hex')}.tmp`);
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, full);
    return { path: rel, bytes };
  }

  private assertInside(real: string, message: string): void {
    const root = this.rootReal ?? this.root;
    if (!real.startsWith(root + path.sep)) throw invalid(message);
  }

  private rootReal: string | null = null;

  async onInit(): Promise<void> {
    this.rootReal = await realpath(this.root).catch(() => this.root);
  }
}
