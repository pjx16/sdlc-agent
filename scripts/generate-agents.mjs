// Writes every generated agent file (see buildAgentFiles in packages/shared/src/agent-files.ts):
// - .claude/agents/sdlc-<name>.md: guidelines/agents/base/<name>.md plus guidelines/agents/pipeline/<name>.md, for every agent;
// - plugins/sdlc-subagents/: the Claude Code plugin (base plus guidelines/agents/plugin/<name>.md, for plugin agents only),
//   its guideline files, licence and manifest, and .claude-plugin/marketplace.json, which lists it.
// Removes generated files that are no longer wanted. The plugin version is packages/cli/package.json's, the release version.
// Run `npm run build -w @sdlc/shared` first. `--check` only reports drift and exits 1 when a file is out of date.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildAgentFiles, PLUGIN } = createRequire(import.meta.url)(path.join(root, 'packages/shared/dist/index.js'));
const check = process.argv.includes('--check');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const version = JSON.parse(read('packages/cli/package.json')).version;
const wanted = buildAgentFiles(read, version);

let drift = 0;
for (const [rel, text] of wanted) {
  const target = path.join(root, rel);
  let current = null;
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // not there yet
  }
  if (current !== text) {
    drift++;
    if (!check) {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
  }
}

/** Files under `dir` (recursive, paths from the root) that `keep` selects. */
function listFiles(dir, keep) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...listFiles(rel, keep));
    else if (keep(e.name)) out.push(rel);
  }
  return out;
}
const generated = [...listFiles('.claude/agents', (n) => n.startsWith('sdlc-')), ...listFiles(`${PLUGIN.dir}/agents`, () => true), ...listFiles(`${PLUGIN.dir}/guidelines`, () => true)];
for (const rel of generated) {
  if (!wanted.has(rel)) {
    drift++;
    if (!check) rmSync(path.join(root, rel));
  }
}
console.log(check ? `${drift} generated agent file(s) out of date` : `${wanted.size} generated agent files written, ${drift} changed`);
process.exit(check && drift > 0 ? 1 : 0);
