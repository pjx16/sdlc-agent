#!/usr/bin/env bash
# Production mode: everything runs in Docker Compose (images built from the current code).
# Usage: npm run up:prod
set -euo pipefail
cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME=sdlc-agent   # production is the project sdlc-agent; `npm run up:dev` uses sdlc-agent-dev

[ -f .env ] || { echo "No .env found. Copy .env.example to .env and fill it in."; exit 1; }
# shellcheck source=scripts/ensure-encryption-key.sh
. ./scripts/ensure-encryption-key.sh
# shellcheck source=scripts/docker-housekeeping.sh
. ./scripts/docker-housekeeping.sh
ensure_encryption_key .env
set -a; . ./.env; set +a
# Repository data lives in the sdlc_data volume, not on the host. Only the encrypted database backups land here, private to you.
mkdir -p backups && chmod 700 backups
export SDLC_UID="${SDLC_UID:-$(id -u)}" SDLC_GID="${SDLC_GID:-$(id -g)}"

docker_housekeeping
echo "==> Building the agent image"
docker compose --profile build build agent-image
echo "==> Building and starting api, worker, dashboard, postgres and proxy"
docker compose up -d --build --wait --wait-timeout 180

echo
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
echo
echo "Dashboard: http://localhost:3000   (first run: enter the setup code from  docker compose logs api | grep 'setup code')"
echo "Logs:      docker compose logs -f worker      Stop: npm run down"
