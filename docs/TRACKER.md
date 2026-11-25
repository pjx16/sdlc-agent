# Issue tracker (Jira) integration

sdlc-agent connects to Jira Cloud and polls it for tickets. It reads approval statuses and writes comments, status moves and sub-tasks back. Pasting a ticket in the dashboard works with or without Jira. A Jira problem pauses intake only; it never blocks the pipeline.

## Choose how to reach Jira

Each project picks a **Jira mode**. All three do the same work (intake, approvals, write-back); they differ in what your organisation allows and in cost.

| Mode | How it works | Claude tokens | Needs |
| --- | --- | --- | --- |
| **REST API** (recommended) | The worker calls the Jira Cloud REST API v3 | None | A classic Atlassian API token |
| **Atlassian Rovo MCP** | The worker calls the Jira tools of Atlassian's Rovo MCP server from code | None | An OAuth sign-in (Connect in the dashboard) or a scoped API token, and the Rovo MCP server enabled for your organisation |
| **Claude Jira connector** | A Claude agent (Haiku) drives the Jira connector you added in claude.ai, one Jira operation per run | **Yes, on every Jira call** | A claude.ai account with the Jira connector, signed in once with `scripts/jira-connector-login.sh` |
| Off | No Jira; tickets are pasted | None | Nothing |

Use REST when you can. Use Rovo MCP when your organisation turns off classic API tokens but allows the Rovo MCP server. Use the connector only when neither is allowed but you can add Jira as a connector in claude.ai.

## Setup

### REST API

Set these (names only; put the values in your own `.env`, or enter them in Settings → Connections; never commit them):

- `JIRA_BASE_URL`: your site, for example `https://your-site.atlassian.net`
- `JIRA_EMAIL`: the email of the Jira account that owns the API token
- `JIRA_API_TOKEN`: an API token for that account, created in your Atlassian account settings

### Atlassian Rovo MCP

In Settings → Connections, card **Jira through Atlassian Rovo MCP**, either:

- **Connect with Atlassian** (OAuth 2.1). The dashboard registers itself with Atlassian's sign-in server (dynamic client registration), you approve access on Atlassian's page, and the grant is stored encrypted and refreshed by itself. It asks only for `read:me`, `read:account`, `offline_access` and the Jira `read`, `write` and `search` agent-interface scopes. Atlassian accepts a dashboard on `localhost` out of the box; any other dashboard address must be allowed by an org admin (Atlassian Administration → Rovo → Rovo MCP server). If Atlassian rotates the refresh token and it cannot be saved, connect again.
- or a **scoped API token** (`JIRA_MCP_TOKEN`) created with the Jira `agent-interface` scopes, used with `JIRA_EMAIL`. An org admin must allow API-token access for the Rovo MCP server.

Optional: `JIRA_MCP_URL` (default: Atlassian's server, `mcp.atlassian.com/v2/mcp`) and `JIRA_CLOUD_ID` (only when the sign-in sees several sites and `JIRA_BASE_URL` is not set; otherwise the site matching `JIRA_BASE_URL`, or the only one, is used).

To check what your organisation allows before setting a project up, run the spike: `node scripts/spike/jira-mcp-oauth.mjs --project KEY > jira-mcp-spike.json`. It signs in, lists the tools and runs one search, and prints a report without tokens.

### Claude Jira connector

1. Add Jira as a connector in claude.ai with the account you will use.
2. On the machine that runs sdlc-agent, run `bash scripts/jira-connector-login.sh`, then `/login` with that account and `/mcp` to see the connector (for example "claude.ai Atlassian"). `--check` lists what the login can see.
3. In the project, set the **connector name** to the part after "claude.ai " (default `Atlassian`) and the **poll interval** (default 15 minutes).

Each Jira operation (a search, a status read, a comment, a move, a sub-task) is one run of the `jiraConnector` stage and spends that account's Claude usage. Intake and approval checks for connector projects run at most once per poll interval, and connector calls wait while Claude usage is paused. The live status dropdown is not offered in this mode (it would cost a run); type the status names.

### Per project

In the dashboard (or when onboarding):

- **Jira mode:** REST API, Atlassian Rovo MCP, Claude Jira connector, or Off.
- **Jira project key:** the key of the Jira project to read.
- **JQL:** optional. Leave it empty to use the default (see below).

The project must be *Ready* (mirror cloned) before it accepts tickets.

## Which tickets are picked up

- By default only issues with the label `sdlc-agent` are picked up. With an empty JQL the query is `project = "KEY" AND labels = "sdlc-agent" ORDER BY created ASC`.
- A custom JQL is used exactly as written, so you can drop the label or filter on a status instead.
- Each issue becomes a ticket once per project and Jira key.
- Jira sub-tasks are never picked up, whatever the query. The pipeline publishes its own sub-tasks and works through them itself.

## Approvals

The plan approval can be given in Jira (connector projects: checked once per poll interval) (the plan is the only approval: it lists the subtasks, and the breakdown runs by itself once it is approved). A ticket that was already waiting for a breakdown approval when that gate was removed can still be approved in Jira. For a ticket that is waiting, the poller reads the Jira status and approves when it equals the approval status you configured for that project. Plan approval copies the Jira title and description onto the ticket. Breakdown approval creates the sub-tasks and publishes them to Jira. One bad ticket does not stop the others.

## Write-back

Write-back works the same in every mode.

- **Transitions:** after a state change, the Jira status mapped to the new state is applied, if status write-back is on for the project.
- **Comments:** comments carry a hidden marker, so writing them twice is safe.
- **Sub-tasks:** approved breakdown items are created in Jira as sub-tasks.

## Failure behaviour

- Network errors, rate limits (the Retry-After header is honoured) and server errors are retried with backoff (REST and Rovo MCP).
- If Jira stays unavailable, intake pauses for 10 minutes, for that mode only. The rest of the pipeline keeps running.
- A failed status move never stops a transition. The result is recorded and an event is logged.
- A move to a status with no matching Jira transition fails with a message listing the available ones.
- Authentication failures raise a support item: a refused token, an expired Rovo sign-in, or an expired connector login (run `scripts/jira-connector-login.sh` again).
- Rovo MCP: a server that lacks a tool the pipeline needs fails with the tool name it looked for. Without a comment-edit tool, a changed plan link is posted as a new comment.
- Connector: an agent answer that does not have the expected shape is a Jira error, never a guess.
- A pasted ticket with an existing key is rejected as a collision, not duplicated.

## Credential boundary

Jira credentials are held by the orchestrator only. In REST and Rovo MCP modes, agent containers never receive Jira credentials: agents only edit files, and the orchestrator makes every Jira call. Tokens and OAuth grants saved in the dashboard are encrypted, and a token must never be committed.

Connector mode is the one exception, by design: the `jiraConnector` stage holds its own claude.ai login (in the `sdlc_jira_connector_home` volume) and reaches Jira through that account's connector. That container gets no workspace, no GitHub token and not the pipeline's Claude token, only the connector's tools, and its egress goes through proxy port 3129, which allows `api.anthropic.com`, `claude.ai`, `platform.claude.com` and `mcp-proxy.anthropic.com` only. See [SECURITY.md](../SECURITY.md).

## More detail

- [README.md](../README.md): project overview and how to add a project.
- [CONFIGURATION.md](./CONFIGURATION.md): environment variables and per-project settings.
- [docs/kb/tracker.md](./kb/tracker.md): the flow, the data it touches and its edge cases.
- [SECURITY.md](../SECURITY.md): the security policy.
