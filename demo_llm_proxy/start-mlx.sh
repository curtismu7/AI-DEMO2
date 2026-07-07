#!/bin/bash
# start-mlx.sh — Apple mlx-lm fallback backend on :8090 (LLM_BACKEND=mlx)
#
# Serves OpenAI-compatible /v1 on :8090 so BFF + agent-service need no URL changes.
# Uses a symlink alias-farm so LLAMACPP_MODEL ids (phi-4-mini-instruct, gpt-oss-20b)
# resolve to local MLX model dirs under ~/.omlx/models/.
#
# Usage: bash demo_llm_proxy/start-mlx.sh [start|stop|status]
#
# Prerequisites:
#   bash demo_llm_proxy/setup-mlx-venv.sh
#   bash demo_llm_proxy/download-omlx-models.sh fetch

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${MLX_VENV_DIR:-$SCRIPT_DIR/.mlx-venv}"
MLX_PORT="${MLX_PORT:-8090}"
MLX_MODEL_DIR="${MLX_MODEL_DIR:-$HOME/.omlx/models}"
MLX_ALIAS_DIR="${MLX_ALIAS_DIR:-$HOME/.omlx/alias-farm}"
MLX_LOG_DIR="${MLX_LOG_DIR:-/tmp/mlx-models}"
PID_FILE="${MLX_LOG_DIR}/mlx-${MLX_PORT}.pid"
LOG_FILE="${MLX_LOG_DIR}/mlx-${MLX_PORT}.log"

mkdir -p "$MLX_MODEL_DIR" "$MLX_ALIAS_DIR" "$MLX_LOG_DIR"

mlx_url() { echo "http://127.0.0.1:${MLX_PORT}"; }

mlx_ready() {
  curl -sf --max-time 3 "$(mlx_url)/health" >/dev/null 2>&1 \
    || curl -sf --max-time 3 "$(mlx_url)/v1/models" >/dev/null 2>&1
}

# mlx_lm.server resolves request model ids as HF repo ids or paths relative to cwd.
# Symlink demo aliases to the shared oMLX model dirs (no duplicate downloads).
ensure_alias_farm() {
  local phi_dir="${MLX_MODEL_DIR}/Phi-4-mini-instruct-4bit"
  local oss_dir="${MLX_MODEL_DIR}/gpt-oss-20b-MXFP4-Q4"
  if [[ ! -d "$phi_dir" || ! -f "$phi_dir/config.json" ]]; then
    echo "❌ Missing ${phi_dir} — run: bash demo_llm_proxy/download-omlx-models.sh fetch"
    exit 1
  fi
  if [[ ! -d "$oss_dir" || ! -f "$oss_dir/config.json" ]]; then
    echo "❌ Missing ${oss_dir} — run: bash demo_llm_proxy/download-omlx-models.sh fetch"
    exit 1
  fi
  ln -sfn "$phi_dir" "${MLX_ALIAS_DIR}/phi-4-mini-instruct"
  ln -sfn "$oss_dir" "${MLX_ALIAS_DIR}/gpt-oss-20b"
  # HF repo ids (if a client sends the full mlx-community path)
  ln -sfn "$phi_dir" "${MLX_ALIAS_DIR}/mlx-community/Phi-4-mini-instruct-4bit" 2>/dev/null || {
    mkdir -p "${MLX_ALIAS_DIR}/mlx-community"
    ln -sfn "$phi_dir" "${MLX_ALIAS_DIR}/mlx-community/Phi-4-mini-instruct-4bit"
  }
  ln -sfn "$oss_dir" "${MLX_ALIAS_DIR}/mlx-community/gpt-oss-20b-MXFP4-Q4" 2>/dev/null || {
    mkdir -p "${MLX_ALIAS_DIR}/mlx-community"
    ln -sfn "$oss_dir" "${MLX_ALIAS_DIR}/mlx-community/gpt-oss-20b-MXFP4-Q4"
  }
}

