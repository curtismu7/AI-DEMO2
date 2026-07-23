#!/usr/bin/env bash
# apply-residency-policy.sh — sourceable helper for host llama.cpp residency.
#
# Reads total RAM via residencyPolicy.js and exports:
#   LLM_PROXY_RESIDENT_TIERS  (dual / single / empty)
#   LLM_PROXY_PIN_TIER        (e.g. 8091 on <32GB)
#   LLAMA_ARG_HOST            (default 0.0.0.0 for Docker reachability)
#
# Also sets (not always exported): _LLM_RESIDENCY_MODE, _LLM_RESIDENCY_REASON,
# _LLM_TOTAL_RAM_GB for caller messaging.
#
# Usage:
#   # shellcheck source=demo_llm_proxy/apply-residency-policy.sh
#   source "$DIR/apply-residency-policy.sh"
#   apply_llm_residency_policy "$DIR"
#
# Policy (see residencyPolicy.js):
#   ≥32GB → dual 8091,8096
#   <32GB → pin :8091 (refuse dual unless LLM_PROXY_FORCE_DUAL=1)
#   LLM_PROXY_RESIDENT_TIERS= (explicit empty) → classic swap

apply_llm_residency_policy() {
  local dir="${1:-}"
  if [[ -z "$dir" ]]; then
    dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fi
  local policy_js="$dir/residencyPolicy.js"
  if [[ ! -f "$policy_js" ]]; then
    echo "apply-residency-policy: missing $policy_js — defaulting dual" >&2
    export LLM_PROXY_RESIDENT_TIERS="${LLM_PROXY_RESIDENT_TIERS-8091,8096}"
    export LLM_PROXY_PIN_TIER="${LLM_PROXY_PIN_TIER:-}"
    export LLAMA_ARG_HOST="${LLAMA_ARG_HOST:-0.0.0.0}"
    _LLM_RESIDENCY_MODE="dual"
    _LLM_RESIDENCY_REASON="residencyPolicy.js missing — default dual"
    return 0
  fi
  # shellcheck disable=SC1090
  eval "$(node "$policy_js" --shell)"
  export LLM_PROXY_RESIDENT_TIERS="${_LLM_RESIDENT_TIERS}"
  export LLM_PROXY_PIN_TIER="${_LLM_PIN_TIER}"
  export LLAMA_ARG_HOST="${LLAMA_ARG_HOST:-0.0.0.0}"
  return 0
}
