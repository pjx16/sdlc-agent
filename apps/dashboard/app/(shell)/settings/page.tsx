import type { CredentialView, SetupStatus } from '@sdlc/shared';
import { ChangePasswordForm } from '@/components/change-password-form';
import { ConnectionsSummary, type BotView } from '@/components/settings/connections-summary';
import { SettingsPageClient } from '@/components/settings/settings-page-client';
import { apiGet } from '@/lib/server-api';
import type { SystemView } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const system = await apiGet<SystemView>('/system');
  if (!system) throw new Error('GET /system returned 404');
  const [status, credentials, bot] = await Promise.all([
    apiGet<SetupStatus>('/setup/status').catch(() => null),
    apiGet<CredentialView[]>('/credentials').catch(() => null),
    apiGet<BotView>('/bot').catch(() => null),
  ]);
  return (
    <SettingsPageClient
      settings={system.settings}
      connections={<ConnectionsSummary credentials={credentials ?? []} bot={bot} />}
      account={status?.passwordFromEnv ? null : <ChangePasswordForm />}
    />
  );
}
