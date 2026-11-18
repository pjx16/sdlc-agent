FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /app
COPY policy.mjs server.mjs ./
# Runs as root only because the Docker socket is root-owned; it opens no files and runs no commands.
CMD ["node", "server.mjs"]
