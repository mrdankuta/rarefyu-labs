# RarefyU Labs: single-VPS runbook

One ordinary Linux VPS runs everything: the control plane (Caddy, web, api,
postgres) in Docker Compose, and one hardened **Docker + gVisor** container per
student. No KVM or nested virtualization needed. Spec: issue #30.

Sizing guess: 8-16 vCPU, 32 GB RAM, 200 GB disk serves ~15-30 concurrent
students (each workspace limited to 1 CPU / 2 GB; idle workspaces hibernate).
Validate with the load test before a live cohort.

## 1. First deploy

```sh
git clone https://github.com/mrdankuta/rarefyu-labs && cd rarefyu-labs
sudo ./infra/provision-vps.sh        # Docker, gVisor, firewall, base image, verification
cp .env.example .env                 # then edit; provision-vps.sh already wrote DOCKER_GID
```

Set at least `ADMIN_TOKEN`, `PREVIEW_SECRET`, `BETTER_AUTH_SECRET` (long random
strings: `openssl rand -hex 32`) and `SITE_ADDRESS=labs.example.com` (DNS A record
pointing at the VPS; Caddy gets the certificate automatically). Then:

```sh
docker compose -f infra/compose.yaml up -d --build
curl -s https://labs.example.com/healthz
```

`provision-vps.sh` runs `images/base-lab/verify.sh` under `runsc` and aborts if
any check fails, so a green provision means the image works under gVisor.

`DRIVER=docker-gvisor` (default) refuses to create workspaces when the `runsc`
runtime is missing. Never set `DRIVER=local` on a server: it runs student
commands directly on the host.

## 2. Daily operations

| Task | Command |
|---|---|
| Status | `docker compose -f infra/compose.yaml ps` and `docker ps --filter label=rfy.workspace` |
| Logs | `docker compose -f infra/compose.yaml logs -f api` |
| Metrics | `curl -s localhost:3000/metrics` (running/hibernated/expired, provision latency) |
| **Kill switch** (destroy every workspace, pause creation) | `curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" 'https://labs.example.com/api/playgrounds?pause=1'` |
| Resume creation | `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"paused":false}' https://labs.example.com/api/admin/creation` |
| Reconcile (clean orphans) | `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://labs.example.com/api/admin/reconcile` |

The api also reconciles automatically on boot and every 5 minutes: workspaces
the session store doesn't know about are destroyed, and records whose workspace
vanished are marked gone.

## 3. Upgrades

```sh
git pull
docker build -t rarefyu/base-lab:dev images/base-lab        # only if the image changed
RUNTIME=runsc images/base-lab/verify.sh                     # gate: all PASS
docker compose -f infra/compose.yaml up -d --build
```

Restarting the api drops its in-memory session store (a Postgres-backed store
is future work); on boot the reconciler then **destroys every running
workspace**. Upgrade between cohorts, or warn students first (announce via the
teach console).

For production pin `LAB_IMAGE` by digest (`images/base-lab/push.sh` prints it)
so a rebuilt image never changes under a running lab.

## 4. Backup

- `/data/snapshots`: expiry snapshots (kept 7 days, then purged).
- Postgres volume `pgdata`: `docker compose -f infra/compose.yaml exec postgres pg_dump -U labs labs > labs.sql`.
- Student workspaces are ephemeral by design (2 h TTL); students download a snapshot before expiry.

## 5. Recovery

- **api crashed/restarted:** workspaces are cleaned up by the reconciler; students start a new one (their last snapshot is in `/data/snapshots`).
- **Host full:** `docker system df`; run the kill switch if needed, then `docker volume prune --filter label=rfy.workspace` and `docker image prune`.
- **gVisor broken after an OS/Docker upgrade:** `runsc install && systemctl restart docker`, then `RUNTIME=runsc images/base-lab/verify.sh`. Until fixed the api refuses to create workspaces rather than silently weakening isolation.
- **Leaked resources:** `docker ps -a --filter label=rfy.workspace`, `docker volume ls --filter label=rfy.workspace`, `docker network ls --filter label=rfy.workspace` should be empty when no student is active.

## 6. Security notes

- The api container mounts the Docker socket. That is root-equivalent on the host: keep the api image trusted and the host patched.
- Workspaces: non-root, all capabilities dropped, `no-new-privileges`, read-only root, CPU/memory/PID limits, own private network, gVisor syscall filtering. Outbound traffic is open; rate-limit it at the host or provider firewall for public playgrounds.
- Apps previewed through `/preview/<token>/` must use relative asset paths (no per-preview subdomain in v1).
- `ADMIN_TOKEN` guards the kill switch, pause and reconcile endpoints. Without it set the api would leave them open, which is why compose refuses to start without it.

## 7. Local `docker` test run (no gVisor)

To try the stack on a laptop: `DRIVER=docker` and remap ports with an override
file. This is hardened runc, not gVisor: do not expose it to untrusted users.
