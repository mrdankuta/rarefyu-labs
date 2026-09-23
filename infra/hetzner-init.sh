#!/usr/bin/env bash
# Bootstrap ONE Hetzner dedicated node (AX line, Ubuntu 24.04) for RarefyU Labs.
#
#   curl -sfL https://raw.githubusercontent.com/mrdankuta/rarefyu-labs/main/infra/hetzner-init.sh \
#     | sudo bash -s --
#
# Idempotent: safe to re-run. Run as root. Covers issue #2 host half:
# KVM check, /data mount, firewall, auto-updates, k3s single node,
# local-registry DNS for the cluster, trivy for image scans.
set -euo pipefail

DATA_DEV="${DATA_DEV:-}"          # e.g. /dev/nvme1n1; empty = skip formatting, use existing /data
DATA_MOUNT="${DATA_MOUNT:-/data}"
SSH_PORT="${SSH_PORT:-22}"
K3S_VERSION="${K3S_VERSION:-v1.31.4+k3s1}"
NODE_IP="${NODE_IP:-$(hostname -I | awk '{print $1}')}"
REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/mrdankuta/rarefyu-labs/main}"

log() { echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
grep -q 'Ubuntu.*24\.04' /etc/os-release || log "WARN: not Ubuntu 24.04, continuing anyway"

# --- 1. KVM -----------------------------------------------------------------
log "checking hardware virtualization"
if ! grep -Eq 'vmx|svm' /proc/cpuinfo; then
  die "no vmx/svm flags — enable VT-x/AMD-V (Hetzner: ask support for BIOS check)"
fi
apt-get update -qq
apt-get install -y -qq cpu-checker curl ca-certificates gnupg jq
if [ ! -e /dev/kvm ]; then
  modprobe kvm 2>/dev/null || true
  modprobe kvm_intel 2>/dev/null || true
  modprobe kvm_amd 2>/dev/null || true
fi
[ -e /dev/kvm ] || die "/dev/kvm missing after modprobe"
log "KVM OK: $(ls -l /dev/kvm)"

# --- 2. /data ---------------------------------------------------------------
log "preparing ${DATA_MOUNT}"
mkdir -p "${DATA_MOUNT}"
if [ -n "${DATA_DEV}" ]; then
  if ! blkid "${DATA_DEV}" >/dev/null 2>&1; then
    log "formatting ${DATA_DEV} as ext4 (no filesystem found)"
    mkfs.ext4 -L data "${DATA_DEV}"
  else
    log "${DATA_DEV} already has a filesystem, leaving data intact"
  fi
  UUID="$(blkid -s UUID -o value "${DATA_DEV}")"
  grep -q "${UUID}" /etc/fstab 2>/dev/null || echo "UUID=${UUID} ${DATA_MOUNT} ext4 defaults,nofail 0 2" >> /etc/fstab
  mountpoint -q "${DATA_MOUNT}" || mount "${DATA_MOUNT}"
fi
df -h "${DATA_MOUNT}"

# --- 3. Base packages, firewall, updates -------------------------------------
log "installing base packages"
apt-get install -y -qq ufw fail2ban unattended-updates htop tmux vim less
systemctl enable --now fail2ban
cat > /etc/apt/apt.conf.d/51-unattended-labs <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
sysctl -w net.ipv4.ip_forward=1
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf 2>/dev/null || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf

log "configuring UFW (ssh ${SSH_PORT}, http/s only)"
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}"/tcp comment 'ssh - set SSH_PORT if yours differs'
ufw allow 80/tcp comment 'caddy http'
ufw allow 443/tcp comment 'caddy https'
ufw --force enable
ufw status numbered | head -20

# --- 4. k3s single node -------------------------------------------------------
log "installing k3s ${K3S_VERSION}"
mkdir -p /etc/rancher/k3s "${DATA_MOUNT}/k3s"
curl -sfL "${REPO_RAW}/infra/k3s-config.yaml" -o /etc/rancher/k3s/config.yaml
curl -sfL https://get.k3s.io -o /tmp/k3s-install.sh
INSTALL_K3S_VERSION="${K3S_VERSION}" INSTALL_K3S_EXEC="--config /etc/rancher/k3s/config.yaml" bash /tmp/k3s-install.sh
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
k3s kubectl wait --for=condition=Ready node --all --timeout=300s
k3s kubectl get nodes -o wide

# --- 5. Local registry visible inside the cluster -----------------------------
# Course images are pushed to the on-box registry (compose `registry`,
# port 5000). Pods must resolve registry.labs.local, so serve it from
# CoreDNS with a dedicated server block. Slice 10 reworks this for multi-node.
log "wiring registry.labs.local -> ${NODE_IP} in CoreDNS"
k3s kubectl -n kube-system rollout status deploy/coredns --timeout=180s >/dev/null
COREFILE="$(k3s kubectl -n kube-system get cm coredns -o jsonpath='{.data.Corefile}')"
if ! grep -q 'registry.labs.local' <<<"${COREFILE}"; then
  BLOCK="$(printf 'registry.labs.local:53 {\n    hosts {\n        %s registry.labs.local\n        fallthrough\n    }\n}\n' "${NODE_IP}")"
  PATCH="$(printf '%s\n%s' "${COREFILE}" "${BLOCK}" | jq -Rs '{data: {Corefile: .}}')"
  k3s kubectl -n kube-system patch cm coredns --type merge -p "${PATCH}"
  k3s kubectl -n kube-system rollout restart deploy/coredns
  k3s kubectl -n kube-system rollout status deploy/coredns --timeout=180s >/dev/null
else
  log "CoreDNS already serves registry.labs.local"
fi
k3s kubectl run -i --rm --restart=Never regcheck --image=busybox:1.36 -- nslookup registry.labs.local

# --- 6. Container runtime + scanner -------------------------------------------
log "installing trivy for image scans"
curl -sfL https://aquasecurity.github.io/trivy-repo/deb/public.key | gpg --dearmor -o /usr/share/keyrings/trivy.gpg
echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" > /etc/apt/sources.list.d/trivy.list
apt-get update -qq && apt-get install -y -qq trivy
trivy --version

# --- 7. Summary ----------------------------------------------------------------
log "DONE. Verify with:"
echo "  k3s kubectl get nodes -o wide"
echo "  ls -l /dev/kvm && df -h ${DATA_MOUNT} && ufw status"
echo "Next: images/base-lab/push.sh, then 'docker compose -f infra/compose.yaml up -d'"
