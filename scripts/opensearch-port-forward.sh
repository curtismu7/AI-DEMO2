#!/bin/bash
# Keeps the OpenSearch MCP port-forward up for LibreChat's opensearch-direct door
# (librechat/librechat.yaml -> http://host.docker.internal:9900/mcp).
#
# Run by the launchd agent that scripts/install-opensearch-port-forward-launchd.sh
# installs with KeepAlive: this script exits whenever the tunnel is gone or broken,
# and launchd starts it again. A kubectl port-forward can outlive a restarted pod
# and keep failing every connection, so health is an MCP initialize through the
# tunnel, not the kubectl process being alive.
#
# The one thing a restart cannot fix: kubectl signs in with `kubectl oidc-login`
# (browser). When that login expires the log says so; run any kubectl command for
# the context in a terminal to sign in, and the next restart picks it up.
set -uo pipefail

CONTEXT="${OPENSEARCH_PF_CONTEXT:-us}"
NAMESPACE="${OPENSEARCH_PF_NAMESPACE:-ping-devops-curtismuir}"
SERVICE="${OPENSEARCH_PF_SERVICE:-svc/opensearch-mcp-server}"
PORT="${OPENSEARCH_PF_PORT:-9900}"
CHECK_EVERY=30
MAX_FAILS=3
RELOGIN_HINT="If kubectl logged an oidc-login or Unauthorized error, run 'kubectl --context ${CONTEXT} get ns' in a terminal to sign in again."

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

healthy() {
  curl -s -o /dev/null -m 10 -w '%{http_code}' -X POST \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"port-forward-health","version":"1"}}}' \
    "http://127.0.0.1:${PORT}/mcp" | grep -q '^200$'
}

# Something else already serves the port (a manual port-forward, say): leave it
# alone and look again later instead of failing to bind in a tight loop.
if healthy; then
  log "port ${PORT} already answers MCP initialize (another process); checking again in ${CHECK_EVERY}s"
  sleep "$CHECK_EVERY"
  exit 0
fi

log "starting kubectl --context ${CONTEXT} -n ${NAMESPACE} port-forward ${SERVICE} ${PORT}:80"
kubectl --context "$CONTEXT" -n "$NAMESPACE" port-forward "$SERVICE" "${PORT}:80" &
PF_PID=$!
trap 'kill "$PF_PID" 2>/dev/null' EXIT

fails=0
sleep 5
while kill -0 "$PF_PID" 2>/dev/null; do
  if healthy; then
    fails=0
  else
    fails=$((fails + 1))
    log "health check failed (${fails}/${MAX_FAILS})"
    if [ "$fails" -ge "$MAX_FAILS" ]; then
      log "tunnel broken; exiting so launchd restarts it. ${RELOGIN_HINT}"
      exit 1
    fi
  fi
  sleep "$CHECK_EVERY"
done

wait "$PF_PID"
log "kubectl port-forward exited (code $?); launchd will restart it. ${RELOGIN_HINT}"
exit 1
