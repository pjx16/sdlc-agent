import Link from 'next/link';
import type { CredentialKey, CredentialView } from '@sdlc/shared';
import { LocalTime } from '@/components/local-time';

export interface BotView {
  connected: boolean;
  installations: { id: number; account: string }[];
}

type Line = { tone: 'ok' | 'warn' | 'bad'; text: React.ReactNode };

const MARK = { ok: '✔', warn: '⚠', bad: '✖' } as const;
const TONE = { ok: 'text-green', warn: 'text-amber', bad: 'text-red' } as const;

/** One saved credential, in a sentence: not set, saved but not tested, tested fine (and when), or refused (and why). */
function credentialLine(view: CredentialView | undefined, what: string): Line {
  if (!view || view.source === 'unset') return { tone: 'warn', text: 'Not set' };
  if (view.verifyError) return { tone: 'bad', text: `${what}: ${view.verifyError}` };
  if (view.verifiedAt) return { tone: 'ok', text: <>{what} · verified <LocalTime iso={view.verifiedAt} /></> };
  return { tone: 'warn', text: `${what} saved, not tested yet` };
}

/**
 * Where the install stands on its two connections, read only: the settings below are for how it behaves; the connections are changed on the
 * setup page, step by step. GitHub counts as connected through the personal token, through sdlc-agent-bot, or both.
 */
export function ConnectionsSummary({ credentials, bot }: { credentials: CredentialView[]; bot: BotView | null }) {
  const byKey = new Map<CredentialKey, CredentialView>(credentials.map((c) => [c.key, c]));
  const token = credentialLine(byKey.get('github_token'), 'Personal token');
  const installed = bot?.installations ?? [];
  const github: Line[] = [];
  if (byKey.get('github_token')?.source !== 'unset' && byKey.get('github_token')) github.push(token);
  if (installed.length > 0) github.push({ tone: 'ok', text: `sdlc-agent-bot · installed for ${installed.map((i) => i.account || `installation ${i.id}`).join(', ')}` });
  if (github.length === 0) github.push({ tone: 'warn', text: 'Not set' });
  const rows: { name: string; lines: Line[] }[] = [
    { name: 'GitHub', lines: github },
    { name: 'Anthropic', lines: [credentialLine(byKey.get('anthropic_api_key'), 'API key')] },
  ];

  return (
    <section aria-labelledby="connections-title" className="panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="connections-title" className="text-base font-semibold">
            Connections
          </h2>
          <p className="mt-1 text-sm text-muted">What the agents use to reach GitHub and Claude. Changed on the setup page.</p>
        </div>
        <Link href="/setup/connections" className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm">
          Manage
        </Link>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.name} className="flex gap-4">
            <dt className="w-24 shrink-0 text-muted">{r.name}</dt>
            <dd className="space-y-0.5">
              {r.lines.map((l, i) => (
                <p key={i} className={TONE[l.tone]}>
                  <span aria-hidden>{MARK[l.tone]} </span>
                  <span className="text-text">{l.text}</span>
                </p>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
