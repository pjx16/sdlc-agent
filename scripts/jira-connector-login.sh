#!/usr/bin/env bash
# Signs the Jira connector stage in to claude.ai (connector mode only).
#
# Connector mode has a Claude agent drive the Jira connector you added in claude.ai. claude.ai connectors load only for a claude.ai
# login, never through the pipeline's LLM gateway, so this stage keeps its own login in the Docker volume sdlc_jira_connector_home.
# Run this once, and again whenever the dashboard says the connector login expired.
#
#   bash scripts/jira-connector-login.sh          # sign in: run /login, then /mcp to see the Jira connector, then /exit
#   bash scripts/jira-connector-login.sh --check  # list the MCP servers the login can see
#
# Use the claude.ai account that has the Jira connector. Every Jira call in connector mode spends that account's Claude usage.
set -euo pipefail

VOLUME=sdlc_jira_connector_home
IMAGE="${AGENT_IMAGE:-sdlc-agent/agent:latest}"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "The agent image $IMAGE is missing. Build it first (npm run up:prod or docker compose build)." >&2
  exit 1
fi
docker volume create "$VOLUME" >/dev/null

run() {
  docker run --rm "$@" --user 1000:1000 \
    -e CLAUDE_CONFIG_DIR=/connector-home -e ENABLE_CLAUDEAI_MCP_SERVERS=1 -e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=0 \
    -v "$VOLUME":/connector-home "$IMAGE"
}

if [ "${1:-}" = "--check" ]; then
  run -t claude mcp list
  exit 0
fi

cat <<'MSG'
Starting Claude Code inside the agent image.
  1. Run /login and choose your claude.ai account (the one with the Jira connector).
  2. Run /mcp and check that the Jira connector is listed (for example "claude.ai Atlassian").
     Its name after "claude.ai " is the connector name for the project setting (default: Atlassian).
  3. Run /exit.
MSG
run -it claude
