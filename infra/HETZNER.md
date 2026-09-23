# Hetzner Runbook — single-box host for RarefyU Labs (issue #2)

Target: 1× Hetzner dedicated (AX41/AX52 class, 64GB+ RAM, NVMe),
Ubuntu 24.04, running k3s + the compose control plane. Multi-node
join/drain is slice 10 (`infra/join-node.sh`, not this file).

## 1. Order / reinstall the server

1. Robot → new server or reinstall: **Ubuntu 24.04**, hostname
   `labs-01`, add your SSH key. No LVM games; keep it simple.
   If you have two NVMe drives and want a separate data disk, note its
   device name (e.g. `/dev/nvme1n1`) — you will pass it as `DATA_DEV`.
2. Wait for the ready mail, then:
   `ssh root@<server-ip>`

If `/dev/kvm` never appears (see §4), the CPU flags are off — only
Hetzner support can fix BIOS settings. Confirm *before* you invest
further: `grep -c -E 'vmx|svm' /proc/cpuinfo` must be non-zero.

## 2. DNS

Point `labs.<yourdomain>` (and optionally `registry.<yourdomain>`)
at the server IP. Caddy obtains certificates automatically once DNS
resolves. Until then use `http://<server-ip>` + `curl -k` for smoke tests.

## 3. Bootstrap (as root on the host)

```sh
# optional: DATA_DEV=/dev/nvme1n1  (only if it is a spare disk — the script
# only formats when blkid finds NO filesystem, but double-check anyway)
curl -sfL https://raw.githubusercontent.com/mrdankuta/rarefyu-labs/main/infra/hetzner-init.sh | sudo bash -s --
```

What the script does, in order: KVM check → `/data` mount →
base packages + UFW (22/80/443) + fail2ban + unattended-upgrades →
IP forwarding → k3s single node (Traefik disabled, Caddy owns 80/443) →
CoreDNS serves `registry.labs.local` → trivy install. Idempotent:
re-running is safe and is the first fix for a half-finished run.

If your SSH port is not 22: `SSH_PORT=2222 ... | sudo bash -s --`
or you will lock yourself out when UFW enables.

## 4. Verify — maps to issue #2 acceptance

```sh
k3s kubectl get nodes -o wide          # Ready, roles control-plane,master
ls -l /dev/kvm && df -h /data && ufw status
k3s kubectl run -i --rm --restart=Never regcheck --image=busybox:1.36 -- nslookup registry.labs.local
```

Then the control plane + base image:

```sh
git clone https://github.com/mrdankuta/rarefyu-labs && cd rarefyu-labs
cp .env.example .env && $EDITOR .env   # BETTER_AUTH_SECRET etc.
docker compose -f infra/compose.yaml up -d
curl -k https://labs.local/healthz     # -> {"ok":true,...} (use real domain on host)
./images/base-lab/push.sh              # build -> trivy gate -> push -> prints digest
cat images/base-lab/.digest            # pin this in lab.yaml spec.image
```

All four #2 host criteria (Ready node + KVM, digest-pinned clean image,
control-plane smoke checks, documented rebuild) are met when the above
passes end to end.

## 5. Rebuild drill (do this once before first cohort)

- **Soft:** `reboot`, wait 3 min, re-run §4. Everything returns via
  `restart: unless-stopped` + k3s service. If Caddy certs fail, check DNS.
- **Hard:** Robot reinstall → §3 → restore `/data` from backup (§6) →
  §4. Record duration; that number is your disaster RTO claim.

## 6. Backups (minimum viable)

- Nightly: `pg_dump` (compose postgres) + tar of `/data` registry +
  MinIO buckets → Hetzner Storage Box (`rsync`/`rclone`, SSH key auth).
- Keep `.digest` files and `lab.yaml` pins in git — images rebuild
  deterministically from the registry or from Dockerfile + digest.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `no vmx/svm flags` | BIOS VT off — Hetzner support ticket |
| Locked out after UFW | KVM console via Robot, `ufw allow <port>/tcp` |
| k3s CrashLoop, port 80/443 busy | Traefik not disabled — check `/etc/rancher/k3s/config.yaml`, restart k3s |
| Pod can't pull `registry.labs.local` | Re-run init (CoreDNS block), `kubectl -n kube-system rollout restart deploy/coredns` |
| Disk full on `/` | Docker + k3s data live under `/data` by config; check `du -sh /var/lib/docker` for strays |
| Second server | Stop — that's slice 10, `infra/join-node.sh` |
