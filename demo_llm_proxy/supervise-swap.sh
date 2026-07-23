#!/bin/bash
# supervise-swap.sh — keep the local LLM backend alive across logins/timers.
#
# Applies residencyPolicy.js automatically each run:
#   ≥32GB → ensure-set dual residents (8091+8096)
#   <32GB → pin :8091 (refuse dual unless LLM_PROXY_FORCE_DUAL=1)
#   explicit empty LLM_PROXY_RESIDENT_TIERS → classic one-tier swap
#
# Idempotent and cheap — safe for launchd StartInterval (see install-launchd.sh).
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=demo_llm_proxy/apply-residency-policy.sh
source "$DIR/apply-residency-policy.sh"
apply_llm_residency_policy "$DIR"
echo "supervise-swap: ${_LLM_RESIDENCY_REASON:-policy applied} (RAM ${_LLM_TOTAL_RAM_GB:-?}GB)"

# Tier ports come from modelCatalog.js (the SSOT) — never hardcode them here.
# POSIX-compatible read (macOS /bin/bash is 3.2, no mapfile).
TIER_PORTS_STR="$(node -e 'console.log(require("'"$DIR"'/modelCatalog").TIERS.map(t=>t.port).join(" "))')"
read -r -a TIERS <<< "$TIER_PORTS_STR"
SMALLEST_PORT="${SMALLEST_TIER_PORT:-${TIERS[0]:-8091}}"

# 1. Tier-manager daemon — must see the same RESIDENT / HOST env as ensure.
if ! curl -sf --max-time 2 http://127.0.0.1:8097/health >/dev/null 2>&1; then
  LLM_PROXY_RESIDENT_TIERS="${LLM_PROXY_RESIDENT_TIERS}" \
  LLAMA_ARG_HOST="${LLAMA_ARG_HOST}" \
    nohup node "$DIR/tier-manager.js" > /tmp/demo-tier-manager.log 2>&1 &
  echo $! > /tmp/demo-tier-manager.pid
  echo "supervise-swap: started tier-manager (pid $(cat /tmp/demo-tier-manager.pid))"
fi

# 2a. Dual / multi resident
if [ -n "${LLM_PROXY_RESIDENT_TIERS:-}" ]; then
  echo "supervise-swap: resident tiers — ensuring $LLM_PROXY_RESIDENT_TIERS loaded"
  bash "$DIR/start-local-models.sh" ensure-set "$LLM_PROXY_RESIDENT_TIERS"
  exit $?
fi

# 2b. Low-RAM pin (strategy B) — one tier, no classic "leave whatever is up"
if [ -n "${LLM_PROXY_PIN_TIER:-}" ]; then
  echo "supervise-swap: pinned tier — ensuring $LLM_PROXY_PIN_TIER"
  bash "$DIR/start-local-models.sh" ensure "$LLM_PROXY_PIN_TIER"
  exit $?
fi

# 2c. Classic swap: load smallest ONLY if nothing is loaded
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
