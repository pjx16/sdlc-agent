FROM verdaccio/verdaccio:7.1.2@sha256:4addf64c2fd5f86e963444e8a482d7cd20cd2243e01470d548bdb23d0cd609de
LABEL org.opencontainers.image.source="https://github.com/pjx16/sdlc-agent" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="SDLC agent read-only npm mirror (Verdaccio)"
USER root
# Alpine security updates on top of the pinned base, and no npm/npx/corepack: Verdaccio serves packages, it never runs npm.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY config.yaml /verdaccio/conf/config.yaml
USER 10001
