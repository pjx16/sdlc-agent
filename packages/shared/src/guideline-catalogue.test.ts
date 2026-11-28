import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENTS } from './agents';
import { FORMATS } from './formats';
import { EDITABLE_GUIDELINES, GUIDELINE_CATALOGUE, GUIDELINE_GROUPS, READABLE_GUIDELINES } from './guideline-catalogue';

const GUIDELINES = path.resolve(__dirname, '../../../guidelines');
const walk = (dir: string, prefix = ''): string[] => readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir, `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));

describe('the guideline catalogue', () => {
  it('has every agent, every format and the shared documents, with unique ids', () => {
    const ids = GUIDELINE_CATALOGUE.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of AGENTS) expect(ids, a.name).toContain(`agent:${a.name}`);
    for (const f of FORMATS) expect(ids, f.name).toContain(`format:${f.name}`);
    expect(ids).toEqual(expect.arrayContaining(['standard:shared-rules', 'standard:review-checklist', 'standard:kb-doc-template']));
  });

  it('every file it names exists in the guidelines folder', () => {
    for (const path_ of READABLE_GUIDELINES) expect(existsSync(path.join(GUIDELINES, path_)), path_).toBe(true);
  });

  it('an agent has an editable behaviour file and a pipeline file that can only be read', () => {
    const coder = GUIDELINE_CATALOGUE.find((i) => i.id === 'agent:coder')!;
    expect(coder).toMatchObject({ editable: 'agents/base/coder.md', readonly: 'agents/pipeline/coder.md', model: 'sonnet' });
    expect(EDITABLE_GUIDELINES.has('agents/base/coder.md')).toBe(true);
    expect(EDITABLE_GUIDELINES.has('agents/pipeline/coder.md')).toBe(false);
    expect(READABLE_GUIDELINES.has('agents/pipeline/coder.md')).toBe(true);
  });

  it('everything editable is readable', () => {
    for (const p of EDITABLE_GUIDELINES) expect(READABLE_GUIDELINES.has(p), p).toBe(true);
  });

  it('keeps out the plugin files, the default CLAUDE.md and the stack guides, however they are reached', () => {
    const hidden = walk(GUIDELINES).filter((f) => f.startsWith('agents/plugin/') || f === 'agents/plugin-preamble.md' || f === 'default-CLAUDE.md' || f.startsWith('stacks/'));
    expect(hidden.length).toBeGreaterThan(10); // the folders exist, so this checks something
    for (const f of hidden) {
      expect(EDITABLE_GUIDELINES.has(f), f).toBe(false);
      expect(READABLE_GUIDELINES.has(f), f).toBe(false);
    }
  });

  it('lists the agents in the order a ticket meets them, the others after', () => {
    const order = GUIDELINE_CATALOGUE.filter((i) => i.kind === 'agent').map((i) => i.id.replace('agent:', ''));
    expect(order.indexOf('solution-architect')).toBeLessThan(order.indexOf('technical-architect'));
    expect(order.indexOf('test-writer')).toBeLessThan(order.indexOf('coder'));
    expect(order.indexOf('coder')).toBeLessThan(order.indexOf('pr-reviewer'));
    expect(order.indexOf('pr-reviewer')).toBeLessThan(order.indexOf('documentor'));
    expect(order.indexOf('repo-profiler')).toBeLessThan(order.indexOf('assistant'));
    // An agent that is not in the pipeline order (one that is added later) comes after all of those, and is still there.
    for (const extra of order.slice(order.indexOf('assistant') + 1)) expect(AGENTS.some((a) => a.name === extra)).toBe(true);
    expect(order).toHaveLength(AGENTS.length);
  });

  it('gives each item a label and a sentence, and the groups cover every item', () => {
    for (const i of GUIDELINE_CATALOGUE) {
      expect(i.label.trim(), i.id).not.toBe('');
      expect(i.description.trim(), i.id).not.toBe('');
      expect(GUIDELINE_GROUPS.map((g) => g.kind), i.id).toContain(i.kind);
    }
    expect(GUIDELINE_CATALOGUE.find((i) => i.id === 'agent:pr-reviewer')?.label).toBe('PR reviewer');
    expect(GUIDELINE_CATALOGUE.find((i) => i.id === 'agent:onboarding-advisor')?.label).toBe('Onboarding advisor');
  });

  it('tweaks are single lines, and only agents have them', () => {
    for (const i of GUIDELINE_CATALOGUE) {
      if (i.kind !== 'agent') expect(i.tweaks, i.id).toEqual([]);
      for (const t of i.tweaks) expect(t, `${i.id}: ${t}`).toMatch(/^[^\n]+$/);
    }
    expect(GUIDELINE_CATALOGUE.find((i) => i.id === 'agent:coder')!.tweaks.length).toBeGreaterThanOrEqual(3);
  });
});
