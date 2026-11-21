FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
LABEL org.opencontainers.image.source="https://github.com/pjx16/sdlc-agent" \
      org.opencontainers.image.licenses="MIT AND LicenseRef-Anthropic-Claude-Code" \
      org.opencontainers.image.description="SDLC agent sandbox that runs one pipeline stage. Built locally, never published: it contains Claude Code, which is Anthropic's proprietary software."

# The one place the Claude Code version is set (compose and the CLI build this Dockerfile without overriding it).
ARG CLAUDE_CODE_VERSION=2.1.322
# Agents run npm, so it stays, upgraded within the major Node.js ships (11): the bundled copy lags on security fixes in its own
# dependencies, and npm 12 changes how dependency install scripts run (Claude Code's own postinstall among them).
ARG NPM_VERSION=11.21.3

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl bash jq \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g npm@${NPM_VERSION} \
 && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

ENV DISABLE_AUTOUPDATER=1 \
    DISABLE_TELEMETRY=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

COPY --chmod=755 run-stage run-cmd /usr/local/bin/

# The shared npm cache volume is mounted here; creating it owned by `node` makes a new volume writable by the agent user.
# /connector-home is the Jira connector's claude.ai login (connector mode only); a named volume is mounted there.
RUN mkdir /npm-cache /connector-home && chown node:node /npm-cache /connector-home

# The node base image provides user `node` (uid 1000).
USER node
WORKDIR /workspace
