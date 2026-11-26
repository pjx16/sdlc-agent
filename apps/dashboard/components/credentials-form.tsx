'use client';

import { LocalTime } from '@/components/local-time';
import type { CredentialKey, CredentialView } from '@sdlc/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCredentials } from '@/lib/use-credentials';
import { Field } from './credential-field';
import { RovoConnect } from './rovo-connect';

interface Card {
  title: string;
  /** Used in test ids: `card-<id>`. */
  id: string;
  optional?: boolean;
  help: React.ReactNode;
  keys: CredentialKey[];
  /** The credential the card's Test button checks (it tests the connection as a whole). */
  testKey: CredentialKey;
  /** Testable even when the test key itself is unset (the connection can be made from other keys). */
  alwaysTestable?: boolean;
  /** The Rovo MCP card also offers the OAuth sign-in. */
  rovoConnect?: boolean;
}

/** GitHub's "new fine-grained token" page with the name and permissions pre-filled (the repositories are chosen on the page). */
const GITHUB_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=sdlc-agent&description=Used+by+sdlc-agent+to+clone%2C+push+branches+and+open+pull+requests&contents=write&pull_requests=write&metadata=read&actions=read&statuses=read';

const PERMISSIONS: { name: string; level: string; why: string }[] = [
  { name: 'Contents', level: 'Read and write', why: 'clone the repository and push the ticket branch' },
  { name: 'Pull requests', level: 'Read and write', why: 'open the draft PR, mark it ready, comment on it' },
  { name: 'Actions', level: 'Read', why: 'read CI results and failing logs' },
  { name: 'Commit statuses', level: 'Read', why: 'read check status on the PR' },
  { name: 'Metadata', level: 'Read', why: 'required by GitHub for every token' },
];

