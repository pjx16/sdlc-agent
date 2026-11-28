import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CREDENTIAL_KEYS, type CredentialKey, type CredentialView } from '@sdlc/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen } from './setup-screen';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const SIGNING_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOurKey sdlc-agent commit signing';
const fetchMock = vi.fn();
let saved: Record<string, CredentialView>;
let testResults: Record<string, { ok: boolean; message: string }>;
let botStatus: { connected: boolean; installations: { id: number; account: string }[]; error: string | null };
let signingResult: { ok: boolean; message: string; login?: string };
/** A field error the server answers every save with (instead of saving). */
let refuseSaveWith: string | null;

const view = (key: CredentialKey, over: Partial<CredentialView> = {}): CredentialView => ({ key, source: 'unset', hint: null, verifiedAt: null, verifyError: null, updatedAt: null, ...over });
const fresh = (): CredentialView[] => CREDENTIAL_KEYS.map((c) => view(c.key));
const done = (key: CredentialKey, hint = 'abcd'): CredentialView => view(key, { source: 'db', hint, verifiedAt: '2026-11-26T10:00:00Z' });
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  window.localStorage.clear();
  saved = {};
  testResults = {};
  botStatus = { connected: false, installations: [], error: null };
  signingResult = { ok: true, message: 'Found on @octocat. Commits will show as Verified.', login: 'octocat' };
  refuseSaveWith = null;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/bot') return json(botStatus);
    if (url === '/api/system/commit-signing/test') return json(signingResult);
    if (url === '/api/credentials' && method === 'GET') return json(Object.values(saved));
    const m = /^\/api\/credentials\/(\w+)(\/test)?$/.exec(url);
    if (m) {
      const key = m[1] as CredentialKey;
      if (m[2]) {
        const result = testResults[key] ?? { ok: true, message: 'Connected' };
        saved[key] = view(key, { source: 'db', hint: saved[key]?.hint ?? 'wxyz', verifiedAt: result.ok ? '2026-11-26T11:00:00Z' : null, verifyError: result.ok ? null : result.message });
        return json(result);
      }
      if (refuseSaveWith) return json({ fields: { value: refuseSaveWith } }, 400);
      const value = JSON.parse(String(init?.body)).value as string;
      saved[key] = view(key, { source: 'db', hint: key.startsWith('git_') ? value : value.slice(-4) });
      return json(saved[key]);
    }
    return json({}, 404);
  });
});
afterEach(() => vi.restoreAllMocks());

const show = (initial: CredentialView[] = fresh(), over: { signingKey?: string | null; encryptionKeyOk?: boolean } = {}) => {
  for (const v of initial) saved[v.key] = v;
  return render(<SetupScreen initial={initial} signingKey={over.signingKey === undefined ? SIGNING_KEY : over.signingKey} encryptionKeyOk={over.encryptionKeyOk ?? true} />);
};
const github = () => within(screen.getByTestId('setup-github'));
const anthropic = () => within(screen.getByTestId('setup-anthropic'));
const step = (card: ReturnType<typeof github>, title: string) => card.getByText(title).closest('li') as HTMLElement;

