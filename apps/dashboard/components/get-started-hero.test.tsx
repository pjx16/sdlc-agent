import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HeroState } from '@/lib/hero-state';
import type { TicketFormData } from '@/lib/ticket-form-data';
import type { ProjectView } from '@/lib/types';
import { GetStartedHero } from './get-started-hero';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const formData: TicketFormData = { projects: [{ id: 'p1', name: 'Billing', enabled: true, mirrorStatus: 'ok', onboardingStatus: 'confirmed', repoUrl: 'https://github.com/a/b', settings: { github: { mode: 'off', statusMap: {} } } } as unknown as ProjectView], template: '', githubIssueOnCreate: 'ask' };
const show = (state: HeroState) => render(<GetStartedHero state={state} formData={formData} />);
const hero = () => screen.getByRole('region', { name: 'Get started' });

describe('GetStartedHero', () => {
  it('no project: says to connect a repository, and the button opens the New project window', async () => {
    show({ kind: 'no-project' });
    expect(within(hero()).getByRole('heading', { name: 'Connect a repository' })).toBeInTheDocument();
    await userEvent.click(within(hero()).getByRole('button', { name: 'New project' }));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument();
    expect(within(hero()).getByRole('link', { name: 'How it works ↗' })).toHaveAttribute('target', '_blank');
  });

  it('a project being set up: names it, says where it is, and opens its page', () => {
    show({ kind: 'onboarding', projectId: 'p9', name: 'Shipping', status: 'proposed' });
    expect(within(hero()).getByRole('heading', { name: 'Finish setting up Shipping' })).toBeInTheDocument();
    expect(within(hero()).getByText('The proposal is ready for your review.')).toBeInTheDocument();
    expect(within(hero()).getByRole('link', { name: 'Open the project →' })).toHaveAttribute('href', '/projects/p9');
  });

  it.each([
    ['profiling', 'It is being profiled now. This takes a few minutes.'],
    ['draft', 'Profiling did not finish. Open it to see why and try again.'],
  ] as const)('a project that is %s says so', (status, text) => {
    show({ kind: 'onboarding', projectId: 'p9', name: 'Shipping', status });
    expect(within(hero()).getByText(text)).toBeInTheDocument();
  });

  it('ready: asks what to build next, the button opens the New ticket window, and tickets are one link away', async () => {
    show({ kind: 'ready' });
    expect(within(hero()).getByRole('heading', { name: 'What should we build next?' })).toBeInTheDocument();
    await userEvent.click(within(hero()).getByRole('button', { name: 'New ticket' }));
    expect(screen.getByRole('dialog', { name: 'New ticket' })).toBeInTheDocument();
    expect(within(hero()).getByRole('link', { name: 'View tickets' })).toHaveAttribute('href', '/tickets');
  });

  it('setup: sends to the connections, and shows no steps', () => {
    show({ kind: 'setup' });
    expect(within(hero()).getByRole('heading', { name: 'Connect GitHub and Anthropic' })).toBeInTheDocument();
    expect(within(hero()).getByRole('link', { name: 'Finish setup →' })).toHaveAttribute('href', '/setup/connections');
    expect(within(hero()).queryByRole('list', { name: 'The way in' })).not.toBeInTheDocument();
  });

  it('is always a fixed 20vh band, never shorter than 148px, in every state', () => {
    for (const state of [{ kind: 'setup' }, { kind: 'no-project' }, { kind: 'onboarding', projectId: 'p', name: 'x', status: 'draft' }, { kind: 'ready' }] as HeroState[]) {
      const { unmount } = show(state);
      expect(hero()).toHaveClass('h-[20vh]', 'min-h-[148px]');
      expect(hero()).toHaveAttribute('data-state', state.kind);
      unmount();
    }
  });

  it('marks the step of the way in: the first until a project is ready, then the second', () => {
    const { unmount } = show({ kind: 'no-project' });
    const steps = () => within(hero()).getAllByRole('listitem').filter((li) => li.hasAttribute('aria-current'));
    expect(steps().map((s) => s.textContent)).toEqual(['1. Connect a repository →']);
    unmount();
    show({ kind: 'ready' });
    expect(steps().map((s) => s.textContent)).toEqual(['2. Write a ticket →']);
  });
});
