# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest `0.x` release | Yes: security fixes are released as a new patch version |
| Older releases | No: upgrade with `sdlc-agent upgrade` |
| `dev` branch | Fixed on the branch before the release that ships the fix |

The project is pre-1.0 and maintained by volunteers, so these are targets rather than guarantees:

| Step | Target |
| --- | --- |
| Acknowledge a report | 3 working days |
| First assessment (accepted or not, severity) | 10 working days |
| Fix for a critical or high finding | 30 days, coordinated with the reporter |

## Reporting a vulnerability

Please **do not** report security vulnerabilities in public issues, discussions or pull requests.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability** (or go to <https://github.com/pjx16/sdlc-agent/security/advisories/new>). Include a description, the affected component and version, steps to reproduce and the potential impact.

Please do not include real tokens, passwords or private repository content in a report. Redact them, or use throwaway values.

We fix accepted reports in a private fork of the advisory, publish a release, and then publish the advisory with credit to the reporter (unless you ask not to be named). Please give us the time above before disclosing a finding yourself.

## Threat model (short)

**Trusted:** the operator, the host the stack runs on, and the `.env` file.

**Not trusted:** ticket text, repository content and everything an agent writes. A prompt-injected agent is assumed possible.

The boundaries that matter:

- **Agent container ↔ worker.** Agent containers run as a non-root user with all capabilities dropped, `no-new-privileges`, a read-only root filesystem, memory, CPU and PID limits and a timeout. They have no Docker socket and no GitHub or Jira credentials. The workspace `.git` directory is mounted read-only. The worker runs git with hooks, fsmonitor, credential helpers and non-HTTPS protocols disabled, pushes only to the stored repository URL, and never follows symlinks in agent-written workspaces.
- **Agent ↔ Claude.** Agents hold no Claude token. They call the worker's LLM gateway, which forwards only `POST /v1/messages` (and `count_tokens`) and adds the token itself. Each agent container gets its own gateway key, valid only while that container runs; any other caller is refused.
- **Agent ↔ internet.** Agent containers sit on an internal network. They can reach the LLM gateway, a read-only npm mirror (Verdaccio, publishing refused) and an egress proxy that allows HTTPS tunnels to Prisma's binary host (`binaries.prisma.sh`) only. Repositories are restricted to `https://github.com/...`, and the GitHub token is only handed to github.com.
- **Worker ↔ Docker.** The worker has no Docker socket. It talks to `docker-proxy` on a network shared with nothing else. The proxy holds the socket, handles one request per connection, and allows only the calls the worker makes. Every container create must use the agent image, carry the agent label, run as a numeric non-root user, drop all capabilities, set `no-new-privileges`, a read-only root filesystem and memory and PID limits, use the agent network, and bind-mount only from `DATA_DIR`. Calls on existing containers work only on containers carrying the agent label.
- **GitHub access per project.** A project uses either the personal token from Settings or, in bot mode, a one-hour token limited to one repository that the token broker (`apps/broker`) issues for the sdlc-agent GitHub App. The App's private key stays on the broker; a system holds only a broker key that can ask for tokens for installations it connected, proven with the installer's own GitHub login. Tokens never reach agent containers. The broker speaks plain HTTP, so run it behind a TLS reverse proxy; `BROKER_REGISTRATION_SECRET` (on the broker and the API) closes registration to systems that know it. See [`docs/BOT.md`](./docs/BOT.md).
- **Pushes.** Never forced, except that a branch holding only the pipeline's own superseded commits is replaced with `--force-with-lease` pinned to the inspected commit; commits by anyone else are never replaced.
- **Stored credentials.** Tokens entered in the dashboard are stored in the local Postgres, encrypted with AES-256-GCM using `ENCRYPTION_KEY` from `.env`; anyone who can read both `.env` and the database can read them. Back up `.env` separately from the database. Losing `ENCRYPTION_KEY` means re-entering the tokens. Environment variables always override stored values.
- **Browser ↔ API.** A single-user password login creates a session cookie (httpOnly, SameSite). Requests are denied by default without a session; the only public endpoints are `/auth/login`, `/health`, `/setup/status` (reveals only whether an admin exists) and `/setup/admin` (needs the one-time setup code and is rate limited), state-changing requests marked cross-site by `Sec-Fetch-Site` are refused, unknown `Host` headers are refused (DNS rebinding), and the dashboard sends anti-framing headers.
- **Supply chain.** Base images and GitHub Actions are pinned by digest. Release images are built in GitHub Actions with provenance, an SBOM and a build attestation, signed with cosign (keyless), and scanned with Trivy. The npm package is published with npm provenance. The agent image is never published: it is built on your machine.

## Verifying a release

```bash
# Build attestation (GitHub CLI)
gh attestation verify oci://ghcr.io/pjx16/sdlc-agent-api:<version> --repo pjx16/sdlc-agent

# Signature (cosign)
cosign verify ghcr.io/pjx16/sdlc-agent-api:<version> \
  --certificate-identity-regexp '^https://github.com/pjx16/sdlc-agent/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The same works for the `worker`, `dashboard`, `broker`, `proxy`, `docker-proxy` and `npm-mirror` images. The release tarball's checksum is in `SHA256SUMS` on the GitHub release.

## Known residual risks

These are known and documented. A report about them is not treated as a new vulnerability unless it bypasses a control stated above.

- `docker-proxy` and the worker run as root, and the proxy holds the Docker socket. Keep the host dedicated to this stack. A kernel exploit from repository code is not covered by runc; set `AGENT_RUNTIME=runsc` (gVisor) or `sysbox-runc` for a stronger sandbox.
- A prompt-injected agent can send repository content to Anthropic in its model calls, and can fetch packages through the npm mirror. Only use repositories whose content you are comfortable sending to Anthropic.
- Postgres publishes no port in prod or release installs; only the api and worker reach it on the private `internal` network. Development mode (`npm run up:dev`) publishes it on `127.0.0.1` only.
- The npm cache volume is per project, but the npm mirror's storage is shared between projects.
- Never publish the dashboard beyond `127.0.0.1` without a TLS reverse proxy and `COOKIE_SECURE=true`.
- The dashboard has no `script-src` Content-Security-Policy yet.

## Scope

This project runs AI-generated code in containers and holds a GitHub token (or, in bot mode, a broker key). Reports about container isolation, `docker-proxy`, the LLM gateway, credential handling, the egress proxy, authentication and secret redaction are especially welcome.