describe('the setup screen', () => {
  it('shows GitHub and Anthropic side by side, each at its first step, with the way out closed', async () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Connect GitHub and Anthropic' })).toBeInTheDocument();
    expect(screen.getByTestId('setup-github').parentElement).toHaveClass('md:grid-cols-2');
    expect(step(github(), 'Access')).toHaveAttribute('data-state', 'open');
    expect(step(github(), 'Git identity')).toHaveAttribute('data-state', 'waiting');
    expect(step(github(), 'Commit signing')).toHaveAttribute('data-state', 'waiting');
    expect(step(anthropic(), 'API key')).toHaveAttribute('data-state', 'open');
    expect(screen.getByRole('button', { name: 'Go to dashboard' })).toBeDisabled();
    expect(screen.getByText(/Finish GitHub access, the Git identity and the Anthropic key to continue/)).toBeInTheDocument();
  });

  it('has no Skip, and nothing about Jira', () => {
    show();
    expect(screen.queryByText(/skip/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/jira/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\.env/i)).not.toBeInTheDocument(); // no environment variable is offered for these
  });

  describe('GitHub access with a personal token', () => {
    it('saves and tests the token, folds the step with who it is, and moves on to the identity', async () => {
      testResults.github_token = { ok: true, message: 'Connected as octocat' };
      show();
      await userEvent.type(github().getByLabelText('GitHub token'), 'ghp_abcdefghijklmnopqrstuv1234');
      await userEvent.click(github().getByRole('button', { name: 'Save & test' }));
      await waitFor(() => expect(step(github(), 'Access')).toHaveAttribute('data-state', 'done'));
      const calls = fetchMock.mock.calls.map(([u, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${u}`);
      expect(calls.indexOf('PUT /api/credentials/github_token')).toBeLessThan(calls.indexOf('POST /api/credentials/github_token/test'));
      expect(calls.indexOf('POST /api/credentials/github_token/test')).toBeLessThan(calls.lastIndexOf('GET /api/credentials'));
      expect(within(step(github(), 'Access')).getByText('· Personal token ••••1234')).toBeInTheDocument();
      expect(step(github(), 'Git identity')).toHaveAttribute('data-state', 'open');
      expect(refresh).toHaveBeenCalled(); // the banner in the shell hears of it
    });

    it('a token that does not work stays open, says why, and does not move on', async () => {
      testResults.github_token = { ok: false, message: 'GitHub rejected the token' };
      show();
      await userEvent.type(github().getByLabelText('GitHub token'), 'ghp_abcdefghijklmnopqrstuv1234');
      await userEvent.click(github().getByRole('button', { name: 'Save & test' }));
      expect(await github().findByText(/GitHub rejected the token/)).toBeInTheDocument();
      expect(step(github(), 'Access')).toHaveAttribute('data-state', 'open');
      expect(step(github(), 'Git identity')).toHaveAttribute('data-state', 'waiting');
    });

    it('a refused value is shown at the field and nothing is tested', async () => {
      refuseSaveWith = 'must be a GitHub personal access token';
      show();
      await userEvent.type(github().getByLabelText('GitHub token'), 'nope');
      await userEvent.click(github().getByRole('button', { name: 'Save & test' }));
      expect(await github().findByText('must be a GitHub personal access token')).toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/test'))).toBe(false);
    });

    it('explains how to make the token, with the permissions it needs (issues and boards too)', async () => {
      show();
      await userEvent.click(github().getByText('How do I create one?'));
      const list = github().getByTestId('github-permissions');
      for (const name of ['Contents', 'Pull requests', 'Issues', 'Projects', 'Actions', 'Commit statuses', 'Metadata']) expect(within(list).getByText(name)).toBeInTheDocument();
      expect(github().getByRole('link', { name: /Open GitHub with the permissions pre-filled/ })).toHaveAttribute('href', expect.stringContaining('issues=write'));
    });

    it('cannot save when the encryption key is missing, and says why', () => {
      show(fresh(), { encryptionKeyOk: false });
      expect(github().getByRole('alert')).toHaveTextContent('ENCRYPTION_KEY is not set');
      expect(github().getByRole('button', { name: 'Save & test' })).toBeDisabled();
    });
  });

  describe('GitHub access through sdlc-agent-bot', () => {
    it('is chosen instead of the token: the App card takes the token field’s place', async () => {
      show();
      expect(github().getByRole('radio', { name: /Personal access token/ })).toHaveAttribute('aria-checked', 'true');
      await userEvent.click(github().getByRole('radio', { name: /sdlc-agent-bot/ }));
      expect(github().getByRole('radio', { name: /sdlc-agent-bot/ })).toHaveAttribute('aria-checked', 'true');
      expect(await github().findByRole('heading', { name: 'sdlc-agent-bot' })).toBeInTheDocument();
      expect(github().getByRole('button', { name: 'Connect sdlc-agent-bot' })).toBeInTheDocument();
      expect(github().queryByLabelText('GitHub token')).not.toBeInTheDocument();
      await userEvent.click(github().getByRole('radio', { name: /Personal access token/ }));
      expect(github().getByLabelText('GitHub token')).toBeInTheDocument(); // and it can be changed back at any time
    });

    it('with the App installed the step is done by the time the page has loaded, and signing needs nothing', async () => {
      botStatus = { connected: true, installations: [{ id: 7, account: 'acme' }], error: null };
      show([done('git_author_name', 'Ada'), done('git_author_email', 'ada@example.com'), ...fresh().filter((v) => !['git_author_name', 'git_author_email'].includes(v.key))]);
      await waitFor(() => expect(step(github(), 'Access')).toHaveAttribute('data-state', 'done'));
      expect(within(step(github(), 'Access')).getByText('· sdlc-agent-bot for acme')).toBeInTheDocument();
      expect(within(step(github(), 'Commit signing')).getByText('· The App signs its own commits')).toBeInTheDocument();
      expect(step(github(), 'Commit signing')).toHaveAttribute('data-state', 'done');
    });
  });

  describe('the Git identity', () => {
    it('saves the name and the email together, and moves on to signing', async () => {
      show([done('github_token'), ...fresh().filter((v) => v.key !== 'github_token')]);
      await userEvent.type(github().getByLabelText('Git author name'), 'Ada Lovelace');
      await userEvent.type(github().getByLabelText('Git author email'), 'ada@example.com');
      await userEvent.click(github().getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(step(github(), 'Git identity')).toHaveAttribute('data-state', 'done'));
      expect(within(step(github(), 'Git identity')).getByText('· Ada Lovelace · ada@example.com')).toBeInTheDocument();
      expect(step(github(), 'Commit signing')).toHaveAttribute('data-state', 'open');
      expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toHaveLength(2);
    });

    it('Save is off until something is typed, and a bad email is shown at its field', async () => {
      refuseSaveWith = 'must be an email address';
      show([done('github_token'), ...fresh().filter((v) => v.key !== 'github_token')]);
      expect(github().getByRole('button', { name: 'Save' })).toBeDisabled();
      await userEvent.type(github().getByLabelText('Git author email'), 'not-an-email');
      await userEvent.click(github().getByRole('button', { name: 'Save' }));
      expect(await github().findByText('must be an email address')).toBeInTheDocument();
      expect(step(github(), 'Git identity')).not.toHaveAttribute('data-state', 'done');
    });
  });

  describe('commit signing', () => {
    const ready = () => show([done('github_token'), done('git_author_name', 'Ada'), done('git_author_email', 'ada@example.com'), ...fresh().filter((v) => !['github_token', 'git_author_name', 'git_author_email'].includes(v.key))]);

    it('shows the key to copy, with the link to add it as a Signing Key', async () => {
      ready();
      expect(step(github(), 'Commit signing')).toHaveAttribute('data-state', 'open');
      expect(github().getByLabelText('Public signing key')).toHaveValue(SIGNING_KEY);
      expect(github().getByRole('link', { name: /Add it on GitHub/ })).toHaveAttribute('href', 'https://github.com/settings/ssh/new');
      expect(github().getByText('Signing Key', { selector: 'strong' })).toBeInTheDocument();
    });

    it('Check asks the server; when the key is found the step is done and remembers it', async () => {
      ready();
      await userEvent.click(github().getByRole('button', { name: 'Check' }));
      await waitFor(() => expect(step(github(), 'Commit signing')).toHaveAttribute('data-state', 'done'));
      expect(fetchMock.mock.calls.some(([u, init]) => u === '/api/system/commit-signing/test' && (init as RequestInit).method === 'POST')).toBe(true);
      expect(within(step(github(), 'Commit signing')).getByText('· Found on @octocat')).toBeInTheDocument();
      expect(window.localStorage.getItem('sdlc.setup.signing')).toBe('Found on @octocat');
    });

    it('when the key is not found it says what to do, and the step stays open', async () => {
      signingResult = { ok: false, message: 'Not found on @octocat. Add it as a Signing Key (not an Authentication Key).', login: 'octocat' };
      ready();
      await userEvent.click(github().getByRole('button', { name: 'Check' }));
      expect(await github().findByText(/Not found on @octocat/)).toBeInTheDocument();
      expect(step(github(), 'Commit signing')).toHaveAttribute('data-state', 'open');
    });

    it('I’ve added it marks it done without asking GitHub', async () => {
      ready();
      await userEvent.click(github().getByRole('button', { name: 'I’ve added it' }));
      expect(step(github(), 'Commit signing')).toHaveAttribute('data-state', 'done');
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/system/commit-signing/test')).toBe(false);
      expect(window.localStorage.getItem('sdlc.setup.signing')).toBe('Marked as added');
    });

    it('a reload comes back with it done', () => {
      window.localStorage.setItem('sdlc.setup.signing', 'Found on @octocat');
      ready();
      return waitFor(() => expect(step(github(), 'Commit signing')).toHaveAttribute('data-state', 'done'));
    });

    it('before the worker has made the key it says so, and offers no buttons', () => {
      show([done('github_token'), done('git_author_name', 'Ada'), done('git_author_email', 'ada@example.com'), ...fresh().filter((v) => !['github_token', 'git_author_name', 'git_author_email'].includes(v.key))], { signingKey: null });
      expect(github().getByText(/The key is made when the worker starts/)).toBeInTheDocument();
      expect(github().queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();
    });
  });

  describe('Anthropic', () => {
    it('saves and tests the key, and folds', async () => {
      testResults.anthropic_api_key = { ok: true, message: 'Anthropic accepted the API key' };
      show();
      await userEvent.type(anthropic().getByLabelText('Anthropic API key'), 'sk-ant-api03-abcdefghijklmnop7890');
      await userEvent.click(anthropic().getByRole('button', { name: 'Save & test' }));
      await waitFor(() => expect(step(anthropic(), 'API key')).toHaveAttribute('data-state', 'done'));
      expect(within(step(anthropic(), 'API key')).getByText('· ••••7890')).toBeInTheDocument();
      expect(anthropic().getByText('Connected')).toBeInTheDocument();
    });

    it('a key that is refused stays open, with the reason', async () => {
      testResults.anthropic_api_key = { ok: false, message: 'Anthropic rejected the API key' };
      show();
      await userEvent.type(anthropic().getByLabelText('Anthropic API key'), 'sk-ant-api03-abcdefghijklmnop7890');
      await userEvent.click(anthropic().getByRole('button', { name: 'Save & test' }));
      expect(await anthropic().findByText(/Anthropic rejected the API key/)).toBeInTheDocument();
      expect(step(anthropic(), 'API key')).toHaveAttribute('data-state', 'open');
    });

    it('reminds to set a spend limit, and links to the Console', () => {
      show();
      expect(anthropic().getByText(/also set a spend limit there/)).toBeInTheDocument();
      expect(anthropic().getByRole('link', { name: /Anthropic Console/ })).toHaveAttribute('href', 'https://console.anthropic.com/settings/keys');
    });
  });

  describe('getting out', () => {
    it('opens once GitHub access, the identity and the Anthropic key are done, whatever the signing key', () => {
      show([done('github_token'), done('git_author_name', 'Ada'), done('git_author_email', 'ada@example.com'), done('anthropic_api_key', '7890'), ...fresh().filter((v) => !['github_token', 'git_author_name', 'git_author_email', 'anthropic_api_key'].includes(v.key))]);
      const link = screen.getByRole('link', { name: 'Go to dashboard' });
      expect(link).toHaveAttribute('href', '/');
      expect(screen.queryByText(/Finish GitHub access/)).not.toBeInTheDocument();
    });

    it('a saved token that was never tested does not count', () => {
      show([view('github_token', { source: 'db', hint: 'abcd' }), done('git_author_name', 'Ada'), done('git_author_email', 'ada@example.com'), done('anthropic_api_key', '7890'), ...fresh().filter((v) => !['github_token', 'git_author_name', 'git_author_email', 'anthropic_api_key'].includes(v.key))]);
      expect(screen.getByRole('button', { name: 'Go to dashboard' })).toBeDisabled();
    });

    it('a finished step can be opened again to change it', async () => {
      show([done('github_token'), ...fresh().filter((v) => v.key !== 'github_token')]);
      await userEvent.click(within(step(github(), 'Access')).getByRole('button'));
      expect(github().getByLabelText('GitHub token')).toBeInTheDocument();
      expect(github().getByRole('button', { name: 'Test again' })).toBeEnabled();
    });
  });
});
