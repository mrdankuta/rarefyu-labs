#!/usr/bin/env bash
# Run a RarefyU lab on your own machine: the same base image and check scripts as
# the hosted platform, in a locked-down container. Needs only Docker.
#
#   scripts/labs-local.sh [track]            # interactive shell, track defaults to demo-agent
#   LABS_CMD='lab-check 01-scaffold' scripts/labs-local.sh   # run one command and exit
#
# Your files live in the Docker volume "rfy-local-<track>" (survives restarts):
#   docker cp rfy-local-<track>-tmp:/home/student/workspace .   # or run with LABS_HOST_DIR=$PWD/work
# Ports 3000-3010 are published on localhost so your own browser can preview apps.
#
# Env: LAB_IMAGE (default rarefyu/base-lab:dev), LABS_BUILD=1 (rebuild the image),
#      LABS_HOST_DIR (bind-mount a host folder as the workspace), LABS_VOLUME (volume name)
set -euo pipefail

TRACK="${1:-demo-agent}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${LAB_IMAGE:-rarefyu/base-lab:dev}"
VOLUME="${LABS_VOLUME:-rfy-local-${TRACK}}"

command -v docker >/dev/null 2>&1 || { echo "Docker is required: https://docs.docker.com/get-docker/" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running (or you lack permission)." >&2; exit 1; }
[ -d "$REPO/tracks/$TRACK" ] || { echo "unknown track '$TRACK' (see tracks/)" >&2; exit 1; }

if [ "${LABS_BUILD:-0}" = "1" ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> building $IMAGE (first run only, a few minutes)"
  docker build -q -t "$IMAGE" "$REPO/images/base-lab" >/dev/null
fi

ARGS=(--rm --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 2g --cpus 2
      --read-only --tmpfs /tmp:exec
      -v "$REPO/tracks:/lab/tracks:ro" -e "LAB_TRACK=$TRACK"
      -p 127.0.0.1:3000-3010:3000-3010)
if [ -n "${LABS_HOST_DIR:-}" ]; then
  mkdir -p "$LABS_HOST_DIR"
  # Run as you so files on the host stay yours; home must be writable for tools.
  ARGS+=(--user "$(id -u):$(id -g)" -e HOME=/tmp -v "$(cd "$LABS_HOST_DIR" && pwd):/home/student/workspace" -w /home/student/workspace)
else
  ARGS+=(-v "${VOLUME}:/home/student")   # no -w here: docker would create that dir as root
fi

# First run in a fresh volume: make the workspace dir.
SETUP='mkdir -p /home/student/workspace; [ -f /home/student/workspace/README.md ] || echo "# $LAB_TRACK workspace" > /home/student/workspace/README.md'
if [ -n "${LABS_CMD:-}" ]; then
  exec docker run "${ARGS[@]}" "$IMAGE" bash -c "$SETUP; cd /home/student/workspace; $LABS_CMD"
fi
echo "==> $TRACK: type 'lab-check' to list steps, 'lab-check <step>' to check. Apps on :3000 appear at http://localhost:3000"
exec docker run -it "${ARGS[@]}" "$IMAGE" bash -c "$SETUP; cd /home/student/workspace; exec bash -l"
