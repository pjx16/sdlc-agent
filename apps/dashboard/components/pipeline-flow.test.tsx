import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PipelineFlow } from './pipeline-flow';
import type { SystemView, TicketListItem } from '@/lib/types';

const t = (key: string, status: string): TicketListItem => ({ id: `id-${key}`, projectId: 'p', projectName: 'p', key, source: 'jira', type: 'story', title: 't', status, holdReason: null, holdFromStatus: null, updatedAt: '2026-11-14T10:00:00Z' });
const system = { settings: { pipelinePaused: false }, worker: { state: 'busy', phase: 'stage', phaseDetail: 'Installing dependencies for SDA-7 (npm ci)' }, runningStage: null } as unknown as SystemView;

describe('PipelineFlow', () => {
  it('shows the tickets in each step, lights the moving one and flags what waits for you', () => {
    render(<PipelineFlow system={system} tickets={[t('SDA-7', 'NEW'), t('SDA-8', 'AWAITING_PLAN_APPROVAL'), t('SDA-9', 'FAILED')]} />);
    const intake = screen.getByTestId('step-NEW');
    expect(intake).toHaveAttribute('data-active', 'true');
    expect(within(intake).getByRole('link', { name: 'SDA-7' })).toHaveAttribute('href', '/tickets/id-SDA-7');
    expect(screen.getByTestId('step-PLANNING')).not.toHaveAttribute('data-active');
    expect(within(screen.getByTestId('step-AWAITING_PLAN_APPROVAL')).getByText('Waiting for you')).toBeInTheDocument();
    expect(within(screen.getByTestId('step-FAILED')).getByText('SDA-9')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Now: SDA-7');
  });
  it('says nothing is moving when idle', () => {
    render(<PipelineFlow system={{ ...system, worker: { state: 'idle', phase: 'idle', phaseDetail: null } } as unknown as SystemView} tickets={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Nothing is moving right now.');
  });
});
