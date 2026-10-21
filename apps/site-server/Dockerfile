# EVACTIS 3DWORKFLOW Site Server — container image.
#
# Built from the already-built server (dist/), so the build itself installs nothing:
#
#   pnpm --filter @evactis-3dworkflow/site-server build
#   docker build -t evactis-3dworkflow-site-server:0.1.0 apps/site-server/dist -f apps/site-server/Dockerfile
#
# Run it with host networking, so the server sees the site's real addresses (for its
# certificate, its TURN relay and its LAN-only checks) and nothing is translated:
#
#   docker run -d --name evx-site --network host --restart unless-stopped \
#     -v /srv/evx-site:/data evactis-3dworkflow-site-server:0.1.0
#
# For an air-gapped host: `docker save` here, `docker load` there. The image makes no
# network calls of its own; see docs/site-server.md.
#
# Node.js 22 (Debian bookworm, slim), pinned by digest so every build starts from the
# same bytes.
FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94

LABEL org.opencontainers.image.title="EVACTIS 3DWORKFLOW Site Server" \
      org.opencontainers.image.vendor="Evactis" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.description="Optional, client-hosted, LAN-only: shared notes, guided sessions, local usage reports."

ENV NODE_ENV=production \
    EVX_SITE_DATA=/data
WORKDIR /app
COPY server.cjs NOTICES.txt ./
COPY web ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
# HTTPS, TURN, TURN relay range (the defaults; change them in /data/config.json).
EXPOSE 8443/tcp 3478/udp 49160-49200/udp
ENTRYPOINT ["node", "/app/server.cjs"]
