import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ProjectStack } from '@sdlc/shared';
import { assembleAgentPrompt } from '@sdlc/shared';
import { buildStageContext, buildSystemMd } from './context-builder';

const GUIDELINES = path.resolve(__dirname, '../../../../../guidelines');
const read = (rel: string) => readFileSync(path.join(GUIDELINES, rel), 'utf8');
/** An agent's prompt as the pipeline runs it: base plus pipeline overlay. */
const stage = (name: string) => assembleAgentPrompt(read(`agents/base/${name}.md`), read(`agents/pipeline/${name}.md`));

describe('shipped guideline files', () => {
  it('has every file this milestone owns', () => {
    for (const f of ['default-CLAUDE.md', 'kb-doc-template.md', 'stacks/ts-node.md', 'stacks/nestjs.md', 'stacks/nextjs.md', 'agents/shared-rules.md', ...['documentor', 'solution-architect', 'technical-architect', 'test-writer', 'coder', 'fixer', 'pr-reviewer'].flatMap((n) => [`agents/base/${n}.md`, `agents/pipeline/${n}.md`]), 'review-checklist.md']) expect(existsSync(path.join(GUIDELINES, f)), f).toBe(true);
  });

  it('the shared rules carry the rules every agent needs, and default-CLAUDE.md how the pipeline runs and reports', () => {
    const shared = read('agents/shared-rules.md');
    for (const needle of ['git commit', 'git push', 'git reset', 'rg -n', 'about 60 lines', 'node_modules', 'dist', 'coverage', 'lockfiles', 'secrets', 'Untrusted input', 'file:line', '**Ask**', '**Stop as blocked**']) expect(shared, needle).toContain(needle);
    const pipeline = read('default-CLAUDE.md');
    for (const needle of ['needs_input', '"blocked"', 'JSON object', 'headless', 'no web access']) expect(pipeline, needle).toContain(needle);
  });

  it('the base prompts say nothing about how the pipeline runs them', () => {
    for (const name of ['documentor', 'solution-architect', 'bug-investigator', 'feature-mapper', 'technical-architect', 'test-writer', 'coder', 'fixer', 'pr-reviewer', 'quality-reviewer', 'security-reviewer', 'ci-triager', 'repo-profiler']) {
      const t = read(`agents/base/${name}.md`);
      for (const needle of ['needs_input', '`blocked`', '`summary`', 'orchestrator', 'reverted', '## Inputs', '## Output']) expect(t, `${name} ${needle}`).not.toContain(needle);
    }
  });

  it('kb-doc-template.md names every required section', () => {
    const t = read('kb-doc-template.md');
    for (const h of ['## Overview', '## Entry points', '## Flow', '## Data touched', '## External calls', '## Edge cases and business rules', '## Open questions']) expect(t, h).toContain(h);
    expect(t).toContain('file:line');
    expect(t).toContain('kbDocMaxLines');
  });

  it('every assembled stage prompt states its goal, inputs, steps, rules, the data shape and when to ask', () => {
    for (const f of ['documentor', 'solution-architect', 'bug-investigator', 'feature-mapper', 'technical-architect', 'test-writer', 'coder', 'fixer', 'pr-reviewer', 'quality-reviewer', 'security-reviewer', 'ci-triager', 'assistant', 'repo-profiler', 'onboarding-advisor']) {
      const t = stage(f);
      for (const needle of ['## Goal', '## Inputs', '## Steps', '## Rules', '## Output `data`']) expect(t, `${f} ${needle}`).toContain(needle);
      expect(t, `${f} asking`).toMatch(/needs_input|\bask\b|Ask only|Do not ask/i);
    }
    expect(stage('solution-architect')).toContain('{ "planMarkdown": "…", "risks": ["…"], "openQuestions": ["…"] }');
    expect(stage('documentor')).toContain('"featureKey": "bookings", "isNew": true');
    expect(stage('solution-architect')).toContain('read-only');
  });

  it('the KB stages leave the index to the orchestrator, and kbUpdate rewrites statements the change made false', () => {
    expect(stage('documentor')).toContain('features.json');
    expect(stage('documentor')).toContain('do not exist yet');
    expect(stage('documentor')).toMatch(/never\s+edit\s+`features.json`/i);
  });

  it('stack guidelines cover conventions, error handling, tests and what to avoid', () => {
    for (const f of ['stacks/ts-node.md', 'stacks/nestjs.md', 'stacks/nextjs.md']) {
      const t = read(f).toLowerCase();
      for (const needle of ['tests', 'avoid']) expect(t, `${f} ${needle}`).toContain(needle);
    }
    expect(read('stacks/ts-node.md')).toContain('Strict TypeScript');
    expect(read('stacks/nestjs.md')).toContain('DTO validation');
    expect(read('stacks/nextjs.md')).toContain('Server Components');
  });
});

describe('review-checklist.md', () => {
  it('has the Correctness, Security and Standards sections and the output rules', () => {
    const t = read('review-checklist.md');
    for (const needle of ['## Correctness', '## Security', '## Standards', "repository's existing patterns", 'Small named functions', 'acceptance criterion', 'validated before use', 'Authentication and authorization', 'No secrets', 'parameterised', 'logs', 'path traversal', 'At most 10 findings']) expect(t, needle).toContain(needle);
  });
});

describe('the prompt builder picks the shipped files up', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'sdlc-gl-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it.each<[ProjectStack, string]>([['ts_node', 'Strict TypeScript'], ['nestjs', 'DTO validation'], ['nextjs', 'Server Components']])('system.md for %s has its stack guideline and our CLAUDE.md', async (stack, marker) => {
    const system = await buildSystemMd(GUIDELINES, stack, 'both');
    expect(system).toContain(marker);
    expect(system).toContain('You run headless');
    expect(system).toContain('Untrusted input');
    expect(await buildSystemMd(GUIDELINES, stack, 'theirs')).not.toContain('You run headless');
  });

  const aliases = { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' } as const;
  const build = (stage: 'solutionDesign' | 'kbBuild', inputs = {}) =>
    buildStageContext({ stageRunId: `r-${stage}`, stage, stack: 'nestjs', claudeMdMode: 'both', inputs: { ticket: { key: 'A-1', title: 't', body: 'b' }, ...inputs }, schema: {}, config: { stage, modelAlias: 'opus', modelAliases: aliases, maxTurns: 5 }, runsDir: tmp, guidelinesDir: GUIDELINES });

  it('puts the plan stage instructions into the plan prompt', async () => {
    const { runDir } = await build('solutionDesign');
    expect(readFileSync(path.join(runDir, 'prompt.md'), 'utf8')).toContain('# Agent: solution-architect');
  });

  it('puts the kb-build instructions, the stack guideline, and the KB location into the kbBuild prompt', async () => {
    const { runDir } = await build('kbBuild', { indexKeys: ['auth'], kbDir: 'docs/kb', kbDocMaxLines: 300 });
    const prompt = readFileSync(path.join(runDir, 'prompt.md'), 'utf8');
    expect(prompt).toContain('# Agent: documentor');
    expect(prompt).toContain('Write a new doc under `docs/kb/`');
    expect(prompt).toContain('at most 300 lines');
    expect(prompt).toContain('DTO validation');
  });
});
