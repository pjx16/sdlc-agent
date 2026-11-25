# Plan: #48 — Tickets recover by themselves after a network issue

## Goal
A network outage (or sleep) never leaves tickets on hold/failed; work resumes by itself when connectivity returns.

## Approach
1. **Shared**: `isNetworkError()` in `packages/shared/src/network-errors.ts`; add `NETWORK_ERROR` to `ERROR_CODES` with policy `retry_until_online` (message "Network problem; will retry when the connection is back", no human action).
2. **Classification points**: `agent-runner.ts` (Claude CLI output/container), `git-runner.ts`, `github-client.ts`, Jira clients — map network failures to `NETWORK_ERROR` before the existing codes.
3. **Outcomes**: `StageOutcomes.forResult` — `NETWORK_ERROR` ⇒ `{ kind: 'stay' }`, StageRun marked `interrupted` (not an attempt), event logged once per outage, `Ticket.retryAt = now + 30 s`.
4. **Loop**: `pickNext` skips tickets with future `retryAt`; with #47's monitor, no steps start while offline, so tickets wake as soon as online.
5. **Startup sweep** (`recovery.service.ts`): stage runs left `running` with no live container → mark interrupted & re-queue; tickets on hold/failed with `NETWORK_ERROR` in the last 24 h → resume via `states.resume(..., 'system')`.
6. **Idempotent git/PR steps**: verify push and PR creation re-check remote (branch SHA, existing PR for branch) before acting; add tests.
7. **Dashboard**: ticket shows "Waiting for network" badge instead of an error.

## Tests
Classifier table tests; outcome test (no retry consumed, no hold); sweep test; push/PR idempotency tests; int test simulating failure then success.

## Acceptance criteria
- Disconnect during a stage → ticket stays in place, no hold/fail, resumes after reconnect without clicks.
- After restart following an outage, previously network-held tickets resume.
- Non-network errors behave as before.

## Out of scope
Offline detection/banner (#47); resuming a half-finished Claude session mid-turn (stage restarts).

## Decisions
Dedicated non-counting error code; re-queue via `stay` + `retryAt`; startup sweep; idempotency audit of push/PR.

## Risks
Misclassifying a real failure as network ⇒ infinite retry (mitigate: cap at 24 h of continuous network errors then hold; log each cycle).
