# VPS deploy notes (ailabs.rarefytech.com)

Verified 2026-11-23 on a Hetzner Cloud box (Ubuntu 24.04, 1 vCPU / 1 GB / 19 GB, "labtest"). This size is a smoke test only.

1. `git ls-files -z | rsync -az --from0 --files-from=- ./ root@HOST:/opt/rarefyu-labs/`
2. `./infra/provision-vps.sh` (installs Docker + gVisor, builds the base image, verifies it under runsc: all checks passed).
3. Write `/opt/rarefyu-labs/.env` (ADMIN_TOKEN, PREVIEW_SECRET, BETTER_AUTH_SECRET, POSTGRES_PASSWORD, SITE_ADDRESS=ailabs.rarefytech.com, SEATS_REQUIRED=1, DRIVER=docker-gvisor).
4. `docker compose --env-file .env -f infra/compose.yaml up -d --build` (`--env-file` is required: compose looks for `.env` next to the compose file, in `infra/`).
5. Caddy obtained the Let's Encrypt certificate on first request. The DNS record is proxied through Cloudflare: SSL mode must be **Full** (not Flexible) or the HTTP-to-HTTPS redirect loops.
6. Add seats: `POST /api/admin/seats` with `Authorization: Bearer $ADMIN_TOKEN` and `{"seats":[{"label","key"}]}`.

Checked end to end: class code login, workspace container `HostConfig.Runtime=runsc`, terminal over wss, agent chip, change detection from inside the container.

Needs a bigger box for the class: 60 workspaces at 1 vCPU / 2 GB each do not fit on 1 vCPU / 1 GB. Size with the #46 load test.

Gotcha fixed: the web runtime image ships only `apps/web`, so server-side imports of editor packages 500. The lab page is `ssr = false`.

## Lab layout flag (Classic / Chat)

The lab page has a header toggle between Classic and Chat. Chat is the default on a student's first visit; the choice is then remembered in the browser (`localStorage` key `rfy_layout`). To fall back to Classic for everyone mid-class (the toggle is hidden and any stored Chat choice is ignored), set `PUBLIC_DEFAULT_LAYOUT=classic` in `/opt/rarefyu-labs/.env` and run `docker compose --env-file .env -f infra/compose.yaml up -d web`. It is read at runtime by the web container, so no rebuild is needed. Unset it, or set anything else, to restore the toggle. Only the value `classic` has an effect.

## Workspace DNS under gVisor (required)

Under `runsc`, Docker's embedded resolver (127.0.0.11) does not answer on the per-workspace network, so workspaces had IP egress but could not resolve any name: the agent hung on its first model call, and `npm`/`curl` would fail too. Found 2026-11-24 on the VPS. Fix: `infra/workspace-resolv.conf` (1.1.1.1, 9.9.9.9) is bind-mounted read-only over `/etc/resolv.conf` in each workspace. Set the HOST path in `.env`: `WORKSPACE_RESOLV_CONF=/opt/rarefyu-labs/infra/workspace-resolv.conf`, then `up -d api`. Workspaces created before this need recreating.

## Seat OpenCode config and terminal notes (2026-11-26)

- Default class model is `opencode-go/muse-spark-1.3-contributor` (`SEAT_DEFAULT_MODEL` overrides; set it in `.env` only if you want something else). Verify the plan's model list shows it: OpenCode only lists models the key's plan allows.
- Each seat's global OpenCode config sets `update: "disable"` (no "/update to install" nag; we pin the version) and `enabled_providers: ["opencode-go"]` (other providers are unusable even if a student connects one). OpenCode 2.4.1 has no supported per-model allowlist, so the model picker still shows every model the plan allows.
- The terminal pty follows the browser pane size (client sends `{"type":"resize","cols","rows"}` over the terminal websocket). Terminals used to be fixed at 80x24.
- Ctrl+P inside a terminal goes to the program (opencode's command palette); the lab's quick-open still works with focus elsewhere.
- A running OpenCode background service holds about 650 MB; the lab stops it after the key install and only warms the on-disk model catalog, so cold starts cost a few seconds, not 650 MB per workspace.

## Resizable and collapsible panels (both layouts)

Panels have draggable dividers in the 12px gaps (Classic: Learn | Explorer | editor | terminal; Chat: Learn | chat | preview, plus the left edge of the terminal and files drawers). Each divider is keyboard-operable (arrows ±16px, Shift ±64, Home/End, Enter collapses, double-click resets), and the Learn, Explorer, terminal and chat panels collapse to a 32px rail with a chevron. Sizes live in the browser (`localStorage` key `rfy_panes_v1`); a "Reset panels" button appears in the header while anything is customised. No server state or config. Dividers are hidden when the layout stacks (Classic below 1200px, Chat below 760px). The terminal follows its panel: dragging it wider gives the shell more columns.
