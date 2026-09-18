#!/usr/bin/env bash
# Start the supported local demo stack, then make the loopback-only operator page available.
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER_HOST="127.0.0.1"
LAUNCHER_PORT="${DEMO_LAUNCHER_PORT:-3090}"
LAUNCHER_URL="http://${LAUNCHER_HOST}:${LAUNCHER_PORT}"
export DEMO_LAUNCHER_HOST="${LAUNCHER_HOST}"

cd "${REPOSITORY_ROOT}"
./run-docker.sh
./run-docker.sh optional start demo-auth

if ! curl --silent --fail --max-time 1 "${LAUNCHER_URL}/health" >/dev/null 2>&1; then
  DEMO_LAUNCHER_PORT="${LAUNCHER_PORT}" nohup node scripts/demo-launcher-server.mjs >/tmp/ai-demo-launcher.log 2>&1 &
  launcher_pid=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl --silent --fail --max-time 1 "${LAUNCHER_URL}/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "${launcher_pid}" >/dev/null 2>&1; then
      cat /tmp/ai-demo-launcher.log >&2
      exit 1
    fi
    sleep 0.2
  done
  if ! curl --silent --fail --max-time 1 "${LAUNCHER_URL}/health" >/dev/null 2>&1; then
    printf 'Demo launcher did not become ready: %s\n' "${LAUNCHER_URL}" >&2
    exit 1
  fi
fi

printf 'Demo launcher: %s\n' "${LAUNCHER_URL}"

if [[ "${DEMO_LAUNCHER_OPEN:-0}" == "1" ]]; then
  if command -v open >/dev/null 2>&1; then
    open "${LAUNCHER_URL}" || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${LAUNCHER_URL}" || true
  fi
fi
