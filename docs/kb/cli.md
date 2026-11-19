# CLI launcher (`sdlc-agent`)

## Overview

`packages/cli` is the npm package that installs and runs the stack from the Docker images published to GHCR, at the same version as the CLI. It is only a launcher: it writes the install folder (`~/.sdlc-agent` or `--dir`), generates infrastructure secrets, and drives `docker compose`. The agent image is not published (it contains Claude Code, which is Anthropic's software): `up` builds it locally from the shipped `docker/agent` folder as `sdlc-agent/agent:<version>`, through the `agent-image` service behind the `build` profile. The worker starts containers from it.

## Entry points

- `run()` / command dispatch — `packages/cli/src/main.ts:35` — parses argv, maps `CliError` to a message and exit code
- `init()` — `packages/cli/src/init.ts:32` — creates the folder and `.env`, then calls `up`
- `up()` — `packages/cli/src/commands.ts:67` — pulls and starts the stack
- `upgrade()` — `packages/cli/src/upgrade.ts:172` — backs up the database, merges guidelines and `.env` keys, then calls `up`
- `down`, `status`, `logs` — `packages/cli/src/commands.ts:81`, `:102`, `:114`
- `runDoctor()` — `packages/cli/src/doctor.ts` — Docker, port and disk checks, run first by `up`
- `resetAdmin`, `uninstall` — `packages/cli/src/admin.ts`
- `agentImage()` — `packages/cli/src/commands.ts` — resolves the agent image reference (`AGENT_IMAGE`, else `sdlc-agent/agent:${SDLC_VERSION}`)
- `prepareAgentImage()` — `packages/cli/src/commands.ts` — builds the agent image locally, or pulls `AGENT_IMAGE` when the operator set one; a failure stops `up`
- `copyAgentBuild()` — `packages/cli/src/init.ts` — replaces `docker/agent` in the install folder on `init` and `upgrade`

## Flow (`up`, also reached from `init` and `upgrade`)

1. Run the doctor checks; stop with `CliError` if any required check fails — `commands.ts:70`
2. `docker compose pull` for the compose services; failure is fatal — `commands.ts:73`
3. `prepareAgentImage`: with `AGENT_IMAGE` set, `docker pull` it; otherwise `docker compose --profile build build agent-image`, which builds `./docker/agent` as `sdlc-agent/agent:${SDLC_VERSION}` (the worker default in `deploy/docker-compose.yml`). Either failure stops `up` with an error, because the worker cannot pull a locally built tag.
4. `docker compose up -d --wait` (300 s timeout), after the agent pull — `commands.ts:76`
5. Print the dashboard URL and setup code if the admin does not exist yet — `commands.ts:78-83`

## Interaction with the worker's image pull

- On start the worker calls `ensureImage(config.agentImage)` — `apps/api/src/worker/worker-runner.ts:49`. `DockerEngine.ensureImage` inspects the image and pulls only when it is missing (404) — `apps/api/src/worker/agent-runner/container-engine.ts:110`.
- The CLI's `docker pull` (step 3) therefore runs before the stack starts and before the worker looks, so the worker finds the image `present`. The two pulls use the same reference, so the layers come from GHCR once; a second pull happens only if the CLI's pull failed or the references differ.

## Data touched

- Install folder: `.env`, `docker-compose.yml`, manifest (`manifest.ts`), guidelines, backups — written by `init`/`upgrade`
- Docker daemon via the `docker` binary (`proc.ts`, `compose.ts:10`); no network calls other than the dashboard `GET /api/setup/status` — `commands.ts:46`

## Edge cases and rules

- `init --no-start` never calls `up` — `init.ts:75`
- `up` is called with `quiet: true` from `init` and `upgrade`, which hides the install tip only — `commands.ts:79`
- A failed compose pull or an unhealthy stack is fatal; a failed agent-image pull is not — `commands.ts:73`, `:76`, `:64`
- `agentImage` is covered by `packages/cli/src/commands.test.ts:39`; `up` (call order, warn-and-continue on agent pull failure, no agent pull when compose pull fails) by `commands.test.ts:47`

## Tests

- `commands.test.ts`, `doctor.test.ts`, `envfile.test.ts`, `init.test.ts`, `secrets.test.ts`, `upgrade.test.ts` in `packages/cli/src/`; run with `npm test` in `packages/cli`
- Worker side: `apps/api/src/worker/agent-runner/ensure-image.test.ts`

## Notes

- The source-build `docker-compose.yml` references the agent image only as the `agent-image` service behind the `build` profile (`docker compose --profile build build agent-image`); the worker starts agent containers from it. The release compose file has the same `agent-image` build service (context `./docker/agent`) and passes `sdlc-agent/agent:${SDLC_VERSION}` to the worker and docker-proxy.
