import { AGENT_TOOLS, AGENTS, assembleAgentPrompt, renderAgentFile, type AgentSpec } from './agents';

/** The Claude Code plugin that ships the agents anyone can call from their own session, and the marketplace that lists it. */
export const PLUGIN = {
  name: 'sdlc-subagents',
  dir: 'plugins/sdlc-subagents',
  marketplace: 'sdlc-agent',
  description:
    'Subagents from sdlc-agent for your own Claude Code sessions: design a feature, investigate a bug, split a plan, write failing tests, implement, fix, document, review a diff for correctness, quality and security, and triage a failed CI run.',
  repository: 'https://github.com/pjx16/sdlc-agent',
} as const;

/** Where the marketplace fetches the plugin from: its directory at the release tag `v<version>`. */
export function pluginSource(version: string) {
  return { source: 'git-subdir', url: `${PLUGIN.repository}.git`, path: PLUGIN.dir, ref: `v${version}` } as const;
}

/** Guideline files the plugin ships next to its agents, read by them through `${CLAUDE_PLUGIN_ROOT}` when needed. */
export const PLUGIN_GUIDELINES = ['stacks/ts-node.md', 'stacks/nestjs.md', 'stacks/nextjs.md', 'review-checklist.md', 'kb-doc-template.md'] as const;

/** The agents the plugin ships. Pipeline-only agents are never among them. */
export const PLUGIN_AGENTS: readonly AgentSpec[] = AGENTS.filter((a) => a.plugin);

/** A plugin agent file: the plugin preamble, the shared rules, then the base prompt with the plugin overlay. */
export function renderPluginAgentFile(agent: AgentSpec, parts: { preamble: string; sharedRules: string; prompt: string }): string {
  return [
    '---',
    `name: ${agent.name}`,
    `description: ${agent.job}`,
    `tools: ${AGENT_TOOLS[agent.pluginWorkspace ?? agent.workspace]}`,
    `model: ${agent.model}`,
    '---',
    '',
    parts.preamble.trim(),
    '',
    parts.sharedRules.trim(),
    '',
    parts.prompt.trim(),
    '',
  ].join('\n');
}

/**
 * Every file `npm run agents` writes, keyed by its path from the repository root: `.claude/agents/` for the pipeline, and
 * the plugin (its agents, the guideline files they read, its manifest and licence) plus the marketplace that lists it.
 * `read` returns a file's text by its path from the repository root; `version` is the release version.
 */
export function buildAgentFiles(read: (rel: string) => string, version: string): Map<string, string> {
  const files = new Map<string, string>();
  const prompt = (name: string, overlay: 'pipeline' | 'plugin') =>
    assembleAgentPrompt(read(`guidelines/agents/base/${name}.md`), read(`guidelines/agents/${overlay}/${name}.md`));

  for (const agent of AGENTS) files.set(`.claude/agents/sdlc-${agent.name}.md`, renderAgentFile(agent, prompt(agent.name, 'pipeline')));

  const preamble = read('guidelines/agents/plugin-preamble.md');
  const sharedRules = read('guidelines/agents/shared-rules.md');
  for (const agent of PLUGIN_AGENTS) {
    files.set(`${PLUGIN.dir}/agents/${agent.name}.md`, renderPluginAgentFile(agent, { preamble, sharedRules, prompt: prompt(agent.name, 'plugin') }));
  }
  for (const rel of PLUGIN_GUIDELINES) files.set(`${PLUGIN.dir}/guidelines/${rel}`, read(`guidelines/${rel}`));
  files.set(`${PLUGIN.dir}/LICENSE`, read('LICENSE'));

  const author = { name: 'sdlc-agent maintainers', url: PLUGIN.repository };
  const manifest = { name: PLUGIN.name, version, description: PLUGIN.description, author, homepage: `${PLUGIN.repository}#readme`, repository: PLUGIN.repository, license: 'MIT', keywords: ['sdlc', 'subagents', 'code-review', 'testing', 'planning'] };
  files.set(`${PLUGIN.dir}/.claude-plugin/plugin.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  const marketplace = {
    name: PLUGIN.marketplace,
    description: 'Claude Code plugins from sdlc-agent.',
    owner: author,
    // Pinned to the release tag, not the default branch, so installs get the released agents and not unreleased work on dev.
    plugins: [{ name: PLUGIN.name, source: pluginSource(version), description: PLUGIN.description }],
  };
  files.set('.claude-plugin/marketplace.json', `${JSON.stringify(marketplace, null, 2)}\n`);
  return files;
}
