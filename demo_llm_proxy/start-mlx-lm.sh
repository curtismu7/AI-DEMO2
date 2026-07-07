#!/bin/bash
# start-mlx-lm.sh — Apple's mlx_lm.server for the MLX demo agent mode (:8098).
#
# Serves one MLX model for agent mode "MLX (Apple)" — separate from the llama.cpp
# router (:8090) and oMLX fast path. OpenAI-compatible /v1 API.
#
# Usage: bash demo_llm_proxy/start-mlx-lm.sh [start|stop|status]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${MLX_VENV_DIR:-$SCRIPT_DIR/.mlx-venv}"
MLX_LM_PORT="${MLX_LM_PORT:-8098}"
MLX_LM_MODEL="${MLX_LM_MODEL:-mlx-community/Phi-4-mini-instruct-4bit}"
MLX_LM_LOG_DIR="${MLX_LM_LOG_DIR:-/tmp/mlx-lm-models}"
PID_FILE="${MLX_LM_LOG_DIR}/mlx-lm-${MLX_LM_PORT}.pid"
LOG_FILE="${MLX_LM_LOG_DIR}/mlx-lm-${MLX_LM_PORT}.log"

mkdir -p "$MLX_LM_LOG_DIR"

mlx_url() { echo "http://127.0.0.1:${MLX_LM_PORT}"; }

mlx_ready() {
  curl -sf --max-time 3 "$(mlx_url)/health" >/dev/null 2>&1 \
    || curl -sf --max-time 3 "$(mlx_url)/v1/models" >/dev/null 2>&1
}

resolve_model_arg() {
  local local_dir="${OMLX_MODEL_DIR:-$HOME/.omlx/models}/Phi-4-mini-instruct-4bit"
  if [[ -d "$local_dir" && -f "$local_dir/config.json" ]]; then
    echo "$local_dir"
  else
    echo "$MLX_LM_MODEL"
  fi
}

start_mlx_lm() {
  if [[ "$(uname)" != "Darwin" ]]; then
    echo "❌ mlx-lm demo server requires macOS + Apple Silicon"
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
      echo "✅ mlx-lm already serving :${MLX_LM_PORT} (PID ${old_pid})"
      return 0
    fi
    rm -f "$PID_FILE"
  fi

  if mlx_ready; then
    echo "✅ mlx-lm already reachable on :${MLX_LM_PORT}"
    return 0
  fi

  local model_arg
  model_arg="$(resolve_model_arg)"
  echo "🚀 Starting mlx-lm on :${MLX_LM_PORT} (model: ${model_arg})"

  nohup "$server_bin" \
    --model "$model_arg" \
    --host 0.0.0.0 \
    --port "$MLX_LM_PORT" \
    --max-tokens 4096 \
    --prompt-cache-size 4 \
    --prompt-cache-bytes 4G \
    >"$LOG_FILE" 2>&1 &

  local new_pid=$!
  echo "$new_pid" > "$PID_FILE"

  local timeout=180
  while [[ $timeout -gt 0 ]]; do
    if mlx_ready; then
      echo "✅ mlx-lm ready on :${MLX_LM_PORT} (MLX demo agent mode)"
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

stop_mlx_lm() {
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

status_mlx_lm() {
  echo "  URL:    $(mlx_url)/v1"
  echo "  Model:  $(resolve_model_arg)"
  if mlx_ready; then
    echo "  ✅ Reachable"
  else
    echo "  ⚫ Not running"
  fi
  echo "  Log:    ${LOG_FILE}"
}

ACTION="${1:-start}"
case "$ACTION" in
  start)  start_mlx_lm ;;
  stop)   stop_mlx_lm ;;
  status) status_mlx_lm ;;
  *)
    echo "Usage: $0 [start|stop|status]"
    exit 1
    ;;
esac
