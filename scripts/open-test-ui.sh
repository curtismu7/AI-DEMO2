#!/usr/bin/env bash
# scripts/open-test-ui.sh — SSH tunnel to the test Mac UI/BFF and open the browser.
#
# Requires /etc/hosts on this Mac:  127.0.0.1  api.ping.demo
# Requires Remote Login enabled on the test Mac and an SSH config Host alias.
#
# Usage:
#   ./scripts/open-test-ui.sh           # tunnel via testmac
#   ./scripts/open-test-ui.sh testmac
#   ./scripts/open-test-ui.sh --stop    # kill background tunnel for this host
#
# Environment:
#   UI_PORT   local UI port      (default: 4000)
#   API_PORT  local BFF port     (default: 3001)
#
set -euo pipefail

HOST="${1:-testmac}"
UI_PORT="${UI_PORT:-4000}"
API_PORT="${API_PORT:-3001}"
APP_URL="https://api.ping.demo:${UI_PORT}"
PID_FILE="${TMPDIR:-/tmp}/ai-demo-tunnel-${HOST}.pid"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '  %s\n' "$*"; }

stop_tunnel() {
  local target_host="${1:-testmac}"
  local pf="${TMPDIR:-/tmp}/ai-demo-tunnel-${target_host}.pid"
  if [[ -f "$pf" ]]; then
    local pid
    pid="$(cat "$pf")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      green "Stopped tunnel (pid $pid) for $target_host"
    else
      info "Stale pid file — removing"
    fi
    rm -f "$pf"
  else
    info "No tunnel pid file for $target_host"
  fi
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && {
  sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

if [[ "${1:-}" == "--stop" ]]; then
  stop_tunnel "${2:-testmac}"
  exit 0
fi

if ! grep -q 'api\.ping\.demo' /etc/hosts 2>/dev/null; then
  red "Missing /etc/hosts entry for api.ping.demo"
  info "Run: echo '127.0.0.1  api.ping.demo' | sudo tee -a /etc/hosts"
  exit 1
fi

# Reuse an existing tunnel when ports are already forwarded.
if lsof -nP -iTCP:"${UI_PORT}" -sTCP:LISTEN 2>/dev/null | grep -q ssh; then
  info "Tunnel already listening on port ${UI_PORT}"
else
  stop_tunnel "$HOST"
  info "Opening SSH tunnel to $HOST (UI:${UI_PORT}, BFF:${API_PORT})..."
  ssh -f -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=60 \
    -L "${UI_PORT}:127.0.0.1:${UI_PORT}" \
    -L "${API_PORT}:127.0.0.1:${API_PORT}" \
    "$HOST"
  # ssh -f backgrounds itself; find the listener pid for --stop.
  sleep 0.5
  lsof -nP -iTCP:"${UI_PORT}" -sTCP:LISTEN -t 2>/dev/null | head -1 > "$PID_FILE" || true
  green "Tunnel up → ${APP_URL}"
fi

open "$APP_URL" 2>/dev/null || xdg-open "$APP_URL" 2>/dev/null || info "Open ${APP_URL} in your browser"
