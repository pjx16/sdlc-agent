# Plan: #49 — Every pipeline commit in a PR is signed

## Goal
All commits the pipeline pushes are cryptographically signed and show "Verified" on GitHub.

## Approach
1. **Signing key (token mode)**
   - Generate ed25519 key pair on first use (`ssh-keygen -t ed25519` in worker, or node `crypto` + OpenSSH encoding); store private key encrypted (existing credentials/ENCRYPTION_KEY machinery), public key in settings.
   - Settings → Connections shows the public key with "Add as a *Signing key* in GitHub → Settings → SSH and GPG keys".
2. **`commitAll`**: accept a `signing` option; run git with `-c gpg.format=ssh -c user.signingkey=<tmpfile> -c commit.gpgsign=true`; key file in a private temp dir (0600), always removed in `finally`. Add `commit.gpgsign=true` to the hardened base config so it can't be overridden.
3. **Bot mode**: after local commit, push via GitHub `createCommitOnBranch` (GraphQL) so GitHub signs as the App; reconcile returned OID into `pushedShas`; fallback = hold.
4. **Failure policy**: signing error ⇒ `GIT_ERROR` hold "Commit signing failed: …"; never push unsigned.
5. **Preflight**: onboarding/`doctor` check signs a test object and (token mode) warns if the key isn't known to GitHub (cannot be verified via API for private keys → user-confirmed checkbox).
6. **Docs + CHANGELOG**; CONTRIBUTING note that human contributors sign their commits too.

## Tests
Unit: git args include signing flags; key file permissions and cleanup; failure path holds. Int: create commit in temp repo, verify `git verify-commit` with allowed-signers. Bot mode: mocked GraphQL.

## Acceptance criteria
- `git log --show-signature` on a pipeline branch shows valid signatures.
- PR commits display Verified (bot mode automatically; token mode once the public key is added).
- No unsigned commit is ever pushed.

## Out of scope
GPG (non-SSH) signing; signing the user's own local commits; rewriting already-pushed unsigned commits.

## Decisions
SSH signing in worker for token mode, GitHub-side signing for bot mode; fail closed; key never enters the agent container.

## Risks
`createCommitOnBranch` handles only text/regular files and size limits (mitigate: fall back to SSH signing key for the bot if GitHub allows a registered key on the App owner, else hold); user must register the key.
