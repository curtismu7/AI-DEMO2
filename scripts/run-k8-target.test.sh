#!/usr/bin/env bash
# scripts/run-k8-target.test.sh — run-k8.sh --target=aws|orbstack routing.
#
# Verbs marked target-agnostic must reach their SE implementations under
# --target=aws, local-only verbs must refuse, and bare (no-flag) invocation
# must keep today's behavior. Uses mocked kubectl/docker/gh so nothing here
# touches a cluster.
#
# Usage: bash scripts/run-k8-target.test.sh   (also runs in npm run hygiene:check)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_K8="$HERE/../run-k8.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
# Mocks: record the k8s deploy script invocation, satisfy prereqs.
cat > "$TMP/bin/kubectl" <<'MOCK'
#!/usr/bin/env bash
[[ -n "${RUN_K8_TARGET_LOG:-}" ]] && echo "kubectl $*" >> "$RUN_K8_TARGET_LOG"
case "${1:-}" in
  config)
    case "${2:-}" in
      current-context) echo "orbstack" ;;
      use-context) exit 0 ;;
    esac
    exit 0 ;;
  cluster-info) exit 0 ;;
  get|rollout|scale|delete|apply|top|version|auth) exit 0 ;;
  *) exit 0 ;;
esac
MOCK
cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat > "$TMP/bin/gh" <<'MOCK'
#!/usr/bin/env bash
echo "fake-token"
MOCK
cat > "$TMP/bin/kubens" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat > "$TMP/bin/aws" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
chmod +x "$TMP/bin/"*

# Which deploy script ran, recorded by the mocks above via RUN_K8_TARGET_LOG.
export RUN_K8_TARGET_LOG="$TMP/invocations.log"

# SE verbs derive the namespace from SE_NAMESPACE (or PING_EMAIL via a tty
# prompt) — pin it so the mocked runs never need a tty.
export SE_NAMESPACE="ping-devops-test"
PASSING=0
FAILED=0

expect_log() {  # expect_log <pattern> <label>
  if grep -qE "$1" "$RUN_K8_TARGET_LOG" 2>/dev/null; then
    PASSING=$((PASSING+1))
  else
    FAILED=$((FAILED+1)); echo "FAIL: $2 — expected log match: $1"; grep -c . "$RUN_K8_TARGET_LOG" 2>/dev/null || true
  fi
}
expect_no_log() {  # expect_no_log <pattern> <label>
  if grep -qE "$1" "$RUN_K8_TARGET_LOG" 2>/dev/null; then
    FAILED=$((FAILED+1)); echo "FAIL: $2 — expected NO log match: $1"
  else
    PASSING=$((PASSING+1))
  fi
}
expect_refuse() {  # expect_refuse <args...> <label> — label is the LAST arg
  local label="${*: -1}"
  set -- "${@:1:$#-1}"
  : > "$RUN_K8_TARGET_LOG"
  local rc=0
  PATH="$TMP/bin:$PATH" bash "$RUN_K8" "$@" >/dev/null 2>&1 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    FAILED=$((FAILED+1)); echo "FAIL: $label — expected refusal, got exit 0"
  else
    PASSING=$((PASSING+1))
  fi
}

# --- --target=aws routes target-agnostic verbs to the SE implementations ---

echo "step: aws status" >> "$TMP/steps.log"
: > "$RUN_K8_TARGET_LOG"
PATH="$TMP/bin:$PATH" bash "$RUN_K8" --target=aws status >/dev/null 2>&1 || true
expect_log "config use-context us" "--target=aws status switches to the SE context"
expect_log "get pods -n ping-devops-test" "--target=aws status reads the SE namespace"

echo "step: aws-spc status" >> "$TMP/steps.log"
: > "$RUN_K8_TARGET_LOG"
PATH="$TMP/bin:$PATH" bash "$RUN_K8" --target aws status >/dev/null 2>&1 || true
expect_log "config use-context us" "--target aws (space form) also routes"

echo "step: aws rag" >> "$TMP/steps.log"
: > "$RUN_K8_TARGET_LOG"
PATH="$TMP/bin:$PATH" bash "$RUN_K8" --target=aws rag on >/dev/null 2>&1 || true
expect_log "config use-context us" "--target=aws rag routes to the SE rag path"

# --- bare invocation keeps local behavior: no SE context switch ---

echo "step: bare status" >> "$TMP/steps.log"
: > "$RUN_K8_TARGET_LOG"
PATH="$TMP/bin:$PATH" bash "$RUN_K8" status >/dev/null 2>&1 || true
expect_no_log "aws/deploy.sh" "bare status must not touch the aws deploy path"

# --- unknown target dies ---

expect_refuse --target=nowhere status "unknown --target value refused"

# --- local-only verbs refuse under --target=aws ---

expect_refuse --target=aws destroy "--target=aws destroy refuses"
expect_refuse --target=aws forward "--target=aws forward refuses"
expect_refuse --target=aws stop "--target=aws stop refuses"

echo "steps: $(cat "$TMP/steps.log" 2>/dev/null | tr "\n" " ")"
echo "run-k8-target: $PASSING passed, $FAILED failed"
[[ "$FAILED" -eq 0 ]]
