import type { CredentialView, SetupStatus } from '@sdlc/shared';
import { SetupScreen } from '@/components/setup/setup-screen';
import { apiGet } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  const [views, status, signing] = await Promise.all([apiGet<CredentialView[]>('/credentials'), apiGet<SetupStatus>('/setup/status'), apiGet<{ publicKey: string | null }>('/system/commit-signing').catch(() => null)]);
  return <SetupScreen initial={views ?? []} signingKey={signing?.publicKey ?? null} encryptionKeyOk={status?.encryptionKeyOk ?? true} />;
}
