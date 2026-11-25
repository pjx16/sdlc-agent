import path from 'node:path';
import { KB_ATTACHMENT_MAX, KB_ATTACHMENT_MAX_LINES, KbAttachmentPath } from '@sdlc/shared';
import { readTextNoFollow } from '../fs/safe-fs';
import { safeDocPath } from './kb-index';

export interface LoadedAttachments {
  docs: { path: string; content: string }[];
  /** What was left out or cut, for the ticket's log. */
  warnings: string[];
}

/** The attachment paths stored on a ticket, as a clean list (anything that is not a valid path is dropped). */
export function attachmentPathsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is string => typeof p === 'string' && KbAttachmentPath.safeParse(p).success).slice(0, KB_ATTACHMENT_MAX);
}

/**
 * Reads the KB docs a ticket has attached from the ticket's workspace, so each stage sees the docs of its own branch. A doc that is gone
 * or unreadable is skipped with a warning, never an error. Together the docs are cut at KB_ATTACHMENT_MAX_LINES lines.
 */
export async function loadAttachments(workspace: string, kbDir: string, paths: string[]): Promise<LoadedAttachments> {
  const docs: LoadedAttachments['docs'] = [];
  const warnings: string[] = [];
  let budget = KB_ATTACHMENT_MAX_LINES;
  for (const p of paths) {
    const full = safeDocPath(workspace, kbDir, p);
    const content = full ? await readTextNoFollow(workspace, path.relative(workspace, full)) : null;
    if (content === null) {
      warnings.push(`The attached KB doc ${p} could not be read, so it was left out`);
      continue;
    }
    if (budget <= 0) {
      warnings.push(`The attached KB doc ${p} was left out: the attached docs are limited to ${KB_ATTACHMENT_MAX_LINES} lines`);
      continue;
    }
    const lines = content.split('\n');
    if (lines.length > budget) {
      docs.push({ path: p, content: `${lines.slice(0, budget).join('\n')}\n\n_(cut here: the attached docs are limited to ${KB_ATTACHMENT_MAX_LINES} lines)_\n` });
      warnings.push(`The attached KB doc ${p} was cut at ${budget} lines`);
      budget = 0;
    } else {
      docs.push({ path: p, content });
      budget -= lines.length;
    }
  }
  return { docs, warnings };
}
