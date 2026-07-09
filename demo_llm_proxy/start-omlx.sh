#!/bin/bash
# start-omlx.sh — optional Mac-native LLM backend (oMLX on Apple Silicon)
#
# Serves OpenAI-compatible /v1 on :8090 so BFF + agent-service need no URL changes.
# Use when LLM_BACKEND=omlx; Docker/K8s keep llama.cpp.
#
# Usage: bash demo_llm_proxy/start-omlx.sh [start|stop|status]
#
# Prerequisites:
#   brew tap jundot/omlx https://github.com/jundot/omlx
#   brew trust jundot/omlx   # required on Homebrew 6.0+
#   brew install omlx
#   bash demo_llm_proxy/download-omlx-models.sh fetch

set -euo pipefail

OMLX_PORT="${OMLX_PORT:-8090}"
OMLX_MODEL_DIR="${OMLX_MODEL_DIR:-$HOME/.omlx/models}"
OMLX_SSD_CACHE_DIR="${OMLX_SSD_CACHE_DIR:-$HOME/.omlx/cache}"
OMLX_LOG_DIR="${OMLX_LOG_DIR:-/tmp/omlx-models}"
PID_FILE="${OMLX_LOG_DIR}/omlx-${OMLX_PORT}.pid"
LOG_FILE="${OMLX_LOG_DIR}/omlx-${OMLX_PORT}.log"

mkdir -p "$OMLX_MODEL_DIR" "$OMLX_SSD_CACHE_DIR" "$OMLX_LOG_DIR"

omlx_url() { echo "http://127.0.0.1:${OMLX_PORT}"; }

omlx_ready() {
  curl -sf --max-time 3 "$(omlx_url)/v1/models" >/dev/null 2>&1
}

# Homebrew oMLX 0.4.4 ships mlx-lm + transformers 5.13 with a known import bug.
# Apply the upstream one-line fix when needed (harmless if already patched).
patch_omlx_transformers_compat() {
  local tu
  tu="$(ls "$(brew --prefix omlx 2>/dev/null)"/libexec/lib/python*/site-packages/mlx_lm/tokenizer_utils.py 2>/dev/null | head -1)" || return 0
  [[ -f "$tu" ]] || return 0
  if grep -q 'AutoTokenizer.register("NewlineTokenizer"' "$tu" 2>/dev/null; then
    sed -i '' 's/AutoTokenizer.register("NewlineTokenizer", fast_tokenizer_class=NewlineTokenizer)/AutoTokenizer.register(NewlineTokenizer, fast_tokenizer_class=NewlineTokenizer)/' "$tu"
    echo "  patched mlx-lm tokenizer_utils.py for transformers 5.13"
  fi
}

# Stop demo llama.cpp stack pieces that would shadow :8090 or waste RAM.
stop_llamacpp_stack() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  bash "${script_dir}/start-local-models.sh" stop 2>/dev/null || true
  if [[ -f /tmp/demo-tier-manager.pid ]]; then
    kill "$(cat /tmp/demo-tier-manager.pid)" 2>/dev/null || true
    rm -f /tmp/demo-tier-manager.pid
  fi
  if [[ -f /tmp/demo-llm-proxy.pid ]]; then
    kill "$(cat /tmp/demo-llm-proxy.pid)" 2>/dev/null || true
    rm -f /tmp/demo-llm-proxy.pid
  fi
  # Legacy: raw llama-server squatting :8090
  local pids
  pids=$(lsof -nP -iTCP:"${OMLX_PORT}" -sTCP:LISTEN 2>/dev/null | awk '$1 ~ /^llama/ {print $2}' | sort -u) || true
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
  fi
}

start_omlx() {
  if [[ "$(uname)" != "Darwin" ]]; then
    echo "❌ oMLX requires macOS + Apple Silicon"
    exit 1
  fi
  if ! command -v omlx >/dev/null 2>&1; then
    echo "❌ omlx CLI not found"
    echo "   brew tap jundot/omlx https://github.com/jundot/omlx"
    echo "   brew install omlx"
    exit 1
  fi

  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid=$(<"$PID_FILE")
    if kill -0 "$old_pid" 2>/dev/null && omlx_ready; then
      echo "✅ oMLX already serving :${OMLX_PORT} (PID ${old_pid})"
      return 0
    fi
    rm -f "$PID_FILE"
  fi

  if omlx_ready; then
    echo "✅ oMLX already reachable on :${OMLX_PORT} (externally managed — brew services or menu bar app)"
    return 0
  fi

  stop_llamacpp_stack

  patch_omlx_transformers_compat

  echo "🚀 Starting oMLX on :${OMLX_PORT} (model-dir: ${OMLX_MODEL_DIR})"

  # Foreground serve in background so run.sh can track the PID.
  # CLI flags override ~/.omlx/settings.json per oMLX docs.
  nohup omlx serve \
    --model-dir "$OMLX_MODEL_DIR" \
    --paged-ssd-cache-dir "$OMLX_SSD_CACHE_DIR" \
    --max-concurrent-requests 16 \
    --port "$OMLX_PORT" \
    >"$LOG_FILE" 2>&1 &

  local new_pid=$!
  echo "$new_pid" > "$PID_FILE"

  local timeout=180
  while [[ $timeout -gt 0 ]]; do
    if omlx_ready; then
      echo "✅ oMLX ready on :${OMLX_PORT}"
      echo "   Admin: $(omlx_url)/admin"
      echo "   Pin phi-4-mini for BFF; alias ids to match LLAMACPP_MODEL"
      return 0
    fi
    if ! kill -0 "$new_pid" 2>/dev/null; then
      echo "❌ oMLX exited early — see ${LOG_FILE}"
      rm -f "$PID_FILE"
      return 1
    fi
    sleep 1
    ((timeout--)) || true
  done

  echo "❌ oMLX did not become ready within 180s — see ${LOG_FILE}"
  return 1
}

stop_omlx() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(<"$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "⏹️  oMLX stopped (PID ${pid})"
    fi
    rm -f "$PID_FILE"
  fi
  # Also stop brew-managed instance if user started via `omlx start`
  if command -v omlx >/dev/null 2>&1; then
    omlx stop 2>/dev/null || true
  fi
}

status_omlx() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔷 oMLX backend (LLM_BACKEND=omlx)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  URL:       $(omlx_url)/v1"
  echo "  Models:    ${OMLX_MODEL_DIR}"
  echo "  SSD cache: ${OMLX_SSD_CACHE_DIR}"
  echo ""
  if omlx_ready; then
    echo "  ✅ Reachable"
    if [[ -f "$PID_FILE" ]] && kill -0 "$(<"$PID_FILE")" 2>/dev/null; then
      echo "  PID: $(<"$PID_FILE") (started by this script)"
    else
      echo "  PID: external (brew services / menu bar app)"
    fi
    curl -sf "$(omlx_url)/v1/models" 2>/dev/null | head -c 500 || true
    echo ""
  else
    echo "  ⚫ Not running"
  fi
  echo ""
  echo "  Log: ${LOG_FILE}"
}

ACTION="${1:-start}"
case "$ACTION" in
  start)   start_omlx ;;
  stop)    stop_omlx ;;
  status)  status_omlx ;;
  *)
    echo "Usage: $0 [start|stop|status]"
    exit 1
    ;;
esac
