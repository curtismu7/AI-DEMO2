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

# ── Host LLM backend (llama.cpp tiers / tier-manager / mlx / oMLX) ────────────
# Multi-GB model servers on :8090/:8091/:8096/:8097 — pure RAM/CPU consumers.
# Only stop what is actually listening; never delete model caches or logs.
#
# The com.ai-demo.llama-models LaunchAgent re-runs supervise-swap.sh every
# 5 minutes and resurrects the backend — so boot it out BEFORE killing the
# servers, or the kill is undone within 5 minutes. A later explicit start
# (./run-docker.sh llamacpp start) or the next login re-loads the agent.
if launchctl print "gui/$(id -u)/com.ai-demo.llama-models" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/com.ai-demo.llama-models" 2>/dev/null || true
  echo "   Booted out launchd keep-alive agent com.ai-demo.llama-models."
fi
# Kill a lingering supervise-swap supervisor from a previous agent run.
pkill -f "demo_llm_proxy/supervise-swap.sh" 2>/dev/null || true
if curl -sf --max-time 2 http://127.0.0.1:8097/health >/dev/null 2>&1; then
  bash "${BASEDIR}/demo_llm_proxy/start-local-models.sh" stop >/dev/null 2>&1 || true
fi
if [[ -f /tmp/demo-tier-manager.pid ]]; then
  kill "$(cat /tmp/demo-tier-manager.pid)" 2>/dev/null || true
  rm -f /tmp/demo-tier-manager.pid
  echo "   Stopped tier-manager (:8097)."
fi
for pid_file in /tmp/demo-llamacpp.pid /tmp/demo-mlx.pid /tmp/demo-omlx.pid; do
  if [[ -f "$pid_file" ]]; then
    kill_process_tree "$(cat "$pid_file" 2>/dev/null || true)"
    rm -f "$pid_file"
  fi
done
for port in 8090 8091 8096 8097; do
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  for pid in $pids; do
    [[ -z "$pid" ]] && continue
    kill_process_tree "$pid"
    echo "   Stopped LLM backend listener on :${port} (PID ${pid})"
  done
done

# ── Compose networks left behind by stopped/removed containers ────────────────
# A down but not removed container or a crashed `up` can leave networks alive.
# Only removes ai-demo-owned networks; never touches volumes or images.
if docker info >/dev/null 2>&1; then
  # Stop auto-restarting containers (llm-proxy, librechat stack). Both are
  # `restart: unless-stopped`, so they resurrect whenever the Docker daemon
  # (OrbStack) restarts. Disable the policy so they stay down.
  containers="$(docker ps -aq --filter "name=^ai-demo-" --filter "name=^librechat" 2>/dev/null || true)"
  if [[ -n "${containers}" ]]; then
    # shellcheck disable=SC2086
    docker update --restart=no ${containers} >/dev/null 2>&1 || true
    # shellcheck disable=SC2086
    docker stop ${containers} >/dev/null 2>&1 || true
    echo "   Stopped Docker containers (ai-demo-*, librechat*) and disabled auto-restart."
  fi
  for net in $(docker network ls -q --filter "name=ai-demo" 2>/dev/null || true); do
    docker network rm "$net" >/dev/null 2>&1 && echo "   Removed compose network (${net})."
  done
else
  echo "   Docker daemon not running — skipping container stop."
fi

echo ""
echo -e "${GREEN}✅ All services stopped.${NC}"
