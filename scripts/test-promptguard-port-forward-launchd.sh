#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FORWARD_SCRIPT="$SCRIPT_DIR/promptguard-port-forward.sh"
INSTALLER="$SCRIPT_DIR/install-promptguard-port-forward-launchd.sh"
TMP_ROOT="$(mktemp -d)"
SUPERVISOR_PID=""

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$SUPERVISOR_PID" ]]; then
    kill "$SUPERVISOR_PID" 2>/dev/null || true
    wait "$SUPERVISOR_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

[[ -x "$FORWARD_SCRIPT" ]] || fail "PromptGuard forward supervisor is missing or not executable"
[[ -x "$INSTALLER" ]] || fail "PromptGuard LaunchAgent installer is missing or not executable"

TEST_BIN="$TMP_ROOT/bin"
TEST_HOME="$TMP_ROOT/home"
TEST_MAIN="$TMP_ROOT/main"
TEST_STATE="$TMP_ROOT/state"
mkdir -p "$TEST_BIN" "$TEST_HOME" "$TEST_MAIN/scripts" "$TEST_STATE"

cat > "$TEST_BIN/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "$PROMPTGUARD_TEST_CURL_ARGS"
if [[ -f "$PROMPTGUARD_TEST_STARTED" ]]; then
  printf '{"ok": true}\n'
  exit 0
fi
exit 7
STUB

cat > "$TEST_BIN/kubectl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$PROMPTGUARD_TEST_KUBECTL_ARGS"
touch "$PROMPTGUARD_TEST_STARTED"
trap 'exit 0' TERM INT
while :; do /bin/sleep 0.1; done
STUB

cat > "$TEST_BIN/lsof" <<'STUB'
#!/usr/bin/env bash
exit 1
STUB

cat > "$TEST_BIN/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB

chmod +x "$TEST_BIN/curl" "$TEST_BIN/kubectl" "$TEST_BIN/lsof" "$TEST_BIN/sleep"

PROMPTGUARD_TEST_CURL_ARGS="$TEST_STATE/curl.args" \
PROMPTGUARD_TEST_KUBECTL_ARGS="$TEST_STATE/kubectl.args" \
PROMPTGUARD_TEST_STARTED="$TEST_STATE/started" \
PATH="$TEST_BIN:$PATH" \
  "$FORWARD_SCRIPT" >"$TEST_STATE/forward.log" 2>&1 &
SUPERVISOR_PID=$!

for _ in {1..100}; do
  [[ -s "$TEST_STATE/kubectl.args" ]] && break
  /bin/sleep 0.05
done

[[ -s "$TEST_STATE/kubectl.args" ]] || fail "supervisor did not start kubectl port-forward"
for expected in --context us -n ping-devops-curtismuir port-forward deployment/agentless-mcpgw 8086:8086; do
  grep -Fqx -- "$expected" "$TEST_STATE/kubectl.args" \
    || fail "kubectl port-forward omitted expected argument: $expected"
done
grep -Fqx 'http://127.0.0.1:8086/health' "$TEST_STATE/curl.args" \
  || fail "supervisor did not health-check the PromptGuard endpoint"

kill "$SUPERVISOR_PID" 2>/dev/null || true
wait "$SUPERVISOR_PID" 2>/dev/null || true
SUPERVISOR_PID=""

cat > "$TEST_BIN/git" <<'STUB'
#!/usr/bin/env bash
printf '%s/.git\n' "$PROMPTGUARD_TEST_MAIN"
STUB

cat > "$TEST_BIN/kubectl-oidc_login" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB

cat > "$TEST_BIN/launchctl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$PROMPTGUARD_TEST_LAUNCHCTL_ARGS"
STUB

chmod +x "$TEST_BIN/git" "$TEST_BIN/kubectl-oidc_login" "$TEST_BIN/launchctl"
cp "$FORWARD_SCRIPT" "$TEST_MAIN/scripts/promptguard-port-forward.sh"

PROMPTGUARD_TEST_MAIN="$TEST_MAIN" \
PROMPTGUARD_TEST_LAUNCHCTL_ARGS="$TEST_STATE/launchctl.args" \
HOME="$TEST_HOME" PATH="$TEST_BIN:$PATH" \
  "$INSTALLER" >"$TEST_STATE/install.log" 2>&1

PLIST="$TEST_HOME/Library/LaunchAgents/com.aidemo2.promptguard-port-forward.plist"
[[ -f "$PLIST" ]] || fail "installer did not write the LaunchAgent plist"
grep -Fq "$TEST_MAIN/scripts/promptguard-port-forward.sh" "$PLIST" \
  || fail "LaunchAgent does not target the main-checkout supervisor"
grep -Fq '<key>RunAtLoad</key><true/>' "$PLIST" \
  || fail "LaunchAgent will not start at login"
grep -Fq '<key>KeepAlive</key><true/>' "$PLIST" \
  || fail "LaunchAgent will not keep the supervisor running"
grep -Fq "load $PLIST" "$TEST_STATE/launchctl.args" \
  || fail "installer did not load the LaunchAgent"

PROMPTGUARD_TEST_LAUNCHCTL_ARGS="$TEST_STATE/launchctl.args" \
HOME="$TEST_HOME" PATH="$TEST_BIN:$PATH" \
  "$INSTALLER" uninstall >"$TEST_STATE/uninstall.log" 2>&1
[[ ! -e "$PLIST" ]] || fail "uninstall left the LaunchAgent plist behind"

echo "PromptGuard port-forward LaunchAgent tests passed"
