# RarefyU Labs — cost ledger (issue #11)

Amortized per-session cost from the single-box invoice. Updated whenever the
host plan changes. All figures in EUR, VAT excluded.

## Current host (single Hetzner AX)

| Item | €/mo |
|---|---|
| AX41-NVMe (Ryzen 5 3600, 64GB, 2×512GB NVMe) | 54.00 |
| Extra IPv4 / snapshots (est.) | 3.00 |
| **Total box** | **≈ 57.00** |

## Per-session math

- Box seconds per month: 30 × 24 × 3600 = 2,592,000.
- Measured bench density: 10 concurrent gVisor labs comfortable, 20 feasible
  (Phase-1 gate). Conservative planning number: **10 sustained**.
- Box-second cost: 57 / 2,592,000 ≈ €0.0000220.
- **2h playground (max TTL): 7200s × €0.0000220 ≈ €0.158.**
- **Typical 25-min guided step: 1500s × €0.0000220 ≈ €0.033.**

Headroom note: guided labs share the box with playgrounds; the quota policy
(2 live / 4-per-day free) caps exposure at ≈ €0.63/learner/day worst case.

## What moves the number

- WarmPool hit rate (cold claim boots a fresh pod; warm reuses — target >80%).
- KubeVirt VMs cost ~4× a gVisor sandbox (reserved vCPU+RAM); bill VM labs
  against course budgets, not the free tier.
- Second node (join-node.sh): doubles capacity, halves per-session only if
  utilization stays constant — track `labs_sessions_live` vs box cost monthly.

## Dashboard mapping

- `labs_sessions_live` × amortized rate → burn-down panel.
- `labs_boot_ms` p95 → warm-pool sizing (cold boots burn box-seconds idle).
- `labs_checks_total` pass rate → support cost proxy (fail-heavy labs page more).
