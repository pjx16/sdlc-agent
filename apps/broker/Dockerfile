FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/broker/package.json apps/broker/
RUN npm ci --ignore-scripts -w @sdlc/broker --include-workspace-root
COPY apps/broker apps/broker
RUN npm run build -w @sdlc/broker
WORKDIR /app/apps/broker
ENV NODE_ENV=production PORT=8080 BROKER_DATA_FILE=/data/broker.json
# The broker keeps one small JSON file (hashed system keys and which installation belongs to which system): mount /data to keep it.
RUN mkdir -p /data && chown -R node:node /data /app/apps/broker
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/main.js"]
