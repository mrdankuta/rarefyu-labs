#!/usr/bin/env bash
# Verify the base lab image under a given Docker runtime (spec #30, spike #31).
#
#   images/base-lab/verify.sh                       # default runtime (runc)
#   RUNTIME=runsc images/base-lab/verify.sh         # gVisor on the VPS
#   IMAGE=registry/labs/base@sha256:... RUNTIME=runsc images/base-lab/verify.sh
#
# Runs each check in a hardened container (non-root, caps dropped, limits)
# and prints a PASS/FAIL table. Exit code = number of failures.
set -uo pipefail

IMAGE="${IMAGE:-rarefyu/base-lab:dev}"
RUNTIME="${RUNTIME:-}"
RT=()
[ -n "$RUNTIME" ] && RT=(--runtime "$RUNTIME")
HARDEN=(--rm --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 1g --cpus 1 --read-only --tmpfs /tmp:exec --tmpfs /home/student:exec,uid=1001,gid=1001)

fails=0
check() { # name, command
  local name="$1" cmd="$2" out
  if out=$(docker run "${HARDEN[@]}" "${RT[@]}" "$IMAGE" bash -lc "$cmd" 2>&1); then
    printf 'PASS  %s\n' "$name"
  else
    printf 'FAIL  %s\n        %s\n' "$name" "$(echo "$out" | tail -3 | tr '\n' ' ')"
    fails=$((fails+1))
  fi
}

echo "image=$IMAGE runtime=${RUNTIME:-default}"
check "runs as non-root"               '[ "$(id -u)" != 0 ]'
check "node runtime"                   'node -e "console.log(1+1)" | grep -q 2'
check "python runtime"                 'python3 -c "print(6*7)" | grep -q 42'
check "git works"                      'cd /tmp && git init -q x && cd x && git -c user.email=a@b -c user.name=n commit -q --allow-empty -m i && git log --oneline | grep -q i'
check "bun runs a script"              'bun -e "console.log(\"bun-ok\")" | grep -q bun-ok'
check "opencode installed"             'opencode --version'
check "claude code installed"          'claude --version'
check "lab-check + fail-message"       'lab-check --help >/dev/null && ! fail-message nope | grep -v "^FAIL: nope$"'
check "tmux session persists"          'tmux new-session -d -s t "sleep 30" && tmux has-session -t t && tmux new-window -t t -n w2 "sleep 30" && [ "$(tmux list-windows -t t | wc -l)" = 2 ]'
check "pty + job control (ctrl-c)"     'script -qec "bash -ic \"sleep 30 & kill -INT \$! ; wait; echo done\"" /dev/null | grep -q done'
check "dev server reachable on port"   'node -e "require(\"http\").createServer((q,r)=>r.end(\"hi\")).listen(3000)" & sleep 1; curl -fs localhost:3000 | grep -q hi'
check "writes to home volume"          'echo x > ~/f && cat ~/f | grep -q x'
check "cannot write to root fs"        '! touch /etc/nope 2>/dev/null'
check "cannot gain privileges"         '! sudo -n true 2>/dev/null; [ "$(id -u)" != 0 ]'
check "outbound DNS+HTTPS (egress)"    'curl -fsS -m 10 -o /dev/null https://registry.npmjs.org/'
check "pid limit enforced"             'python3 -c "
import subprocess,sys
ps=[]
try:
    for _ in range(700): ps.append(subprocess.Popen([\"sleep\",\"20\"]))
except OSError:
    sys.exit(0)
sys.exit(1)"'
echo "failures: $fails"
exit $fails
