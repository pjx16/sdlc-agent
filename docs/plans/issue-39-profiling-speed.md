# Plan: #39 — Code profiling: visible progress and less waiting

## Goal
1. Make profiling obviously in-progress with a modal showing live phases.
2. Reduce wall-clock time.

## Approach
### A. Instrumentation
- In `onboarding-worker.ts` wrap each phase (`access`, `facts`, `mirror`, `checkout`, `profile`, `install`, `typecheck`, `advise`) in a timer helper; record durations in `proposal.timings` and log one summary event.

### B. Phase progress API
- Prisma: add `Project.onboardingPhase String?` and `onboardingPhaseStartedAt DateTime?` (migration).
- Worker updates them at each phase boundary; clears on finish/failure.
- `onboarding.service.ts` includes `{ phase, phases[], startedAt }` in the view; shared type in `packages/shared`.

### C. Speed
- Run `onboardAdvise` concurrently with `clone → checkout → profile → install → typecheck` via `Promise.all`. Errors: first rejection fails onboarding as today; no half-written state because the proposal is written once at the end.
- Keep install/typecheck validation (correctness). Reuse the already-warm mirror for checkout (already shallow).
- Follow-ups, only if timings justify: smaller profiler `maxTurns`, cheaper model alias, optional "skip validation".

### D. UI
- New `ProfilingModal` in `apps/dashboard/components/`: checklist of phases (done ✔ / current spinner / pending), elapsed timer, "Continue in background" button; opens automatically when a project is created and when the user visits a `profiling` project. Polling interval unchanged (or 2 s while the modal is open).
- Respect `prefers-reduced-motion`.

## Files
`apps/api/prisma/schema.prisma` (+migration), `apps/api/src/worker/onboarding/onboarding-worker.ts`, `apps/api/src/projects/onboarding.service.ts`, `packages/shared/src/*` (view type), `apps/dashboard/components/onboarding-panel.tsx`, new `profiling-modal.tsx`, tests.

## Tests
- Worker int test: phases recorded in order; advise runs concurrently (fake runner asserts overlap); failure in either branch → `draft` with message.
- Service test: view includes phase info.
- Dashboard test (`onboarding.test.tsx`): modal renders phases, marks current, can be dismissed.

## Acceptance criteria
- Creating a project shows the modal with live phase updates.
- Median profiling time drops by roughly the duration of the advise stage (verify with recorded timings).
- Timings visible in logs/proposal.
- Failure paths unchanged.

## Out of scope
Skipping validation, model changes (follow-ups); GitHub Projects support (#40).

## Decisions
Measure → parallelise → show phases; keep validation; modal is dismissible.

## Risks
Two concurrent Claude runs raise rate-limit pressure (mitigated: existing pause-on-limit logic applies; run is single-project at a time); migration needed.
