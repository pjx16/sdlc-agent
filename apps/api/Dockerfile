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
      org.opencontainers.image.description="SDLC agent API"
# The digest pins the base image, which then lags the Debian security updates; take them at build time.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*
# npm, npx and corepack are never used at runtime. Removing them drops the npm CLI and its bundled dependencies (and their CVEs).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/doc/sdlc-agent/
WORKDIR /app
# The API needs no privileges (unlike the worker, which needs the Docker socket and chown).
COPY --from=deps --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma apps/api/prisma
COPY --from=build --chown=node:node /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY --from=build --chown=node:node /app/apps/api/docker-entrypoint.sh apps/api/docker-entrypoint.sh
# The guidelines as they shipped. The folder people edit is mounted over /app/guidelines, so this copy is how the dashboard knows what was changed and can put the original back.
COPY --chown=node:node guidelines /app/guidelines.default
WORKDIR /app/apps/api
ENV NODE_ENV=production PORT=4000 GUIDELINES_DEFAULT_DIR=/app/guidelines.default
USER node
EXPOSE 4000
ENTRYPOINT ["sh", "/app/apps/api/docker-entrypoint.sh"]
