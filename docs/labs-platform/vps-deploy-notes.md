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
