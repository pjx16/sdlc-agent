# Container images (api and worker)

## Overview

The `api` and `worker` services are built from two Dockerfiles that share the same three-stage layout: a `build` stage installs all workspace dependencies and compiles `@sdlc/shared` and `@sdlc/api` with `tsc`, a `deps` stage installs production dependencies of `@sdlc/api` only, and a runtime stage copies just `node_modules` from `deps` and the compiled output from `build`. Dev dependencies, TypeScript sources and the dashboard package are not in the final images. A release install pulls the published images instead of building them.

## Entry points

- API image — `apps/api/Dockerfile:20` (runtime stage) — runs `docker-entrypoint.sh` as user `node`, port 4000
- Worker image — `docker/worker/Dockerfile:20` (runtime stage) — runs `node dist/worker.js` as root
- API entrypoint — `apps/api/docker-entrypoint.sh:5` — runs `npx prisma migrate deploy`, then `node dist/main.js`
- Build context filter — `.dockerignore:1` — excludes `node_modules`, `dist`, `.next`, `.turbo`, `.git`, `.env`, `data`, `*.md` (except `README.md`)
- Source-build compose — `docker-compose.yml:25` (api), `:53` (worker)
- Release compose — `deploy/docker-compose.yml:26` (api), `:52` (worker): images `sdlc-agent-api` / `sdlc-agent-worker` from `${SDLC_REGISTRY:-ghcr.io/pjx16}` at `${SDLC_VERSION}`
- CLI — `packages/cli/src/compose.ts:6` builds the `docker compose` arguments; `packages/cli/src/init.ts:23` copies the release compose file into the install folder

## Flow

1. All stages start from `node:24-bookworm-slim` pinned by digest; the first two are named `build` and `deps` — `apps/api/Dockerfile:1`, `:12`, `:20`, `docker/worker/Dockerfile:1`, `:12`, `:20`
2. `build` copies only manifests (`package.json`, lockfile, `turbo.json`, `tsconfig.base.json`, `shared`, `api`, `dashboard` package.json files), then `npm ci --ignore-scripts` installs every workspace's dependencies, dev included — `apps/api/Dockerfile:3-7`, `docker/worker/Dockerfile:3-7`
3. `build` copies sources of `packages/shared` and `apps/api` — `apps/api/Dockerfile:8-9`, `docker/worker/Dockerfile:8-9`
4. `npm run build -w @sdlc/shared && npm run build -w @sdlc/api` compiles both; the api build also runs `prisma generate`, whose client goes to `apps/api/src/generated/prisma` and is compiled into `dist` — `apps/api/Dockerfile:10`, `apps/api/package.json:6`, `apps/api/prisma/schema.prisma:3`
5. `deps` runs `npm ci --omit=dev --ignore-scripts -w @sdlc/api`, giving production-only `node_modules` — `apps/api/Dockerfile:18`, `docker/worker/Dockerfile:18`
6. API runtime stage copies `node_modules` from `deps`, and from `build` the shared `package.json` and `dist`, the api `package.json`, `dist`, `prisma/`, `prisma.config.ts` and `docker-entrypoint.sh`, all with `--chown=node:node` — `apps/api/Dockerfile:23-30`
7. API: `WORKDIR /app/apps/api`, `NODE_ENV=production PORT=4000`, `USER node`, `EXPOSE 4000`, entrypoint script — `apps/api/Dockerfile:31-35`
8. Worker runtime stage first runs one `RUN` that installs `git`, `ca-certificates`, `curl`, fetches the `gh` apt keyring with `curl`, installs `gh`, purges `curl` and removes apt lists; `gnupg` is not installed — `docker/worker/Dockerfile:22-30`
9. Worker copies `git-askpass-token`, sets `GIT_ASKPASS` and `GIT_TERMINAL_PROMPT=0`, and marks every directory as a git `safe.directory` because workspaces belong to uid 1000 while the worker runs as root — `docker/worker/Dockerfile:31-36`
10. Worker copies `node_modules` from `deps` and the shared and api `package.json` and `dist` from `build` (no `prisma/` folder), then sets `WORKDIR /app/apps/api`, `NODE_ENV=production`, `CMD ["node", "dist/worker.js"]` — `docker/worker/Dockerfile:38-47`
11. The worker runs as root (no `USER`) because it drives Docker — `docker/worker/Dockerfile:46`. In the source-build compose it reaches Docker through the filtering `docker-proxy` service (`docker/socket-proxy`, `DOCKER_HOST=tcp://docker-proxy:2375`) rather than the socket itself; `deploy/docker-compose.yml` does the same
12. The dashboard image uses a similar two-stage build (build stage, then only `.next/standalone` and `.next/static` copied) — `apps/dashboard/Dockerfile:1`, `:12-17`

## Data touched

- Reads: repository sources and manifests at build time; no runtime data of its own
- The api container applies Prisma migrations at start when `prisma/migrations` is non-empty — `apps/api/docker-entrypoint.sh:4`
- No database schema or API contract is part of this feature

## Rules and edge cases

- The worker needs `git` and `gh` at runtime (`gh` for pull requests; git credentials via `git-askpass-token`). Removing them breaks the worker — `docker/worker/Dockerfile:22-36`
- `prisma` is in `dependencies` of the api package, so the production-only install keeps the CLI that the entrypoint runs with `npx prisma migrate deploy` — `apps/api/package.json:33`, `apps/api/docker-entrypoint.sh:5`
- The api runtime image needs `prisma/` and `prisma.config.ts` for `migrate deploy` — `apps/api/Dockerfile:28-29`
- Images use `npm ci --ignore-scripts`, so the `postinstall` `prisma generate` does not run; the build script runs it — `apps/api/Dockerfile:7`, `apps/api/package.json:6`
- The base image digest is pinned in every `FROM`; changing it is a supply-chain decision — `apps/api/Dockerfile:1`
- `.dockerignore` excludes `*.md`, so any file the build needs must not be a markdown file — `.dockerignore:8`
- `docker-compose.yml:1` documents that the agent image is built separately with `docker compose --profile build build`; the release compose says the worker pulls the agent image on first start — `deploy/docker-compose.yml:1`
- The pull size of published images is set by the release workflow, which builds these Dockerfiles (`.github/workflows/release.yml`, content not verified)

## Tests

- `apps/api/src/docker-images.test.ts` parses both Dockerfiles and the api `package.json` (stages, `--omit=dev` install, copies, `prisma` placement, worker apt packages) and checks the changelog entry
- CLI behaviour around compose is tested in `packages/cli/src/init.test.ts`, `packages/cli/src/upgrade.test.ts`

## Open questions

- Whether the worker loads anything from the `dashboard` workspace — not verified (its package.json is copied only to satisfy the lockfile)
- Whether the worker runs without `prisma/` and `prisma.config.ts` at runtime — not verified by running the image
