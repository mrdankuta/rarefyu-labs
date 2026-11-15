# Capacity load test

`scripts/loadtest.ts` simulates a cohort against a running deployment and recommends the
global workspace cap (`MAX_WORKSPACES_GLOBAL`) and a per-workspace memory figure.

Each simulated student: creates a workspace (with the demo track's tabs) -> opens a terminal over
the WebSocket and round-trips a command -> starts a web server -> waits for the signed preview to go
live and fetches it -> holds (optionally burning CPU) -> stops the workspace.

## Run it (on the target VPS, before a live cohort)

```sh
# 1. start the stack with caps high enough that the test, not the limiter, is the bottleneck
MAX_WORKSPACES_GLOBAL=200 MAX_WORKSPACES_PER_IP=200 docker compose -f infra/compose.yaml up -d
# 2. ramp: each stage is N concurrent students, held for --hold seconds
bun scripts/loadtest.ts --base https://labs.example.com --stages 5,10,20,30,40 --hold 60 --cpu --cpus 16
# 3. put the recommended cap into .env (MAX_WORKSPACES_GLOBAL) and re-up
```

`--cpu` makes every student burn a core for the hold period (worst case). Without it the test
measures the idle-shell case. Set `ADMIN_TOKEN` in the environment to reconcile leftovers first.

## What passes a stage

A stage passes when all of these hold (override with `LT_*` env vars, see the script header):
no failed students; create p95 <= 20 s; terminal echo p95 <= 3 s; preview live p95 <= 20 s;
>= 15% host memory still available during the hold; load average <= 1.5 per CPU.
The ramp stops at the first failing stage. **Recommended cap = 80% of the last passing stage.**

The summary also prints the observed host memory used per workspace. It is noisy at small stage
sizes; trust it from stages of 10+ students.

Exit code is 1 only if even the first stage fails.

## Notes

- Workspaces created by the test are stopped at the end of each stage; verify with
  `docker ps -a --filter label=rfy.workspace` (should be empty).
- Sleeping (hibernated) workspaces do not count toward the cap, so the real cap can safely be
  somewhat higher than the number of students who are *simultaneously active*.
