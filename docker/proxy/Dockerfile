# Canonical publishes this image only on `_edge` and `_beta` tracks; `_beta` of the 24.04 LTS line is its most stable one. Pinned by digest.
FROM ubuntu/squid:6.6-24.04_beta@sha256:6a097f68bae708cedbabd6188d68c7e2e7a38cedd05a176e1cc0ba29e3bbe029
LABEL org.opencontainers.image.source="https://github.com/pjx16/sdlc-agent" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="SDLC agent egress allowlist proxy (Squid)"
# Canonical rebuilds this image rarely: apply Ubuntu's security updates (openssl, apt, gpgv) on top of the pinned base.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*
COPY squid.conf /etc/squid/squid.conf
CMD ["-f", "/etc/squid/squid.conf", "-NYC"]
