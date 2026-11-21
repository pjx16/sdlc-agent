FROM verdaccio/verdaccio:7.1.1@sha256:c826ec44b4f7bf6512b0362c5f6f199bbdc8c4348410ced7fdb7fc62f52f477e
LABEL org.opencontainers.image.source="https://github.com/pjx16/sdlc-agent" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="SDLC agent read-only npm mirror (Verdaccio)"
USER root
# Alpine security updates on top of the pinned base, and no npm/npx/corepack: Verdaccio serves packages, it never runs npm.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY config.yaml /verdaccio/conf/config.yaml
USER 10001
