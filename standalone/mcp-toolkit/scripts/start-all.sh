#!/usr/bin/env bash
# Starts all three tools in the background (run scripts/install.sh first).
# Logs to logs/<name>.log, PIDs to .pids/<name>.pid.
#
# `npm start` forks its own child process (and mcp-inspector/ai-gateway-client's
# start script is itself a `build && start` compound command, forking again) —
# the PID `$!` gives us is that wrapper, not the node process actually holding
# the port, so killing it alone leaves the real server running orphaned.
# `set -m` gives each backgrounded job its own process group; stop-all.sh then
# kills the whole group with a negative PID.
set -euo pipefail
set -m
cd "$(dirname "$0")/.."

mkdir -p logs .pids

start_one() {
  local name="$1" dir="$2" cmd="$3"
  local pidfile=".pids/$name.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "== $name: already running (pid $(cat "$pidfile")) =="
    return
  fi
  echo "== $name: starting =="
  (cd "$dir" && exec $cmd) >"logs/$name.log" 2>&1 &
  echo $! >"$pidfile"
}

start_one "llm-gateway" "repos/llm-gateway" "npm start"
start_one "mcp-inspector" "repos/mcp-inspector" "npm start"
start_one "ai-gateway-client" "repos/ai-gateway-client" "npm start"

sleep 2
echo
echo "llm-gateway:       http://127.0.0.1:8090  (logs/llm-gateway.log)"
echo "mcp-inspector:      http://127.0.0.1:3900  (logs/mcp-inspector.log)"
echo "ai-gateway-client:  http://127.0.0.1:3910  (logs/ai-gateway-client.log)"
echo
echo "Stop with ./scripts/stop-all.sh"
