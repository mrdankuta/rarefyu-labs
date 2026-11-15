#!/usr/bin/env bash
# Provision ONE ordinary Linux VPS (Ubuntu 22.04/24.04 or Debian 12) for RarefyU Labs.
# No KVM / nested virtualization needed: workspaces are Docker containers hardened
# with the gVisor (runsc) runtime. Idempotent: safe to re-run. Run as root.
#
#   sudo ./infra/provision-vps.sh
#
# Steps: base packages + firewall -> Docker -> gVisor registered as a runtime ->
# build the base lab image -> verify it under runsc (fails loudly if gVisor is
# missing or the image misbehaves) -> write DOCKER_GID into .env.
set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-rarefyu/base-lab:dev}"
SKIP_VERIFY="${SKIP_VERIFY:-0}"

log() { echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
. /etc/os-release
case "${ID}" in ubuntu|debian) ;; *) die "unsupported OS ${ID}; use Ubuntu or Debian" ;; esac
[ "$(uname -m)" = "x86_64" ] || [ "$(uname -m)" = "aarch64" ] || die "unsupported arch $(uname -m)"

# --- 1. base packages, firewall, auto-updates --------------------------------
log "installing base packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg jq ufw unattended-upgrades git

log "configuring firewall (ssh/http/https only)"
ufw allow "${SSH_PORT}/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# --- 2. Docker ----------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker info >/dev/null || die "docker daemon is not running"

# --- 3. gVisor (runsc) --------------------------------------------------------
if ! command -v runsc >/dev/null 2>&1; then
  log "installing gVisor"
  curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
    > /etc/apt/sources.list.d/gvisor.list
  apt-get update -qq
  apt-get install -y -qq runsc
fi
if ! docker info --format '{{json .Runtimes}}' | grep -q '"runsc"'; then
  log "registering runsc with Docker"
  runsc install
  systemctl restart docker
fi
docker info --format '{{json .Runtimes}}' | grep -q '"runsc"' || die "runsc is not registered with Docker"

log "smoke test: container under gVisor"
docker run --rm --runtime runsc alpine:3 uname -a | tee /dev/stderr | grep -qi "linux" || die "gVisor smoke test failed"

# --- 4. data dirs + base image --------------------------------------------------
mkdir -p /data/snapshots
chown 1000:1000 /data/snapshots 2>/dev/null || true   # api container user

log "building base lab image ${IMAGE}"
docker build -t "${IMAGE}" "${REPO_DIR}/images/base-lab"

if [ "${SKIP_VERIFY}" != "1" ]; then
  log "verifying image under gVisor (this is the gate: any FAIL aborts)"
  IMAGE="${IMAGE}" RUNTIME=runsc "${REPO_DIR}/images/base-lab/verify.sh" \
    || die "base image failed verification under runsc — see FAIL lines above; fix before opening to students"
fi

# --- 5. .env: DOCKER_GID --------------------------------------------------------
GID="$(stat -c %g /var/run/docker.sock)"
ENV_FILE="${REPO_DIR}/.env"
touch "${ENV_FILE}"
if grep -q '^DOCKER_GID=' "${ENV_FILE}"; then sed -i "s/^DOCKER_GID=.*/DOCKER_GID=${GID}/" "${ENV_FILE}"; else echo "DOCKER_GID=${GID}" >> "${ENV_FILE}"; fi

log "done. Next: edit ${ENV_FILE} (see .env.example), then:"
echo "    docker compose -f infra/compose.yaml up -d --build"
