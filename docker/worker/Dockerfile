FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @sdlc/shared && npm run build -w @sdlc/api

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --omit=dev --ignore-scripts -w @sdlc/api

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
LABEL org.opencontainers.image.source="https://github.com/pjx16/sdlc-agent" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="SDLC agent worker"
# curl is only needed to fetch the (already dearmored) gh keyring, so it is purged in the same layer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && apt-get purge -y --auto-remove curl \
 && rm -rf /var/lib/apt/lists/*
COPY docker/worker/git-askpass-token /usr/local/bin/git-askpass-token
RUN chmod +x /usr/local/bin/git-askpass-token
# Workspaces are written by the agent user (uid 1000) while the worker runs as root. There is no system-wide safe.directory '*': git-runner.ts
# passes safe.directory for the one folder each call runs in, and ignores the system and global git config (GIT_CONFIG_NOSYSTEM).
# Hooks and fsmonitor are disabled on every git call, so a workspace's own config cannot run code here.
ENV GIT_ASKPASS=/usr/local/bin/git-askpass-token GIT_TERMINAL_PROMPT=0

COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/doc/sdlc-agent/
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
ENV NODE_ENV=production
# Runs as root: the worker uses the Docker socket (BUILD_PLAN 6.1).
CMD ["node", "dist/worker.js"]
