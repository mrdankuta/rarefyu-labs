# Class-day deployment runbook (30–60 students, one hourly VPS)

Goal: a public URL where each student opens their own workspace (terminal, editor, preview, `opencode`
already signed in). One ordinary VPS billed by the hour, created for the class and deleted after.
Day-2 operations live in `infra/RUNBOOK.md`; this document is the sequence for a class.

**Status of what has actually been verified.** Verified on a laptop: the stack with Docker (runc), seat
codes, key injection with fake keys, resume. **Not verified until you do steps 3–5 on the VPS:** gVisor
(`runsc`) isolation (#31), capacity for your class size (#46), `provision-vps.sh` on a fresh machine, HTTPS,
and a real model key. Do those at least two days before the class, not the morning of.

## 0. Decisions and inputs (T-7 days)

| Need | Notes |
|---|---|
| Domain | e.g. `labs.yourdomain.com`; you must be able to add one DNS A record |
| Model keys | One key per student (e.g. OpenCode Go, $10 individual or $20 Teams seat). Buy right before class (no proration on mid-period joins for Teams) |
| Student list | CSV `label,key` — one line per student (a few spares) |
| VPS | Ubuntu 24.04 or Debian 12, x86_64 or arm64, **no KVM needed**. Start from 16 vCPU / 64 GB / 200 GB for 60 students and let the load test confirm. Hetzner's 16 vCPU/64 GB class was roughly €275–280/month (about €0.40–0.50/hour) in Nov 2026 per third-party listings; check the provider's price page. Hourly billing means a few days costs a few euros |
| A second pair of hands | Someone to watch `docker stats` and answer "my code doesn't work" during the first 10 minutes |

## 1. Create the server (T-2 days)

1. Create the VPS with your SSH key. Note the IPv4 address.
2. DNS: `A labs.yourdomain.com -> <ip>` (TTL 300). Wait until `dig +short labs.yourdomain.com` shows it.
3. SSH in as root, then:

```sh
git clone https://github.com/mrdankuta/rarefyu-labs && cd rarefyu-labs
sudo ./infra/provision-vps.sh      # Docker, gVisor, firewall, base image, runsc verification, /data dirs
```

`provision-vps.sh` stops if the gVisor smoke test or the 15-check image verification fails. If it fails,
**stop and tell me the output** — that is exactly what issue #31 is for.

## 2. Configure and start

```sh
cp .env.example .env
for v in ADMIN_TOKEN PREVIEW_SECRET BETTER_AUTH_SECRET; do sed -i "s|^$v=.*|$v=$(openssl rand -hex 32)|" .env; done
sed -i "s|^SITE_ADDRESS=.*|SITE_ADDRESS=labs.yourdomain.com|; s|^BETTER_AUTH_URL=.*|BETTER_AUTH_URL=https://labs.yourdomain.com|" .env
grep -E '^(DRIVER|SEATS_REQUIRED|SEAT_TTL_MIN|MAX_WORKSPACES)' .env      # DRIVER must be docker-gvisor
docker compose -f infra/compose.yaml up -d --build
curl -s https://labs.yourdomain.com/healthz        # {"ok":true,...} once Caddy has its certificate
```

Save `ADMIN_TOKEN` in a password manager. It controls the kill switch and the student keys.

## 3. Prove isolation (issue #31)

```sh
RUNTIME=runsc images/base-lab/verify.sh              # all 15 must PASS
docker run --rm --runtime runsc rarefyu/base-lab:dev dmesg 2>&1 | head -3   # gVisor kernel banner, not the host's
```

Record results under "Findings" in `docs/labs-platform/gvisor-spike.md`. Also check by hand that
`opencode` starts and websockets/hot reload work through a preview (the loadtest in step 4 covers preview).

## 4. Find the capacity (issue #46)

```sh
MAX_WORKSPACES_GLOBAL=200 MAX_WORKSPACES_PER_IP=200 docker compose -f infra/compose.yaml up -d
ADMIN_TOKEN=... bun scripts/loadtest.ts --base https://labs.yourdomain.com \
  --stages 10,20,30,45,60 --hold 90 --cpu --cpus 16
```

Take the recommended cap (80% of the last passing stage), put it in `.env` as `MAX_WORKSPACES_GLOBAL`,
and `docker compose -f infra/compose.yaml up -d` again. If 60 students don't fit, either use a bigger VPS
or lower `WORKSPACE_CPUS` / `WORKSPACE_MEMORY` and re-run. `--cpu` is the worst case; real students mostly
idle between commands, and idle workspaces hibernate after 20 minutes.

## 5. Load the class (T-1 day)

```sh
# students.csv: label,key   (one per line; # for comments). Keep it off the server and out of git.
ADMIN_TOKEN=... API=https://labs.yourdomain.com bun scripts/seats.ts students.csv > codes.csv
```

`codes.csv` is `label,code`. Hand each student their own code (slide, printed slip, or DM). Then set
`SEATS_REQUIRED=1` in `.env` and re-up so only code holders can start workspaces.

**Real-key test (do this once, with your own seat):** open the URL, enter a code, run `opencode`, send one
prompt and confirm a reply comes back. This is the only step that proves the model side works.

## 6. Rehearsal (T-1 day, 30 minutes)

- Three people open the URL on different devices/networks with three different codes. Each runs `opencode`.
- One student closes the tab, then re-enters their code from a phone: they must land in the same workspace.
- Start a web app on port 3000 in one workspace and open the Preview tab.
- Kill drill: run the kill switch (`infra/RUNBOOK.md` §2) and confirm workspaces vanish, then resume creation.
  Re-enter a code afterwards: it must create a fresh workspace with the key present.

## 7. Class day

**T-60 min:** `docker compose -f infra/compose.yaml ps`, `curl .../healthz`, free disk (`df -h /`), and
`docker ps --filter label=rfy.workspace` should be empty. Confirm `SEATS_REQUIRED=1`.

**During:**
- `watch -n5 'docker stats --no-stream | head -20; uptime; free -h'` in a spare terminal.
- **Do not restart the API mid-class.** Its session store is in memory; on boot the reconciler destroys every
  running workspace. A student's files are lost if that happens. (Seat keys are safe in `/data/seats`; a
  re-entered code creates a new workspace with the key.)
