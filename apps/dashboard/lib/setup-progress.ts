import type { CredentialKey, CredentialView } from '@sdlc/shared';

export interface BotInstalls {
  connected: boolean;
  installations: { id: number; account: string }[];
}

export const isSet = (view: CredentialView | undefined): boolean => Boolean(view && view.source !== 'unset');
/** Saved and tested with success: the test marks it, and a later refusal clears it. */
export const isVerified = (view: CredentialView | undefined): boolean => Boolean(view && view.source !== 'unset' && view.verifiedAt && !view.verifyError);

export interface SetupProgress {
  /** A personal token that works, or the bot installed on at least one account. */
  githubAccess: boolean;
  /** The name and the email every commit is made with. */
  identity: boolean;
  /** The commit-signing key is on the GitHub account (checked or confirmed), or there is nothing to add because the App signs. */
  signing: boolean;
  anthropic: boolean;
  tokenSet: boolean;
  botInstalled: boolean;
  /** Only the bot: the App signs its own commits. */
  botOnly: boolean;
  /** Everything the agents need. The signing key is not needed to work: it only makes GitHub show the commits as Verified. */
  ready: boolean;
}

/** Where the setup stands, from what is saved and what the bot reports. */
export function setupProgress(views: ReadonlyMap<CredentialKey, CredentialView>, bot: BotInstalls | null, signingConfirmed: boolean): SetupProgress {
  const tokenSet = isSet(views.get('github_token'));
  const botInstalled = (bot?.installations.length ?? 0) > 0;
  const botOnly = !tokenSet && botInstalled;
  const githubAccess = isVerified(views.get('github_token')) || botInstalled;
  const identity = isSet(views.get('git_author_name')) && isSet(views.get('git_author_email'));
  const anthropic = isVerified(views.get('anthropic_api_key'));
  return { githubAccess, identity, signing: signingConfirmed || botOnly, anthropic, tokenSet, botInstalled, botOnly, ready: githubAccess && identity && anthropic };
}
