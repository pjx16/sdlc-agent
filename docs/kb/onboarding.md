# Onboarding (project profiling)

## Overview

When a user adds a project (repo URL, optional Jira key), the API creates it in status `profiling`. A worker housekeeper then collects facts, runs the `repo-profiler` agent, checks install/typecheck once, optionally runs the `onboarding-advisor` agent for Jira/Confluence mapping, and stores a proposal. The user reviews and confirms it in the dashboard; nothing is applied until then. Profiling is the slow part (clone, two agent containers, install and typecheck runs).

## Entry points

- `POST /projects/onboard` — `apps/api/src/projects/projects.controller.ts:19` → `OnboardingService.start` (`onboarding.service.ts:61`)
- `GET /projects/:id/onboarding` — `projects.controller.ts:24` → `OnboardingService.get` (`onboarding.service.ts:101`)
- `POST /projects/:id/onboarding/rerun` — `projects.controller.ts:29` → `rerun` (`onboarding.service.ts:107`)
- `PATCH /projects/:id/onboarding/sections/:section` — `projects.controller.ts:35` → `section` (`onboarding.service.ts:116`)
- `OnboardingWorker.check()` — `apps/api/src/worker/onboarding/onboarding-worker.ts:102`, a `Housekeeper` polled every 5 s (`:84`)
- `OnboardingPanel` — `apps/dashboard/components/onboarding-panel.tsx` (shown from `app/(shell)/projects/[id]/page.tsx`)
- Agent prompt: `guidelines/agents/base/repo-profiler.md`

## Flow

1. `start` creates the project with placeholder stack/test command, `onboardingStatus: 'profiling'`, `mirrorStatus: 'pending'` — `onboarding.service.ts:78`
2. `check()` skips while the pipeline is paused for limits, picks the oldest `profiling` project, one at a time (`running` flag) — `onboarding-worker.ts:102`
3. `onboard()` first checks GitHub App access when `RepoAccessService` is present — `onboarding-worker.ts:122`
4. `collectFacts` (no AI): GitHub repo facts, Jira project facts if a key is set, Confluence writable spaces (failure tolerated) — `onboarding-worker.ts:174`
5. Sets `baseBranch` to the GitHub default and clones the bare mirror via `MirrorService.clone` — `onboarding-worker.ts:129`
6. Shallow-clones the mirror (`--depth 1`) into `<dataDir>/onboarding/<projectId>` and makes it writable for the agent — `onboarding-worker.ts:139`
7. Runs the `repoProfile` stage through `AgentRunner` (read-only workspace) — `onboarding-worker.ts:142`, `stage()` at `:199`
8. Runs the profile's install command, then typecheck (skipped when install failed), each once via `VerifyService.runCmd` with `verifyTimeoutSec` — `onboarding-worker.ts:143`, `check1` at `:217`
9. If Jira facts exist, runs the `onboardAdvise` stage (no workspace) — `onboarding-worker.ts:147`
10. Saves `onboardingStatus: 'proposed'` with the proposal JSON, raises an `onboarding` support item and logs an event — `onboarding-worker.ts:156`
11. On any error: status `draft` with a message of at most 500 characters; the checkout is always removed — `onboarding-worker.ts:163`
12. Dashboard: while status is `profiling` the panel polls `GET .../onboarding` every 3 s (`POLL_MS`, `onboarding-panel.tsx:8`, `:70`) and shows a plain text status box ("Reading the repository and your Jira project…", "This takes a few minutes") — `onboarding-panel.tsx:89`. No stepwise progress, animation or modal exists.
13. `draft` shows the error and a "Run it again" button calling `rerun`; `proposed` shows per-section Accept/Edit — `onboarding-panel.tsx:98`

## Data touched

- `Project` — `onboardingStatus` (`profiling`/`proposed`/`draft`/confirmed), `onboardingError`, `onboardingProposal` (JSON: facts, profile, advice, accepted), `baseBranch`, `mirrorStatus`/`mirrorError`
- `Event` — "Onboarding … started/failed/ready" notes (`onboarding.service.ts:82`, `onboarding-worker.ts:164`)
- Support item of kind `onboarding`, dedupe key `onboarding:<projectId>` (`onboarding-worker.ts:157`)
- Disk: `<dataDir>/onboarding/<projectId>` (temporary) and the project mirror

## External calls

- GitHub API (`repoFacts`), Jira (`projectFacts`), Confluence (`listWritableSpaces`)
- `git clone` of the mirror and the checkout (`CHECKOUT_TIMEOUT_MS`)
- Agent containers (Claude) for `repoProfile` and `onboardAdvise`; command containers for install/typecheck
- Stage config: `repoProfile` workspace mode `ro`, `onboardAdvise` `none` — `agent-runner/stage-config.ts:8`

## Rules and edge cases

- Duplicate repo URL: name collisions retry with `owner-repo`, then `owner-repo-2`, else a validation error — `onboarding.service.ts:63`
- `rerun` returns 409 while already `profiling` — `onboarding.service.ts:109`
- Sections can be accepted/edited only when status is `proposed`; Jira-related sections must be accepted before confirming (`MUST_ACCEPT`)
- Nothing in the proposal affects the project until confirmed; the worker ignores the project until then

## Tests

- `apps/api/src/worker/onboarding/onboarding-worker.int.test.ts`
- `apps/api/src/projects/onboarding.int.test.ts`
- `apps/dashboard/components/onboarding.test.tsx`

## Open questions

- Which steps dominate the wall time (mirror clone, agent container start, install) — not verified
- Whether `mirrors.clone` and the second shallow clone could be merged or the Jira advisor run in parallel with the profiler — not verified
