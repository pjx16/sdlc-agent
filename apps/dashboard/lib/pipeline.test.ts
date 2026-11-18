import { describe, expect, it } from 'vitest';
import { currentActivity } from './pipeline';
import type { SystemView, TicketListItem } from './types';

const ticket = (key: string, status: string): TicketListItem => ({ id: `id-${key}`, projectId: 'p', projectName: 'p', key, source: 'jira', type: 'story', title: 't', status, holdReason: null, holdFromStatus: null, updatedAt: '2026-11-14T10:00:00Z' });
const system = (over: { running?: { stage: string; ticketId: string | null }; phase?: string; detail?: string | null; paused?: boolean } = {}): SystemView =>
  ({
    settings: { pipelinePaused: over.paused ?? false },
    worker: { state: over.phase ? 'busy' : 'idle', phase: over.phase ?? 'idle', phaseDetail: over.detail ?? null },
    runningStage: over.running ? { id: 'r', model: 'opus', projectId: 'p', startedAt: null, ...over.running } : null,
  }) as unknown as SystemView;

describe('currentActivity', () => {
  const tickets = [ticket('SDA-7', 'NEW'), ticket('SDA-8', 'PLANNING')];
  it('a running stage lights the step it belongs to', () => {
    expect(currentActivity(system({ running: { stage: 'solutionDesign', ticketId: 'id-SDA-8' } }), tickets)).toMatchObject({ status: 'PLANNING', ticketKey: 'SDA-8' });
    expect(currentActivity(system({ running: { stage: 'securityReview', ticketId: null } }), tickets).status).toBe('REVIEW');
  });
  it('a step without a stage run (an install) lights the ticket\'s step', () => {
    expect(currentActivity(system({ phase: 'stage', detail: 'Installing dependencies for SDA-7 (npm ci)' }), tickets)).toMatchObject({ status: 'NEW', ticketKey: 'SDA-7' });
    expect(currentActivity(system({ phase: 'stage', detail: 'NEW on SDA-7' }), tickets)).toMatchObject({ status: 'NEW', ticketKey: 'SDA-7' });
  });
  it('nothing moves when idle or paused', () => {
    expect(currentActivity(system(), tickets).status).toBeNull();
    expect(currentActivity(system({ paused: true, running: { stage: 'implement', ticketId: null } }), tickets).status).toBeNull();
    expect(currentActivity(null, tickets).status).toBeNull();
  });
});
