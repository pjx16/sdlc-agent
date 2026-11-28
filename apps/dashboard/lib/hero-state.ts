import type { SetupStatus } from '@sdlc/shared';
import type { ProjectView } from '@/lib/types';

/** What the get-started band at the top of the Dashboard says, and so what its one button does. */
export type HeroState =
  /** The credentials are not all there: nothing else can start. */
  | { kind: 'setup' }
  /** No project at all. */
  | { kind: 'no-project' }
  /** A project is being set up (or the setup failed, or waits for review), and none is ready yet. */
  | { kind: 'onboarding'; projectId: string; name: string; status: 'profiling' | 'proposed' | 'draft' }
  /** At least one project can take a ticket. */
  | { kind: 'ready' };

/**
 * Which state applies, in this order: setup comes first, then a ready project (it offers a ticket even while another project is still being
 * set up), then the newest project that is being set up, then nothing. A disabled project does not count as ready. A status that could not be
 * read counts as complete, so a broken page never blocks the way in.
 */
export function heroState(projects: readonly ProjectView[], setup: Pick<SetupStatus, 'ready'> | null): HeroState {
  if (setup && !setup.ready) return { kind: 'setup' };
  if (projects.some((p) => p.enabled && (p.onboardingStatus ?? 'confirmed') === 'confirmed')) return { kind: 'ready' };
  const settingUp = projects
    .filter((p): p is ProjectView & { onboardingStatus: 'profiling' | 'proposed' | 'draft' } => p.onboardingStatus === 'profiling' || p.onboardingStatus === 'proposed' || p.onboardingStatus === 'draft')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return settingUp ? { kind: 'onboarding', projectId: settingUp.id, name: settingUp.name, status: settingUp.onboardingStatus } : { kind: 'no-project' };
}
