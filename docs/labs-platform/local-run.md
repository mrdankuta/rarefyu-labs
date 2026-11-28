# Run a lab on your own machine (optional fallback)

The hosted workspace needs nothing installed. If you prefer your own machine, the
same base image and the same check scripts run locally with Docker:

```sh
git clone https://github.com/mrdankuta/rarefyu-labs && cd rarefyu-labs
scripts/labs-local.sh                # demo-agent track; first run builds the image
```

You get a shell in a locked-down container (non-root, no capabilities, read-only
root filesystem, memory/CPU/PID limits). Inside it:

- `lab-check` lists the track's steps; `lab-check 01-scaffold` runs that step's
  check and prints the same `PASS` / `FAIL: <hint>` verdict as the hosted Check button.
- Apps listening on ports 3000-3010 are reachable from your browser at `http://localhost:3000`.
- Your files live in the Docker volume `rfy-local-<track>` and survive restarts.
  To work in a normal folder instead: `LABS_HOST_DIR=$PWD/work scripts/labs-local.sh`.

Run one command and exit (handy for scripting): `LABS_CMD='lab-check 01-scaffold' scripts/labs-local.sh`.
Rebuild the image after pulling updates: `LABS_BUILD=1 scripts/labs-local.sh`.

This is a convenience path, not an isolation guarantee for course authors: hosted
labs additionally run under gVisor. Local mode does not include the web shell,
grading or snapshots.

## Grading switch

"Submit for grade" is disabled unless `GRADING_ENABLED=1` is set for the API. Leave it unset for a normal run (the lab shows "Grading is unavailable right now"); set it only on your own machine if you are working on grading.
