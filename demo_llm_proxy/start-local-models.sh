#!/bin/bash
# start-local-models.sh — start 5 local llama-server instances for the LLM proxy
#
# Runs 5 separate llama-server processes in background on ports 8091-8096.
# Call this BEFORE starting the docker-compose stack.
#
# Usage: bash demo_llm_proxy/start-local-models.sh [start|stop|status]

set -e

MODELS_DIR="/Users/cmuir/models"
LOG_DIR="/tmp/llama-models"
mkdir -p "$LOG_DIR"

# Model configuration: (port, name, model_file, threads, extra llama-server args)
# gpt-oss needs --jinja (harmony chat template, enables tool calls); the default
# reasoning-format (auto) parses reasoning into reasoning_content so plain chat
# clients get only the final answer in content.
# NOTE: :8095 is skipped — the mcp-code-search container publishes it.
declare -a MODELS=(
  "8091:Tier1:gemma-3-4b-it-qat-Q4_0.gguf:4:"
  "8092:Tier2:gemma-4-12B-it-qat-UD-Q4_K_XL.gguf:4:"
  "8093:Tier3:starcoder2-15b-instruct-v0.1-Q4_K_M.gguf:6:"
  "8094:Tier4:gemma-4-12b-it-UD-Q4_K_XL.gguf:8:"
  "8096:Tier5:gpt-oss-20b-mxfp4.gguf:6:--jinja"
)

# Helper functions
start_model() {
  local config="$1"
  IFS=':' read -r port tier model threads extra <<< "$config"

  local model_path="$MODELS_DIR/$model"
  if [ ! -f "$model_path" ]; then
    echo "❌ $tier: Model not found: $model_path"
    return 1
  fi

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
    --ctx-size 4096 \
    $extra \
    >"$log_file" 2>&1 &

  local new_pid=$!
  echo "$new_pid" > "$pid_file"

  # Wait for server to be ready
  local timeout=30
  while [ $timeout -gt 0 ]; do
    if curl -s "http://localhost:$port/health" >/dev/null 2>&1; then
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
    echo "🔷 Starting 5-tier LLM proxy backend (local llama-server instances)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    failed=0
    for model in "${MODELS[@]}"; do
      start_model "$model" || ((failed++))
    done
    echo ""
    if [ $failed -eq 0 ]; then
      echo "✅ All ${#MODELS[@]} models started successfully!"
      echo "   Proxy will route to these instances on ports 8091-8096"
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
    echo "Usage: $0 [start|stop|status]"
    exit 1
    ;;
esac
