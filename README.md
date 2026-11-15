# RarefyU Labs

Zero-install course sandbox for developers and agents. One URL per course:
guided steps, editor, terminals, file manager, browser preview, project
selector — running on one ordinary VPS: a hardened Docker + gVisor container per student.

Spec: `docs/labs-platform/spec.md` · Plan: `docs/labs-platform/plan.md` ·
PRD: issue #1 · Slices: issues #2–#11.

## Quickstart (slice 1 skeleton)

```sh
bun install
bun run build
bun run test

# production deploy on a fresh VPS: see infra/RUNBOOK.md
sudo ./infra/provision-vps.sh && docker compose -f infra/compose.yaml up -d --build

# dev servers (no Docker needed)
bun run dev:api   # :3000  -> /healthz
bun run dev:web   # :5173  -> workspace shell placeholder
```

Copy `.env.example` to `.env` before anything that touches Postgres or auth.
Dev defaults to `DRIVER=local` (host processes, no isolation). Try containers
with `DRIVER=docker bun run dev:api` after `docker build -t rarefyu/base-lab:dev images/base-lab`.
No KVM / nested virtualization is needed anywhere.
