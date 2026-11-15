# Spike: base image under gVisor (issue #31)

Status: **image verified under runc; gVisor (`runsc`) run still to do on a VPS.**

## What exists
- `images/base-lab/Dockerfile`: node 22, python3, git, tmux, bun, `opencode`, `claude` (Claude Code), `lab-check`, `fail-message`; non-root `student` (uid 1001).
- `images/base-lab/verify.sh`: 15 behavior checks run in a hardened container
  (non-root, `--cap-drop ALL`, `no-new-privileges`, read-only root, pid/mem/cpu limits).
  Covers runtimes, agents on PATH, tmux windows, pty + Ctrl-C, dev server on a port,
  writable home, immutable root, egress, pid limit.
- Result under default runc on a dev laptop: **15/15 pass**. Image ~1.85 GB.

## To finish the spike (needs a real VPS, no nested virt required)
1. Install gVisor and register the runtime (`runsc install && systemctl restart docker`).
2. `RUNTIME=runsc images/base-lab/verify.sh`
3. Record any FAIL lines below, plus: do `opencode` and `claude` complete a real
   prompt (needs API keys) under runsc? Do websockets/hot reload through a
   published port work?
4. Push by digest with `images/base-lab/push.sh` and pin it in track configs.

## Findings (fill in after the runsc run)
- _pending_

## Known/expected incompatibilities
- Docker-in-Docker is not supported under gVisor: needs a Sysbox variant (out of v1).
- Image is large; consider trimming (drop `claude` or `bun` per course) once usage is known.
