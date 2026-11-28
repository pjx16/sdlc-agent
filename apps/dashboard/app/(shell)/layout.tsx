import type { SetupStatus } from '@sdlc/shared';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { apiGet } from '@/lib/server-api';
import { hasValidSession } from '@/lib/session';
import { setupRedirect } from '@/lib/setup-gate';

export const dynamic = 'force-dynamic';

export default async function ShellLayout({ children }: { children: ReactNode }) {
  if (!(await hasValidSession())) redirect('/login');
  // Until GitHub and Anthropic are connected, every page but the setup itself leads to the setup.
  const pathname = (await headers()).get('x-pathname') ?? '';
  const toSetup = setupRedirect(pathname, await apiGet<SetupStatus>('/setup/status').catch(() => null));
  if (toSetup) redirect(toSetup);
  return <Shell>{children}</Shell>;
}
