FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/broker/package.json apps/broker/
RUN npm ci --ignore-scripts -w @sdlc/broker --include-workspace-root
COPY apps/broker apps/broker
RUN npm run build -w @sdlc/broker

# The broker has no runtime dependencies: the image holds its compiled code only, without the toolchain, sources or dev dependencies.
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
LABEL org.opencontainers.image.source="https://github.com/pjx16/sdlc-agent" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="SDLC agent GitHub broker"
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/doc/sdlc-agent/
WORKDIR /app/apps/broker
COPY --from=build /app/apps/broker/package.json package.json
COPY --from=build /app/apps/broker/dist dist
ENV NODE_ENV=production PORT=8080 BROKER_DATA_FILE=/data/broker.json
# The broker keeps one small JSON file (hashed system keys and which installation belongs to which system): mount /data to keep it.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/main.js"]