const CARDS: Card[] = [
  {
    title: 'Anthropic',
    help: (
      <>
        Create an API key in the <a className="underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Anthropic Console</a> and paste it (it starts with <code>sk-ant-api</code>). Every stage is billed to the key's workspace, so also set a spend limit there.
      </>
    ),
    keys: ['anthropic_api_key'],
    id: 'claude',
    testKey: 'anthropic_api_key',
  },
  {
    title: 'GitHub',
    help: (
      <div className="space-y-3">
        <p>
          Create a <strong>fine-grained personal access token</strong>.{' '}
          <a href={GITHUB_TOKEN_URL} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            Open GitHub with the permissions pre-filled ↗
          </a>
        </p>
        <div>
          <p className="font-medium text-text">Repository access</p>
          <p>
            Choose <strong>Only select repositories</strong> and add every repository you will use here. The token owner must be the account or organisation that owns them. A token that cannot see a repository
            makes it fail with a 404.
          </p>
        </div>
        <div>
          <p className="font-medium text-text">Repository permissions</p>
          <ul className="mt-1 space-y-0.5" data-testid="github-permissions">
            {PERMISSIONS.map((p) => (
              <li key={p.name}>
                <span className="font-medium text-text">{p.name}</span>: {p.level} <span className="text-muted">— {p.why}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1">Do not grant Administration or any account permission.</p>
        </div>
        <p>
          A classic token also works: it needs the <code>repo</code> scope (and SSO authorisation for an organisation). The name and email below are used for every commit.
        </p>
      </div>
    ),
    keys: ['github_token', 'git_author_name', 'git_author_email'],
    id: 'github',
    testKey: 'github_token',
  },
  {
    title: 'Jira',
    optional: true,
    help: (
      <div className="space-y-2">
        <p>
          For Jira REST mode, the recommended way: it spends no Claude tokens. Use your Jira Cloud base URL (<code>https://your-site.atlassian.net</code>), the email of your Atlassian account, and an API token from{' '}
          <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer" className="text-accent underline">
            id.atlassian.com ↗
          </a>
          .
        </p>
        <p>The account behind it must be able to browse the project, comment, create subtasks and transition issues, because the pipeline reads tickets, posts plans and moves statuses.</p>
        <p>The base URL and email are also used by Rovo MCP mode (below): the URL picks the site, the email goes with a scoped token.</p>
      </div>
    ),
    keys: ['jira_base_url', 'jira_email', 'jira_api_token'],
    id: 'jira',
    testKey: 'jira_api_token',
  },
  {
    title: 'Jira through Atlassian Rovo MCP',
    optional: true,
    help: (
      <div className="space-y-2">
        <p>
          For Jira mode <strong>Atlassian Rovo MCP</strong>, when your organisation turns off classic API tokens but allows the Rovo MCP server. The pipeline calls the server&apos;s Jira tools from code, so it
          spends no Claude tokens.
        </p>
        <p>
          Either <strong>connect with Atlassian</strong> (OAuth; the sign-in is refreshed by itself), or paste a <strong>scoped</strong> API token with the Jira <code>agent-interface</code> scopes and set the Jira email above (an org admin must allow API-token access for Rovo MCP). Leave the server URL empty for the default. The cloud ID is only needed when the sign-in sees several sites and the Jira base URL is not set.
        </p>
      </div>
    ),
    keys: ['jira_mcp_url', 'jira_mcp_token', 'jira_cloud_id'],
    id: 'jira-mcp',
    testKey: 'jira_mcp_oauth',
    alwaysTestable: true,
    rovoConnect: true,
  },
];

function CardView({ card, views, onSaved }: { card: Card; views: Map<CredentialKey, CredentialView>; onSaved: (v: CredentialView[]) => void }) {
  const { fields, values, setValue, errors, busy, message, test, changed, save, runTest } = useCredentials(card.keys, views, onSaved);
  const primary = views.get(card.testKey);
  const testable = card.alwaysTestable || (primary !== undefined && primary.source !== 'unset');
  const allEnv = fields.every((v) => v.source === 'env');

  return (
    <section data-testid={`card-${card.id}`} className="panel p-6" aria-labelledby={`card-${card.title}`}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={`card-${card.title}`} className="text-lg font-semibold">
          {card.title}
          {card.optional && <span className="ml-2 text-xs font-normal text-muted">optional</span>}
        </h2>
        <a href={NEXT_ANCHOR[card.id] ?? '/'} className="text-xs text-muted underline">
          Skip for now
        </a>
      </div>
      <div className="mt-2 text-sm text-muted">{card.help}</div>
      <div className="mt-4 space-y-4">
        {fields.map((v) => (
          <Field key={v.key} view={v} value={values[v.key] ?? ''} onChange={(text) => setValue(v.key, text)} error={errors[v.key]} />
        ))}
      </div>
      {card.rovoConnect && <RovoConnect view={primary} onChanged={() => onSaved([{ ...(primary as CredentialView), source: 'unset', hint: null }])} />}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {!allEnv && (
          <button type="button" onClick={() => void save()} disabled={busy !== null || changed.length === 0} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-50">
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void runTest(card.testKey)}
          disabled={busy !== null || !testable || changed.length > 0}
          title={changed.length > 0 ? 'Save your changes first' : undefined}
          className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
        >
          {busy === 'test' ? 'Testing…' : 'Test'}
        </button>
      </div>
      {message && (
        <p role="status" className="mt-3 text-xs text-muted">
          {message}
        </p>
      )}
      {test && (
        <p role="status" className={`mt-3 text-xs ${test.ok ? 'text-green' : 'text-red'}`}>
          {test.ok ? '✔' : '✖'} {test.message} <span className="text-muted">(<LocalTime iso={test.at} />)</span>
        </p>
      )}
      {!test && primary?.verifyError && <p className="mt-3 text-xs text-red">{primary.verifyError}</p>}
      {!test && !primary?.verifyError && primary?.verifiedAt && <p className="mt-3 text-xs text-muted">Last verified <LocalTime iso={primary.verifiedAt} /></p>}
    </section>
  );
}

const NEXT_ANCHOR: Record<string, string> = { claude: '#card-GitHub', github: '#card-Jira' };

/** The connection cards of the setup wizard and the settings page: one Save and one Test per card. Secrets are never rendered, only a hint of the last 4 characters. */
export function CredentialsForm({ initial, encryptionKeyOk = true }: { initial: CredentialView[]; encryptionKeyOk?: boolean }) {
  const router = useRouter();
  const [views, setViews] = useState(initial);
  const byKey = new Map(views.map((v) => [v.key, v]));
  const onSaved = (saved: CredentialView[]) => {
    setViews((all) => all.map((x) => saved.find((s) => s.key === x.key) ?? x));
    router.refresh(); // the setup banner lives in the shell layout, which stays mounted: re-fetch it
  };

  return (
    <div className="space-y-6">
      {!encryptionKeyOk && (
        <p role="alert" className="rounded-md border border-amber px-3 py-2 text-sm">
          ENCRYPTION_KEY is not set, so tokens cannot be saved here. Add it to .env (<code>openssl rand -base64 32</code>) and restart.
        </p>
      )}
      {CARDS.map((card) => (
        <CardView key={card.id} card={card} views={byKey} onSaved={onSaved} />
      ))}
      <section data-testid="card-jira-connector" className="panel p-6" aria-labelledby="card-jira-connector-title">
        <h2 id="card-jira-connector-title" className="text-lg font-semibold">
          Jira through the Claude Jira connector <span className="ml-2 text-xs font-normal text-muted">optional · uses Claude tokens</span>
        </h2>
        <div className="mt-2 space-y-2 text-sm text-muted">
          <p>
            For Jira mode <strong>Claude Jira connector</strong>, when your organisation allows neither of the above but you have added Jira as a connector in claude.ai. A Claude agent does every Jira call, so
            it spends Claude usage each time; use it only when nothing else is allowed.
          </p>
          <p>
            Nothing is entered here. Sign the connector in once, on the machine that runs sdlc-agent: <code>bash scripts/jira-connector-login.sh</code>, then <code>/login</code> with the claude.ai account that has
            the connector, and <code>/mcp</code> to check it is listed. <code>bash scripts/jira-connector-login.sh --check</code> shows what the login can see.
          </p>
        </div>
      </section>
    </div>
  );
}
