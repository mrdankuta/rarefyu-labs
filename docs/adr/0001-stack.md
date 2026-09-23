# ADR 0001: Stack — Bun, SvelteKit, Better-Auth, Firecracker-first

Date: 2026-09-23. Status: accepted.

- **Bun** is the only runtime/package/test runner. No node, pnpm, npm, vitest.
  Hono, SvelteKit, Better-Auth, Drizzle are all Bun-native.
- **SvelteKit (Svelte 5 runes) + Tailwind**, deployed with the Bun adapter
  behind Caddy. No Next.js, no Elm: runes cover step/check/agent state.
- **Better-Auth + Drizzle + Postgres** for auth; the `organization` plugin
  models cohorts (owner = instructor, member = learner). No per-seat vendor.
- **CodeMirror 6** default editor (50–200KB); code-server iframe is opt-in
  per lab. **xterm.js** behind a `TerminalRenderer` interface; Ghostty-WASM
  later without touching session logic.
- **Firecracker-first, no managed-container hop**: k3s + KubeVirt (VM labs)
  + gVisor RuntimeClass (dense labs) + Kata-FC (strict Firecracker pods) +
  `kubernetes-sigs/agent-sandbox` (Sandbox/Template/Claim/WarmPool).
  Same OCI images everywhere; start on 1× Hetzner dedicated, join nodes.
- Learner preview is an **iframe over signed preview URLs**, never an
  embedded Chromium. Agent/grader browsing uses snapshot-and-interact
  automation (Playwright) in checker environments.
