#!/bin/sh
# Second-node join/drain rehearsal (issue #11).
# Usage: ./infra/join-node.sh [--dry-run] [new-node-host]
# Dry-run (default in bench): prints every step without touching anything.
# Live: joins a k3s agent, labels it, waits for labs to schedule, drains cleanly.
set -eu
DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; shift; fi
NODE="${1:-<new-node-host>}"

step() { echo "== $1"; if [ "$DRY" -eq 0 ]; then eval "$2"; else echo "   [dry-run] $2"; fi; }

step "1. preflight (KVM, disk, reachability)" "kvm-ok && ssh root@${NODE} 'df -h /data | tail -1'"
step "2. install k3s agent + join" "ssh root@${NODE} 'curl -sfL https://get.k3s.io | K3S_URL=https://\$SERVER:6443 K3S_TOKEN=\$TOKEN sh -'"
step "3. label for lab workloads" "kubectl label node ${NODE} workload=labs --overwrite"
step "4. verify labs schedule on it" "kubectl get pods -o wide -l app=lab | grep ${NODE}"
step "5. drain (labs reschedule, control plane untouched)" "kubectl drain ${NODE} --ignore-daemonsets --delete-emptydir-data"
step "6. remove node" "kubectl delete node ${NODE}"
echo "rehearsal ${DRY:+complete (dry-run)}"
