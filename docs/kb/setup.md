# Initial setup (install checks and first-run admin)

## Overview

Initial setup has two parts. The `sdlc-agent` CLI (`packages/cli`) runs preflight checks ("doctor") before `init` and `up`, including a free-disk-space check. Once the stack runs, the API's setup endpoints let the first visitor create the admin password with a one-time setup code and report which credentials are still missing. Minimum free space is currently checked only in the CLI doctor; the API and dashboard have no disk check.

## Entry points

- `doctor()` — `packages/cli/src/doctor.ts:134` — builds the list of `Check`s (Node, Docker, Compose, socket, port 3000, sub-path mount probe, disk); the Docker server and Compose version lookups run in parallel
- `runDoctor()` — `packages/cli/src/doctor.ts:210` — runs the checks under a progress spinner (`withProgress`, `packages/cli/src/ui.ts:25`) and prints them; skipped when `SDLC_AGENT_SKIP_DOCTOR=1`
- `sdlc-agent doctor` — `packages/cli/src/main.ts:117` — exit code 1 when a required check fails
- `init` — `packages/cli/src/init.ts:62` — runs the doctor once, then starts the stack with `up({ skipDoctor: true })` (`init.ts:96`)
- `up` — `packages/cli/src/commands.ts:75` (runs the doctor unless `skipDoctor`); `upgrade` — `packages/cli/src/upgrade.ts:176` (quiet mode)
- `SetupController` — `apps/api/src/setup/setup.controller.ts:15` — `GET setup/status`, `POST setup/admin`, `POST auth/password`
- `SetupCodeService` — `apps/api/src/setup/setup-code.service.ts:20` — one-time first-run code
- `CredentialsService.status()` — `apps/api/src/credentials/credentials.service.ts:142` — builds `SetupStatus`
- `SetupStatus` type — `packages/shared/src/credentials.ts:45`

## Flow

1. `init`/`up`/`upgrade` call `runDoctor` — `init.ts:62`, `commands.ts:78`, `upgrade.ts:176`; `init` then calls `up` with `skipDoctor`, so the doctor does not run twice — `init.ts:96`, `commands.ts:77`
2. `init`, `up` and `upgrade` throw `CliError` when any required check failed, so setup stops — `init.ts:63`, `commands.ts:79`, `upgrade.ts:177`
3. The disk check picks the path with `diskTarget`: `DATA_DIR` if set, else the install folder, walking up to the nearest existing parent; it reads `statfsSync` there and computes `bavail * bsize` — `doctor.ts:85`, `:190-192`
4. `diskCheck` compares the free bytes with `MIN_REQUIRED_DISK_BYTES` (5 GiB) and `RECOMMENDED_DISK_BYTES` (10 GiB), with the free GB and path as detail and a hint to free space — `doctor.ts:69-82`
5. Under 5 GB is a required ✖ failure, so `init`, `up` and `upgrade` stop (block); 5-10 GB is a non-required `!` warning that does not stop them; `statfs` errors are swallowed and the check is skipped — `doctor.ts:189-195`
6. After the stack is healthy, `up` shows the dashboard URL and `SETUP_CODE` when no admin exists — `commands.ts:88-92`
7. On API start, `SetupCodeService.onModuleInit` creates a code (from `SETUP_CODE` or generated and logged) only if there is no admin and no `DASHBOARD_PASSWORD` — `setup-code.service.ts:28`
8. `GET setup/status` returns only `adminCreated` without a session, else the full `SetupStatus` — `setup.controller.ts:26-31`
9. `POST setup/admin` checks existing admin (409), login limiter (429), body schema, code (401), then sets the password, expires the code and starts a session — `setup.controller.ts:35-52`

## Data touched

- `AdminAccount` — created via `AuthService.setAdminPassword` (`setup.controller.ts:48`)
- Session row via `SessionService.create` (`setup.controller.ts:51`)
- `.env` in the install folder (`SETUP_CODE`, `DATA_DIR`) — read by the CLI (`commands.ts:92`)
- No data is written by the disk check.

## External calls

- `docker version` and `docker compose version` (run in parallel), and a `docker run` probe mounting a volume sub-path — `doctor.ts:122-127`, `:147`
- `docker image inspect`, then `docker pull` with visible output, of the Postgres probe image when it is not local — `doctor.ts:115-119`, `:186`
- Node `statfsSync` for disk space — `doctor.ts:191`

## Edge cases and rules

- Disk space is measured on `DATA_DIR` when set, else on the install folder (nearest existing parent if the path does not exist yet) — `doctor.ts:85`
- `SDLC_AGENT_SKIP_DOCTOR=1` bypasses all checks, including disk — `doctor.ts:211`
- Setup code comparison is constant-time and ignores case, dashes and spaces — `setup-code.service.ts:11`, `:42`
- With `DASHBOARD_PASSWORD` set, password change returns 409 — `setup.controller.ts:57`

## Tests

- `packages/cli/src/doctor.test.ts` — doctor unit tests (includes `diskCheck` and `diskTarget` tests)
- `packages/cli/src/init-start.test.ts` — `init` starts the stack without a second doctor run
- `packages/cli/src/ui.test.ts` — `withProgress`
- `packages/cli/src/docs.test.ts` — checks that the CLI README and this doc state the 5 GB minimum and 10 GB recommendation
- `apps/api/src/setup/setup.int.test.ts` — setup endpoints

## Open questions

- Whether the dashboard setup wizard should show disk space: not verified; `SetupStatus` has no disk field.
