import { staticCredentials } from '../../testing/static-credentials';
import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerConfig } from '../worker-config';
import { AgentRunner, type StageRequest } from './agent-runner';
import { ContainerRunner } from './container-runner';
import { FakeEngine, type FakeBehaviour } from './fake-engine';
import { NullLogSink } from './log-sink';
import { MemoryStore } from '../../testing/memory-stage-run-store';
import { GatewayTokens } from '../llm-gateway/gateway-tokens';

const planData = { planMarkdown: '# Plan', risks: [], openQuestions: [] };
const stream = (structured: unknown, extra: Record<string, unknown> = {}, rate?: unknown): string[] =>
  [
    { type: 'system', subtype: 'init', claude_code_version: '2.1.322' },
    ...(rate ? [rate] : []),
    { type: 'result', subtype: 'success', is_error: false, num_turns: 2, duration_ms: 50, total_cost_usd: 0.01, session_id: 's', usage: { input_tokens: 5, output_tokens: 6 }, structured_output: structured, result: '', ...extra },
  ].map((o) => JSON.stringify(o));
const good: FakeBehaviour = { lines: stream({ status: 'done', summary: 'ok', data: planData }) };
const badOutput: FakeBehaviour = { lines: stream({ status: 'done', summary: 'ok', data: { planMarkdown: '' } }) };

let tmp: string;
let config: WorkerConfig;
beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'sdlc-runner-'));
  mkdirSync(path.join(tmp, 'ws'), { recursive: true });
  config = new WorkerConfig({ DATA_DIR: tmp, DATABASE_URL: 'x', ANTHROPIC_API_KEY: 'tok', GUIDELINES_DIR: path.join(tmp, 'guidelines') } as NodeJS.ProcessEnv);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const request = (over: Partial<StageRequest> = {}): StageRequest => ({
  projectId: 'p1', ticketId: 't1', stage: 'solutionDesign', stack: 'nestjs', claudeMdMode: 'both', modelAlias: 'opus',
  modelAliases: { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' }, maxTurns: 15, stageTimeoutMin: 20, inputs: { ticket: { key: 'A-1', title: 't', body: 'b' } },
  workspacePath: path.join(tmp, 'ws'), ...over,
});

const setup = (behaviour: FakeBehaviour | FakeBehaviour[]) => {
  const engine = new FakeEngine(behaviour);
  const store = new MemoryStore();
  return { engine, store, runner: new AgentRunner(new ContainerRunner(engine), config, staticCredentials({ anthropic_api_key: 'tok' }), store, new NullLogSink()) };
};

describe('AgentRunner, Jira connector stage', () => {
  const connectorData = { result: { key: 'A-1', status: 'To Do', summary: 's', description: 'd' }, error: null };
  const connectorRequest = () => request({ stage: 'jiraConnector', modelAlias: 'haiku', workspacePath: undefined, inputs: { jira: { serverName: 'Jira', operation: 'read', args: { issueKey: 'A-1' }, resultShape: '{ key }' } } });

  it('runs with its own claude.ai login and the connector proxy: no gateway key, no workspace, no other credential', async () => {
    const { runner, engine } = setup({ lines: stream({ status: 'done', summary: 'ok', data: connectorData }) });
    expect(await runner.run(connectorRequest())).toMatchObject({ kind: 'done' });
    const created = engine.created[0];
    const env = created?.Env ?? [];
    expect(env).toContain('CLAUDE_CONFIG_DIR=/connector-home');
    expect(env).toContain('HTTPS_PROXY=http://proxy:3129');
    for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']) expect(env.some((e) => e.startsWith(`${name}=`)), name).toBe(false);
    expect(env.some((e) => e.endsWith('=tok'))).toBe(false);
    expect(created?.HostConfig?.Binds).toContain('sdlc_jira_connector_home:/connector-home:rw');
    expect(created?.HostConfig?.Binds?.some((b) => b.includes(':/workspace'))).toBe(false);
  });

  it('a refused connector login does not mark the pipeline\'s Anthropic API key as rejected', async () => {
    const marks: unknown[] = [];
    const creds = { ...staticCredentials({ anthropic_api_key: 'tok' }), markVerified: async (...a: unknown[]) => void marks.push(a) };
    const engine = new FakeEngine({ lines: [JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 401, result: 'Invalid API key · Please run /login' })] });
    const runner = new AgentRunner(new ContainerRunner(engine), config, creds as never, new MemoryStore(), new NullLogSink());
    expect(await runner.run(connectorRequest())).toMatchObject({ kind: 'claude_auth' });
    expect(marks).toHaveLength(0);
  });
});

