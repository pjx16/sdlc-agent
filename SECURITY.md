# Security Policy

## Supported versions

Only the latest `0.0.x` pre-release is supported, on a best-effort basis, with no response-time promise. This is a pre-release built for the author's own use; see [`CHANGELOG.md`](./CHANGELOG.md).

## Reporting a vulnerability

Please **do not** report security vulnerabilities in public issues, discussions or pull requests.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include a description, the affected component, steps to reproduce and the potential impact.

Please do not include real tokens, passwords or private repository content in a report. Redact them, or use throwaway values.

## Threat model (short)

**Trusted:** the operator, the host the stack runs on, and the `.env` file.

**Not trusted:** ticket text, repository content and everything an agent writes. A prompt-injected agent is assumed possible.

The boundaries that matter:

- **Agent container ↔ worker.** Agent containers run with all capabilities dropped, `no-new-privileges`, resource limits, no Docker socket, no Claude token (they call the worker's LLM gateway, which only forwards `POST /v1/messages`), npm only through a read-only mirror, and no GitHub or Jira credentials. The workspace `.git` directory is mounted read-only. The worker runs git with hooks, fsmonitor, credential helpers and non-HTTPS protocols disabled, pushes only to the stored repository URL, and never follows symlinks in agent-written workspaces.
- **Agent ↔ internet.** The only route out is an egress proxy that allows HTTPS tunnels (CONNECT to port 443) to the Anthropic API and the npm registry. Repositories are restricted to `https://github.com/...`, and the GitHub token is only handed to github.com.
- **GitHub access per project.** A project uses either the personal token from Settings or, in bot mode, a one-hour token limited to one repository that the token broker (`apps/broker`) issues for the sdlc-agent GitHub App. The App's private key stays on the broker; a system holds only a broker key that can ask for tokens for installations it connected, proven with the installer's own GitHub login. Tokens never reach agent containers. The broker speaks plain HTTP, so run it behind a TLS reverse proxy; `BROKER_REGISTRATION_SECRET` (on the broker and the API) closes registration to systems that know it. See [`docs/BOT.md`](./docs/BOT.md).
- **Pushes.** Never forced, except that a branch holding only the pipeline's own superseded commits is replaced with `--force-with-lease` pinned to the inspected commit; commits by anyone else are never replaced.
- **Stored credentials.** Tokens entered in the dashboard are stored in the local Postgres, encrypted with AES-256-GCM using `ENCRYPTION_KEY` from `.env`; anyone who can read both `.env` and the database can read them. Back up `.env` separately from the database. Losing `ENCRYPTION_KEY` means re-entering the tokens. Environment variables always override stored values.
- **Browser ↔ API.** A single-user password login creates a session cookie (httpOnly, SameSite). Requests are denied by default without a session; the only public endpoints are `/auth/login`, `/health`, `/setup/status` (reveals only whether an admin exists) and `/setup/admin` (needs the one-time setup code and is rate limited), state-changing requests marked cross-site by `Sec-Fetch-Site` are refused, and the dashboard sends anti-framing headers.

## Known residual risks

These are known and documented. A report about them is not treated as a new vulnerability unless it bypasses a control stated above.

- The worker no longer holds the Docker socket: it talks to a `docker-proxy` that refuses privileged containers, host/PID networking, added capabilities, devices, root users and bind mounts outside `DATA_DIR`, and every call except create/start/wait/attach/kill/delete/logs and image pulls. The proxy itself holds the socket, so keep it on the internal network and the host dedicated; a kernel exploit from repository code is still not covered (gVisor or Sysbox would be the next step).
- Agents can reach the Anthropic API and the npm registry, and a prompt-injected agent could use them to send repository content out. Only use repositories whose content you are comfortable sending to those services.
- Postgres publishes no port in prod or release installs; only the api and worker reach it on the private `internal` network. Development mode (`npm run up:dev`) adds the `docker-compose.dev.yml` overlay, which publishes it on `127.0.0.1` only. For host access in prod use `docker compose exec postgres psql -U sdlc sdlc`.
- The npm cache volume is shared between projects.
- Never publish the dashboard beyond `127.0.0.1` without a TLS reverse proxy and `COOKIE_SECURE=true`.
- The dashboard has no `script-src` Content-Security-Policy yet.

## Scope

This project runs AI-generated code in containers and holds a GitHub token (or, in bot mode, a broker key). Reports about container isolation, credential handling, the egress proxy, authentication and secret redaction are especially welcome.
