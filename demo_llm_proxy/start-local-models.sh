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
# Demo-oriented defaults: smaller ctx than 16k loads faster and uses less RAM;
# prompt cache + slot similarity keep agent system-prefix hits warm across turns.
CTX_SIZE="${LLM_CTX_SIZE:-8192}"
# Per-tier override. gpt-oss (:8096) backs Code Explorer, whose retrieved source
# alone can reach ~4k tokens (retrieve.py _CONTEXT_CAP is 14000 CHARS); at 8192
# the prompt hit 8479 tokens and llama-server refused it with
# exceed_context_size_error before any answer could be generated. 16384 leaves
# room for the prompt plus LLAMACPP_MAX_TOKENS of output. :8091 keeps the
# smaller window on purpose — it loads faster and uses less RAM.
CTX_SIZE_8096="${LLM_CTX_SIZE_8096:-16384}"
N_GPU_LAYERS="${LLM_N_GPU_LAYERS:-33}"
N_PARALLEL="${LLM_N_PARALLEL:-1}"
SLOT_SIM="${LLM_SLOT_PROMPT_SIMILARITY:-0.50}"
# Docker/OrbStack reaches host tiers via host.docker.internal — bind all
# interfaces (not 127.0.0.1). Override with LLAMA_ARG_HOST=127.0.0.1 for local-only.
LLAMA_LISTEN_HOST="${LLAMA_ARG_HOST:-0.0.0.0}"
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

  # Context window is per-tier (see CTX_SIZE_8096 above), not one global value.
  # `if` rather than `[ … ] && …`: this script runs under `set -e`, where a
  # bare AND-list that tests false returns non-zero and aborts the run — which
  # would kill tier startup for every port that is not 8096, :8091 included.
  local ctx_size="$CTX_SIZE"
  if [ "$port" = "8096" ]; then
    ctx_size="$CTX_SIZE_8096"
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
  local -a cmd=(
    llama-server
    -m "$model_path"
    --host "$LLAMA_LISTEN_HOST"
    --port "$port"
    --threads "$threads"
    --n-gpu-layers "$N_GPU_LAYERS"
    --ctx-size "$ctx_size"
    --parallel "$N_PARALLEL"
    --cache-prompt
    --slot-prompt-similarity "$SLOT_SIM"
  )
  # shellcheck disable=SC2206  # deliberate word-split, see above
  cmd+=( $extra )

  # Detach into a NEW SESSION, or launchd kills the model the moment its
  # launcher exits.
  #
  # com.ai-demo.llama-models runs supervise-swap.sh as a one-shot (RunAtLoad +
  # StartInterval 300, no KeepAlive) and the plist does not set
  # AbandonProcessGroup, so when the script returns launchd reaps the whole
  # process group — including a plain `llama-server ... &` child. Measured
  # 2026-08-17: the launcher logged "Starting" 148 times and "already loaded"
  # ZERO times, i.e. it never once found a tier alive from its own previous run.
  # gpt-oss-20b suffered worst — an 11GB cold load takes ~150s, so it was killed
  # almost as soon as it reported ready, and the proxy's recurring
  # "gpt-oss-20b did not become healthy within 180s" was the visible symptom.
  #
  # nohup and disown do NOT fix this: nohup only ignores SIGHUP and disown only
  # edits the shell's job table, while launchd signals the process GROUP. A new
  # session is required. macOS ships no setsid(1), so perl's POSIX::setsid is
  # the portable equivalent; exec keeps the PID, so $! below still names the
  # real llama-server for the pid file.
  if command -v perl >/dev/null 2>&1; then
    perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die "exec failed: $!\n"' \
      "${cmd[@]}" >"$log_file" 2>&1 &
  else
    echo "⚠️  perl not found — starting $tier without session detach; it will not"
    echo "    survive its launcher under launchd (see comment above)."
    "${cmd[@]}" >"$log_file" 2>&1 &
  fi

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
  ensure-set)
    # ensure-set <port>[,<port>...] — residency primitive: keep EVERY listed tier
    # loaded and stop the rest. Swap mode's one-tier-at-a-time rule makes the BFF
    # (phi-4-mini) and the agent (gpt-oss-20b) evict each other; loading both
    # removes the swap entirely. Costs the sum of the tiers' memory.
    PORT_CSV="${2:?usage: $0 ensure-set <port>[,<port>...]}"
    IFS=',' read -r -a WANTED <<< "$PORT_CSV"

    want_port() {
      local p
      for p in "${WANTED[@]}"; do
        [ "${p// /}" = "$1" ] && return 0
      done
      return 1
    }

    # Stop first, so a tier being dropped frees its memory before we load a new one.
    for model in "${MODELS[@]}"; do
      IFS=':' read -r port _ _ _ _ <<< "$model"
      want_port "$port" || stop_model "$model"
    done

    failed=0
    for model in "${MODELS[@]}"; do
      IFS=':' read -r port _ _ _ _ <<< "$model"
      if want_port "$port"; then
        start_model "$model" || ((failed++))
      fi
    done

    if [ "$failed" -gt 0 ]; then
      echo "❌ ensure-set: $failed tier(s) failed to load"
      exit 1
    fi
    echo "✅ ensure-set: resident tiers loaded ($PORT_CSV)"
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
    echo "Usage: $0 [start|stop|status|ensure <port>|ensure-set <port,port>|ensure-available]"
    exit 1
    ;;
esac
