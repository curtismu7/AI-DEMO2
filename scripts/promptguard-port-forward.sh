#!/usr/bin/env bash
# Keeps the PromptGuard health endpoint reachable at localhost:8086 for browser checks.
# Run by the per-user LaunchAgent installed by install-promptguard-port-forward-launchd.sh.
# Launchd starts this at login; this supervisor retries after pod rotations, cluster
# interruptions, or expired kubectl OIDC credentials.
set -uo pipefail

CONTEXT="${PROMPTGUARD_PF_CONTEXT:-us}"
NAMESPACE="${PROMPTGUARD_PF_NAMESPACE:-ping-devops-curtismuir}"
DEPLOYMENT="${PROMPTGUARD_PF_DEPLOYMENT:-deployment/agentless-mcpgw}"
PORT="${PROMPTGUARD_PF_PORT:-8086}"
CHECK_EVERY="${PROMPTGUARD_PF_CHECK_SECONDS:-30}"
RETRY_AFTER_FAILURE="${PROMPTGUARD_PF_RETRY_SECONDS:-10}"
MAX_FAILS=3
HEALTH_URL="http://127.0.0.1:${PORT}/health"
RELOGIN_HINT="If kubectl reports an oidc-login or Unauthorized error, run 'kubectl --context ${CONTEXT} get ns' in Terminal to sign in again."
PF_PID=""

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

healthy() {
  local body
  body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null)" || return 1
  [[ "$body" == '{"ok": true}' ]]
}

port_in_use() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1
}

stop_forward() {
  [[ -n "$PF_PID" ]] || return 0
  kill "$PF_PID" 2>/dev/null || true
  wait "$PF_PID" 2>/dev/null || true
  PF_PID=""
}

trap stop_forward EXIT
trap 'exit 0' INT TERM

while true; do
  if healthy; then
    log "PromptGuard health is already available on localhost:${PORT}; monitoring it."
    sleep "$CHECK_EVERY"
    continue
  fi

  if port_in_use; then
    log "localhost:${PORT} is occupied but is not answering the PromptGuard health check; retrying."
    sleep "$CHECK_EVERY"
    continue
  fi

  log "starting kubectl --context ${CONTEXT} -n ${NAMESPACE} port-forward ${DEPLOYMENT} ${PORT}:${PORT}"
  kubectl --context "$CONTEXT" -n "$NAMESPACE" port-forward "$DEPLOYMENT" "${PORT}:${PORT}" &
  PF_PID=$!
  sleep 5

  fails=0
  while kill -0 "$PF_PID" 2>/dev/null; do
    if healthy; then
      fails=0
    else
      fails=$((fails + 1))
      log "health check failed (${fails}/${MAX_FAILS})"
      if [[ "$fails" -ge "$MAX_FAILS" ]]; then
        log "tunnel is not healthy; restarting it. ${RELOGIN_HINT}"
        stop_forward
        break
      fi
    fi
    sleep "$CHECK_EVERY"
  done

  if [[ -n "$PF_PID" ]]; then
    status=0
    wait "$PF_PID" || status=$?
    PF_PID=""
    log "kubectl port-forward exited (code ${status}); retrying. ${RELOGIN_HINT}"
  fi
  sleep "$RETRY_AFTER_FAILURE"
done
