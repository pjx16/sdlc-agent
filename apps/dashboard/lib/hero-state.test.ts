import { describe, expect, it } from 'vitest';
import { heroState } from './hero-state';
import type { ProjectView } from './types';

let n = 0;
const project = (over: Partial<ProjectView> = {}) => ({ id: `p${++n}`, name: `Project ${n}`, enabled: true, onboardingStatus: 'confirmed', createdAt: `2026-11-${String(10 + n).padStart(2, '0')}T10:00:00Z`, ...over }) as unknown as ProjectView;
const ok = { ready: true };

describe('heroState', () => {
  it('no project: connect a repository', () => {
    expect(heroState([], ok)).toEqual({ kind: 'no-project' });
  });

  it('a project that is confirmed and enabled: ready for a ticket', () => {
    expect(heroState([project()], ok)).toEqual({ kind: 'ready' });
    expect(heroState([project({ onboardingStatus: undefined })], ok)).toEqual({ kind: 'ready' }); // projects made before onboarding existed
  });

  it('a project that is still being set up: finish it, by status', () => {
    for (const status of ['profiling', 'proposed', 'draft'] as const) {
      const p = project({ onboardingStatus: status });
      expect(heroState([p], ok)).toEqual({ kind: 'onboarding', projectId: p.id, name: p.name, status });
    }
  });

  it('the newest project being set up is the one named', () => {
    const older = project({ onboardingStatus: 'draft', createdAt: '2026-01-01T00:00:00Z' });
    const newer = project({ onboardingStatus: 'profiling', createdAt: '2026-06-01T00:00:00Z' });
    expect(heroState([older, newer], ok)).toMatchObject({ kind: 'onboarding', projectId: newer.id });
    expect(heroState([newer, older], ok)).toMatchObject({ projectId: newer.id });
  });

  it('a ready project wins over one being set up: a ticket can be written while another project is profiled', () => {
    expect(heroState([project({ onboardingStatus: 'profiling' }), project()], ok)).toEqual({ kind: 'ready' });
  });

  it('a disabled project does not count as ready', () => {
    expect(heroState([project({ enabled: false })], ok)).toEqual({ kind: 'no-project' });
    const settingUp = project({ onboardingStatus: 'proposed' });
    expect(heroState([project({ enabled: false }), settingUp], ok)).toMatchObject({ kind: 'onboarding', projectId: settingUp.id });
  });

  it('missing credentials come first, whatever the projects are', () => {
    expect(heroState([project()], { ready: false })).toEqual({ kind: 'setup' });
    expect(heroState([], { ready: false })).toEqual({ kind: 'setup' });
  });

  it('a status that could not be read never blocks the way in', () => {
    expect(heroState([project()], null)).toEqual({ kind: 'ready' });
    expect(heroState([], null)).toEqual({ kind: 'no-project' });
  });
});
