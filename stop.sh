#!/usr/bin/env bash
# stop.sh — Stop all demo digital assistant services
# Works with PIDs from both run.sh (.pids/) and run-demo.sh (/tmp/bank-*)
# Also sweeps common ports to catch orphaned processes.

set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")" && pwd)"

BOLD='\033[1m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
NC='\033[0m'

echo -e "${BOLD}🛑  Stopping Banking Digital Assistant services...${NC}"

# Kill a PID and every descendant (npm/node/uvicorn survive a plain kill)
kill_process_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  case "$pid" in
    ''|*[!0-9]*) return 0 ;;
  esac
  [[ "$pid" -le 1 ]] && return 0
  local c
  for c in $(pgrep -P "$pid" 2>/dev/null); do
    kill_process_tree "$c"
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

set +e

# Stop via PID files — both run.sh and run-demo.sh locations
for pid_file in \
  "${BASEDIR}/.pids/api.pid" "${BASEDIR}/.pids/ui.pid" "${BASEDIR}/.pids/mcp.pid" "${BASEDIR}/.pids/agent.pid" \
  /tmp/bank-api-server.pid /tmp/bank-mcp-server.pid /tmp/bank-langchain-agent.pid /tmp/bank-ui.pid \
  /tmp/demo-api-server.pid /tmp/demo-mcp-server.pid /tmp/langchain-agent.pid /tmp/demo-ui.pid; do
  if [[ -f "$pid_file" ]]; then
    PID=$(cat "$pid_file" 2>/dev/null || true)
    rm -f "$pid_file"
    if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
      kill_process_tree "$PID"
      echo "   Stopped PID ${PID} ($(basename "$pid_file" .pid))"
    fi
  fi
done

sleep 1

# Sweep all Banking ports to catch orphans
echo "   Sweeping ports :3000 :3001 :3002 :4000 :8080 :8888..."
for port in 3000 3001 3002 4000 8080 8888; do
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  for pid in $pids; do
    [[ -z "$pid" ]] && continue
    kill_process_tree "$pid"
    echo "   Stopped listener on :${port} (PID ${pid})"
  done
done

sleep 1

# Force-kill anything still clinging to our ports
for port in 3000 3001 3002 4000 8080 8888; do
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  for pid in $pids; do
    [[ -z "$pid" ]] && continue
    kill -KILL "$pid" 2>/dev/null && echo "   Force-killed PID ${pid} on :${port}"
  done
done

set -euo pipefail

echo ""
echo -e "${GREEN}✅ All services stopped.${NC}"