# Stop demo llama.cpp / oMLX stack pieces that would shadow :8090 or waste RAM.
stop_competing_stack() {
  bash "${SCRIPT_DIR}/start-omlx.sh" stop 2>/dev/null || true
  bash "${SCRIPT_DIR}/start-local-models.sh" stop 2>/dev/null || true
  if [[ -f /tmp/demo-tier-manager.pid ]]; then
    kill "$(cat /tmp/demo-tier-manager.pid)" 2>/dev/null || true
    rm -f /tmp/demo-tier-manager.pid
  fi
  if [[ -f /tmp/demo-llm-proxy.pid ]]; then
    kill "$(cat /tmp/demo-llm-proxy.pid)" 2>/dev/null || true
    rm -f /tmp/demo-llm-proxy.pid
  fi
  local pids
  pids=$(lsof -nP -iTCP:"${MLX_PORT}" -sTCP:LISTEN 2>/dev/null | awk '$1 ~ /^(llama|omlx|Python)/ {print $2}' | sort -u) || true
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
  fi
}

start_mlx() {
  if [[ "$(uname)" != "Darwin" ]]; then
    echo "❌ mlx-lm backend requires macOS + Apple Silicon"
    exit 1
  fi

  local server_bin="$VENV_DIR/bin/mlx_lm.server"
  if [[ ! -x "$server_bin" ]]; then
    echo "❌ mlx-lm venv not found — run: bash demo_llm_proxy/setup-mlx-venv.sh"
    exit 1
  fi

  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid=$(<"$PID_FILE")
    if kill -0 "$old_pid" 2>/dev/null && mlx_ready; then
      echo "✅ mlx-lm already serving :${MLX_PORT} (PID ${old_pid})"
      return 0
    fi
    rm -f "$PID_FILE"
  fi

  if mlx_ready; then
    echo "✅ mlx-lm already reachable on :${MLX_PORT}"
    return 0
  fi

  ensure_alias_farm
  stop_competing_stack

  echo "🚀 Starting mlx-lm on :${MLX_PORT} (alias-farm: ${MLX_ALIAS_DIR})"

  # cwd = alias farm so per-request model ids resolve to symlinked dirs.
  (
    cd "$MLX_ALIAS_DIR"
    nohup "$server_bin" \
      --model phi-4-mini-instruct \
      --host 0.0.0.0 \
      --port "$MLX_PORT" \
      --max-tokens 4096 \
      --prompt-cache-size 4 \
      --prompt-cache-bytes 4G \
      >"$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  )

  local new_pid
  new_pid=$(<"$PID_FILE")
  local timeout=180
  while [[ $timeout -gt 0 ]]; do
    if mlx_ready; then
      echo "✅ mlx-lm ready on :${MLX_PORT} (LLM_BACKEND=mlx)"
      echo "   Aliases: phi-4-mini-instruct, gpt-oss-20b"
      return 0
    fi
    if ! kill -0 "$new_pid" 2>/dev/null; then
      echo "❌ mlx-lm exited early — see ${LOG_FILE}"
      rm -f "$PID_FILE"
      return 1
    fi
    sleep 1
    ((timeout--)) || true
  done

  echo "❌ mlx-lm did not become ready — see ${LOG_FILE}"
  return 1
}

stop_mlx() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(<"$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "⏹️  mlx-lm stopped (PID ${pid})"
    fi
    rm -f "$PID_FILE"
  fi
}

status_mlx() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔷 mlx-lm backend (LLM_BACKEND=mlx)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  URL:        $(mlx_url)/v1"
  echo "  Alias farm: ${MLX_ALIAS_DIR}"
  echo "  Models:     ${MLX_MODEL_DIR}"
  echo ""
  if mlx_ready; then
    echo "  ✅ Reachable"
    if [[ -f "$PID_FILE" ]] && kill -0 "$(<"$PID_FILE")" 2>/dev/null; then
      echo "  PID: $(<"$PID_FILE")"
    fi
    curl -sf "$(mlx_url)/v1/models" 2>/dev/null | head -c 500 || true
    echo ""
  else
    echo "  ⚫ Not running"
  fi
  echo ""
  echo "  Log: ${LOG_FILE}"
}

ACTION="${1:-start}"
case "$ACTION" in
  start)  start_mlx ;;
  stop)   stop_mlx ;;
  status) status_mlx ;;
  *)
    echo "Usage: $0 [start|stop|status]"
    exit 1
    ;;
esac
