# Configuration

Settings come from three places: environment variables (`.env`), the dashboard (Settings, stored in Postgres), and per-project settings. `.env.example` lists every variable with comments.

## Environment variables

A variable set here overrides the dashboard value and makes the field read-only there.

| Name | Required | Purpose |
| --- | --- | --- |
| `ENCRYPTION_KEY` | yes | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts the tokens saved in the dashboard. Back it up separately from the database |
| `POSTGRES_PASSWORD` | yes | Database password (`npm run up:prod` and the CLI create one for you where they can) |
| `DATA_DIR` | yes | Absolute host path for mirrors, workspaces, runs and logs. Also the only place agent containers may bind-mount from |
| `CLAUDE_CODE_OAUTH_TOKEN` | no | Output of `claude setup-token` |
| `GITHUB_TOKEN` | no | Fine-grained token for git and `gh` (not needed when every project works as the bot) |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | no | Identity of every commit made with a personal token |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Jira or Confluence | One Atlassian credential for Jira and Confluence |
| `DASHBOARD_PASSWORD` | no | Admin password (at least 12 characters). Overrides the setup wizard and disables password change |
| `SETUP_CODE` | no | One-time code for the setup wizard; otherwise the API logs one at start-up |
| `COOKIE_SECURE` | no | `true` when the dashboard is served over HTTPS |
| `DASHBOARD_BIND` | no | Address the dashboard port is published on (default `127.0.0.1`) |
| `ALLOWED_HOSTS` | no | Extra host names the dashboard answers to (comma-separated), for use behind a TLS reverse proxy. Other `Host` headers get 421 |
| `TRUST_PROXY_HOPS` | no | Proxies in front of the API that add `X-Forwarded-For`: 1 by default (the dashboard's `/api` rewrite), 2 behind a TLS reverse proxy as well |
| `BROKER_URL` | no | Token broker for sdlc-agent-bot (default `https://broker.sdlc-agent.dev`); see [`BOT.md`](./BOT.md) |
| `BROKER_REGISTRATION_SECRET` | no | Set on both the broker and the API to close broker registration to systems that know it |
| `AGENT_IMAGE` | no | Agent image; a source build uses `sdlc-agent/agent:latest`, a release install the published image for `SDLC_VERSION` |
| `AGENT_MEMORY`, `AGENT_CPUS` | no | Limits per agent container (defaults `4g`, `2`) |
| `AGENT_RUNTIME` | no | `runsc` (gVisor) or `sysbox-runc`, once installed on the Docker host. Empty means Docker's default |
| `LLM_GATEWAY_PORT`, `LLM_GATEWAY_UPSTREAM`, `LLM_GATEWAY_URL`, `NPM_REGISTRY_URL` | no | Worker settings for the LLM gateway and the npm mirror that agents use. The defaults match the shipped Compose file (`8080`, `https://api.anthropic.com`, `http://llm-gateway:8080`, `http://npm-mirror:4873/`) |
| `LOG_LEVEL` | no | pino level of the API and worker (default `info`) |
| `SDLC_VERSION`, `SDLC_REGISTRY` | release installs | The release to run (without the leading `v`) and the registry (default `ghcr.io/pjx16`). Used only by `deploy/docker-compose.yml` |
| `DOCKER_SOCK` | no | Docker socket path on the host if it is not `/var/run/docker.sock` (Colima, OrbStack). Release compose only |
| `POSTGRES_PORT` | no | Loopback port of the development database (default `5433`, `npm run up:dev` only) |
| `SDLC_AGENT_HOME`, `SDLC_AGENT_SKIP_DOCTOR` | no | CLI: install folder (default `~/.sdlc-agent`), and `1` to skip the preflight checks |

## Tokens

- **GitHub:** either a fine-grained personal access token limited to the target repositories, with Contents (read/write), Pull requests (read/write), Actions (read), Commit statuses (read) and Metadata (read), and no administration permission, or no token at all: connect **sdlc-agent-bot** in Settings → Connections and install the GitHub App on the repositories ([`BOT.md`](./BOT.md)). Chosen per project.
- **Claude:** run `claude setup-token` on a machine where Claude Code is logged in.
- **Atlassian (Jira and Confluence):** an API token for the account that should read and update tickets and write pages.

Never commit `.env` or any token.

## Per project (dashboard)

Stored in the database and edited on the project page:

- Repository, base branch, stack and its install, typecheck and targeted-test commands, knowledge-base folder, `CLAUDE.md` mode (`ours`, `theirs`, `both`).
- Jira mode, project key, JQL, issue-type routing, intake label, status mapping and which Jira status counts as plan approval; Confluence space and parent page.
- Which stages run, the model and turn limit of each, review rounds, CI fix rounds, rerun and re-plan limits, recovery (`recovery.enabled`, `recovery.maxAttempts`), PR size limits (`limits.prSoftLines`, `limits.prHardLines`), extra security triggers (`securityRiskPatterns`).
- How the project reaches GitHub: personal token or sdlc-agent-bot.

Global defaults (stage models and turn limits, usage thresholds) are in Settings. Agent instructions and output formats are markdown in [`guidelines/`](../guidelines) and editable in the dashboard's Guidelines page.