describe('AgentRunner', () => {
  it('gives each container its own gateway key, live only while the container runs', async () => {
    const engine = new FakeEngine([good, good]);
    const tokens = new GatewayTokens();
    const runner = new AgentRunner(new ContainerRunner(engine), config, staticCredentials({ anthropic_api_key: 'tok' }), new MemoryStore(), new NullLogSink(), undefined, tokens);
    await runner.run(request());
    await runner.run(request());
    const keys = engine.created.map((c) => c.Env?.find((e) => e.startsWith('ANTHROPIC_API_KEY='))?.split('=')[1]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^sdlc-gw-[A-Za-z0-9_-]{43}$/);
    expect(keys[0]).not.toBe(keys[1]);
    for (const k of keys) expect(tokens.isLive(k)).toBe(false);
  });

  it('runs a stage and records tokens, cost, turns, session and CLI version', async () => {
    const { runner, store, engine } = setup(good);
    const res = await runner.run(request());
    expect(res).toMatchObject({ kind: 'done', attempts: 1, envelope: { status: 'done', data: planData } });
    const run = store.runs.get('run-1');
    expect(run).toMatchObject({ stage: 'solutionDesign', model: 'opus', attempt: 1, status: 'succeeded' });
    expect(run?.finished?.usage).toMatchObject({ inputTokens: 5, outputTokens: 6, costUsd: 0.01, numTurns: 2, sessionId: 's', cliVersion: '2.1.322' });
    expect(run?.containerId).toBe('fake-1');
    expect(engine.created[0]?.name).toBe('sdlc-run-run-1');
    // The Anthropic API key is not in the container: the LLM gateway holds it.
    expect(engine.created[0]?.Env?.join('\n')).not.toMatch(/OAUTH_TOKEN|=tok$/m);
    expect(engine.created[0]?.Env).toContain('ANTHROPIC_BASE_URL=http://llm-gateway:8080');
    expect(engine.created[0]?.Env).toContain('npm_config_registry=http://npm-mirror:4873/');
    expect(engine.created[0]?.Env).toContain('HTTPS_PROXY=http://proxy:3128');
    expect(engine.created[0]?.HostConfig?.Binds?.[0]).toBe(`${path.join(tmp, 'ws')}:/workspace:ro`); // plan is read-only
  });

  it('checks the spend budgets after every attempt, once its cost is stored', async () => {
    const engine = new FakeEngine([badOutput, good]);
    const store = new MemoryStore();
    const finishedAtCheck: number[] = [];
    const gate = { check: async () => (finishedAtCheck.push([...store.runs.values()].filter((r) => r.finished).length), false) };
    const runner = new AgentRunner(new ContainerRunner(engine), config, staticCredentials({ anthropic_api_key: 'tok' }), store, new NullLogSink(), gate);
    expect(await runner.run(request())).toMatchObject({ kind: 'done', attempts: 2 });
    expect(finishedAtCheck).toEqual([1, 2]);
  });

  it('retries a schema failure once with a fresh run, then succeeds', async () => {
    const { runner, store, engine } = setup([badOutput, good]);
    const res = await runner.run(request());
    expect(res).toMatchObject({ kind: 'done', attempts: 2 });
    expect([...store.runs.values()].map((r) => [r.attempt, r.status])).toEqual([[1, 'failed'], [2, 'succeeded']]);
    expect(store.runs.get('run-1')?.finished?.error).toContain('data.planMarkdown');
    expect(engine.created).toHaveLength(2);
  });

  it('fails after a second schema failure (the ticket goes on hold)', async () => {
    const { runner, store } = setup(badOutput);
    const res = await runner.run(request());
    expect(res).toMatchObject({ kind: 'failed', attempts: 2 });
    expect((res as { reason: string }).reason).toContain('failed validation');
    expect([...store.runs.values()].every((r) => r.status === 'failed')).toBe(true);
  });

  it('retries a non-zero exit and a timeout', async () => {
    expect(await setup([{ exitCode: 2, lines: [] }, good]).runner.run(request())).toMatchObject({ kind: 'done', attempts: 2 });
    const timeout = await setup([{ runMs: 5000 }, good]).runner.run(request({ stageTimeoutMin: 0.0005 }));
    expect(timeout).toMatchObject({ kind: 'done', attempts: 2 });
    const twice = await setup({ runMs: 5000 }).runner.run(request({ stageTimeoutMin: 0.0005 }));
    expect(twice).toMatchObject({ kind: 'failed', attempts: 2 });
    expect((twice as { reason: string; errorCode: string }).reason).toContain('took longer than');
    expect(twice).toMatchObject({ errorCode: 'TIMEOUT' });
  });

  it('treats blocked and orchestrator-validation failures as failed attempts', async () => {
    const blocked = { lines: stream({ status: 'blocked', summary: 'cannot' }) };
    // BLOCKED is not retried: the policy holds the ticket with the reason.
    expect(await setup(blocked).runner.run(request())).toMatchObject({ kind: 'failed', errorCode: 'BLOCKED', attempts: 1 });
    const res = await setup(good).runner.run(request({ validate: () => 'featureKey is not in the index' }));
    expect(res).toMatchObject({ kind: 'failed', errorCode: 'INVALID_OUTPUT', attempts: 2 });
    expect((res as { reason: string }).reason).toContain('featureKey is not in the index');
  });

  it('retries once at the turn limit with 1.5x the turns, then gives up', async () => {
    const turnLimit: FakeBehaviour = { exitCode: 1, lines: [JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 16, terminal_reason: 'max_turns', result: null, errors: ['Reached maximum number of turns (15)'] })] };
    const { runner, engine, store } = setup(turnLimit);
    expect(await runner.run(request({ maxTurns: 10 }))).toMatchObject({ kind: 'turn_limit', errorCode: 'TURN_LIMIT', attempts: 2 });
    expect(engine.created).toHaveLength(2);
    expect(store.runs.get('run-1')?.finished).toMatchObject({ error: 'Reached the turn limit', errorCode: 'TURN_LIMIT' });
  });

  describe('Claude-side errors', () => {
    const errorLines = (text: string, extra: Record<string, unknown> = {}) => [JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [text], ...extra })];

    it('CLAUDE_AUTH: no retry, no failure of the ticket; the run is marked with the code', async () => {
      const { runner, engine, store } = setup({ exitCode: 1, lines: errorLines('authentication_error: invalid bearer token') });
      expect(await runner.run(request())).toMatchObject({ kind: 'claude_auth', attempts: 1 });
      expect(engine.created).toHaveLength(1);
      expect(store.runs.get('run-1')?.finished).toMatchObject({ errorCode: 'CLAUDE_AUTH' });
    });

    it('CLAUDE_CREDITS: no retry; an out-of-credits result the caller pauses on', async () => {
      const { runner, engine, store } = setup({ exitCode: 1, lines: errorLines('Your credit balance is too low to access the Anthropic API.', { api_error_status: 400 }) });
      expect(await runner.run(request())).toMatchObject({ kind: 'out_of_credits', attempts: 1 });
      expect(engine.created).toHaveLength(1);
      expect(store.runs.get('run-1')?.finished).toMatchObject({ errorCode: 'CLAUDE_CREDITS' });
    });

    it('CLAUDE_RATE_LIMIT: retries three times with 1, 2 and 5 minute waits, then gives up without pausing', async () => {
      const { runner, engine } = setup({ exitCode: 1, lines: errorLines('too many requests', { api_error_status: 429 }) });
      const waits: number[] = [];
      runner.sleep = async (ms) => void waits.push(ms);
      expect(await runner.run(request())).toMatchObject({ kind: 'failed', errorCode: 'CLAUDE_RATE_LIMIT', attempts: 4 });
      expect(engine.created).toHaveLength(4);
      expect(waits).toEqual([60_000, 120_000, 300_000]);
    });

    it('a successful answer that talks about rate limits or usage limits is not a rate limit', async () => {
      const text = 'Document the Claude rate limit, the usage limit reached pause and too many requests (429) handling';
      const lines = stream({ status: 'done', summary: text, data: planData }, { result: text });
      const { runner, store } = setup({ lines });
      expect(await runner.run(request())).toMatchObject({ kind: 'done' });
      expect(store.runs.get('run-1')?.finished).toMatchObject({ status: 'succeeded' });
    });

    it('CLAUDE_API_ERROR: retries three times with 1, 4 and 10 minute waits, then gives up', async () => {
      const { runner, engine, store } = setup({ exitCode: 1, lines: errorLines('API Error: 529 overloaded_error') });
      const waits: number[] = [];
      runner.sleep = async (ms) => void waits.push(ms);
      expect(await runner.run(request())).toMatchObject({ kind: 'failed', errorCode: 'CLAUDE_API_ERROR', attempts: 4 });
      expect(engine.created).toHaveLength(4);
      expect(waits).toEqual([60_000, 240_000, 600_000]);
      expect(store.retryAt.size).toBe(3); // the next attempt's time is stored on the failed run
    });

    it('CLAUDE_API_ERROR then success: recovers without failing', async () => {
      const { runner } = setup([{ exitCode: 1, lines: errorLines('overloaded') }, good]);
      runner.sleep = async () => undefined;
      expect(await runner.run(request())).toMatchObject({ kind: 'done', attempts: 2 });
    });

    it('CLAUDE_CONTEXT_TOO_LONG: no retry', async () => {
      const { runner, engine } = setup({ exitCode: 1, lines: errorLines('Prompt is too long') });
      expect(await runner.run(request())).toMatchObject({ kind: 'failed', errorCode: 'CLAUDE_CONTEXT_TOO_LONG', attempts: 1 });
      expect(engine.created).toHaveLength(1);
    });
  });

  it('INVALID_OUTPUT: retries once with the validation errors in the prompt', async () => {
    const bad = { lines: [JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'no json here' })] };
    const { runner, engine } = setup([bad, good]);
    expect(await runner.run(request())).toMatchObject({ kind: 'done', attempts: 2 });
    expect(engine.created).toHaveLength(2);
  });

  it('CONTAINER_ERROR: a container that cannot start is retried once, then reported with its code', async () => {
    const res = await setup({ exitCode: 125, lines: [] }).runner.run(request());
    expect(res).toMatchObject({ kind: 'failed', errorCode: 'CONTAINER_ERROR', attempts: 2 });
  });

  it('a rate-limit error with no other wording is still retried as CLAUDE_RATE_LIMIT', async () => {
    const { runner } = setup([{ exitCode: 1, lines: [JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['x'], api_error_status: 429 })] }, good]);
    runner.sleep = async () => undefined;
    expect(await runner.run(request())).toMatchObject({ kind: 'done', attempts: 2 });
  });

  it('returns needs_input with the question', async () => {
    const { runner, store } = setup({ lines: stream({ status: 'needs_input', summary: 'q', question: 'Which database?' }) });
    expect(await runner.run(request())).toMatchObject({ kind: 'needs_input', question: 'Which database?' });
    expect(store.runs.get('run-1')?.status).toBe('needs_input');
  });

  it('kills a running stage when killRequested is set, and does not retry', async () => {
    const { runner, store, engine } = setup({ runMs: 5000 });
    setTimeout(() => store.killRequested.add('run-1'), 20);
    const res = await runner.run(request());
    expect(res).toMatchObject({ kind: 'killed', attempts: 1 });
    expect(store.runs.get('run-1')?.status).toBe('killed');
    expect(engine.handles[0]).toMatchObject({ killed: true, removed: true });
  }, 15_000);

  it('refuses a stage that needs a workspace but has none', async () => {
    await expect(setup(good).runner.run(request({ workspacePath: undefined }))).rejects.toThrow('needs a workspace');
  });

  it('hides the repository CLAUDE.md in mode ours, with an empty-file mount', async () => {
    const ws = path.join(tmp, 'ws-ours');
    mkdirSync(ws, { recursive: true });
    writeFileSync(path.join(ws, 'CLAUDE.md'), 'rules');
    const { runner, engine } = setup(good);
    await runner.run(request({ claudeMdMode: 'ours', workspacePath: ws, stage: 'implement', inputs: { ticket: { key: 'A-1', title: 't', body: 'b' } } }));
    expect(engine.created[0]?.HostConfig?.Binds).toContain(`${path.join(tmp, 'empty-file')}:/workspace/CLAUDE.md:ro`);
  });
});
