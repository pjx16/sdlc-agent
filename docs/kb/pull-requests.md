# Pull requests and CI polling

## Overview

After the last review/KB step a ticket waits in `AWAITING_CI`. A code-only housekeeper (no AI agent) polls the PR's checks through GitHub. Passing checks mark the PR ready and move the ticket to `IN_HUMAN_REVIEW`; a failure queues one AI `fix` round (optionally after a `ciTriage` stage), which pushes to the PR branch, then polling resumes. Timeouts and a second failure hold the ticket. A separate poller watches merge/close in `IN_HUMAN_REVIEW`.

## Entry points

- `PrService` — `apps/api/src/worker/pipeline/pr.service.ts:15` — opens the draft PR, describes it, comments, finalizes
- `CiPoller.check()` — `apps/api/src/worker/ci/ci-poller.ts:32` — housekeeper (`name 'ci'`, every `CI_POLL_MS` = 30 s, line 11)
- `decideCi()` — `apps/api/src/worker/ci/ci-rules.ts:9` — pure verdict: pass/fail/pending/timeout
- `CiFixHandler.run()` — `apps/api/src/worker/ci/ci-fix.handler.ts:43` — step handler for `AWAITING_CI` when `ciFixPending`
- `MergePoller.check()` — `apps/api/src/worker/ci/merge-poller.ts:21` — `IN_HUMAN_REVIEW` -> `DONE` or hold
- `GitHubClient` — `apps/api/src/worker/github/github-client.ts:37` — `openDraftPr`, `markReady`, `checks`, `failureReport`, `failingLogTail`, `rerunFailed`, `prState`
- Wiring — `apps/api/src/worker/worker.module.ts:129` (CiPoller), `:133` (housekeepers), `:136` (step handlers)

## Flow

1. The draft PR is opened once (`pr.earlyDraft` decides early vs after the last subtask) and `prNumber`/`prUrl` stored — `pr.service.ts:49`, `:57`
2. The poller selects enabled-project tickets in `AWAITING_CI` with `ciFixPending = false` — `ci-poller.ts:33`
3. It stamps `ciWaitStartedAt` on first look and opens the draft PR if none exists — `ci-poller.ts:42`, `:46`
4. It reads checks via `github.checks`; a read error is a warning event and counts as pending — `ci-poller.ts:52`
5. `decideCi`: any fail/cancel -> fail; else any pending -> pending until `pr.ciTimeoutMin`, then timeout; none or all passing -> pass — `ci-rules.ts:9`
6. pass: `PrService.finalize` (mark ready, rewrite description, post review summary), then transition to `IN_HUMAN_REVIEW` — `ci-poller.ts:79`, `pr.service.ts:105`
7. timeout: hold `needs_help`, PR stays draft — `ci-poller.ts:68`
8. fail with `pr.ciFixRound` on and `ciFixDone` false: set `ciFixPending = true` — `ci-poller.ts:70`. If the round was already used: hold `loop_limit`; if the fix round is disabled: hold `needs_help` — `ci-poller.ts:76`
9. `CiFixHandler` reads `failureReport` (fallback `failingLogTail`) — `ci-fix.handler.ts:50`
10. If `stages.ciTriage.enabled`, triage classifies `code | flaky | infra`; `code` continues — `ci-fix.handler.ts:58`, `:87`
11. flaky (first time): `rerunFailed`, set `ciRerunDone`, stay and poll again; second flaky (unless the `ci_flaky` orchestrator point picks rerun) or `infra`: raise a `ci_infra` support item and hold — `ci-fix.handler.ts:100-118`
12. Fix round: sets `ciFixDone = true`, launches the `fix` stage with reason `ci`, squashes agent commits, commits `fix(<KEY>): resolve CI failure` and pushes; guard/push errors hold — `ci-fix.handler.ts:62`, `:80`
13. After `continue` the ticket is polled again; the worker loop keeps `AWAITING_CI` + `ciFixPending` tickets for the handler — `worker-loop.ts:136`
14. In `IN_HUMAN_REVIEW`, `MergePoller` moves merged PRs to `DONE` (storing `mergedAt` and PR size) and holds closed ones as `pr_closed` — `merge-poller.ts:27`

## Data touched

- `Ticket` — `prNumber`, `prUrl`, `branch`, `ciFixPending`, `ciFixDone`, `ciRerunDone`, `ciWaitStartedAt`, `mergedAt`, `prAdditions/Deletions/ChangedFiles` (`apps/api/prisma/schema.prisma:243`, `:261-266`)
- `Event` — type `git` rows for PR opened, warnings, queued fix, triage result
- `StateTransition` / holds via `StateMachine.transition` and `hold`
- `Project.settings.pr` — `earlyDraft`, `ciFixRound`, `ciTimeoutMin` (`packages/shared/src/project-settings.ts:101-103`); `loopLimits.ciFix`; `stages.ciTriage`

## External calls

- GitHub (via `GITHUB_CLIENT`): open draft PR (with retry, `pr.service.ts:57`), checks, failure report/log, rerun failed, mark ready, edit body, comment, PR state
- Agent stages: `ciTriage` (optional) and `fix` — only on failure; polling itself spends no AI tokens
- `SupportRaiser` for `ci_infra` and GitHub auth failures

## Edge cases and business rules

- No checks at all counts as passing — `ci-rules.ts:10`
- Only one CI fix round per ticket; a second failure holds with `loop_limit` — `ci-poller.ts:76`
- GitHub read errors never fail the ticket; the timeout still applies — `ci-poller.ts:55`
- One ticket's error is logged and does not stop the others — `ci-poller.ts:36`
- Holds clear `ciWaitStartedAt` and notify via `HoldNotifier` — `ci-poller.ts:86`

## Open questions

- Not verified: whether `loopLimits.ciFix` is read by the poller (the code uses a fixed single round via `ciFixDone`; `ci-poller.ts:73` only formats the message with `1`).
- Not verified: whether a failing fix push re-triggers checks quickly enough that `ciWaitStartedAt` (reset to null at `ci-fix.handler.ts:62`) restarts the timeout cleanly.