- Student cannot get in: `scripts/seats.ts --list` shows whether their code is `active` or `unused`.
- A key stops working (rate limit or leak): revoke with `DELETE /api/admin/seats/:id`, re-add that student
  with a new key, hand out the new code. Revocation destroys that student's workspace.
- Runaway workspace: `docker stats`, then `docker rm -f rfy-<id>`.
- Workspaces live 8 h (`SEAT_TTL_MIN`) and hibernate after 20 idle minutes; files survive hibernation.

**Student guidance to put on the first slide:** open the URL, enter your code, run `opencode`. Download a
snapshot (top-right) before you leave if you want to keep your work: the server is deleted after the class.

## 8. After the class

1. Tell students to download their snapshots, or do it for them via `/data/snapshots` (kept 7 days).
2. `docker compose -f infra/compose.yaml down` then copy `/data/snapshots` somewhere safe.
3. **Delete the VPS** (billing is hourly; a powered-off server still bills for its disk). Delete or rotate the
   model keys with the provider. `/data/seats/seats.json` contained all the keys in plaintext.
4. Record the real capacity, cost and anything that broke in `docs/labs-platform/load-test.md` for next time.

## Known gaps you may hit

- No login: a class code is the only credential. A student who shares their code shares their workspace and key.
- In-memory sessions: see "Do not restart the API".
- `opencode` default model is `opencode-go/kimi-k3`; change with `SEAT_DEFAULT_MODEL` if the plan's allowed models differ.
- Claude Code is installed but unconfigured; it needs the student's own Anthropic login/key.
- Student egress is open to the internet (they need npm/pip/the model API). Abuse control is the per-workspace
  CPU/memory/pid limits and the kill switch, not a network allowlist.
