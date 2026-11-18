# Issue tracker (Jira) integration

sdlc-agent connects to Jira Cloud over REST v3 and polls it for tickets. It reads approval statuses and writes comments, status moves and sub-tasks back. Pasting a ticket in the dashboard works with or without Jira. A Jira problem pauses intake only; it never blocks the pipeline.

## Setup

Set these environment variables (names only; put the values in your own `.env`, never in the repository):

- `JIRA_BASE_URL`: your site, for example `https://your-site.atlassian.net`
- `JIRA_EMAIL`: the email of the Jira account that owns the API token
- `JIRA_API_TOKEN`: an API token for that account, created in your Atlassian account settings

Then, per project in the dashboard:

- **Jira mode:** REST or off. Only REST is supported.
- **Jira project key:** the key of the Jira project to read.
- **JQL:** optional. Leave it empty to use the default (see below).

The project must be *Ready* (mirror cloned) before it accepts tickets.

## Which tickets are picked up

- By default only issues with the label `sdlc-agent` are picked up. With an empty JQL the query is `project = "KEY" AND labels = "sdlc-agent" ORDER BY created ASC`.
- A custom JQL is used exactly as written, so you can drop the label or filter on a status instead.
- Each issue becomes a ticket once per project and Jira key.
- Jira sub-tasks are never picked up, whatever the query. The pipeline publishes its own sub-tasks and works through them itself.

## Approvals

The plan approval can be given in Jira (the plan is the only approval: it lists the subtasks, and the breakdown runs by itself once it is approved). A ticket that was already waiting for a breakdown approval when that gate was removed can still be approved in Jira. For a ticket that is waiting, the poller reads the Jira status and approves when it equals the approval status you configured for that project. Plan approval copies the Jira title and description onto the ticket. Breakdown approval creates the sub-tasks and publishes them to Jira. One bad ticket does not stop the others.

## Write-back

- **Transitions:** after a state change, the Jira status mapped to the new state is applied, if status write-back is on for the project.
- **Comments:** comments carry a hidden marker, so writing them twice is safe.
- **Sub-tasks:** approved breakdown items are created in Jira as sub-tasks.

## Failure behaviour

- Network errors, rate limits (the Retry-After header is honoured) and server errors are retried with backoff.
- If Jira stays unavailable, intake pauses for 10 minutes. The rest of the pipeline keeps running.
- A failed status move never stops a transition. The result is recorded and an event is logged.
- A move to a status with no matching Jira transition fails with a message listing the available ones.
- Authentication failures raise a support item.
- A pasted ticket with an existing key is rejected as a collision, not duplicated.

## Credential boundary

Jira credentials are held by the orchestrator only. Agent containers never receive Jira credentials: agents only edit files, and the orchestrator makes every Jira call. Tokens saved in the dashboard are encrypted, and a token must never be committed. See [SECURITY.md](../SECURITY.md).

## More detail

- [README.md](../README.md): project overview, ticket selection and configuration.
- [docs/kb/tracker.md](./kb/tracker.md): the flow, the data it touches and its edge cases.
- [SECURITY.md](../SECURITY.md): the security policy.
