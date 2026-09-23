# RarefyU Labs — Build Plan (v2, Bun + Better-Auth + Firecracker-first on Hetzner)

Spec: `spec.md`. Vertical slices; each task = one session, system stays working. Verify commands use **bun**. Contract/migration risks noted.

## Repo layout

```
apps/web/              # SvelteKit + svelte-adapter-bun, Tailwind, CodeMirror, xterm iface
apps/api/              # Bun + Hono: REST + WS relay + preview proxy + webhooks + workers
packages/auth/         # Better-Auth server/client + Drizzle schema
packages/lab-sdk/      # LabTemplate/Session/CheckResult/AgentPolicy zod types
images/base-lab/       # OCI base (student user, node/python, code-server, tmux, lab-check)
courses/demo-agent/    # steps.md + lab.yaml + starter + tests + scripts/
k8s/                   # k3s bootstrap, KubeVirt, gVisor RuntimeClass, agent-sandbox, templates, NetPol
infra/compose.yaml     # v1 control plane: web/api/pg/redis/minio/registry/caddy/prom/loki
e2e/                   # Playwright (bunx playwright)
docs/adr/ docs/cost.md
```

## Phase 0 — Box + toolchain (days 1–3)

### T0.1 Bun monorepo + compose control plane
- Context: `bun init`-style workspaces (`apps/*`, `packages/*`). `infra/compose.yaml`: caddy, web, api, postgres:16, redis:7, minio, registry:2, prometheus/grafana/loki. Caddy terminates TLS and routes `/ → web`, `/api/* → api`, `/ws/* → api (WS)`, `/preview/* → api (signed proxy)`.
- Acceptance: `bun install && bun run build` green; `docker compose up` serves staging host with valid cert.
- Verify: `bun install; bun run build; docker compose -f infra/compose.yaml up -d; curl -k https://labs.local/healthz`

### T0.2 Better-Auth + Drizzle (orgs = cohorts)
- Context: `packages/auth`: better-auth with `drizzleAdapter(pg)`, plugins `organization, passkey, emailOTP`, github/google OAuth. Migrations via `drizzle-kit`. Seed: admin user, demo org, instructor + learner. **Migration risk:** auth tables additive only; never rename `user/session` mid-cohort.
- Acceptance: sign-up → login → join org → `getSession` gates `/api/sessions`; owner can invite/reset.
- Verify: `bun run db:migrate; bun run db:seed; bun test packages/auth; curl -i localhost:3000/api/sessions` → 401 anon.

### T0.3 Base OCI image + registry
- Context: `images/base-lab/Dockerfile` (ubuntu:24.04, bun+node LTS, python, tmux, code-server, ttyd, `lab-check` stub, `student` non-root, baked deps). Push to on-box `registry:2`, scan with trivy, record digest.
- Acceptance: digest-pinned pull works from k3s; non-root; boots <5s as container.
- Verify: `docker build -t registry.labs.local/labs/base:0.1 images/base-lab; trivy image --severity CRITICAL registry.labs.local/labs/base:0.1; docker push registry.labs.local/labs/base:0.1`

### T0.4 Hetzner node prep (single AX)
- Context: Ubuntu 24.04, `grep -c vmx|svm`, `/dev/kvm` present, NVMe mounted `/data`, UFW (22,80,443 only), fail2ban, unattended-upgrades, `k3s install --disable traefik --write-kubeconfig`, Longhorn or hostpath-provisioner, `multus` + `bridge` CNI for VM nets. Snapshot Hetzner rescue + document rebuild script (`infra/hetzner-init.sh`).
- Acceptance: `kubectl get nodes` Ready; KVM functional; `/data` >70% free; rebuild script tested once.
- Verify: `ls -l /dev/kvm; kubectl get nodes -o wide; df -h /data; kvm-ok`

## Phase 1 — Firecracker-class exec on 1 node (week 1–2) — GATE: VM lab boots on metal

### T1.1 KubeVirt + gVisor + Agent Sandbox install (pinned)
- Context: install `kubevirt vX.Y.Z` operator, `runsc` RuntimeClass (`gvisor`), optional `kata-fc` RuntimeClass, `agent-sandbox vA.B.C` (core+extensions), `SandboxWarmPool` CRDs. Pin versions in `k8s/versions.env`. Resource quotas + LimitRange + PodSecurity (restricted) + default-deny NetworkPolicy.
- Acceptance: `kubectl get runtimeclass` shows gvisor (+kata-fc); `kubectl get crd | grep sandbox` present; privileged pod rejected.
- Verify: `kubectl apply -k k8s/; kubectl get runtimeclass,pods -A; kubectl auth can-i --list | grep -i privileged`

### T1.2 ExecDriver (bun) → agent-sandbox
- Context: `apps/api/src/drivers/` iface `create/exec/read/write/preview/snapshot/destroy`. Driver maps `lab.yaml backend`: `gvisor → SandboxClaim(runsc)`, `kubevirt → KubeVirt VM via Sandbox`, `kata-fc → kata`. Stable hostname + PVC `/home/student`. WS exec relay (`kubectl exec`-style streaming via sandboxd/router) with tmux persistence. Conformance suite in `packages/lab-sdk` must pass per backend.
- Acceptance: same image boots on all three backends; 2 terminals share tmux; refresh resumes.
- Verify: `bun test drivers.conformance; bunx playwright test e2e/terminal.spec.ts`

