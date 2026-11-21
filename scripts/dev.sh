#!/usr/bin/env bash
# Development mode: Postgres, the egress proxy, the npm mirror and the LLM gateway relay run in Docker; the API, worker and dashboard run on this machine
# with hot reload. Ctrl+C stops the three of them (Postgres and the proxy keep running; `npm run down:dev` stops those).
# Usage: npm run up:dev
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

# Development is its own Docker Compose project (containers sdlc-agent-dev-*, its own database volume), so it never shares
# containers or data with `npm run up:prod`, which is the project called sdlc-agent. Postgres is on 5433 here so both can run.
export COMPOSE_PROJECT_NAME=sdlc-agent-dev
# The dev overlay publishes Postgres on host loopback so the host api and worker can connect; prod and release never do.
export COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml
export POSTGRES_PORT="${DEV_POSTGRES_PORT:-5433}"

[ -f .env ] || { echo "No .env found. Copy .env.example to .env and fill it in."; exit 1; }
# shellcheck source=scripts/ensure-encryption-key.sh
. ./scripts/ensure-encryption-key.sh
# shellcheck source=scripts/docker-housekeeping.sh
. ./scripts/docker-housekeeping.sh
ensure_encryption_key .env
set -a; . ./.env; set +a
: "${DATA_DIR:?set DATA_DIR in .env}"
: "${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}"
mkdir -p "$DATA_DIR"
command -v gh >/dev/null || echo "Warning: the GitHub CLI (gh) is not installed; the worker needs it to open pull requests."

docker_housekeeping
echo "==> Stopping the production api, worker and dashboard if they run (they use the same ports 3000 and 4000)"
docker compose -p sdlc-agent stop api worker dashboard >/dev/null 2>&1 || true

echo "==> Building the agent image and starting Postgres, the egress proxy, the npm mirror and the LLM gateway relay"
docker compose --profile build build agent-image
# Agents reach the npm mirror and, through the relay, the worker's LLM gateway on this machine.
docker compose up -d --build --wait --wait-timeout 120 postgres proxy npm-mirror llm-gateway-relay

export DATABASE_URL="postgresql://sdlc:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/sdlc"
export GIT_ASKPASS="$ROOT/docker/worker/git-askpass-token" GIT_TERMINAL_PROMPT=0
export API_URL="${API_URL:-http://localhost:4000}"

[ -d node_modules ] || { echo "==> npm install"; npm install; }
echo "==> Building the shared package and applying database migrations"
npm run build -w @sdlc/shared >/dev/null
(cd apps/api && npx prisma generate >/dev/null && npx prisma migrate deploy)

pids=()
cleanup() { echo; echo "==> Stopping"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM
run() { local name=$1; shift; ( "$@" 2>&1 | sed -u "s/^/[$name] /" ) & pids+=($!); }

run api npm run dev -w @sdlc/api
echo "==> Waiting for the first API build"
for _ in $(seq 1 120); do [ -f apps/api/dist/worker.js ] && curl -fs localhost:4000/health >/dev/null 2>&1 && break; sleep 1; done
run worker bash -c "cd apps/api && node --watch --watch-path=dist dist/worker.js"
run dashboard npm run dev -w @sdlc/dashboard

echo
echo "Dashboard: http://localhost:3000   API: http://localhost:4000   (Ctrl+C to stop)"
wait
