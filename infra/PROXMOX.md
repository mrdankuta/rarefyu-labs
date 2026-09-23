# Proxmox Lab Bench — spare laptops for dev/test (issue #2)

The Hetzner vServer (`labs-01`) has no nested virtualization, so VM-backed
tiers can never run there. These spare laptops are the private lab bench
where KVM work happens; the vServer stays the public endpoint (DNS, site)
until a dedicated box arrives.

Inventory:

| Host | RAM | Disk | Role |
|---|---|---|---|
| `bench-01` (laptop 1) | 16 GB | 512 GB SSD | Proxmox host → primary `labvm` (control plane + exec, KVM) |
| `bench-02` (laptop 2) | 8 GB | 512 GB HDD | k3s **agent only**, dense (`runsc`) labs — no VMs |

Rule of thumb: SSD hosts VMs, HDD hosts containers. The 8 GB HDD box
must never schedule KubeVirt VMs (slow disk + RAM pressure); it joins
with a taint that only dense workloads tolerate.

---

## Part A — bench-01: Proxmox + primary lab VM

### A0. BIOS / firmware (do first, with keyboard attached)

1. Enter setup: enable **VT-x / AMD-V** (may be called “Virtualization
   Technology”, on by default on most laptops — verify, don't assume).
2. **Disable Secure Boot** (Proxmox ISO boots more reliably without it).
3. Set USB as first boot device (revert after install).
4. Power: disable “sleep on lid close” later in software (§A5); for now
   keep the lid open and the charger connected.

### A1. Install Proxmox VE 8

1. Flash the Proxmox VE 8.x ISO to USB (Balena Etcher / `dd`).
2. Boot the laptop from USB → Install Proxmox VE → target disk: the
   512 GB SSD → set root password + admin email.
3. Network: **static IP** on your LAN (e.g. `192.168.1.50/24`, gateway
   `.1`, DNS `1.1.1.1`), hostname `bench-01`.
4. Reboot into Proxmox. From your daily machine confirm
   `https://192.168.1.50:8006` (accept the self-signed cert).
5. Shell on the host (SSH or web console) and update once:
   `apt update && apt full-upgrade -y && reboot` (no-subscription
   repos are fine for a lab bench; silence the nag in UI if it annoys).
6. Confirm nesting is allowed outward:
   `cat /sys/module/kvm_intel/parameters/nested /sys/module/kvm_amd/parameters/nested`
   — whichever file exists must read `Y`. If `N`:
   `echo 'options kvm_intel nested=1' > /etc/modprobe.d/nested.conf`
   (or `kvm_amd`), then reboot.

### A2. Upload Ubuntu ISO, create the lab VM

1. Datacenter → bench-01 → local storage → ISO Images → Upload:
   Ubuntu 24.04 Server ISO.
2. Create VM (`labvm`, ID 100):
   - OS: the Ubuntu ISO. System: defaults + **QEMU Agent ticked**.
   - Disks: **140 GB**, SSD emulation on, discard on.
   - CPU: **sockets 1, cores 5** (leave ~1 core + for the host),
     **Type: `host`** — this is the critical setting; without it the
     guest gets no VT-x flags and `/dev/kvm` never appears.
   - Memory: **12288 MB** (12 GB; host keeps ~4 GB).
   - Network: bridged `vmbr0`, virtio, firewall off (we use UFW inside).
3. Start → Console → install Ubuntu Server (OpenSSH ticked, no snaps
   needed). Give it a LAN static IP or a **DHCP reservation**
   (e.g. `192.168.1.51`), hostname `labvm`.

### A3. Verify nesting, snapshot, bootstrap

Inside `labvm`:

```sh
ls -l /dev/kvm && grep -c -E 'vmx|svm' /proc/cpuinfo   # both must succeed
```

Back in Proxmox: snapshot the VM (`snap-clean-install`). This is your
time machine — snapshot again before every risky step below.

Then run the standard bootstrap **stock** (no degraded flags):

```sh
curl -sfL https://raw.githubusercontent.com/mrdankuta/rarefyu-labs/main/infra/hetzner-init.sh | sudo bash -s --
```

Continue with `infra/HETZNER.md` §§4–5 (clone, compose up, health check,
`push.sh`, rebuild drill) — everything there applies verbatim, with
`labs.local` replaced by your LAN IP or Tailscale name until §A6.

### A4. Snapshot discipline (non-optional)

- `snap-clean-install` — before bootstrap (you have this).
- `snap-post-init` — after init + compose + first image push all verify.
- `snap-pre-<experiment>` — before KubeVirt, kernel, or network work.
- Name + date every snapshot; delete stale ones (snapshots cost disk).

### A5. Laptop-as-server chores (both laptops)

```sh
# never sleep, lid or otherwise
sudo mkdir -p /etc/systemd/logind.conf.d
printf '[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchDocked=ignore\nHandleSuspendKey=ignore\n' \
  | sudo tee /etc/systemd/logind.conf.d/nosleep.conf
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
sudo systemctl restart systemd-logind
```

Plus: charger always in, lid open or vents clear, on a hard surface,
router DHCP reservation for the MAC, and a cheap UPS if your power
flickers. Check thermals under load once (`sensors` / Proxmox summary
graphs) — sustained 90°C+ means prop the back edge up for airflow.

### A6. Reaching the bench from anywhere (Tailscale)

1. `curl -fsSL https://tailscale.com/install.sh | sh` on Proxmox host,
   `labvm`, and your daily machine; `sudo tailscale up` on each.
2. Use the `100.x.y.z` Tailscale IPs / MagicDNS names for SSH, Proxmox
   UI, and lab URLs. No port forwarding, nothing exposed to the internet.
3. TLS behind NAT: public Caddy HTTP-01 challenge can't reach you, so
   for dev either serve plain HTTP over the tailnet or use
   `tls internal` in the Caddyfile. Public certs (DNS-01 via Hetzner /
   Cloudflare API + a custom Caddy build) arrive with the dedicated box
   — do not burn time on this for the bench.

---

## Part B — bench-02: second laptop as dense-only agent node

The 8 GB HDD box is too weak for VMs and too slow to host Postgres, so
it does exactly one job: extra **dense-lab capacity** (`runsc`/gVisor
pods). Bare Ubuntu, no Proxmox (hypervisor overhead buys nothing here).

### B1. Install and join

1. Install Ubuntu 24.04 Server bare metal, hostname `bench-02`,
   same §A5 no-sleep chores, Tailscale, charger + airflow.
2. Confirm `bench-01`'s `labvm` runs k3s healthy
   (`k3s kubectl get nodes`).
3. On `labvm`, read the agent token:
   `sudo cat /var/lib/rancher/k3s/server/node-token`.
4. On `bench-02`, join as **exec-only agent** (never another server —
   etcd on HDD is asking for pain):
   ```sh
   curl -sfL https://get.k3s.io | \
     INSTALL_K3S_VERSION=v1.31.4+k3s1 \
     K3S_URL=https://<labvm-ip>:6443 \
     K3S_TOKEN=<node-token> \
     INSTALL_K3S_EXEC="agent --node-label workload=lab-density --node-taint workload=vm:NoSchedule" \
     sh -
   ```
5. Back on `labvm`: `k3s kubectl get nodes -o wide` shows `bench-02`
   Ready. The `workload=vm:NoSchedule` taint is the guardrail: VM
   workloads (KubeVirt/Kata, toleration-free by default) can never
   land on the HDD box; only dense pods with matching tolerations do
   (wired in slice 3+ templates).

### B2. Operating limits for bench-02

- Cap it: ~10–15 small dense sessions max; watch `kubectl top nodes`
  and load average. HDD iowaits show up as mysterious slowness — that
  means drain it, not debug it: `k3s kubectl drain bench-02 --ignore-daemonsets`.
- Its kubelet + containerd live on local disk; images pull from
  `registry.labs.local` (reachable over LAN/Tailscale — if DNS doesn't
  resolve there, add a hosts entry pointing at `labvm`).
- If it dies mid-session, sessions reschedule dirty — acceptable for
  dev; production redundancy is a dedicated-box concern.

---

## Part C — how the fleet maps (today → later)

| Where | Today | Later (dedicated AX arrives) |
|---|---|---|
| Public edge (DNS, site) | vServer `labs-01` | unchanged, or Caddy moves to AX |
| Control plane + dense labs | `labvm` on bench-01 | migrates to AX (same compose + k3s manifests) |
| Extra dense capacity | bench-02 agent | retired or kept as overflow |
| VM labs (KubeVirt/Kata) | `labvm` (dev scale: 1–2 small VMs) | AX bare metal (real capacity) |

Rehearsing slice 10 early is cheap here: clone a second small VM on
bench-01 and practice join/taint/drain between the two VMs before ever
touching production hosts.
