#!/usr/bin/env bash
# resolve-llm-backend.sh — platform-aware LLM_BACKEND resolution
#
# Apple Silicon Mac (darwin + arm64): default omlx when LLM_BACKEND is unset
# Linux / AWS / CI / Docker-on-Linux: default llamacpp; omlx/mlx are rejected
#
# Usage (source from run.sh / run-docker.sh):
#   source demo_llm_proxy/resolve-llm-backend.sh
#   resolve_llm_backend [context]   # prints effective backend; sets RESOLVED_LLM_BACKEND
#   [[ -n "${LLM_BACKEND_RESOLVE_WARN:-}" ]] && warn "$LLM_BACKEND_RESOLVE_WARN"
#
# Call it bare rather than in $( ) when you need the warning: a command
# substitution resolves in a subshell and LLM_BACKEND_RESOLVE_WARN is lost.
# Read RESOLVED_LLM_BACKEND instead of the printed value.

# Test hooks: UNAME_S / UNAME_M override uname for unit tests.
_llm_uname_s() { echo "${UNAME_S:-$(uname -s)}"; }
_llm_uname_m() { echo "${UNAME_M:-$(uname -m)}"; }

# Return 0 when running on macOS (any arch).
is_macos() {
  [[ "$(_llm_uname_s)" == "Darwin" ]]
}

# Return 0 when running on Apple Silicon (darwin + arm64).
is_apple_silicon_mac() {
  is_macos && [[ "$(_llm_uname_m)" == "arm64" ]]
}

# Resolve the effective host LLM backend.
#
# resolve_llm_backend [context]      context: native (default) | docker | cluster
#
# oMLX is native-only. It serves :8090 on the host directly, which is the one
# port the llm-proxy container needs under Compose — so running it alongside
# Docker means the container gets skipped and the tier routing never engages.
# Docker and cluster launchers therefore always use llamacpp: Compose routes
# through llm-proxy to the host tiers, and k8s runs llama.cpp as an in-cluster
# pod. Only ./run.sh, which has no container competing for :8090, gets oMLX.
#
# Honors explicit LLM_BACKEND, except that omlx/mlx outside the native context
# are downgraded with a warning rather than silently breaking the port bind.
resolve_llm_backend() {
  local context="${1:-native}"
  local requested="${LLM_BACKEND:-}"
  local effective=""
  LLM_BACKEND_RESOLVE_WARN=""

  if [[ -z "$requested" ]]; then
    if [[ "$context" == "native" ]] && is_apple_silicon_mac; then
      effective="omlx"
    else
      effective="llamacpp"
    fi
  else
    effective="$requested"
    case "$effective" in
      omlx|mlx)
        if [[ "$context" != "native" ]]; then
          LLM_BACKEND_RESOLVE_WARN="LLM_BACKEND=${effective} is native-only (./run.sh) — using llamacpp for the ${context} launcher"
          effective="llamacpp"
        elif [[ "$effective" == "omlx" ]] && ! is_apple_silicon_mac; then
          if is_macos; then
            LLM_BACKEND_RESOLVE_WARN="LLM_BACKEND=omlx requires Apple Silicon — using llamacpp"
          else
            LLM_BACKEND_RESOLVE_WARN="LLM_BACKEND=omlx requires macOS Apple Silicon — using llamacpp"
          fi
          effective="llamacpp"
        elif [[ "$effective" == "mlx" ]] && ! is_macos; then
          LLM_BACKEND_RESOLVE_WARN="LLM_BACKEND=mlx requires macOS — using llamacpp"
          effective="llamacpp"
        fi
        ;;
      llamacpp|*)
        # Explicit llamacpp or unknown values pass through unchanged.
        ;;
    esac
  fi

  RESOLVED_LLM_BACKEND="$effective"
  export RESOLVED_LLM_BACKEND
  printf '%s' "$effective"
}
