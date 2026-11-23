#!/bin/bash
# Runs the student app: api (:3100) + web (:3101) behind caddy (:3000).
# If any of them dies the container exits, so `docker restart`/the launcher brings it all back.
set -u
cd /opt/lab
API_PORT=3100 bun ./apps/api/src/index.ts &
(cd apps/web && PORT=3101 HOST=127.0.0.1 bun ./build/index.js) &
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
wait -n
echo "a lab service exited; stopping" >&2
exit 1
