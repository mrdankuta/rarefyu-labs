# RarefyU Labs — Workspace Spec v2 (from wayfinding map #12)

Supersedes the shell/authoring portions of `spec.md` (v2 §4–5) and re-sequences
`plan.md` Phase 1. Source of decisions: map #12 (all six tickets closed).
Prototypes: `prototype/hybrid-shell` (locked layout), `prototype/original-shell`,
`prototype/workspace-shell` (branches, never to merge).

## 1. Product modes (taxonomy decision)

v1 ships exactly two modes. Drills and courses-as-products are out of scope.

- **Playground**: free shell, timer only. No steps, no checks, no progress.
  Hard TTL (default 2h, configurable per playground), idle-hibernate at 20 min,
  15-min warning toast, destroy on expiry. First shipped loop is anonymous.
- **Guided lab**: steps + checks + progress + cohort seat. Auth required.

Auth is orthogonal to exec: anonymous playgrounds are allowed under the
playground policy; guided labs require Better-Auth (orgs = cohorts).

## 2. Shell layout (prototype decision — LOCKED)

Fixed 3-column dock with iximiuz chrome. Reference implementation:
`prototype/hybrid-shell` branch, `prototypes/hybrid-shell/index.html`.
Design tokens: header `#edeff4`, tab bar `#b6dcf7`, Inter + Source Code Pro,
dark panes (`#1f1f1f` IDE, `#080808` terminal).

```
┌ header: logo · course › lab › Run-id … ● countdown · snapshot · stop · avatar ┐
├ tabbar: Learn: [Instructions] [IDE] │ Run: [Term N] [+] [Preview] [Agent]    ┤
├──────────────┬───────────────────────────┬──────────────────────────────────┤
│ LEARN rail   │ IDE (CodeMirror 6,        │ RUN group (tabbed): terminals,   │
│ steps,       │ explorer, read-only       │ preview (waiting→live), agent    │
│ assignment,  │ ranges, hint widgets,     │ (approval policy)                │
│ Check + hint │ diff/reset;               │                                  │
│ pinned below │ NEVER collapses           │                                  │
└──────────────┴───────────────────────────┴──────────────────────────────────┘
```

Rules:
- Columns are fixed; only the Run group tabs. Side columns collapse to edge
  fabs (focus modes); the IDE never collapses. Collapse is a per-user
  persisted preference (post-MVP mechanism).
- Instructions pane and Check button are always visible — pedagogy never hides.
- Editor: CodeMirror 6 default; code-server iframe opt-in per lab (Theia ruled out).
- Terminals: xterm.js behind `TerminalRenderer`, tmux-persistent, survive refresh.
- Preview: tab in Run group, waiting→live states, signed short-TTL URL via API proxy.
- Agent: tab in Run group, per-lab policy (allowed / approval-gated / forbidden),
  approve-or-deny inline, full audit trace.
- Connection state: header dot (green/amber) + WS reconnect banner; refresh-safe
  session rehydration.

## 3. Authoring model — lab.yaml v2 (Instruqt 1:1 minus two)

Track-directory layout (Instruqt CLI shape):

```
my-track/
  track.yml        # title, slug, mode: playground|guided, ttl, tab defaults
  config.yml       # image, resources, egress, backend: gvisor|kubevirt
  01-slug/
    assignment.md  # frontmatter (title, difficulty, timelimit, tabs) + markdown
    setup | check | solve | cleanup    # any language; FAIL: + exit-1 contract
  02-slug/ ...
```

- Tabs: `{title, type: terminal|editor|service|website, port|path|workdir|cmd|url}`
  against a single implicit session host (no `hostname` until multi-host labs).
- Check contract: `fail-message "..."` helper writes `FAIL: ...` to stdout;
  nonzero exit = fail, message becomes the learner hint. Implement `fail-message`
  in the base image (assumes POSIX sh).
- Lifecycle: setup (seed), check (Check click), solve (Skip + author track-test),
  cleanup (async, never for next-challenge setup). Track-level setup/cleanup.
- NOT adopted: virtual-browser tabs, pause/resume scripts.
- Versions immutable once used, digest-pinned, rollback supported.

## 4. Check execution (split — LOCKED)

- In-session `check`: instant hints, best-effort UX, runs in the learner session.
- Isolated grading: fresh checker env from the submitted commit, pinned deps;
  its verdict is the record (tamper-proof, deterministic, immutable attempt logs).
- Identical submissions → identical verdicts, regardless of in-lab tampering.

## 5. Anonymous playground policy (LOCKED)

- Quotas: 1 concurrent session per IP+cookie; 2h TTL (configurable); 20-min
  idle hibernate; 15-min warning.
- Egress: full, rate-limited at the node (no allowlist in v1).
- Expiry: warn → one snapshot → destroy. Snapshot kept max 7 days as a
  signup-conversion hook; learner gets a workspace-t tarball download link.
- Kill switch: one-button playground nuke (<60s) ships BEFORE the playground opens.

## 6. Exec sequencing (re-sequences plan.md Phase 1)

1. gVisor RuntimeClass + anonymous playground loop first (no auth in path).
2. Real SvelteKit shell from the hybrid prototype (mocked → live APIs).
3. Guided demo track in v2 format (in-session checks + progress).
4. Auth + cohorts (gates guided only), isolated grading, agent broker.
5. KubeVirt only when a course needs Docker-in-lab (deferred).

## 7. Build order (rewrites slices #2–#6)

- Playground exec loop (gVisor pod from pinned digest, WS terminal, TTL/hibernate/
  destroy, quotas, kill switch) — replaces old slice order; auth NOT in path.
- Shell from hybrid prototype against live session APIs.
- Demo track in v2 authoring format with preview tab + in-session checks.
- Guided cohort gate (Better-Auth, quotas, progress/attempts records).
- Then: KubeVirt VM labs, teach console, agent broker, isolated grading,
  hardening/second-node (old slices 6–10, unchanged in intent).
