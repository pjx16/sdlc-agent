FROM verdaccio/verdaccio:7.1.0@sha256:c1b1b86154b43a4e1861bc7a4496d4977aa43c8bdb5db49b68445f8a9273729f
LABEL org.opencontainers.image.source="https://github.com/pjx16/sdlc-agent" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="SDLC agent read-only npm mirror (Verdaccio)"
USER root
# Alpine security updates on top of the pinned base, and no npm/npx/corepack: Verdaccio serves packages, it never runs npm.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY config.yaml /verdaccio/conf/config.yaml
USER 10001
