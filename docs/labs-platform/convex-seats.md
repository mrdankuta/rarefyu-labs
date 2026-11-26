# Class seats on Convex + the single-container image

Seats (class code → model key) can live in Convex instead of a JSON file, so the same codes
work whether workspaces run on a VPS, on a student laptop, or elsewhere.

## Convex backend (`/convex`)
- `seats:redeem {code}` — student-facing; returns `{ok, id, label, key}`. Global throttle:
  30 wrong codes/minute across everyone (Convex cannot see client IPs).
- `seats:add | list | get | remove | sweepMisses` — admin; every call needs `secret` = the
  deployment's `ADMIN_SECRET`.

Setup (real deployment): `npx convex login && npx convex dev --once`, then
`npx convex env set ADMIN_SECRET <long random>`; `npx convex deploy` for production.
Put the deployment URL in `CONVEX_URL` (and `CONVEX_ADMIN_SECRET` where you manage seats).
Local test backend, no account: `CONVEX_AGENT_MODE=anonymous npx convex dev` (port 3210).

Load seats exactly as before: `scripts/seats.ts` talks to the API admin routes, which use
Convex whenever `CONVEX_URL` is set. Keys are stored in Convex in plaintext (see known gaps).

## Single-container image (`images/lab-local`)
`docker build -f images/lab-local/Dockerfile -t rarefyu/lab-local:dev .` (needs `rarefyu/base-lab:dev`).
Web UI + API + terminals + opencode/claude behind Caddy on one port (`LAB_PORT`, default 3000).
The container is the isolation boundary, so the API runs `DRIVER=local` inside it as the
non-root `student` user. `SEATS_REQUIRED=1` by default.

    docker run -d -p 3000:3000 -e CONVEX_URL=https://<deployment>.convex.cloud \
      -v lab-data:/data rarefyu/lab-local:dev

Verified (local Convex + real container + headed browser): wrong code → 403, right code →
workspace with `auth.json` 0600 and "Agent ready · muse-spark-1.3-contributor", same code resumes.

## Known gaps
- Image is 2.77 GB: slim it before asking 60 students to pull it.
- (Fixed) Sessions now persist to `${DATA_DIR}/sessions.json` and reload before the reconciler
  runs, so an API/container restart keeps workspaces. Verified with `docker restart`.
- Keys are plaintext in Convex and readable by the student who owns them; use per-student,
  revocable keys and rotate after class.
- On hosts with ufw, containers cannot reach a Convex backend on the host (hosted Convex is fine).
- Nothing yet to distribute: launcher scripts (`start.sh` / `start.ps1`), registry publish.
