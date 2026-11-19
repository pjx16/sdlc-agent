FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
LABEL org.opencontainers.image.source="https://github.com/pjx16/sdlc-agent" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="SDLC agent filtered Docker socket proxy"
# npm, npx and corepack are never used at runtime. Removing them drops the npm CLI and its bundled dependencies (and their CVEs).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY policy.mjs server.mjs ./
# Runs as root only because the Docker socket is root-owned; it opens no files and runs no commands.
CMD ["node", "server.mjs"]
