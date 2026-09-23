# RarefyU Labs — Platform Spec (v2)

> Single source of truth. Plan: `plan.md`. Decisions 2026-09-23: **SvelteKit only (no Elm), Bun (no pnpm/npm), Better-Auth, Firecracker-first on Hetzner (single server → fleet).**

## 1. Vision

One URL per course: **guided steps, editor, terminal(s), file manager, browser preview, project selector** — zero install. Same sandbox runs **humans + AI agents** safely, with iximiuz-grade realism (real kernels, breakable networking/disks/Docker/K8s).

## 2. Goals

1. Workspace ready in <10s warm / <45s cold on our own metal.
2. Author = Git repo (`steps.md` + `lab.yaml` + starter + checks), digest-pinned.
3. Learner loop: read → edit/run → Check → hint/solution → progress → reset/replay. Survives refresh.
4. Agent loop: narrow context + tool broker + approval tiers + audit (tools, diffs, cost).
5. Ephemeral policy-controlled runtimes: per-session microVM, TTL/hibernate, default-deny egress, quotas.
6. Start on **1× Hetzner dedicated**, scale horizontally by adding identical nodes. No managed-container dependency.

## 3. Non-goals (v1)

- No Cloudflare Sandbox / E2B / managed exec as primary (keep driver interface, don't depend on them).
- No full LMS (marketplace, LTI, certificates) — minimal cohorts + progress.
- No desktop app, no GPU labs in v1.

## 4. Stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Runtime + pkg + test | **Bun** | One binary: installs (`bun install`), runs (`bun --hot`), tests (`bun test`). Hono + SvelteKit + Better-Auth are all Bun-native. Replaces node/pnpm/vitest. |
| Frontend | **SvelteKit (Svelte 5 runes) + Tailwind**, `svelte-adapter-bun` (or node) behind Caddy | Small bundles, simple WS state, serves from same Hetzner box. No Next.js, no Elm. |
| Editor | CodeMirror 6 default; code-server iframe opt-in | 50–200KB vs Monaco 2–5MB; full-VS Code only when needed. |
| Terminal | xterm.js behind `TerminalRenderer` iface (Ghostty-WASM later) | Only production browser terminal today. |
| API | **Bun + Hono** (single service, `apps/api`) | Serves REST + WS terminal relay + preview proxy + webhooks. |
| Auth | **Better-Auth** + Drizzle + Postgres | Self-hosted, SvelteKit-integrated, org plugin = cohorts, email+OAuth+passkey. No Clerk/Access fees or lock-in. |
| DB / queue / store | Postgres 16 + Redis (Oban-equivalent: `bun` workers via BullMQ or pg-boss) + MinIO (S3-compat, replaces R2) + local registry | All on-box via Docker Compose v1; moves to managed/external when multi-node. |
| Exec | **Firecracker-first, orchestrated by k3s + KubeVirt + Agent Sandbox CRDs** (see §5) | Real microVM isolation with K8s scheduling so 1 node → N nodes is `k3s join`. gVisor RuntimeClass for dense cheap labs on same box. |
| Reverse proxy | Caddy (TLS auto, reverse proxy `/`, `/ws/*`, `/preview/*`) | Simpler than Traefik/Envoy for 1 box; upgrade path kept. |
| Observability | OTEL + Prometheus/Grafana + Loki (all in compose) | Per-session boot/exec/OOM/cost metrics from day one. |

## 5. Execution plane: Firecracker on one Hetzner box → fleet

Do **not** hand-roll a Firecracker scheduler. Run Firecracker *under Kubernetes*:

```
Hetzner AX (Ubuntu 24.04, /dev/kvm, NVMe)
 └─ k3s (single node, --disable traefik; Caddy outside)
     ├─ KubeVirt (VM-backed labs: Docker/K8s/net/systemd, multus bridges)
     ├─ gVisor RuntimeClass runsc (dense labs: python/node/agent, cheap)
     ├─ Kata-FC optional (Firecracker hypervisor for Kata pods — strict FC where wanted)
     └─ kubernetes-sigs/agent-sandbox (Sandbox/Template/Claim/WarmPool, sandboxd, router)
```

- Course images stay **OCI**. Standard labs → `runsc` pods (ms boot, high density). Systems labs → KubeVirt VMs (own kernel, Multus isolated nets, extra disks). Where curriculum says "Firecracker", use Kata+FC or KubeVirt — same hardware isolation class, no custom VMM fleet code.
- Warm pools per template (e.g. 5× standard, 2× VM) give <5s claims. Snapshots (KubeVirt) / overlay (containers) for reset.
- Egress: default-deny NetworkPolicy + per-namespace allowlist proxy (squid/envoy) for `github/hex/pypi/npm`. Secrets via short-lived broker, never env.
- Persistence: PVC per session (`/home/student`) on local NVMe (Longhorn or hostpath-provisioner v1) → Longhorn/Ceph when multi-node.

### Scaling 1 → N Hetzner nodes

1. Keep control plane (web/api/pg/redis/minio/registry) on node-0 (or tiny CX cloud VM) stateless + backed-up.
2. New exec node = same Ubuntu image + `k3s agent join` + labels (`workload=lab`, `hv=kvm`) → capacity appears; WarmPools spread via affinity.
3. Storage: Longhorn replica 2 → 3 as nodes arrive; object artifacts already in MinIO (later migrate bucket to Hetzner Object Storage).
4. Network: Multus bridges per host now; VXLAN/Geneve overlay (or Tailscale/WireGuard mesh) when labs span hosts; preview proxy stays central (signed URLs).
5. Unit economics you control: ~~200 standard (`runsc`, 0.25CPU/512M oversubscribed) or ~30–60 KubeVirt VMs (2CPU/4G) per AX52-class box depending on oversubscription. Tune from real metrics, not theory.

## 6. Lab template contract (`lab.yaml` v2, unchanged semantics)

```yaml
apiVersion: labs.rarefyu.dev/v1
kind: LabTemplate
metadata: { name: python-agent-basics-v1 }
spec:
  image: registry.labs.rarefyu.dev/labs/python-agent:1.0.0@sha256:<digest>
  backend: auto  # auto | gvisor | kubevirt | kata-fc
  resources: { cpu: 2, memoryMb: 4096, diskGb: 12, timeoutMin: 60 }
  ports: [{ name: app, port: 3000, preview: true }]
  workspace: { source: { type: git, repo: https://github.com/rarefyu/starter-agent, rev: main }, persistence: pvc }
  network: { egress: restricted, allow: [github.com, pypi.org, files.pythonhosted.org, registry.npmjs.org] }
  lifecycle: { init: ["./scripts/bootstrap"], reset: ["./scripts/reset"] }
  checks:
    - { name: tests pass, type: command, run: "pytest /home/student/tests -q" }
    - { name: health, type: http, url: http://app:3000/health, expectStatus: 200 }
```

Routing: `basics/agent-app → gvisor`, `secure/untrusted → kata-fc`, `docker/k8s/net/systemd → kubevirt`. Templates versioned + digest-pinned, never mutated mid-cohort.

## 7. Auth design (Better-Auth)

- `apps/web + apps/api` share `packages/auth` (better-auth server + svelte client). Drizzle schema in Postgres. Plugins: `organization` (org = cohort/school), `passkey`, `emailOTP` (low-friction learner login), OAuth (github/google).
- Session: DB-backed, cookie; API verifies via `auth.api.getSession`. Claims `orgId/role` gate `POST /sessions` + quotas (2 concurrent, 4h/day free).
- Admin: org owner = instructor (invite, reset/extend, announce). Audit log table for agent tool calls + session events.

## 8. Security baseline

One session = one pod/VM. Non-root, drop caps, seccomp/AppArmor, no docker.sock/hostPath, read-only root where possible, signed images + SBOM + digest pin, short-lived secret broker, audit every exec/write/fetch, TTL + idle hibernate, per-cohort kill-switch, disclose recording.

## 9. Success metrics (single-box MVP)

- Warm claim p50 <5s, cold VM p50 <45s; provision success >99% over 200 synthetic sessions.
- 30 concurrent standard labs stable on 1 box; checker determinism (same commit → same verdict).
- $/session from node amortization visible in Grafana; time-to-first-success <15 min for stranger test.
