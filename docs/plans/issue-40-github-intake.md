# Plan: #40 — GitHub Issues and Projects as ticket sources

## Goal
Equal footing with Jira: pull tickets from GitHub (Projects recommended, Issues supported), write status back, with a global intake switch plus one switch per source (Jira, GitHub, Pasted).

## Phases (each its own PR)
### Phase 1 — Source model and switches
- Prisma: add `github` to `TicketSource`; `GlobalSettings.intakeJiraEnabled/intakeGithubEnabled/intakePasteEnabled` (default true); `Project.githubMode` (`off|issues|projects`), `githubProjectRef` (owner + project number), `githubStatusField`, `githubIntakeStatus`/`githubIntakeLabel`.
- `IntakePoller`: respect per-source flags in addition to `intakePaused`. Paste endpoint rejects when paste switch is off (clear message).
- Dashboard: intake card in settings/run-controls showing global switch + three source toggles.

### Phase 2 — `TicketSourceAdapter`
- Define interface in `apps/api/src/intake/`; wrap existing Jira client as `JiraAdapter` (no behaviour change; existing int tests must pass untouched).

### Phase 3 — GitHub Issues adapter
- REST via `GithubClient`: list issues by label/state (exclude PRs), map to `ticket` (type from labels, e.g. `bug`), key `owner/repo#N`.
- Status write-back via labels (`sdlc:planning`, …) and comments; close on done.

### Phase 4 — GitHub Projects v2 adapter (recommended path)
- GraphQL: items of a project filtered by Status field value; read/write Status single-select; handle pagination.
- Broker: add Projects permission to `TOKEN_PERMISSIONS`; PAT fallback for user-owned projects.
- Approvals: moving the card to configured "Plan approved"/"Breakdown approved" columns.

### Phase 5 — Onboarding & UI
- `repo-profiler` facts gather GitHub project fields/columns; `onboardAdvise` proposes mapping like for Jira; onboarding panel gets a GitHub card; project form gets source picker (GitHub Projects pre-selected as recommended).

### Phase 6 — Docs (`docs/`), CHANGELOG, e2e.

## Tests
Adapter contract tests run against both Jira and GitHub fakes; poller int tests for switch combinations; GraphQL pagination test; dedupe test; broker permission test.

## Acceptance criteria
- With only GitHub enabled, tickets from a Project appear exactly once and move columns as the pipeline progresses.
- Disabling a source stops only that source; global switch stops all.
- Existing Jira behaviour unchanged.

## Out of scope
GitHub Enterprise Server GraphQL differences; two-way field sync beyond status; migrating existing Jira tickets.

## Decisions
See PR comment: adapter wrapper, per-source flags, Projects recommended, App token first + PAT fallback, key `owner/repo#N`.

## Risks
App permission change needs re-approval by installers; user-owned Projects v2 unsupported by App tokens; GraphQL rate limits (poll interval + ETag/cursor).
