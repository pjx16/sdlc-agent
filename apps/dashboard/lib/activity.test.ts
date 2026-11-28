import { describe, expect, it } from 'vitest';
import { ago, describeActivity, inFuture } from './activity';
import type { SystemView, WorkerStatusView } from './types';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

const worker = (over: Partial<WorkerStatusView> = {}): WorkerStatusView => ({ online: true, state: 'idle', phase: 'idle', phaseDetail: null, phaseSince: at(3), startedAt: at(900), pid: 1, version: '1.0.0', restartingRepeatedly: false, heartbeatAt: at(3), tickOutcome: 'idle', tickDetail: null, ...over });
const system = (over: { worker?: WorkerStatusView | null; paused?: boolean; intakePaused?: boolean; running?: boolean; reason?: string | null } = {}): SystemView =>
  ({
    settings: { pipelinePaused: over.paused ?? false, pausedReason: over.reason ?? null, intakePaused: over.intakePaused ?? false, pollIntervalSec: 120 },
    worker: over.worker === undefined ? worker() : over.worker,
    runningStage: over.running ? { id: 'r1', stage: 'plan', model: 'opus', projectId: 'p', ticketId: 't', startedAt: at(10) } : null,
    recentEvents: [],
    usage: null,
  }) as unknown as SystemView;
const line = (s: SystemView | null, key: string) => describeActivity(s, NOW).find((l) => l.key === key);

describe('ago / inFuture', () => {
  it('formats elapsed and upcoming time', () => {
    expect(ago(at(5), NOW)).toBe('5s ago');
    expect(ago(at(180), NOW)).toBe('3 min ago');
    expect(ago(at(7200), NOW)).toBe('2 h ago');
    expect(ago(null, NOW)).toBe('never');
    expect(inFuture(40_000)).toBe('in 40s');
    expect(inFuture(150_000)).toBe('in 3 min');
    expect(inFuture(-5)).toBe('due now');
  });
});

describe('describeActivity: the worker', () => {
  it('says so when the worker has never reported, and tells you how to start it', () => {
    const l = describeActivity(system({ worker: null }), NOW);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ key: 'worker', tone: 'amber' });
    expect(l[0]?.text).toContain('npm run up:dev');
  });
  it('says offline (red) when the heartbeat is stale, and shows nothing else', () => {
    const l = describeActivity(system({ worker: worker({ online: false, state: 'offline', heartbeatAt: at(600) }) }), NOW);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ tone: 'red' });
    expect(l[0]?.text).toContain('Offline: last seen 10 min ago');
  });
  it('shows all four states: idle, busy with phase and time, stalled, offline', () => {
    expect(line(system(), 'worker')).toMatchObject({ tone: 'green', text: 'Online, idle (checked 3s ago).' });
    const busy = worker({ state: 'busy', phase: 'stage', phaseDetail: 'implement on SDA-12', phaseSince: at(185) });
    expect(line(system({ worker: busy }), 'worker')).toMatchObject({ tone: 'green', text: 'Online, busy (stage: implement on SDA-12) for 3 min.' });
    const stalled = worker({ state: 'stalled', phase: 'stage', phaseDetail: 'implement on SDA-12', phaseSince: at(3 * 3600) });
    expect(line(system({ worker: stalled }), 'worker')).toMatchObject({ tone: 'amber' });
    expect(line(system({ worker: stalled }), 'worker')?.text).toContain('Stalled');
    expect(line(system({ worker: worker({ state: 'offline', online: false }) }), 'worker')).toMatchObject({ tone: 'red' });
  });
  it('shows a banner line when the worker keeps restarting', () => {
    expect(line(system({ worker: worker({ restartingRepeatedly: true }) }), 'worker')).toMatchObject({ tone: 'red', text: expect.stringContaining('restarting repeatedly') });
  });
});

describe('describeActivity: the pipeline', () => {
  it('idle, running, paused, blocked by setup, working on a ticket, and a failed iteration', () => {
    expect(line(system(), 'pipeline')).toMatchObject({ tone: 'grey', text: expect.stringContaining('Idle') });
    expect(line(system({ running: true }), 'pipeline')).toMatchObject({ tone: 'green', text: 'Running plan with opus for 10s.', link: { href: '/runs/r1' } });
    expect(line(system({ paused: true, reason: 'manual' }), 'pipeline')).toMatchObject({ tone: 'amber', text: 'Paused. Paused by you.' });
    const blocked = line(system({ worker: worker({ tickOutcome: 'not_configured', tickDetail: 'anthropic_api_key, github_token' }) }), 'pipeline');
    expect(blocked).toMatchObject({ tone: 'amber', link: { href: '/setup/connections' } });
    expect(blocked?.text).toContain('anthropic_api_key, github_token');
    expect(line(system({ worker: worker({ tickOutcome: 'stepped', tickDetail: 'SDA-1 (PLANNING)' }) }), 'pipeline')?.text).toBe('Working on SDA-1 (PLANNING).');
    expect(line(system({ worker: worker({ tickDetail: 'Iteration failed: boom' }) }), 'pipeline')).toMatchObject({ tone: 'red', text: 'Iteration failed: boom' });
  });
});

describe('describeActivity: intake', () => {
  it('says nothing about intake while it runs', () => {
    expect(line(system(), 'intake')).toBeUndefined();
  });
  it('is paused by you, and says pasted tickets still work', () => {
    expect(line(system({ intakePaused: true }), 'intake')).toMatchObject({ tone: 'amber', text: expect.stringContaining('Pasted tickets still work') });
  });
});

describe('describeActivity: onboarding', () => {
  it('says which project is being read and which one waits for review, with a link', () => {
    const s = { ...system(), onboarding: [{ projectId: 'p1', name: 'billing', status: 'profiling' }, { projectId: 'p2', name: 'shop', status: 'proposed' }] } as SystemView;
    const lines = describeActivity(s, NOW).filter((l) => l.key === 'onboarding');
    expect(lines[0]).toMatchObject({ tone: 'green', text: expect.stringContaining('Reading billing'), link: { href: '/projects/p1' } });
    expect(lines[1]).toMatchObject({ tone: 'amber', text: expect.stringContaining('shop'), link: { href: '/projects/p2' } });
    expect(line(system(), 'onboarding')).toBeUndefined();
  });
});

describe('describeActivity: a step that is not a stage run', () => {
  it('says what the worker is doing instead of calling the pipeline idle', () => {
    const busy = worker({ state: 'busy', phase: 'stage', phaseDetail: 'Installing dependencies for SDA-7 (npm ci, up to 10 min)', phaseSince: at(95) });
    expect(line(system({ worker: busy }), 'pipeline')).toMatchObject({ tone: 'green', text: 'Installing dependencies for SDA-7 (npm ci, up to 10 min) for 2 min.' });
    const stage = worker({ state: 'busy', phase: 'stage', phaseDetail: 'NEW on SDA-7', phaseSince: at(30) });
    expect(line(system({ worker: stage }), 'pipeline')?.text).toContain('Idle');
  });
});

describe('describeActivity: the agent image', () => {
  it('shows a red line with the fix when the image is missing, and nothing when it is there', () => {
    const missing = system({ worker: worker({ agentImageError: 'The agent image x is not available. Build it with: docker compose --profile build build agent-image' }) });
    expect(line(missing, 'agent-image')).toMatchObject({ tone: 'red', text: expect.stringContaining('build agent-image') });
    expect(line(system(), 'agent-image')).toBeUndefined();
  });
});
