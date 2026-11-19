import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENTS, assembleAgentPrompt, promptFileOf, renderAgentFile } from './agents';
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
  it.each(['base', 'pipeline'])('every agent has a %s prompt file, and those files are exactly the roster', (dir) => {
    for (const a of AGENTS) expect(existsSync(path.join(root, 'guidelines/agents', dir, `${a.name}.md`))).toBe(true);
    const files = readdirSync(path.join(root, 'guidelines/agents', dir)).map((f) => f.replace(/\.md$/, '')).sort();
    expect(files).toEqual(AGENTS.map((a) => a.name).sort());
  });
  it('the files in .claude/agents are generated from the prompts and not edited by hand (run `npm run agents`)', () => {
    for (const a of AGENTS) {
      const read = (dir: string) => readFileSync(path.join(root, 'guidelines/agents', dir, `${a.name}.md`), 'utf8');
      const prompt = assembleAgentPrompt(read('base'), read('pipeline'));
      expect(readFileSync(path.join(root, '.claude/agents', `sdlc-${a.name}.md`), 'utf8')).toBe(renderAgentFile(a, prompt));
    }
    const onDisk = readdirSync(path.join(root, '.claude/agents')).filter((f) => f.startsWith('sdlc-'));
    expect(onDisk.sort()).toEqual(AGENTS.map((a) => `sdlc-${a.name}.md`).sort());
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
