#!/bin/bash
# supervise-swap.sh — keep the local LLM backend alive in SWAP MODE with minimal
# RAM. This is the low-memory design used by run.sh: the tier-manager daemon
# (:8097) plus AT MOST ONE loaded llama-server tier. The smart router (:8090)
# swaps up to a bigger tier on demand and decays back to the smallest when idle.
#
# NEVER loads all tiers at once. Here we load only the smallest tier, and only
# when nothing is loaded, so we never interrupt a larger tier the router swapped
# up for a live request.
#
# Idempotent and cheap — safe to run on a login/interval timer (see
# install-launchd.sh). macOS/Linux.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMALLEST_PORT="${SMALLEST_TIER_PORT:-8091}"
# Two tiers only: small (Phi-4-mini :8091) and big (gpt-oss-20b :8096).
TIERS=(8091 8096)

# 1. Tier-manager daemon: the swap coordinator the router calls to load/unload
#    tiers one at a time. Start it if it isn't answering.
if ! curl -sf --max-time 2 http://127.0.0.1:8097/health >/dev/null 2>&1; then
  nohup node "$DIR/tier-manager.js" > /tmp/demo-tier-manager.log 2>&1 &
  echo $! > /tmp/demo-tier-manager.pid
  echo "supervise-swap: started tier-manager (pid $(cat /tmp/demo-tier-manager.pid))"
fi

# 2. Ensure the smallest tier is loaded ONLY if nothing is loaded at all. If a
#    tier is already up (possibly a bigger one the router swapped up), leave it
#    — `ensure` would evict it and we'd fight the router.
loaded=""
for p in "${TIERS[@]}"; do
  if curl -sf --max-time 2 "http://127.0.0.1:$p/health" >/dev/null 2>&1; then
    loaded="$p"
    break
  fi
done

if [ -z "$loaded" ]; then
  echo "supervise-swap: no tier loaded — loading smallest ($SMALLEST_PORT)"
  bash "$DIR/start-local-models.sh" ensure "$SMALLEST_PORT"
else
  echo "supervise-swap: tier $loaded already loaded — leaving swap state untouched"
fi