### T1.3 SvelteKit shell (dock) + CodeMirror + xterm + preview
- Context: `/lab/[id]`: Steps/Files/Projects | Editor (CM6 + read-only ranges + hint widget + diff + reset) | Terminal (xterm `TerminalRenderer`) ×N | Preview iframe (signed `/preview/:port?token=` short TTL) | Checks bar. Svelte stores + auto-reconnect WS. File APIs proxy to driver.
- Acceptance: mocked session works offline; real session edits/saves/resets; preview ready when app listens; WS reconnect banner.
- Verify: `bun --filter web dev` manual pass + `bunx playwright test e2e/shell.spec.ts`

### T1.4 Demo course + checker v0
- Context: `courses/demo-agent` (5 steps) + `lab-check` (command/http/file validators). Worker `POST /sessions/:id/check` runs **against** sandbox; logs to MinIO. Starter fails with hints, solution passes <30s.
- Acceptance: `lab-check` fail-then-pass locally and remotely; attempts recorded in Postgres.
- Verify: `cd courses/demo-agent && ./scripts/bootstrap && lab-check` (fail) → apply solution → pass; `curl -XPOST .../check` asserts same.

**Phase-1 gate:** `kubectl top nodes` healthy with 10 concurrent gVisor labs + 2 KubeVirt VMs; stranger completes demo lab on `https://labs.<domain>`; boot/cost recorded.

## Phase 2 — Platform: cohorts, authoring, teach console (week 3)

### T2.1 Quotas + progress + attempts
- Context: Better-Auth org Roless: `owner(instructor)/member(learner)`. Tables: enrollments, sessions(status/backend/costEst), attempts, progress. Enforce 2 concurrent / 4h-day free at `POST /sessions` (429 + message).
- Acceptance: 3rd concurrent create → 429; check pass advances progress; reset clears FS not progress history.
- Verify: `bun test quotas; curl` over-quota → 429.

### T2.2 Git authoring → digest-pinned templates
- Context: webhook builds image (`docker buildx`), runs e2e lab test, pushes digest, writes `SandboxTemplate` version, updates registry UI + rollback. Templates immutable once used.
- Acceptance: push → new version pinned; rollback restores; in-use version undeletable.
- Verify: `git push` demo → `/api/templates/demo/versions` shows digest → rollback via API works.

### T2.3 Teach console + presence
- Context: `/teach/:org`: live list (active/idle/stuck from last-check), reset/extend(+30m)/message/announce via DO-like in-memory presence in api + pg audit.
- Acceptance: reset → learner toast + fresh FS; extend updates TTL; announce reaches all sessions.
- Verify: `bunx playwright test e2e/teach.spec.ts`

## Phase 3 — Agents + grading integrity (week 4)

### T3.1 Tool broker + policy tiers
- Context: MCP-ish tools via api (`fs.read/write, exec, preview.open, checks.run`), per-lab `allowed/approvalRequired/forbidden`. Approve/Deny dialog in AgentPane. Log `{tool, argsHash, ms, cost}`; redact secrets.
- Acceptance: agent fixes test with allowed tools only; `npm install` pauses for approval; cred-exfil blocked + logged.
- Verify: `bunx playwright test e2e/agent.spec.ts; bun test redact`

### T3.2 Isolated grading
- Context: graded checks run in fresh checker pod/VM from submitted commit (not learner shell). Same commit → same verdict. Immutable result + logs in MinIO.
- Acceptance: tampered in-lab `lab-check` doesn't affect grade; double-submit identical.
- Verify: `bunx playwright test e2e/determinism.spec.ts`

## Phase 4 — Harden + scale prep (week 5)

### T4.1 Security + kill-switch
- Context: drop caps, seccomp/AppArmor, read-only root where possible, cosign sign + SBOM attest, secret broker rotation, `DELETE /orgs/:id/sessions` kills all in <60s.
- Acceptance: trivy clean CRITICAL; kill-switch drill passes; audit covers all exec/write.
- Verify: `trivy image <digest>; ./scripts/kill-switch-drill.sh`

### T4.2 Obs + cost + resilience
- Context: OTEL (sessionId baggage) → Prometheus/Grafana/Loki dashboards (boot p50/p95, exec lat, OOM, pass rate, €/session from amortized Hetzner invoice in `docs/cost.md`). Alerts on provision fail >1%/10m. Low-bandwidth: CM6 default, lazy preview/xterm, WS replay ring (50KB), offline steps, optimistic progress retry.
- Acceptance: dashboard live; synthetic failure pages; 1Mbps-throttle e2e passes.
- Verify: `bunx playwright test e2e/resilience.spec.ts` (throttled) + Grafana screenshots in PR.

### T4.3 Second-node runbook (dry-run)
- Context: `infra/join-node.sh` (k3s agent join + labels + CNI + Longhorn expand + WarmPool spread) tested against a cheap CX trial or local VM. No data loss on join; control plane untouched.
- Acceptance: runbook joins a throwaway node, schedules labs, drains + removes cleanly.
- Verify: `./infra/join-node.sh --dry-run` + one live join/drain cycle recorded.

## Risks

| Risk | Mitigation |
|---|---|
| Raw-Firecracker temptation (custom scheduler/IPAM/snapshots) | Stay on KubeVirt/Kata-FC under K8s — same KVM isolation, scheduler included |
| Single-box noisy neighbor / disk full | Quotas + LimitRange + `/data` alerts at 70/85%; Longhorn replica discipline |
| Better-Auth on Bun edge cases | Pin `better-auth` version; keep session logic in `packages/auth` with unit tests; Drizzle additive migrations |
| Checker gaming | Grade in isolated checker, never in-lab binary |

**Next:** T0.1–T0.4 this week (box ready + auth + image + KubeVirt), then T1.1–T1.4 to stranger-test gate.
