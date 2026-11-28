import type { SetupStatus } from '@sdlc/shared';

/** The page where the connections are made. Anything else sends a person here until they are. */
export const SETUP_PATH = '/setup/connections';

/** Pages that stay open while the setup is not done: the setup itself (its screen, and the Jira connections kept apart from it). */
const isSetupPage = (pathname: string): boolean => pathname === '/setup' || pathname.startsWith('/setup/');

/**
 * Where to send a person who asks for `pathname`: to the setup screen while GitHub and Anthropic are not connected, and nowhere otherwise.
 * A status that could not be read sends nobody: an API that is down must not shut the dashboard behind a screen that cannot work either.
 */
export function setupRedirect(pathname: string, status: Pick<SetupStatus, 'ready'> | null): string | null {
  if (!status || status.ready || isSetupPage(pathname)) return null;
  return SETUP_PATH;
}
