#!/usr/bin/env bash
# resolve-llm-backend.sh — platform-aware LLM_BACKEND resolution
#
# Apple Silicon Mac (darwin + arm64): default omlx when LLM_BACKEND is unset
# Linux / AWS / CI / Docker-on-Linux: default llamacpp; omlx/mlx are rejected
#
# Usage (source from run.sh / run-docker.sh):
#   source demo_llm_proxy/resolve-llm-backend.sh
#   resolve_llm_backend          # prints effective backend; sets RESOLVED_LLM_BACKEND
#   [[ -n "${LLM_BACKEND_RESOLVE_WARN:-}" ]] && warn "$LLM_BACKEND_RESOLVE_WARN"

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
# Honors explicit LLM_BACKEND; auto-selects omlx on Apple Silicon when unset.
resolve_llm_backend() {
  local requested="${LLM_BACKEND:-}"
  local effective=""
  LLM_BACKEND_RESOLVE_WARN=""

  if [[ -z "$requested" ]]; then
    if is_apple_silicon_mac; then
      effective="omlx"
    else
      effective="llamacpp"
    fi
  else
    effective="$requested"
    case "$effective" in
      omlx)
        if ! is_apple_silicon_mac; then
          if is_macos; then
            LLM_BACKEND_RESOLVE_WARN="LLM_BACKEND=omlx requires Apple Silicon — using llamacpp"
          else
            LLM_BACKEND_RESOLVE_WARN="LLM_BACKEND=omlx requires macOS Apple Silicon — using llamacpp"
          fi
          effective="llamacpp"
        fi
        ;;
      mlx)
        if ! is_macos; then
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
