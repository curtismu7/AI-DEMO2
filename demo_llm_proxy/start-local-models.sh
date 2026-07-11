#!/bin/bash
# start-local-models.sh — start 2 local llama-server instances for the LLM proxy
#
# Runs 2 separate llama-server processes in background on ports 8091 and 8096.
# Call this BEFORE starting the docker-compose stack.
#
# Usage: bash demo_llm_proxy/start-local-models.sh [start|stop|status]

set -e

MODELS_DIR="${MODELS_DIR:-$HOME/models}"
LOG_DIR="/tmp/llama-models"
mkdir -p "$LOG_DIR"

resolve_model_path() {
  local model="$1"
  local direct="$MODELS_DIR/$model"
  if [ -f "$direct" ]; then
    echo "$direct"
    return 0
  fi
  echo "$direct"
  return 1
}

tier_file_present() {
  resolve_model_path "$1" >/dev/null 2>&1
}

# Model configuration: (port, name, model_file, threads, extra llama-server args)
# gpt-oss needs --jinja (harmony chat template, enables tool calls); the default
# reasoning-format (auto) parses reasoning into reasoning_content so plain chat
# clients get only the final answer in content.
# NOTE: :8095 is skipped — the mcp-code-search container publishes it.
declare -a MODELS=(
  "8091:Tier1:microsoft_Phi-4-mini-instruct-Q4_K_M.gguf:4:"
  "8096:Tier5:gpt-oss-20b-mxfp4.gguf:6:--jinja"
)

# Helper functions
start_model() {
  local config="$1"
  IFS=':' read -r port tier model threads extra <<< "$config"

  local model_path
  model_path="$(resolve_model_path "$model")" || {
    echo "❌ $tier: Model not found: $MODELS_DIR/$model"
    return 1
  }

  local pid_file="$LOG_DIR/llama-$port.pid"
  local log_file="$LOG_DIR/llama-$port.log"

  # Check if already running
  if [ -f "$pid_file" ]; then
    local old_pid=$(<"$pid_file")
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "✅ $tier (port $port): Already running (PID $old_pid)"
      return 0
    fi
  fi

  echo "🚀 $tier (port $port): Starting $model on port $port..."

  # $extra is intentionally unquoted — it holds optional extra llama-server
  # flags (word-split on spaces; empty for most tiers).
  llama-server \
    -m "$model_path" \
    --port "$port" \
    --threads "$threads" \
    --n-gpu-layers 33 \
    --ctx-size 16384 \
    $extra \
    >"$log_file" 2>&1 &

  local new_pid=$!
  echo "$new_pid" > "$pid_file"

  # Wait for the model to actually be LOADED: -f makes curl fail on the 503
  # llama-server returns while still loading, so "Ready" means HTTP 200.
  # (Without -f, ensure returned early and swap-mode callers saw an unhealthy
  # tier, re-triggering swaps.) 150s covers a cold load of the 11GB gpt-oss.
  local timeout=150
  while [ $timeout -gt 0 ]; do
    if curl -sf "http://localhost:$port/health" >/dev/null 2>&1; then
      echo "✅ $tier (port $port): Ready"
      return 0
    fi
    sleep 1
    ((timeout--))
  done

  echo "❌ $tier (port $port): Failed to start (timeout)"
  return 1
}

stop_model() {
  local config="$1"
  IFS=':' read -r port tier _ _ <<< "$config"

  local pid_file="$LOG_DIR/llama-$port.pid"
  if [ -f "$pid_file" ]; then
    local pid=$(<"$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      rm "$pid_file"
      echo "⏹️  $tier (port $port): Stopped (PID $pid)"
    fi
  fi
}

status_model() {
  local config="$1"
  IFS=':' read -r port tier model _ <<< "$config"

  local pid_file="$LOG_DIR/llama-$port.pid"
  if [ -f "$pid_file" ]; then
    local pid=$(<"$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      echo "✅ $tier (port $port): Running (PID $pid) — $model"
      return 0
    else
      echo "❌ $tier (port $port): Stale PID file (PID $pid), please run 'stop'"
      return 1
    fi
  else
    echo "⚫ $tier (port $port): Not running"
    return 1
  fi
}

# Main
ACTION="${1:-start}"
case "$ACTION" in
  start)
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔷 Starting 2-tier LLM proxy backend (local llama-server instances)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    failed=0
    for model in "${MODELS[@]}"; do
      start_model "$model" || ((failed++))
    done
    echo ""
    if [ $failed -eq 0 ]; then
      echo "✅ All ${#MODELS[@]} models started successfully!"
      echo "   Proxy will route to these instances on ports 8091 and 8096"
      echo "   Start proxy with: docker compose up llm-proxy"
    else
      echo "❌ $failed model(s) failed to start"
      echo "   Logs: $LOG_DIR/llama-*.log"
      exit 1
    fi
    ;;
  stop)
    echo "Stopping all llama-server instances..."
    for model in "${MODELS[@]}"; do
      stop_model "$model"
    done
    ;;
  ensure-available)
    # Load the smallest tier whose GGUF file exists on disk (partial downloads OK).
    for model in "${MODELS[@]}"; do
      IFS=':' read -r port _ mod _ _ <<< "$model"
      if tier_file_present "$mod"; then
        echo "🔷 ensure-available: loading tier on :${port} ($mod)"
        TARGET_PORT="$port"
        found=""
        for m in "${MODELS[@]}"; do
          IFS=':' read -r p _ _ _ _ <<< "$m"
          if [ "$p" = "$TARGET_PORT" ]; then
            found="$m"
          else
            stop_model "$m"
          fi
        done
        start_model "$found"
        exit $?
      fi
    done
    echo "❌ ensure-available: no GGUF files found under $MODELS_DIR"
    echo "   Download from the demo UI (Servers → llama.cpp) or:"
    echo "   bash demo_llm_proxy/download-models.sh fetch"
    exit 1
    ;;
  ensure)
    # ensure <port> — swap-mode primitive: stop every tier EXCEPT <port>, then
    # start <port> if it isn't already running. Used by tier-manager.js so only
    # one model is loaded at a time ("smallest that does the job").
    TARGET_PORT="${2:?usage: $0 ensure <port>}"
    found=""
    for model in "${MODELS[@]}"; do
      IFS=':' read -r port _ _ _ _ <<< "$model"
      if [ "$port" = "$TARGET_PORT" ]; then
        found="$model"
      else
        stop_model "$model"
      fi
    done
    if [ -z "$found" ]; then
      echo "❌ ensure: no tier configured on port $TARGET_PORT"
      exit 1
    fi
    start_model "$found"
    ;;
  status)
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔷 LLM Proxy Backend Status"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    for model in "${MODELS[@]}"; do
      status_model "$model"
    done
    echo ""
    echo "Logs: $LOG_DIR/llama-*.log"
    ;;
  *)
    echo "Usage: $0 [start|stop|status|ensure <port>|ensure-available]"
    exit 1
    ;;
esac
