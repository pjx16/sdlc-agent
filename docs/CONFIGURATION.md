# Configuration

Settings come from three places: environment variables (`.env`), the dashboard (Settings, stored in Postgres), and per-project settings. `.env.example` lists every variable with comments.

## Environment variables

A variable set here overrides the dashboard value and makes the field read-only there.

| Name | Required | Purpose |
| --- | --- | --- |
| `ENCRYPTION_KEY` | yes | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts the tokens saved in the dashboard. Back it up separately from the database |
| `POSTGRES_PASSWORD` | yes | Database password (`npm run up:prod` and the CLI create one for you where they can) |
| `DATA_DIR` | development only | Absolute host path for mirrors, workspaces and logs when the api and worker run on your machine (`npm run up:dev`). Installs keep all of it in the `sdlc_data` Docker volume instead, and agents mount sub-paths of that volume |
| `SDLC_UID`, `SDLC_GID` | no | The user the daily backup is written as (`sdlc-agent init` and `npm run up:prod` set them to yours), so `backups/` stays readable without root |
| `BACKUP_KEEP` | no | How many daily encrypted database backups to keep (default 7) |
| `ANTHROPIC_API_KEY` | no | Anthropic API key (`sk-ant-api…`) from the Anthropic Console. Every stage is billed to it |
| `GITHUB_TOKEN` | no | Fine-grained token for git and `gh` (not needed when every project works as the bot) |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | no | Identity of every commit made with a personal token |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Jira | One Atlassian credential for Jira (REST mode, recommended) |
| `JIRA_MCP_TOKEN` | Rovo MCP mode, if not using OAuth | A scoped Atlassian API token with the Jira `agent-interface` scopes, used with `JIRA_EMAIL`. OAuth (Connect in Settings → Connections) is the usual way |
| `JIRA_MCP_URL` | no | Rovo MCP server (default `https://mcp.atlassian.com/v2/mcp`) |
| `JIRA_CLOUD_ID` | no | The Atlassian site for Rovo MCP mode, when the sign-in sees several sites and `JIRA_BASE_URL` is not set |
| `JIRA_MCP_OAUTH` | no | The stored Rovo OAuth grant; normally written by the dashboard's Connect flow. Set in `.env`, its refreshed tokens cannot be saved |
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
| `LLM_GATEWAY_PORT`, `LLM_GATEWAY_UPSTREAM`, `LLM_GATEWAY_URL`, `NPM_REGISTRY_URL` | no | Worker settings for the LLM gateway and the npm mirror that agents use. The defaults match the shipped Compose file (`8080`, `https://api.anthropic.com`, `http://llm-gateway:8080`, `http://npm-mirror:4873/`). The API's connection test of the key uses `LLM_GATEWAY_UPSTREAM` too |
| `LOG_LEVEL` | no | pino level of the API and worker (default `info`) |
| `SDLC_VERSION`, `SDLC_REGISTRY` | release installs | The release to run (without the leading `v`) and the registry (default `ghcr.io/pjx16`). Used only by `deploy/docker-compose.yml` |
| `CONNECTIVITY_CHECK` | no | `off` turns off the internet check. By default the worker checks every 10 s and pauses the pipeline (banner in the dashboard) after 3 rounds in a row with no answer; it resumes by itself |
| `CONNECTIVITY_PROBES` | no | Comma-separated `https://` addresses the check asks (default: `api.anthropic.com`, `api.github.com`, `1.1.1.1`). Any answer, even an error status, counts as online. Replace them for a proxy or an air-gapped network |
| `DOCKER_SOCK` | no | Docker socket path on the host if it is not `/var/run/docker.sock` (Colima, OrbStack). Release compose only |
| `POSTGRES_PORT` | no | Loopback port of the development database (default `5433`, `npm run up:dev` only) |
| `SDLC_AGENT_HOME`, `SDLC_AGENT_SKIP_DOCTOR` | no | CLI: install folder (default `~/.sdlc-agent`), and `1` to skip the preflight checks |

## Tokens

- **GitHub:** either a fine-grained personal access token limited to the target repositories, with Contents (read/write), Pull requests (read/write), Actions (read), Commit statuses (read) and Metadata (read), and no administration permission, or no token at all: connect **sdlc-agent-bot** in Settings → Connections and install the GitHub App on the repositories ([`BOT.md`](./BOT.md)). Chosen per project.
- **Anthropic:** create an API key in the [Anthropic Console](https://console.anthropic.com/settings/keys) and add credits. Usage is billed per token, so set a spend limit on the key's workspace as a hard stop; the pipeline's own budgets (below) are the soft one. *Test* in Settings → Connections checks the key against the API.
- **Atlassian (Jira):** an API token for the account that should read and update tickets.

Never commit `.env` or any token.

## Per project (dashboard)

Stored in the database and edited on the project page:

- Repository, base branch, stack and its install, typecheck and targeted-test commands, knowledge-base folder, `CLAUDE.md` mode (`ours`, `theirs`, `both`).
- Jira mode, project key, JQL, issue-type routing, intake label, status mapping and which Jira status counts as plan approval.
- Which stages run, the model and turn limit of each, review rounds, CI fix rounds, rerun and re-plan limits, recovery (`recovery.enabled`, `recovery.maxAttempts`), PR size limits (`limits.prSoftLines`, `limits.prHardLines`), extra security triggers (`securityRiskPatterns`).
- How the project reaches GitHub: personal token or sdlc-agent-bot.

## Budgets (dashboard)

Settings → Budgets holds a daily, a weekly (Monday to Sunday) and a monthly budget in credits, where 1 credit is 1 USD of Anthropic credit balance. Leave one empty for no limit. Periods are counted in the timezone set there, which the dashboard fills in from your browser when you first approve the budgets.

- Spend is the cost Claude Code reports for each stage run. Jira connector mode runs use their own claude.ai login and are not counted.
- The worker checks the budgets before it starts a step and after every stage. When one is used up it pauses the pipeline until the next period starts, then resumes by itself. Raising the budget ends the pause at once; *Ignore budgets until then* skips them until the reset.
- A banner warns when a budget reaches the warning level (default 80%). Until budgets are approved (or *No limits* is chosen), a banner suggests some from recent spend. It blocks nothing.
- A low credit balance pauses the pipeline until you add credits and press *Resume*. Rate limits are retried after 1, 2 and 5 minutes (Claude Code also retries them itself), then the ticket is held.

Global defaults (stage models and turn limits, budgets) are in Settings. Agent instructions and output formats are markdown in [`guidelines/`](../guidelines) and editable in the dashboard's Guidelines page.
