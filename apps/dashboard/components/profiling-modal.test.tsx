import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OnboardingProgress } from '@sdlc/shared';
import { describe, expect, it, vi } from 'vitest';
import { ProfilingModal } from './profiling-modal';

const progress: OnboardingProgress = {
  startedAt: new Date().toISOString(),
  planned: ['facts', 'mirror', 'profile', 'advise'],
  running: ['profile', 'advise'],
  done: [{ id: 'facts', ms: 2000 }, { id: 'mirror', ms: 65_000 }],
};

describe('ProfilingModal', () => {
  it('lists the planned phases with their state and time', () => {
    render(<ProfilingModal progress={progress} onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Profiling your repository' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.getAttribute('data-state'))).toEqual(['done', 'done', 'running', 'running']);
    expect(within(items[1]!).getByText('1m 05s')).toBeInTheDocument();
    expect(screen.queryByText('Checking the install command')).not.toBeInTheDocument(); // not planned
  });

  it('shows every phase as waiting before the worker has written any progress', () => {
    render(<ProfilingModal progress={null} onClose={() => undefined} />);
    expect(screen.getAllByRole('listitem').every((i) => i.getAttribute('data-state') === 'waiting')).toBe(true);
  });

  it('closes with the button and with Escape', async () => {
    const onClose = vi.fn();
    render(<ProfilingModal progress={progress} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue in background' }));
    fireEvent(document.querySelector('dialog') as HTMLDialogElement, new Event('cancel', { cancelable: true })); // what Esc does to a dialog
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
