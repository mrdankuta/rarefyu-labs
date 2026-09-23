#!/usr/bin/env bash
# Build, scan, and push the base lab image to the on-box registry by digest.
# Run ON the Hetzner host after hetzner-init.sh + compose are up:
#
#   REGISTRY=registry.labs.local:5000 ./images/base-lab/push.sh
#
# Prints the digest; pin it in the course template (lab.yaml).
set -euo pipefail

REGISTRY="${REGISTRY:-registry.labs.local:5000}"
TAG="$(date +%Y%m%d)-$(git rev-parse --short HEAD 2>/dev/null || echo manual)"
REF="${REGISTRY}/labs/base:${TAG}"

cd "$(dirname "$0")"
echo "==> building ${REF}"
docker build -t "${REF}" .

echo "==> scanning (gate: no unfixed CRITICAL)"
trivy image --severity CRITICAL --ignore-unfixed --exit-code 1 "${REF}"

echo "==> pushing"
docker push "${REF}"
DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${REF}")"
echo "${DIGEST}" > .digest
echo "==> pinned: ${DIGEST}"
echo "Put this image ref in lab.yaml spec.image"
