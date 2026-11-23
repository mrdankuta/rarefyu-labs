# Single-container student app: web UI + API + terminals + coding agents on ONE port (3000).
# Build from the repo root:  docker build -f images/lab-local/Dockerfile -t rarefyu/lab-local:dev .
# Runs the same on a student laptop, a VPS, or (later) Cloudflare Containers: the
# container itself is the isolation boundary, so the API uses DRIVER=local inside it.
ARG BASE=rarefyu/base-lab:dev

FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock bun.lockb* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/lab-sdk/package.json ./packages/lab-sdk/
COPY packages/auth/package.json ./packages/auth/
COPY e2e/package.json ./e2e/
RUN bun install
COPY . .
RUN cd packages/lab-sdk && bun run build && cd ../auth && bun run build && cd ../../apps/web && bun run build

FROM caddy:2 AS caddy

FROM ${BASE}
USER root
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=build /app /opt/lab
COPY images/lab-local/Caddyfile /etc/caddy/Caddyfile
COPY images/lab-local/entrypoint.sh /usr/local/bin/lab-entrypoint
RUN chmod +x /usr/local/bin/lab-entrypoint \
    && mkdir -p /data && chown -R student:student /data /opt/lab
USER student
WORKDIR /home/student
ENV DRIVER=local \
    PLAYGROUND_ROOT=/data/playgrounds \
    DATA_DIR=/data \
    SEATS_REQUIRED=1 \
    SEAT_TTL_MIN=480 \
    MAX_WORKSPACES_GLOBAL=3 \
    MAX_WORKSPACES_PER_IP=3
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["lab-entrypoint"]
