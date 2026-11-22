#!/usr/bin/env bash
# scripts/spiffe-recover.sh
# Recover the SPIRE agent after a crash/restart: the join token is single-use,
# so a restarted agent cannot re-attest with the old bootstrap token. The
# sequence is: stop agent -> re-run registration (fresh join token) -> start
# agent. Safe to run repeatedly; no-ops when the agent is already healthy.
#
# Usage: scripts/spiffe-recover.sh [--force]
#   --force  recover even if the agent looks healthy
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose --profile spiffe"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

agent_healthy() {
  # The agent is "healthy" when the BFF can reach the Workload API socket.
  docker exec ai-demo-api-server ls /run/spire-agent/sockets/agent.sock >/dev/null 2>&1
}

if [ "$FORCE" -eq 0 ] && agent_healthy; then
  echo "SPIRE agent socket present — nothing to do (use --force to recover anyway)."
  exit 0
fi

echo "Recovering SPIRE agent (join token is single-use; re-issuing)..."
$COMPOSE stop spire-agent >/dev/null 2>&1 || true
# `compose start` refuses a one-shot service that has no container yet, so use
# `run` for the registration step (creates, runs, removes).
$COMPOSE run --rm --no-deps spire-registration >/dev/null
$COMPOSE up -d --no-deps spire-agent >/dev/null

# Wait for the workload API socket to appear inside the BFF mount.
for _ in $(seq 1 30); do
  if agent_healthy; then
    echo "SPIRE agent recovered: workload API socket is reachable from the BFF."
    exit 0
  fi
  sleep 2
done

echo "ERROR: agent started but the workload API socket never appeared." >&2
exit 1
