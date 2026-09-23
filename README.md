# RarefyU Labs

Zero-install course sandbox for developers and agents. One URL per course:
guided steps, editor, terminals, file manager, browser preview, project
selector — running on our own Hetzner metal (Firecracker-class isolation
via k3s + KubeVirt + Agent Sandbox).

Spec: `docs/labs-platform/spec.md` · Plan: `docs/labs-platform/plan.md` ·
PRD: issue #1 · Slices: issues #2–#11.

## Quickstart (slice 1 skeleton)

```sh
bun install
bun run build
bun run test

# control plane (needs Docker)
docker compose -f infra/compose.yaml config   # validate
docker compose -f infra/compose.yaml up -d    #Bring up

# dev servers (no Docker needed)
bun run dev:api   # :3000  -> /healthz
bun run dev:web   # :5173  -> workspace shell placeholder
```

Copy `.env.example` to `.env` before anything that touches Postgres or auth.
No `/dev/kvm` on a dev laptop is fine — VM-backed labs only run on the
Hetzner host (see `infra/hetzner-init.sh` in slice 1 scope).
