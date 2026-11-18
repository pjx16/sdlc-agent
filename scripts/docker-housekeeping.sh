#!/usr/bin/env bash
# Sourced by prod.sh and dev.sh. Repeated image builds fill Docker's disk until Postgres cannot start ("No space left on device"),
# so before building: drop build cache that nothing has used for 3 days, then say how much Docker holds.
# Only build cache is touched: never images, containers or volumes (the database lives in a volume).
docker_housekeeping() {
  echo "==> Removing build cache older than 3 days"
  docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
  local line
  line=$(docker system df --format '{{.Type}}: {{.Size}} ({{.Reclaimable}} reclaimable)' 2>/dev/null | tr '\n' ' ') || true
  [ -n "${line:-}" ] && echo "    Docker disk use  ${line}"
  echo "    If Docker runs out of space, run: docker builder prune -af   (volumes and the database are not touched)"
}
