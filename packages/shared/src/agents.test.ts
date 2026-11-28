import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENTS, assembleAgentPrompt, promptFileOf, renderAgentFile } from './agents';
import { buildAgentFiles, PLUGIN, PLUGIN_AGENTS } from './agent-files';
import { STAGE_NAMES } from './enums';

const root = path.resolve(__dirname, '../../..');

describe('the agent roster', () => {
  it('has one row per agent and every pipeline stage runs exactly one agent', () => {
    expect(AGENTS).toHaveLength(16);
    expect(new Set(AGENTS.map((a) => a.name)).size).toBe(AGENTS.length);
    for (const stage of STAGE_NAMES) expect(AGENTS.filter((a) => a.stages.includes(stage))).toHaveLength(1);
  });
  it('the documentor serves both knowledge-base stages', () => {
    expect(promptFileOf('kbBuild')).toBe('documentor');
    expect(promptFileOf('kbUpdate')).toBe('documentor');
  });
  it('every plugin agent has a plugin overlay, and only plugin agents do', () => {
    const files = readdirSync(path.join(root, 'guidelines/agents/plugin')).map((f) => f.replace(/\.md$/, '')).sort();
    expect(files).toEqual(PLUGIN_AGENTS.map((a) => a.name).sort());
  });
  it.each(['base', 'pipeline'])('every agent has a %s prompt file, and those files are exactly the roster', (dir) => {
    for (const a of AGENTS) expect(existsSync(path.join(root, 'guidelines/agents', dir, `${a.name}.md`))).toBe(true);
    const files = readdirSync(path.join(root, 'guidelines/agents', dir)).map((f) => f.replace(/\.md$/, '')).sort();
    expect(files).toEqual(AGENTS.map((a) => a.name).sort());
  });
  it('the generated agent files and the plugin are up to date and not edited by hand (run `npm run agents`)', () => {
    const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
    const wanted = buildAgentFiles(read, JSON.parse(read('packages/cli/package.json')).version);
    for (const [rel, text] of wanted) expect(existsSync(path.join(root, rel)) ? read(rel) : null, rel).toBe(text);
    const onDisk = readdirSync(path.join(root, '.claude/agents')).filter((f) => f.startsWith('sdlc-'));
    expect(onDisk.sort()).toEqual(AGENTS.map((a) => `sdlc-${a.name}.md`).sort());
    expect(readdirSync(path.join(root, PLUGIN.dir, 'agents')).sort()).toEqual(PLUGIN_AGENTS.map((a) => `${a.name}.md`).sort());
  });
  it('a writing agent may edit; a read-only one may not', () => {
    const tools = (name: string) => /tools: (.*)/.exec(renderAgentFile(AGENTS.find((a) => a.name === name)!, ''))?.[1];
    expect(tools('coder')).toContain('Edit');
    expect(tools('pr-reviewer')).not.toContain('Edit');
    expect(tools('ci-triager')).toBe('Read');
  });
});

describe('assembleAgentPrompt', () => {
  const base = '# Agent: x\n\n## Goal\n\nDo x.\n\n## Steps\n\n```markdown\n## Not a heading\n```\n\n## Rules\n\n- r\n';
  const overlay = '## Inputs\n\n- the ticket\n\n## Output `data`\n\n```json\n{}\n```\n';

  it('puts the overlay inputs after the goal and the rest of the overlay at the end', () => {
    const out = assembleAgentPrompt(base, overlay);
    const order = ['# Agent: x', '## Goal', '## Inputs', '## Steps', '## Not a heading', '## Rules', '## Output `data`'].map((h) => out.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out.endsWith('```\n')).toBe(true);
  });
  it('throws when the base has no goal or the overlay has no inputs', () => {
    expect(() => assembleAgentPrompt('# Agent\n\n## Steps\n', overlay)).toThrow(/Goal/);
    expect(() => assembleAgentPrompt(base, '## Output `data`\n')).toThrow(/Inputs/);
  });
});

describe('the sdlc-subagents plugin', () => {
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
  const files = buildAgentFiles(read, '9.9.9');
  const pluginAgents = [...files].filter(([rel]) => rel.startsWith(`${PLUGIN.dir}/agents/`));

  it('ships exactly the agents that are useful outside the pipeline, never a pipeline-only one', () => {
    expect(PLUGIN_AGENTS.map((a) => a.name).sort()).toEqual(
      ['bug-investigator', 'ci-triager', 'coder', 'documentor', 'fixer', 'pr-reviewer', 'quality-reviewer', 'security-reviewer', 'solution-architect', 'technical-architect', 'test-writer'].sort(),
    );
    for (const name of ['assistant', 'orchestrator', 'onboarding-advisor', 'feature-mapper', 'repo-profiler']) {
      expect([...files.keys()].some((rel) => rel.startsWith(PLUGIN.dir) && rel.includes(name)), name).toBe(false);
    }
  });
  it('plugin agents say nothing about how the pipeline runs them', () => {
    expect(pluginAgents).toHaveLength(PLUGIN_AGENTS.length);
    for (const [rel, text] of pluginAgents) {
      for (const needle of ['needs_input', 'orchestrator', 'headless', '/workspace', 'reverted', 'default-CLAUDE.md', '## Output `data`']) expect(text, `${rel} ${needle}`).not.toContain(needle);
      for (const needle of ['## Your report', '# Rules for every agent', '## Goal', '## Inputs', '## Result']) expect(text, `${rel} ${needle}`).toContain(needle);
      expect(text, rel).toMatch(/^---\nname: [a-z-]+\ndescription: .+\ntools: .+\nmodel: (haiku|sonnet|opus)\n---\n/);
    }
  });
  it('every file a plugin agent points to through ${CLAUDE_PLUGIN_ROOT} ships in the plugin', () => {
    for (const [rel, text] of pluginAgents) {
      for (const [, target] of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.md)/g)) expect(files.has(`${PLUGIN.dir}/${target}`), `${rel} -> ${target}`).toBe(true);
    }
  });
  it('the manifest carries the release version, and the marketplace pins the plugin directory to the release tag', () => {
    const manifest = JSON.parse(files.get(`${PLUGIN.dir}/.claude-plugin/plugin.json`)!);
    expect(manifest).toMatchObject({ name: PLUGIN.name, version: '9.9.9', license: 'MIT' });
    const marketplace = JSON.parse(files.get('.claude-plugin/marketplace.json')!);
    expect(marketplace.name).toBe(PLUGIN.marketplace);
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({
        name: PLUGIN.name,
        source: { source: 'git-subdir', url: `${PLUGIN.repository}.git`, path: PLUGIN.dir, ref: 'v9.9.9' },
      }),
    ]);
  });
  it('the CI triager can read a run log in the plugin, though it has no tools in the pipeline', () => {
    expect(files.get(`${PLUGIN.dir}/agents/ci-triager.md`)).toContain('tools: Read, Grep, Glob, Bash');
    expect(files.get('.claude/agents/sdlc-ci-triager.md')).toContain('tools: Read\n');
  });
});
