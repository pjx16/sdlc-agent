# Plan: #47 — Detect no-internet, auto-pause the pipeline, show a banner

## Goal
When the machine loses internet, the pipeline pauses by itself and a small banner explains it; when it comes back, everything resumes automatically.

## Approach
1. **Worker**: `apps/api/src/worker/connectivity/connectivity-monitor.ts`
   - Probes (default: Anthropic API, api.github.com, 1.1.1.1:443) with 3 s timeout, run in parallel; any success ⇒ online.
   - State machine: `online → suspect (1–2 failed rounds) → offline (3 failed rounds)`; back online on the first successful round. Injectable clock/probe for tests.
   - Probe interval 15 s online, 5 s while suspect/offline.
2. **DB**: `GlobalSettings.networkOffline Boolean @default(false)`, `offlineSince DateTime?` (migration).
3. **Loop**: `WorkerLoop` treats `networkOffline` like a pause (`phase('paused')` with detail "offline") **without** touching `pipelinePaused`. Intake pollers also skip while offline.
4. **API**: expose `networkOffline/offlineSince` in `GET /system` settings DTO.
5. **Dashboard**: `OfflineBanner` in `shell.tsx`; `StatusPill` shows "Offline"; polling keeps working (dashboard→API is local).
6. **Config**: `CONNECTIVITY_CHECK=on|off`, `CONNECTIVITY_PROBES` (comma-separated URLs).
7. **Events**: log `offline`/`online` transitions with duration.

## Tests
Monitor unit tests (hysteresis, recovery, all-probes-fail vs one-fails); loop test (no step while offline, resumes after); system DTO test; banner component test.

## Acceptance criteria
- Unplugging the network pauses within ~45 s, shows the banner; reconnecting clears both within one probe round.
- Manual pause state is never altered by connectivity changes.
- No tickets fail or hold merely because the network dropped between steps.

## Out of scope
Recovering a step already in flight (#48); proxy auto-detection.

## Decisions
Dedicated flag rather than reusing `pipelinePaused`; multiple real-dependency probes; 3-round hysteresis; configurable/disableable.

## Risks
Corporate networks blocking probe hosts ⇒ false offline (mitigated by "any probe succeeds", configurable list, off switch).
