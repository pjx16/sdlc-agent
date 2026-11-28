import type { CredentialView, SetupStatus } from '@sdlc/shared';
import Link from 'next/link';
import { CredentialsForm } from '@/components/credentials-form';
import { apiGet } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * The Jira connections, kept apart from the setup screen (which is only GitHub and Anthropic). Nothing links here: it is for an install that
 * still uses Jira while Jira support is being removed, so that it can still change its Jira credentials. It goes with the Jira code.
 */
export default async function JiraConnectionsPage() {
  const [views, status] = await Promise.all([apiGet<CredentialView[]>('/credentials'), apiGet<SetupStatus>('/setup/status')]);
  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Jira connections</h1>
      <p className="mb-6 mt-2 text-sm text-muted">
        Jira support is being retired: tickets and comments are moving to GitHub issues. These settings stay for installs that still use Jira. <Link href="/setup/connections" className="text-accent underline">Back to GitHub and Anthropic</Link>
      </p>
      <CredentialsForm initial={views ?? []} encryptionKeyOk={status?.encryptionKeyOk ?? true} only={['jira', 'jira-mcp', 'jira-connector']} />
    </section>
  );
}
