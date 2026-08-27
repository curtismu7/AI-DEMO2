#!/bin/bash
# Runnable check for the se-undeploy confirmation guard and the `stop` refusal.
# Run: bash scripts/test-se-undeploy-guard.sh
#
# se-undeploy deletes every deployment, service, ingress, configmap and secret
# in a SHARED cluster namespace. These assert the two ways that can happen by
# accident stay closed: a teardown reachable by a harmless-looking name, and a
# teardown that runs without anyone confirming it.
#
# kubectl is stubbed on PATH, so nothing here can touch a real cluster — the
# assertions are about whether kubectl WOULD have been called.

BASEDIR="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
STUB_DIR="$(mktemp -d)"
KUBECTL_LOG="$STUB_DIR/kubectl.log"
trap 'rm -rf "$STUB_DIR"' EXIT

# Stub kubectl: record the call, never do anything. `config current-context`
# answers `us` so se_undeploy does not try to switch contexts.
cat > "$STUB_DIR/kubectl" <<'STUB'
#!/bin/bash
echo "$*" >> "$KUBECTL_LOG"
[ "$1 $2" = "config current-context" ] && echo us
exit 0
STUB
chmod +x "$STUB_DIR/kubectl"
export KUBECTL_LOG
export PATH="$STUB_DIR:$PATH"

# A namespace that is not anyone's, so even a total failure of the guard cannot
# name a real target.
NS=ping-devops-guard-test

run_undeploy() { # run_undeploy <extra args…> — always with stdin closed (no tty)
  : > "$KUBECTL_LOG"
  SE_NAMESPACE="$NS" "$BASEDIR/run-k8.sh" se-undeploy "$@" </dev/null >/dev/null 2>&1
  echo $?
}

deleted() { grep -q '^delete ' "$KUBECTL_LOG" && echo yes || echo no; }

check() { # check <label> <expected> <actual>
  if [ "$2" != "$3" ]; then
    echo "FAIL: $1 — expected '$2', got '$3'"
    FAIL=1
  fi
}

# 1. No terminal and no --yes: refuse rather than assume consent from a script.
code=$(run_undeploy)
check "no tty without --yes exits non-zero" "1" "$code"
check "no tty without --yes deletes nothing" "no" "$(deleted)"

# 2. --yes is an explicit, deliberate override, so it proceeds.
code=$(run_undeploy --yes)
check "--yes exits zero" "0" "$code"
check "--yes performs the delete" "yes" "$(deleted)"

# 3. Same via the environment, for callers that cannot pass a flag.
: > "$KUBECTL_LOG"
SE_NAMESPACE="$NS" SE_UNDEPLOY_YES=1 "$BASEDIR/run-k8.sh" se-undeploy </dev/null >/dev/null 2>&1
check "SE_UNDEPLOY_YES=1 performs the delete" "yes" "$(deleted)"

# 4. A piped "y" must NOT confirm — the prompt reads the terminal, not stdin,
#    so `yes | ./run-k8.sh se-undeploy` cannot auto-approve a teardown.
: > "$KUBECTL_LOG"
printf 'y\n' | SE_NAMESPACE="$NS" "$BASEDIR/run-k8.sh" se-undeploy >/dev/null 2>&1
check "piped 'y' does not confirm" "no" "$(deleted)"

# 5. `stop` on run-pingaws.sh must refuse outright. It used to be a third alias
#    for this teardown, while `run-k8.sh stop` is a harmless local stop — the
#    same word meaning opposite things one script over.
out=$("$BASEDIR/run-pingaws.sh" stop 2>&1); code=$?
check "run-pingaws.sh stop exits non-zero" "1" "$code"
check "run-pingaws.sh stop refuses" "yes" "$(echo "$out" | grep -q 'Refusing' && echo yes || echo no)"
check "run-pingaws.sh stop names the real teardown" "yes" \
  "$(echo "$out" | grep -q 'run-pingaws.sh undeploy' && echo yes || echo no)"
check "run-pingaws.sh stop names the local stop" "yes" \
  "$(echo "$out" | grep -q 'run-k8.sh stop' && echo yes || echo no)"

# 6. The wrapper is what people actually type, and it has to forward both the
#    confirmation and the override across the exec into run-k8.sh.
: > "$KUBECTL_LOG"
SE_NAMESPACE="$NS" "$BASEDIR/run-pingaws.sh" undeploy </dev/null >/dev/null 2>&1
check "run-pingaws.sh undeploy still confirms" "no" "$(deleted)"

: > "$KUBECTL_LOG"
SE_NAMESPACE="$NS" "$BASEDIR/run-pingaws.sh" undeploy --yes </dev/null >/dev/null 2>&1
check "run-pingaws.sh undeploy --yes forwards the override" "yes" "$(deleted)"

# 7. `stop` must not reach se-undeploy at all.
: > "$KUBECTL_LOG"
SE_NAMESPACE="$NS" "$BASEDIR/run-pingaws.sh" stop >/dev/null 2>&1
check "run-pingaws.sh stop deletes nothing" "no" "$(deleted)"

if [ "$FAIL" = 0 ]; then
  echo "PASS — se-undeploy guard and stop refusal hold"
else
  echo "FAILURES above"
fi
exit "$FAIL"
