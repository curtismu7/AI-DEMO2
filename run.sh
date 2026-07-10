#!/usr/bin/env bash
# run.sh — Primary startup script for the AI Demo.
# Runs on api.ping.demo (HTTPS).
#
# Port layout:
#   Demo API Server  → https://api.ping.demo:3001
#   Demo UI          → https://api.ping.demo:4000
#   Demo MCP Server  → localhost:8080
#   LangChain Agent  → localhost:8887 (FastAPI/CodeGraph) + 8889 (chat WS) + 8881 (health/inspector)
#
# One-time setup (run once each, requires sudo for /etc/hosts):
#   echo '127.0.0.1  api.ping.demo' | sudo tee -a /etc/hosts
#   mkcert -install   # install local CA (once per machine)
#
# Usage:
#   ./run.sh              # start all services (optional: tail prompt at end if TTY)
#   ./run.sh stop         # stop all services (process trees + listeners)
#   ./run.sh restart      # stop then start
#   ./run.sh status       # live service health check
#   ./run.sh tail         # pick a log by number or 'all' (all logs at once)
#   ./run.sh tail 2       # tail UI log directly (no prompt)
#   ./run.sh tail all     # tail -f all log files together (interleaved)
#   ./run.sh test         # run full test suite
#   ./run.sh help         # show this help message
#
# Logs:
#   Log files are written to logs/ in the repo root while services are running.
#   ./run.sh tail            # interactive: pick a service by number, or type 'all'
#   ./run.sh tail all        # tail all services interleaved (Ctrl+C stops tail only)
#   ./run.sh tail 1          # tail BFF (banking-api-server) directly
#   ./run.sh tail 2          # tail UI dev server directly
#   ./run.sh tail 3          # tail MCP server directly
#   ./run.sh tail 4          # tail AI agent directly
#   cat logs/banking-api-server.log   # read a log file directly

set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/demo-terminal.sh
source "${BASEDIR}/scripts/demo-terminal.sh"
demo_init_terminal

# ── Auto-load VAULT_PASSWORD from .env files ──────────────────────────────────
# If VAULT_PASSWORD is not already set in the shell environment, try to source
# it from the root .env or demo_api_server/.env (in that order). This lets
# operators put VAULT_PASSWORD in their .env file rather than manually
# exporting it before each ./run.sh invocation.
#
# Security: these files are plaintext on disk — same risk profile as any other
# secret in .env. Only VAULT_PASSWORD is extracted; we don't source the entire
# file to avoid polluting the run.sh shell environment with unrelated vars.
if [[ -z "${VAULT_PASSWORD:-}" ]]; then
  for _env_candidate in "${BASEDIR}/.env" "${BASEDIR}/demo_api_server/.env"; do
    if [[ -f "$_env_candidate" ]]; then
      _vp=$(grep -E '^VAULT_PASSWORD=' "$_env_candidate" 2>/dev/null | head -1 | sed 's/^VAULT_PASSWORD=//' | sed 's/^"//' | sed 's/"$//' | tr -d "'" || true)
      if [[ -n "$_vp" ]]; then
        export VAULT_PASSWORD="$_vp"
        echo "[VAULT] Auto-loaded VAULT_PASSWORD from ${_env_candidate}"
        break
      fi
    fi
  done
  unset _env_candidate _vp
fi

# ── Allow localhost override via PUBLIC_APP_URL in demo_api_server/.env ──────
# If PUBLIC_APP_URL is set to a localhost URL, skip the api.ping.demo hostname,
# /etc/hosts setup, and mkcert — run plain HTTP on localhost instead.
_api_env_early="${BASEDIR}/demo_api_server/.env"
_pub_url=""
if [[ -f "$_api_env_early" ]]; then
  _pub_url=$(grep -E '^PUBLIC_APP_URL=' "$_api_env_early" 2>/dev/null | head -1 \
             | sed 's/^PUBLIC_APP_URL=//' | tr -d '"' | tr -d "'" || true)
fi
# Also honour a PUBLIC_APP_URL already exported in the shell environment.
_pub_url="${PUBLIC_APP_URL:-$_pub_url}"
unset _api_env_early

# Extract the hostname from PUBLIC_APP_URL (strips scheme and port).
_override_host=""
if [[ -n "$_pub_url" ]]; then
  _override_host=$(echo "$_pub_url" | sed -E 's|https?://([^:/]+).*|\1|')
fi

if [[ "$_override_host" == "localhost" || "$_override_host" == "127.0.0.1" ]]; then
  API_HOST="$_override_host"
  USE_HTTPS=false
else
  API_HOST="${_override_host:-api.ping.demo}"
  USE_HTTPS=true
fi
unset _override_host _pub_url

API_PORT=3001
UI_PORT=4000
JAEGER_UI_PORT=16686
JAEGER_OTLP_PORT=4317
# OpenTelemetry → local Jaeger (same as docker-compose.yml). Set on every native
# BFF launch so tracing works without editing demo_api_server/.env.
OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${JAEGER_OTLP_PORT}"
OTEL_BOOTSTRAP="${BASEDIR}/scripts/otel-instrument.js"
OTEL_NODE_OPTIONS="-r ${OTEL_BOOTSTRAP}"
OTEL_SERVICE_NAME="demo-api-server"

CERT_DIR="${BASEDIR}/certs"
# mkcert names cert files after the first SAN argument, e.g.:
#   mkcert api.ping.demo localhost 127.0.0.1  → api.ping.demo+2.pem
#   mkcert localhost 127.0.0.1               → localhost+1.pem
# We derive the expected filenames from API_HOST at runtime.
_cert_sans_count=2   # api.ping.demo + localhost + 127.0.0.1 → +2
[[ "$API_HOST" == "localhost" || "$API_HOST" == "127.0.0.1" ]] && _cert_sans_count=1
CERT_FILE="${CERT_DIR}/${API_HOST}+${_cert_sans_count}.pem"
KEY_FILE="${CERT_DIR}/${API_HOST}+${_cert_sans_count}-key.pem"
unset _cert_sans_count

# macOS default bash (3.2) does not support ${var^^}; use a helper for banners/help text.
proto_label() {
  if [[ "$USE_HTTPS" == "true" ]]; then echo "HTTPS"; else echo "HTTP"; fi
}
PROTO_LABEL="$(proto_label)"

if [[ "$USE_HTTPS" == "false" ]]; then
  # localhost mode — plain HTTP, no /etc/hosts or mkcert needed.
  API_URL="http://${API_HOST}:${API_PORT}"
  CLIENT_URL="http://${API_HOST}:${UI_PORT}"
else
  API_URL="https://${API_HOST}:${API_PORT}"
  CLIENT_URL="https://${API_HOST}:${UI_PORT}"

  # ── /etc/hosts check — auto-add if missing ─────────────────────────────────
  if ! grep -q "${API_HOST}" /etc/hosts 2>/dev/null; then
    echo "[HOSTS] Adding ${API_HOST} to /etc/hosts (requires sudo)..."
    if sudo sh -c "echo '127.0.0.1  ${API_HOST}' >> /etc/hosts" 2>/dev/null; then
      echo "[OK] /etc/hosts entry added."
    else
      echo "WARNING:  Could not add ${API_HOST} to /etc/hosts automatically."
      echo "   Ask your admin to run: echo '127.0.0.1  ${API_HOST}' | sudo tee -a /etc/hosts"
      echo "   Continuing — HTTPS URLs may not resolve in the browser until this is done."
    fi
  fi

  # ── mkcert install + SSL cert auto-generate ──────────────────────────────────
  if ! command -v mkcert &>/dev/null; then
    if command -v brew &>/dev/null; then
      echo "[SSL] Installing mkcert via Homebrew..."
      brew install mkcert 2>&1 | tail -3
    else
      echo "WARNING:  mkcert and Homebrew not found — cannot auto-install."
      echo "   Ask your admin to install: brew install mkcert && mkcert -install"
    fi
  fi

  if command -v mkcert &>/dev/null; then
    # Install root CA if not already trusted (sudo needed once per machine)
    _ca_root="$(mkcert -CAROOT 2>/dev/null)/rootCA.pem"
    if [[ ! -f "${_ca_root}" ]]; then
      echo "[SSL] Installing mkcert root CA (requires sudo)..."
      if sudo mkcert -install 2>/dev/null; then
        # Fix ownership so future mkcert calls (cert generation) run without sudo
        sudo chown -R "$(whoami)" "$(mkcert -CAROOT 2>/dev/null)" 2>/dev/null || true
        echo "[OK] mkcert root CA installed."
      else
        echo "WARNING:  Could not install mkcert root CA automatically."
        echo "   Ask your admin to run: sudo mkcert -install"
      fi
    fi

    # Generate certs if missing
    if [[ ! -f "${CERT_FILE}" ]] || [[ ! -f "${KEY_FILE}" ]]; then
      echo "[SSL] Generating SSL certs for ${API_HOST}..."
      mkdir -p "${CERT_DIR}"
      (cd "${CERT_DIR}" && mkcert "${API_HOST}" localhost 127.0.0.1)
      echo "[OK] Certs created in ${CERT_DIR}"
    fi

    # Copy mkcert root CA into certs/ so Docker nginx can verify the BFF cert
    if [[ -f "${_ca_root}" ]] && [[ ! -f "${CERT_DIR}/rootCA.pem" ]]; then
      cp "${_ca_root}" "${CERT_DIR}/rootCA.pem"
      echo "[OK] Copied mkcert root CA to ${CERT_DIR}/rootCA.pem"
    fi
  else
    if [[ ! -f "${CERT_FILE}" ]] || [[ ! -f "${KEY_FILE}" ]]; then
      echo "WARNING:  mkcert not found — falling back to HTTP."
      echo "   Ask your admin to install: brew install mkcert && mkcert -install"
      API_URL="http://${API_HOST}:${API_PORT}"
      CLIENT_URL="http://${API_HOST}:${UI_PORT}"
    fi
  fi
fi

# Derive gateway URL from the same scheme+host as the API (port 3005).
# This ensures localhost HTTP mode gets http://localhost:3005, not the old
# hardcoded https://api.ping.demo:3005 default.
_api_scheme="${API_URL%%://*}"   # "http" or "https"
GW_URL="${_api_scheme}://${API_HOST}:3005"
unset _api_scheme

# PID files — separate from start.sh so both can coexist
PID_API=/tmp/demo-api.pid
PID_MCP=/tmp/demo-mcp.pid
PID_AGENT=/tmp/demo-langchain.pid
PID_UI=/tmp/demo-ui.pid

LOG_API=/tmp/demo-api.log
LOG_UI=/tmp/demo-ui.log
LOG_MCP=/tmp/demo-mcp.log
LOG_AGENT=/tmp/demo-langchain.log
LOG_MCP_TRAFFIC=/tmp/demo-mcp-traffic.log
PID_GW=/tmp/demo-mcp-gateway.pid
LOG_GW=/tmp/demo-mcp-gateway.log
PID_AUTHZ=/tmp/demo-authz-server.pid
# LOG_AUTH is already declared below — reuse it for the authz server log
PID_HITL=/tmp/demo-hitl.pid
LOG_HITL=/tmp/demo-hitl.log
PID_AGENT_SVC=/tmp/demo-agent.pid
LOG_AGENT_SVC=/tmp/demo-agent.log
PID_INVEST=/tmp/demo-invest.pid
LOG_INVEST=/tmp/demo-invest.log
PID_MORTGAGE=/tmp/demo-mortgage.pid
LOG_MORTGAGE=/tmp/demo-mortgage.log
PID_OASDK=/tmp/demo-openai-agent.pid
LOG_OASDK=/tmp/demo-openai-agent.log
PID_MASTRA=/tmp/demo-mastra-agent.pid
LOG_MASTRA=/tmp/demo-mastra-agent.log
PID_PYDANTIC=/tmp/demo-pydantic-agent.pid
LOG_PYDANTIC=/tmp/demo-pydantic-agent.log
LOG_AUTH=/tmp/demo-authorize.log
LOG_HELIX=/tmp/demo-helix.log
LOG_PG=/tmp/demo-ping-gateway.log
LOG_JAEGER=/tmp/demo-jaeger.log
PID_LOG_JANITOR=/tmp/demo-log-janitor.pid
# Computed once — docker info is a daemon RPC (~200-500 ms); cache the result.
DOCKER_AVAILABLE=false
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  DOCKER_AVAILABLE=true
fi
# Ports managed by run.sh (Node processes + Python agents + Docker-hosted PingGateway :3036).
# Defined once and referenced by both stop_listeners_on_demo_ports and
# force_kill_listeners_on_demo_ports to avoid per-function drift.
# LangChain ports: 8887 (FastAPI/CodeGraph), 8889 (chat WS), 8881 (health)
DEMO_PORTS=(3001 4000 8080 8887 8889 8881 3005 3006 3009 8081 8082 8891 8892 8893 3036)

# Pre-create all log files so tail/log viewers work before services start.
# We TRUNCATE here (not just touch) — services that get skipped or fail to relaunch
# would otherwise leave stale errors from a prior run, which is misleading when
# debugging the current startup. Only run on `start` to keep `status`/`tail` safe.
if [[ "${1:-start}" == "start" || "${1:-start}" == "restart" || "${1:-start}" == "dev" || -z "${1:-}" ]]; then
  for _logf in "${LOG_API}" "${LOG_UI}" "${LOG_MCP}" "${LOG_AGENT}" "${LOG_MCP_TRAFFIC}" \
               "${LOG_GW}" "${LOG_HITL}" "${LOG_AGENT_SVC}" "${LOG_INVEST}" "${LOG_MORTGAGE}" "${LOG_AUTH}" \
               "${LOG_HELIX}" "${LOG_OASDK}" "${LOG_MASTRA}" "${LOG_PYDANTIC}" "${LOG_PG}"; do
    : > "${_logf}" 2>/dev/null || true
  done
else
  touch "${LOG_API}" "${LOG_UI}" "${LOG_MCP}" "${LOG_AGENT}" "${LOG_MCP_TRAFFIC}" \
        "${LOG_GW}" "${LOG_HITL}" "${LOG_AGENT_SVC}" "${LOG_INVEST}" "${LOG_MORTGAGE}" "${LOG_AUTH}" \
        "${LOG_HELIX}" "${LOG_OASDK}" "${LOG_MASTRA}" "${LOG_PYDANTIC}" 2>/dev/null || true
fi

# Terminal colors (scripts/demo-terminal.sh — used by banner, status, tail_demo_logs)
ok()   { demo_ok "$@"; }
warn() { demo_warn "$@"; }
err()  { demo_err "$@"; }

# Floor for the running Node major. Must match root package.json#engines.node
# (currently ">=20"). The runtime accepts any major at or above this floor —
# Node 20, 22, 24, future LTSes are all fine.
NODE_MIN_VERSION=20

# ── Helpers ──────────────────────────────────────────────────────────────────
_node_major() {
  command -v node >/dev/null 2>&1 || { echo ''; return; }
  node -e "process.stdout.write(process.version.replace('v','').split('.')[0])" 2>/dev/null
}

# If `node` is missing or on the wrong major, try to source nvm into THIS shell
# and `nvm use` the required major. This rescues users whose ~/.zshrc doesn't
# auto-load nvm — they'd otherwise see "command not found: nvm" before they ever
# get a chance to run our preflight.
ensure_node_runtime() {
  local current
  current="$(_node_major)"
  # Pass when current Node major is at or above the floor (20+). Node 22, 24,
  # future LTSes all work; we only need to act when current is missing or below.
  if [[ -n "${current}" ]] && [[ "${current}" -ge "${NODE_MIN_VERSION}" ]] 2>/dev/null; then
    return 0
  fi

  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "${nvm_dir}/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    \. "${nvm_dir}/nvm.sh"
    if command -v nvm >/dev/null 2>&1; then
      if nvm use "${NODE_MIN_VERSION}" >/dev/null 2>&1; then
        ok "Loaded Node $(node --version) via nvm (was ${current:-missing})"
        return 0
      fi
    fi
  fi

  if [[ -z "${current}" ]]; then
    err "Node.js is not on PATH in this shell."
  else
    err "Node ${NODE_MIN_VERSION}+ required, but this shell is using Node v${current}."
  fi
  echo ""
  echo "  Fix (zsh/bash) — load nvm into this shell, then install/select Node ${NODE_MIN_VERSION} or newer:"
  echo "    export NVM_DIR=\"\$HOME/.nvm\""
  echo "    [ -s \"\$NVM_DIR/nvm.sh\" ] && \\. \"\$NVM_DIR/nvm.sh\""
  echo "    nvm install ${NODE_MIN_VERSION} && nvm use ${NODE_MIN_VERSION}"
  echo ""
  echo "  Persist for future shells: append the two export/source lines above to"
  echo "    ~/.zshrc (zsh)   or   ~/.bashrc (bash)"
  echo ""
  echo "  No nvm yet? Install: https://github.com/nvm-sh/nvm#installing-and-updating"
  echo ""
  echo "  Then re-run from the demo repo:  ./run.sh"
  exit 1
}

# Check if a TCP port is listening locally
port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1
}

# ── Pre-flight checks ───────────────────────────────────────────────────────
preflight_checks() {
  echo ""
  echo -e "${WHITE}${BOLD}  PRE-FLIGHT CHECKS${RESET}"

  # Node.js — ensure_node_runtime will source nvm and switch majors if needed,
  # exiting with detailed guidance if it can't recover.
  ensure_node_runtime
  ok "Node.js $(node --version)"

  # npm
  if ! command -v npm >/dev/null 2>&1; then
    err "npm is not installed"
    exit 1
  fi
  ok "npm $(npm --version)"

  # .env files
  if [[ ! -f "${BASEDIR}/demo_api_server/.env" ]]; then
    warn "demo_api_server/.env not found — copy env.example and fill in PingOne credentials"
  else
    ok "demo_api_server/.env exists"
  fi

  # Port conflicts (check for non-Banking listeners)
  for port in "${API_PORT}" "${UI_PORT}" 8080 8887 8889 8881; do
    if port_listening "${port}"; then
      warn "Port ${port} is already in use (will be stopped before start)"
    fi
  done

  # Local LLM (NL intent fallback + agent reasoning) — optional, local-only.
  # If LLAMACPP_BASE_URL points to a remote host we skip the local start attempt
  # and just verify reachability. If unset, default to localhost:8090.
  #
  # LLM_BACKEND selects the host LLM backend (platform-aware default via resolve-llm-backend.sh):
  #   unset    — omlx on Apple Silicon Mac; llamacpp elsewhere
  #   llamacpp — 2-tier llama.cpp proxy (router :8090 → tiers :8091/:8096)
  #   omlx     — oMLX on :8090 (Apple Silicon only; see demo_llm_proxy/start-omlx.sh)
  #   mlx      — Apple mlx-lm on :8090 (macOS fallback; see demo_llm_proxy/start-mlx.sh)
  #
  # Architecture note (llamacpp): :8090 is the 2-tier LLM proxy (router.js).
  # It classifies each request and routes it to a llama-server backend on
  # :8091 (small) or :8096 (big), managed by demo_llm_proxy/start-local-models.sh
  # (GGUFs verified by demo_llm_proxy/download-models.sh). NEVER bind a raw
  # llama-server straight onto :8090 — the proxy owns that port and exposes the
  # same OpenAI-compatible /v1 API the services expect. Both the router and the
  # tiers bind 0.0.0.0, so Docker/k8s containers can reach them via
  # host.docker.internal.
  #
  # LLAMACPP_BASE_URL is the ORIGIN only (no /v1 suffix); default http://localhost:8090
  # (8090 avoids the MCP server's :8080).
  # shellcheck source=demo_llm_proxy/resolve-llm-backend.sh
  source "${BASEDIR}/demo_llm_proxy/resolve-llm-backend.sh"
  local llm_backend
  llm_backend="$(resolve_llm_backend)"
  if [[ -n "${LLM_BACKEND_RESOLVE_WARN:-}" ]]; then
    warn "${LLM_BACKEND_RESOLVE_WARN}"
  elif [[ -z "${LLM_BACKEND:-}" && "$llm_backend" == "omlx" ]]; then
    ok "Apple Silicon Mac — defaulting to oMLX (override: LLM_BACKEND=llamacpp)"
  fi
  local llamacpp_model="${LLAMACPP_MODEL:-phi-4-mini-instruct}"
  local llamacpp_base="${LLAMACPP_BASE_URL:-http://localhost:8090}"
  # Extract host and port from the URL (handles http://host:port and http://host)
  local llamacpp_host llamacpp_port
  llamacpp_host=$(echo "$llamacpp_base" | sed -E 's|https?://([^:/]+).*|\1|')
  llamacpp_port=$(echo "$llamacpp_base" | sed -E 's|https?://[^:]+:([0-9]+).*|\1|')
  [[ "$llamacpp_port" == "$llamacpp_base" ]] && llamacpp_port="8090"  # sed produced no match → default

  _local_llm_ready() {
    local port="${1:-8090}"
    curl -sf --max-time 3 "http://127.0.0.1:${port}/health" >/dev/null 2>&1 \
      || curl -sf --max-time 3 "http://127.0.0.1:${port}/v1/models" >/dev/null 2>&1
  }

  # Start the local LLM proxy stack in SWAP MODE: the tier-manager daemon
  # (:8097) + only the smallest tier, then the smart router on :8090 if nothing
  # healthy is already serving it (e.g. the llm-proxy container in docker mode).
  # The router asks the manager to swap up when a request needs a bigger model
  # and decays back to the smallest tier when idle — one model loaded at a time.
  _start_llm_proxy_stack() {
    if ! curl -sf --max-time 2 http://127.0.0.1:8097/health >/dev/null 2>&1; then
      nohup node "${BASEDIR}/demo_llm_proxy/tier-manager.js" > /tmp/demo-tier-manager.log 2>&1 &
      echo $! > /tmp/demo-tier-manager.pid
    fi
    bash "${BASEDIR}/demo_llm_proxy/start-local-models.sh" ensure-available || {
      warn "no local GGUF tiers found — download from demo UI or: bash demo_llm_proxy/download-models.sh fetch (logs: /tmp/llama-models/)"
      return 1
    }
    if ! _local_llm_ready 8090; then
      LLAMA_HOST=127.0.0.1 LLM_PROXY_PORT=8090 nohup node "${BASEDIR}/demo_llm_proxy/router.js" > /tmp/demo-llm-proxy.log 2>&1 &
      echo $! > /tmp/demo-llm-proxy.pid
    fi
    local _w=0
    while [[ $_w -lt 30 ]]; do
      _local_llm_ready 8090 && return 0
      sleep 1; (( _w++ )) || true
    done
    return 1
  }

  _start_mlx_stack() {
    if ! is_macos; then
      warn "LLM_BACKEND=mlx requires macOS — falling back to llama.cpp"
      _start_llm_proxy_stack
      return $?
    fi
    bash "${BASEDIR}/demo_llm_proxy/start-mlx.sh" start
  }

  _start_omlx_stack() {
    if ! is_apple_silicon_mac; then
      warn "oMLX requires Apple Silicon Mac — falling back to llama.cpp"
      _start_llm_proxy_stack
      return $?
    fi
    if ! command -v omlx >/dev/null 2>&1; then
      warn "omlx not found — brew tap jundot/omlx && brew install omlx"
      warn "  models: bash demo_llm_proxy/download-omlx-models.sh fetch"
      warn "  falling back to llama.cpp tiers"
      _start_llm_proxy_stack
      return $?
    fi
    bash "${BASEDIR}/demo_llm_proxy/start-omlx.sh" start
  }

  if [[ "$llamacpp_host" != "localhost" && "$llamacpp_host" != "127.0.0.1" ]]; then
    # Remote LLM — just check reachability, never try to start locally
    if curl -sf --max-time 3 "${llamacpp_base}/health" >/dev/null 2>&1 \
       || curl -sf --max-time 3 "${llamacpp_base}/v1/models" >/dev/null 2>&1; then
      ok "local LLM reachable at ${llamacpp_base} — model: ${llamacpp_model}"
    else
      warn "local LLM at ${llamacpp_base} not reachable — NL fallback may be disabled"
    fi
  elif _local_llm_ready "${llamacpp_port}"; then
    if [[ "$llm_backend" == "mlx" ]]; then
      ok "mlx-lm already serving :${llamacpp_port}"
    elif [[ "$llm_backend" == "omlx" ]]; then
      ok "oMLX already serving :${llamacpp_port}"
    else
      ok "LLM proxy already serving :${llamacpp_port} (2-tier router)"
    fi
  elif [[ "$llm_backend" == "mlx" ]]; then
    echo -e "  ${CYAN}[SPIN]${RESET}  Starting mlx-lm on :${llamacpp_port}…"
    if _start_mlx_stack; then
      ok "mlx-lm ready on :${llamacpp_port}"
    else
      warn "mlx-lm did not become ready — bash demo_llm_proxy/setup-mlx-venv.sh"
    fi
  elif [[ "$llm_backend" == "omlx" ]]; then
    echo -e "  ${CYAN}[SPIN]${RESET}  Starting oMLX on :${llamacpp_port}…"
    if _start_omlx_stack; then
      ok "oMLX ready on :${llamacpp_port}"
    else
      warn "oMLX did not become ready — check /tmp/omlx-models/ and demo_llm_proxy/start-omlx.sh"
      if [[ -z "${LLM_BACKEND:-}" ]]; then
        echo -e "  ${CYAN}[SPIN]${RESET}  Falling back to llama.cpp proxy stack…"
        _start_llm_proxy_stack \
          && ok "LLM proxy ready on :8090 (oMLX auto-fallback)" \
          || warn "LLM proxy fallback did not become ready"
      fi
    fi
  elif ! command -v llama-server >/dev/null 2>&1; then
    warn "llama-server not found — NL fallback LLM disabled."
    # Only offer interactive install when stdin is a real TTY (i.e. the user
    # launched run.sh directly). Suppress the prompt during bootstrap restarts
    # or any non-interactive invocation — just print the install hint.
    if [[ -t 0 ]]; then
      local _answer=""
      read -r -p "  Install llama.cpp now for NL intent routing? [Y/n] " _answer </dev/tty 2>/dev/null || true
      [[ -z "$_answer" ]] && _answer="y"
      case "$_answer" in
        y|Y|yes|YES)
          if [[ "$(uname)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
            echo "  Installing llama.cpp via Homebrew..."
            brew install llama.cpp --quiet && echo "  [OK] llama.cpp installed." \
              || { warn "brew install llama.cpp failed — build from https://github.com/ggml-org/llama.cpp"; }
          else
            warn "Automatic install unavailable on this platform — build from https://github.com/ggml-org/llama.cpp"
          fi
          if command -v llama-server >/dev/null 2>&1; then
            echo -e "  ${CYAN}[SPIN]${RESET}  Starting LLM proxy stack (tiers :8091 + :8096 + router :8090)…"
            _start_llm_proxy_stack \
              && ok "LLM proxy ready on :8090 (routing tiers 8091 + 8096)" \
              || warn "LLM proxy did not become ready — check /tmp/demo-llm-proxy.log and /tmp/llama-models/"
          fi
          ;;
        *) warn "Skipping llama.cpp — NL fallback disabled. Install later: https://github.com/ggml-org/llama.cpp  (or: LLM_BACKEND=omlx on Mac)" ;;
      esac
    else
      warn "  Install llama.cpp: https://github.com/ggml-org/llama.cpp  (or: brew install llama.cpp; Mac: LLM_BACKEND=omlx)"
    fi
  else
    echo -e "  ${CYAN}[SPIN]${RESET}  Starting LLM proxy stack (tiers :8091 + :8096 + router :8090)…"
    if _start_llm_proxy_stack; then
      ok "LLM proxy ready on :8090 (routing tiers 8091 + 8096)"
    else
      warn "LLM proxy did not become ready on :8090 — check /tmp/demo-llm-proxy.log and /tmp/llama-models/"
    fi
  fi

  # MLX demo agent mode — Apple's mlx-lm on :8098 (Mac only; non-fatal).
  # Skipped when LLM_BACKEND=mlx already owns :8090 with mlx-lm.
  if [[ "$(uname)" == "Darwin" && "$llm_backend" != "mlx" ]]; then
    if curl -sf --max-time 3 "http://127.0.0.1:8098/health" >/dev/null 2>&1 \
       || curl -sf --max-time 3 "http://127.0.0.1:8098/v1/models" >/dev/null 2>&1; then
      ok "mlx-lm demo server already serving :8098"
    elif [[ -x "${BASEDIR}/demo_llm_proxy/.mlx-venv/bin/mlx_lm.server" ]]; then
      echo -e "  ${CYAN}[SPIN]${RESET}  Starting mlx-lm demo server on :8098…"
      if bash "${BASEDIR}/demo_llm_proxy/start-mlx-lm.sh" start; then
        ok "mlx-lm demo ready on :8098 (agent mode: MLX)"
      else
        warn "mlx-lm demo did not start — run: bash demo_llm_proxy/setup-mlx-venv.sh"
      fi
    fi
  fi

  ok "Pre-flight checks passed"
  echo ""
}

# ── Intra-session log size cap ────────────────────────────────────────────────
# Runs in the background and truncates any log that exceeds 10 MB to its last
# 5000 lines, preventing memory pressure from verbose sessions.
_log_janitor_loop() {
  local max_bytes=10485760  # 10 MB
  local keep_lines=5000
  local all_logs=(
    "${LOG_API}" "${LOG_MCP}" "${LOG_GW}" "${LOG_HITL}" "${LOG_AGENT_SVC}"
    "${LOG_INVEST}" "${LOG_MORTGAGE}" "${LOG_OASDK}" "${LOG_MASTRA}"
    "${LOG_PYDANTIC}" "${LOG_AGENT}" "${LOG_AUTH}" "${LOG_HELIX}"
  )
  while true; do
    sleep 30
    for _lf in "${all_logs[@]}"; do
      [[ -f "${_lf}" ]] || continue
      local _sz
      _sz=$(wc -c < "${_lf}" 2>/dev/null | tr -d '[:space:]')
      if [[ -n "${_sz}" ]] && (( _sz > max_bytes )); then
        local _tmp="${_lf}.janitor.tmp"
        tail -n "${keep_lines}" "${_lf}" > "${_tmp}" 2>/dev/null && mv "${_tmp}" "${_lf}" 2>/dev/null || rm -f "${_tmp}"
      fi
    done
  done
}

# ── Tail logs (pick one by number, or all at once) ────────────────────────────
tail_demo_logs() {
  local pre="${1:-}"
  [[ "${pre}" == "ALL" || "${pre}" == "All" ]] && pre="all"
  local names=("Demo API" "Demo UI" "MCP Server" "LangChain Agent" "MCP Traffic" "MCP Gateway" "HITL Service" "Agent Service" "MCP Invest" "Demo Mortgage" "Authorize Server" "Helix LLM" "OpenAI Agents SDK" "Mastra Agent" "Pydantic AI Agent")
  local logs=("${LOG_API}" "${LOG_UI}" "${LOG_MCP}" "${LOG_AGENT}" "${LOG_MCP_TRAFFIC}" "${LOG_GW}" "${LOG_HITL}" "${LOG_AGENT_SVC}" "${LOG_INVEST}" "${LOG_MORTGAGE}" "${LOG_AUTH}" "${LOG_HELIX}" "${LOG_OASDK}" "${LOG_MASTRA}" "${LOG_PYDANTIC}")
  local count=${#names[@]}
  local all_opt=$((count + 1))
  local choice=""

  echo ""
  echo -e "${CYAN}Pick a log to follow (tail -f). Ctrl+C stops tail only.${RESET}"
  for i in $(seq 0 $((count - 1))); do
    echo "  $((i + 1))) ${names[i]}"
    echo "      ${logs[i]}"
  done
  echo "  ${all_opt}) All of the above (same terminal, interleaved with file headers)"
  if [[ -n "${pre}" ]]; then
    choice="${pre}"
  else
    read -r -p "Number [1-${all_opt}] or 'all' [default: all]: " choice
  fi
  [[ -z "${choice}" || "${choice}" == "ALL" || "${choice}" == "All" ]] && choice="all"

  if [[ "${choice}" == "all" || "${choice}" == "${all_opt}" ]]; then
    local existing=()
    local f
    for f in "${logs[@]}"; do
      if [[ -f "${f}" ]]; then
        existing+=("${f}")
      else
        echo "WARNING:  Skipping (not yet created): ${f}"
      fi
    done
    if [[ ${#existing[@]} -eq 0 ]]; then
      echo "WARNING:  No log files found yet. Start services with ./run.sh first."
      exit 1
    fi
    echo "[LOG] Tailing ${#existing[@]} log file(s) together (interleaved). Ctrl+C stops."
    tail -f "${existing[@]}"
  elif [[ "${choice}" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= count )); then
    local idx=$((choice - 1))
    local f="${logs[$idx]}"
    if [[ ! -f "${f}" ]]; then
      echo "WARNING:  Log file does not exist yet: ${f}"
      echo "   (Start services first, or pick another number.)"
      exit 1
    fi
    echo "[LOG] Tailing ${names[$idx]} ..."
    tail -f "${f}"
  else
    echo "Invalid choice (use 1–${all_opt}, or 'all')."
    exit 1
  fi
}

# Kill a PID and every descendant (npm/node/uvicorn survive a plain kill on the subshell).
kill_process_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  case "$pid" in
    ''|*[!0-9]*) return 0 ;;
  esac
  [[ "$pid" -le 1 ]] && return 0
  local c
  # Children first (depth-first) so nothing is reparented under init still listening
  for c in $(pgrep -P "$pid" 2>/dev/null); do
    kill_process_tree "$c"
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

# Stop anything still listening on Banking ports (orphaned node/python after PID file lost).
stop_listeners_on_demo_ports() {
  local port pid pids
  for port in "${DEMO_PORTS[@]}"; do
    pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
    for pid in $pids; do
      [[ -z "$pid" ]] && continue
      echo "   Stopping listener on :${port} (PID ${pid})"
      kill_process_tree "$pid"
    done
  done
}

force_kill_listeners_on_demo_ports() {
  local port pid pids
  for port in "${DEMO_PORTS[@]}"; do
    pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
    for pid in $pids; do
      [[ -z "$pid" ]] && continue
      if kill -KILL "$pid" 2>/dev/null; then
        echo "   Force-killed PID ${pid} still on :${port}"
      fi
    done
  done
}

# Wait for a port with a timeout; returns "up" or "timeout" on stdout.
# When stderr is a TTY, also prints a per-second heartbeat to stderr so the
# user can see we're still working — without polluting any caller that's
# parsing stdout. The heartbeat clears itself before returning.
wait_for_port() {
  local port="$1" timeout="${2:-25}" label="${3:-port $1}" i=0
  local interactive=0
  if [[ -t 2 ]]; then interactive=1; fi

  if [[ $interactive -eq 1 ]]; then
    printf "    waiting for %s (port %s)" "$label" "$port" >&2
  fi

  while [[ $i -lt $timeout ]]; do
    if port_listening "$port"; then
      [[ $interactive -eq 1 ]] && printf " — up after %ds\n" "$i" >&2
      echo "up"; return 0
    fi
    [[ $interactive -eq 1 ]] && printf "." >&2
    sleep 1
    (( i++ )) || true
  done
  [[ $interactive -eq 1 ]] && printf " — TIMEOUT after %ds\n" "$timeout" >&2
  echo "timeout"
}

# Verify a service is truly healthy: first wait for TCP port, then poll HTTP /health
# until HTTP 200. On timeout, prints the last 20 lines of the service log.
# Args: port path timeout label log_file
# Returns "up" or "timeout" on stdout (same contract as wait_for_port).
wait_for_health() {
  local port="$1" path="$2" timeout="${3:-25}" label="${4:-:$1}" log_file="${5:-}"
  local interactive=0
  [[ -t 2 ]] && interactive=1

  # Phase 1: wait for TCP port (half the timeout budget)
  local port_timeout=$(( timeout / 2 ))
  if [[ "$(wait_for_port "$port" "$port_timeout" "$label")" == "timeout" ]]; then
    _health_timeout_report "$label" "$log_file"
    echo "timeout"; return 1
  fi

  # Phase 2: poll /health until HTTP 200
  local i=0 remaining=$(( timeout - port_timeout ))
  [[ $interactive -eq 1 ]] && printf "    polling health for %s" "$label" >&2
  while [[ $i -lt $remaining ]]; do
    local http_code
    # Try HTTPS first (BFF uses TLS); fall back to plain HTTP for services
    # that don't use TLS (MCP server, gateway health, etc.).
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 2 --insecure "https://localhost:${port}${path}" 2>/dev/null || echo "000")
    if [[ "$http_code" != "200" ]]; then
      http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 2 "http://localhost:${port}${path}" 2>/dev/null || echo "000")
    fi
    if [[ "$http_code" == "200" ]]; then
      [[ $interactive -eq 1 ]] && printf " — healthy after %ds\n" "$i" >&2
      echo "up"; return 0
    fi
    [[ $interactive -eq 1 ]] && printf "." >&2
    sleep 1; (( i++ )) || true
  done
  [[ $interactive -eq 1 ]] && printf " — TIMEOUT after %ds\n" "$timeout" >&2

  _health_timeout_report "$label" "$log_file"
  echo "timeout"; return 1
}

# Print last 20 lines of a service log when health check times out.
# All output goes to stderr so it isn't swallowed by >/dev/null at call sites.
_health_timeout_report() {
  local label="$1" log_file="$2"
  echo "" >&2
  err "$label did not become healthy"
  if [[ -n "$log_file" && -f "$log_file" ]]; then
    echo -e "  ${DIM}Last 20 lines of ${log_file}:${RESET}" >&2
    echo -e "  ${DIM}$(printf '─%.0s' {1..60})${RESET}" >&2
    tail -20 "$log_file" | sed 's/^/    /' >&2
    echo -e "  ${DIM}$(printf '─%.0s' {1..60})${RESET}" >&2
  fi
  echo "" >&2
  warn "Run ./run.sh status to see current service state." >&2
}

# Print a single-line status row for a service.
# Args: label port health_path url
# health_path — the HTTP path to check (e.g. /health). Pass "" to skip health check.
service_status_line() {
  local label="$1" port="$2" health_path="${3:-}" url="${4:-}"
  if port_listening "$port"; then
    local health_status="port-up"
    local health_color="${YELLOW}"
    if [[ -n "$health_path" ]]; then
      local hcode
      hcode=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 2 --insecure "http://localhost:${port}${health_path}" 2>/dev/null || echo "000")
      if [[ "$hcode" == "200" ]]; then
        health_status="healthy"
        health_color="${GREEN}"
      fi
    fi
    printf "  ${GREEN}${BOLD}  [OK]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${health_color}%-10s${RESET}  ${YELLOW}%s${RESET}\n" \
      "$label" "$port" "$health_status" "$url"
  else
    printf "  ${RED}${BOLD}  [DOWN]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${DIM}%-10s${RESET}\n" \
      "$label" "$port" "offline"
  fi
}

# Print the full status table (used by both 'start' and 'status' subcommands)
print_status_table() {
  echo -e "${WHITE}${BOLD}  SERVICES${RESET}"
  service_status_line "Demo API Server"      ${API_PORT}  "/api/healthz"  "${API_URL}"
  service_status_line "Demo MCP Server"      8080         "/health"        "ws://localhost:8080 (internal)"
  service_status_line "Authorization Server" 9001         "/health"        "http://localhost:9001 (internal)"
  service_status_line "MCP Gateway"          3005         "/health"        "http://localhost:3005 (internal)"
  service_status_line "MCP Invest Server"    8081         "/health"        "ws://localhost:8081 (internal)"
  service_status_line "Mortgage Service"     8082         "/health"        "http://localhost:8082 (internal)"
  service_status_line "Agent Service"        3006         "/health"        "http://localhost:3006 (internal)"
  service_status_line "HITL Service"         3009         "/health"        "http://localhost:3009 (internal)"
  service_status_line "LangChain Agent"      8881         "/health"        "ws://localhost:8889 (chat WS)"
  service_status_line "OpenAI Agents SDK"    8891         "/health"        "http://localhost:8891 (internal)"
  service_status_line "Mastra Agent"         8892         "/health"        "http://localhost:8892 (internal)"
  service_status_line "Pydantic AI Agent"    8893         "/health"        "http://localhost:8893 (internal)"
  if port_listening 3036; then
    printf "  ${GREEN}${BOLD}  [OK]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${GREEN}%-10s${RESET}  ${YELLOW}%s${RESET}\n" \
      "PingGateway (IG)" "3036" "port-up" "http://localhost:3036 (MCP gateway)"
  else
    printf "  ${YELLOW}  [WAIT]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${DIM}%-10s${RESET}  %s${RESET}\n" \
      "PingGateway (IG)" "3036" "stopped" "http://localhost:3036 (MCP gateway)"
  fi
  if port_listening "${JAEGER_UI_PORT}"; then
    printf "  ${GREEN}${BOLD}  [OK]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${GREEN}%-10s${RESET}  ${YELLOW}%s${RESET}\n" \
      "Jaeger (tracing UI)" "${JAEGER_UI_PORT}" "port-up" "http://localhost:${JAEGER_UI_PORT} (service: ${OTEL_SERVICE_NAME})"
  else
    printf "  ${YELLOW}  [WAIT]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${DIM}%-10s${RESET}  %s${RESET}\n" \
      "Jaeger (tracing UI)" "${JAEGER_UI_PORT}" "stopped" "http://localhost:${JAEGER_UI_PORT}"
  fi
  if port_listening ${UI_PORT}; then
    printf "  ${GREEN}${BOLD}  [OK]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${GREEN}%-10s${RESET}  ${YELLOW}%s${RESET}\n" \
      "Demo UI (React)" "${UI_PORT}" "port-up" "${CLIENT_URL}"
  else
    printf "  ${YELLOW}  [WAIT]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${DIM}%-10s${RESET}  %s${RESET}\n" \
      "Demo UI (React)" "${UI_PORT}" "compiling…" "${CLIENT_URL}"
  fi
}

# ── Subcommand: stop ─────────────────────────────────────────────────────────
cmd_stop() {
  echo "[STOP] Stopping Demo services (run.sh)..."
  set +e
  for pid_file in "$PID_API" "$PID_MCP" "$PID_AUTHZ" "$PID_GW" "$PID_HITL" "$PID_AGENT_SVC" "$PID_INVEST" "$PID_MORTGAGE" "$PID_AGENT" "$PID_UI" "$PID_OASDK" "$PID_MASTRA" "$PID_PYDANTIC" "$PID_LOG_JANITOR"; do
    if [[ -f "$pid_file" ]]; then
      PID=$(cat "$pid_file" 2>/dev/null || true)
      rm -f "$pid_file"
      if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
        kill_process_tree "$PID"
        echo "   Stopped process tree from PID ${PID} ($(basename "$pid_file" .pid))"
      fi
    fi
  done
  sleep 1
  # PingGateway runs as a Docker container — stop via compose, not PID.
  if [[ "$DOCKER_AVAILABLE" == "true" ]]; then
    docker compose -f "$BASEDIR/ping-gateway/docker-compose.yml" down --remove-orphans \
      >> "${LOG_PG}" 2>&1 || true
  fi
  echo "   Sweeping ports (API :${API_PORT}, UI :${UI_PORT}, MCP :8080, AuthzServer :9001, GW :3005, Agent :3006, HITL :3009, Invest :8081, Mortgage :8082, LangChain :8887/8889/8881, OASDK :8891, Mastra :8892, Pydantic :8893, PingGateway :3036)…"
  stop_listeners_on_demo_ports
  sleep 1
  force_kill_listeners_on_demo_ports
  set -euo pipefail
  echo "[OK] All Demo listeners stopped (or none were running)."
}

# ── Subcommand: test ─────────────────────────────────────────────────────────
cmd_test() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [BANK]  DEMO — TEST SUITE                                          ${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""

  local failed=0

  if [[ -d "${BASEDIR}/demo_api_server" ]]; then
    echo -e "  ${CYAN}→${RESET}  Running demo_api_server tests..."
    if (cd "${BASEDIR}/demo_api_server" && npm test -- --passWithNoTests 2>&1); then
      ok "demo_api_server tests passed"
    else
      err "demo_api_server tests FAILED"
      failed=$((failed + 1))
    fi
  fi

  if [[ -d "${BASEDIR}/demo_api_ui" ]]; then
    if grep -q '"test"' "${BASEDIR}/demo_api_ui/package.json" 2>/dev/null; then
      echo -e "  ${CYAN}→${RESET}  Running demo_api_ui tests..."
      if (cd "${BASEDIR}/demo_api_ui" && CI=true npm test -- --watchAll=false --passWithNoTests 2>&1); then
        ok "demo_api_ui tests passed"
      else
        err "demo_api_ui tests FAILED"
        failed=$((failed + 1))
      fi
    fi
  fi

  if [[ -d "${BASEDIR}/demo_mcp_server" ]]; then
    if grep -q '"test"' "${BASEDIR}/demo_mcp_server/package.json" 2>/dev/null; then
      echo -e "  ${CYAN}→${RESET}  Running demo_mcp_server tests..."
      if (cd "${BASEDIR}/demo_mcp_server" && npm test -- --passWithNoTests 2>&1); then
        ok "demo_mcp_server tests passed"
      else
        err "demo_mcp_server tests FAILED"
        failed=$((failed + 1))
      fi
    fi
  fi

  echo ""
  if [[ "${failed}" -eq 0 ]]; then
    ok "All test suites passed"
  else
    err "${failed} test suite(s) failed"
    exit 1
  fi
  echo ""
}

# ── Subcommand: help ─────────────────────────────────────────────────────────
cmd_help() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [BANK]  AI DEMO — run.sh                      ${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  echo -e "${WHITE}${BOLD}  Usage:${RESET} ./run.sh <command>"
  echo ""
  echo -e "${WHITE}${BOLD}  Commands:${RESET}"
  echo "    (default)  Start all services (${PROTO_LABEL} on ${API_HOST})"
  echo "    stop       Stop all services gracefully (process tree + port sweep)"
  echo "    restart    Stop then start all services"
  echo "    status     Show running/stopped status with ports and URLs"
  echo "    tail       Pick a log to follow (number) or 'all' for all logs at once"
  echo "    tail N     Tail a specific log directly (1=API, 2=UI, 3=MCP, …)"
  echo "    fresh      Run setup:fresh (initial install / PingOne bootstrap)"
  echo "    fresh <f>  Run setup:fresh with a migration bundle (.tar.gz)"
  echo "    test       Run full test suite (API, UI, MCP)"
  echo "    help       Show this message"
  echo ""
  echo -e "${WHITE}${BOLD}  Port Layout:${RESET}"
  echo "    Demo API Server      :${API_PORT}  (${PROTO_LABEL})"
  echo "    Demo UI              :${UI_PORT}  (${PROTO_LABEL})"
  echo "    Demo MCP Server      :8080
    MCP Gateway          :3005"
  echo "    LangChain Agent      :8887 (FastAPI/CodeGraph) :8889 (chat WS) :8881 (health)"
  echo "    OpenAI Agents SDK    :8891"
  echo "    Mastra Agent         :8892"
  echo "    Pydantic AI Agent    :8893"
  echo ""
  echo -e "${WHITE}${BOLD}  Log Files:${RESET}"
  echo "    ${LOG_API}"
  echo "    ${LOG_UI}"
  echo "    ${LOG_MCP}"
  echo "    ${LOG_AGENT}"
  echo "    ${LOG_MCP_TRAFFIC}"
  echo "    ${LOG_GW}"
  echo "    ${LOG_HITL}"
  echo "    ${LOG_AGENT_SVC}"
  echo "    ${LOG_INVEST}"
  echo "    ${LOG_MORTGAGE}"
  echo "    ${LOG_AUTH}"
  echo ""
  echo -e "${WHITE}${BOLD}  One-time Setup:${RESET}"
  echo "    echo '127.0.0.1  ${API_HOST}' | sudo tee -a /etc/hosts"
  echo "    mkcert -install && cd certs && mkcert ${API_HOST} localhost 127.0.0.1"
  echo ""
}

# ── Argument parsing (extract flags before command) ──────────────────────────
# Supports: ./run.sh stop
#           ./run.sh --vault-password 'secret' stop  
#           ./run.sh stop --vault-password 'secret' (reserved args stay in place)
# Extract flags from the beginning, stop at first non-flag argument.
while [[ $# -gt 0 && "$1" == --* ]]; do
  case "$1" in
    --vault-password)
      shift
      export VAULT_PASSWORD="$1"
      shift || true
      ;;
    --)
      shift
      break
      ;;
    *)
      err "Unknown flag: $1"
      exit 1
      ;;
  esac
done

# First remaining argument is the command (default: start)
COMMAND="${1:-start}"

# ── Subcommand dispatch ─────────────────────────────────────────────────────
case "${COMMAND}" in
  stop)
    cmd_stop
    exit 0
    ;;
  restart)
    cmd_stop
    # fall through to start below
    ;;
  dev)
    # Same as restart, but the BFF (demo_api_server) launches under nodemon so
    # edits to its source + config/verticals JSON auto-reload (see nodemon.json).
    export BFF_DEV=1
    cmd_stop
    # fall through to start below
    ;;
  status)
    echo ""
    echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${CYAN}${BOLD}   [BANK]  AI DEMO — SERVICE STATUS                                ${RESET}"
    echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""
    print_status_table
    echo ""
    echo -e "${GREEN}${BOLD}  ┌─ URLS ──────────────────────────────────────────────────────┐${RESET}"
    echo -e "${GREEN}${BOLD}  │${RESET}  [WEB]  App           ${YELLOW}${BOLD}${CLIENT_URL}${RESET}"
    echo -e "${GREEN}${BOLD}  │${RESET}  [CONFIG]   Admin Config  ${YELLOW}${BOLD}${CLIENT_URL}/config${RESET}"
    echo -e "${GREEN}${BOLD}  │${RESET}  [SSL]  Admin Login   ${YELLOW}${BOLD}${API_URL}/api/auth/oauth/login${RESET}"
    echo -e "${GREEN}${BOLD}  │${RESET}  [USER]  User Login    ${YELLOW}${BOLD}${API_URL}/api/auth/oauth/user/login${RESET}"
    echo -e "${GREEN}${BOLD}  │${RESET}  [TRACE] Jaeger UI     ${YELLOW}${BOLD}http://localhost:${JAEGER_UI_PORT}${RESET}  ${DIM}(BFF, gateway, MCP, authz, HITL, agent)${RESET}"
    echo -e "${GREEN}${BOLD}  └─────────────────────────────────────────────────────────────┘${RESET}"
    echo ""
    echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""
    exit 0
    ;;
  mcp-traffic|mcp-watch)
    if [[ ! -f "${LOG_MCP_TRAFFIC}" ]]; then echo "No MCP traffic log yet. Start services first." >&2; exit 1; fi
    echo "[TRAFFIC] MCP Traffic Log — Ctrl+C to stop"
    tail -f "${LOG_MCP_TRAFFIC}"
    exit 0
    ;;
  tail)
    tail_demo_logs "${2:-}"
    exit 0
    ;;
  fresh)
    shift || true
    echo "[SETUP] Running setup:fresh..."
    bash scripts/run-node.sh demo_api_server/scripts/setupFresh.js "$@"
    exit 0
    ;;
  test)
    cmd_test
    exit 0
    ;;
  help|--help|-h)
    cmd_help
    exit 0
    ;;
  start)
    # fall through to start below
    ;;
  *)
    err "Unknown command: ${COMMAND}"
    cmd_help
    exit 1
    ;;
esac

# ══════════════════════════════════════════════════════════════════════════════
# START SERVICES
# ══════════════════════════════════════════════════════════════════════════════

preflight_checks

# ── Auto-kill any existing Banking services before (re)starting ─────────────
_any_running=false
for _chk_port in ${API_PORT} ${UI_PORT} 8080 8887 8889 8881 8891 8892 8893; do
  if port_listening "$_chk_port"; then
    _any_running=true
    break
  fi
done
if [[ "$_any_running" == "true" ]]; then
  echo -e "${YELLOW}  [SPIN]  Stopping existing Demo services…${RESET}"
  set +e
  for _pf in "$PID_API" "$PID_MCP" "$PID_AUTHZ" "$PID_GW" "$PID_HITL" "$PID_AGENT_SVC" "$PID_INVEST" "$PID_AGENT" "$PID_UI" "$PID_OASDK" "$PID_MASTRA" "$PID_PYDANTIC" "$PID_LOG_JANITOR"; do
    if [[ -f "$_pf" ]]; then
      _pid=$(cat "$_pf" 2>/dev/null || true)
      rm -f "$_pf"
      [[ -n "$_pid" ]] && kill_process_tree "$_pid" 2>/dev/null || true
    fi
  done
  stop_listeners_on_demo_ports
  sleep 1
  force_kill_listeners_on_demo_ports
  set -euo pipefail
  echo -e "${GREEN}  [OK]  Previous services stopped.${RESET}"
  echo ""
fi

# ── Dependency check (all Node services, not just the obvious three) ─────────
# Parallel arrays — keep indices aligned. SVC_BUILD="ts" means run `npm run build`
# (tsc) when dist/index.js is missing. SVC_INSTALL_FLAGS handles services that
# need extra `npm install` flags. Loud failure on any error — silent skips here
# are exactly how we got cryptic MODULE_NOT_FOUND in service logs.
SVC_LIST=(demo_api_server demo_mcp_server demo_api_ui demo_mcp_gateway demo_hitl_service demo_agent_service demo_mcp_invest demo_mortgage_service mastra_agent demo_authz_server)
SVC_BUILD=(""                "ts"               ""       "ts"                ""                   "ts"                  "ts"               ""                    "ts"          "")
SVC_INSTALL_FLAGS=("--legacy-peer-deps" ""                 ""       ""                  ""                   ""                    ""                 ""                    ""            "")

# Decide whether a Node service needs `npm install`. Prints a short human reason
# and returns 0 when install is needed; returns 1 (no output) when in sync.
#
# A plain `[[ -d node_modules ]]` check is NOT enough: a *borrowed* node_modules
# — copied into a git worktree, bind-mounted from the host into the devcontainer,
# or simply left over from before a new dependency was added to package.json —
# exists on disk but is missing the newly-declared package(s), which then surface
# as cryptic MODULE_NOT_FOUND at build/start time (e.g. @azure/msal-browser).
# Detect that by verifying every declared dependency is present under node_modules.
svc_needs_install() {
  local dir="$1"
  if [[ ! -d "$dir/node_modules" ]]; then
    echo "node_modules missing"
    return 0
  fi
  # Without node or a manifest we can't introspect — fall back to the old
  # behaviour (node_modules exists, assume it's good).
  { [[ -f "$dir/package.json" ]] && command -v node >/dev/null 2>&1; } || return 1
  local missing
  missing="$(node -e '
    const fs = require("fs"), path = require("path");
    const dir = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    // Only direct prod + dev deps; optionalDependencies may be platform-specific
    // and legitimately absent, which would force a reinstall on every run.
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    const missing = Object.keys(deps).filter(
      d => !fs.existsSync(path.join(dir, "node_modules", d, "package.json"))
    );
    process.stdout.write(missing.slice(0, 5).join(", ") + (missing.length > 5 ? ", …" : ""));
  ' "$dir" 2>/dev/null)"
  if [[ -n "$missing" ]]; then
    echo "missing declared dep(s): $missing"
    return 0
  fi
  return 1
}

for i in "${!SVC_LIST[@]}"; do
  svc="${SVC_LIST[$i]}"
  [[ -d "$BASEDIR/$svc" ]] || continue

  if reason="$(svc_needs_install "$BASEDIR/$svc")"; then
    echo "[PKG] Installing dependencies for $svc ($reason)..."
    if ! (cd "$BASEDIR/$svc" && npm install ${SVC_INSTALL_FLAGS[$i]}); then
      err "npm install failed for $svc — aborting startup."
      err "  Fix the error above (often a network or registry issue), then re-run ./run.sh"
      exit 1
    fi
  fi

  if [[ "${SVC_BUILD[$i]}" == "ts" ]] && [[ ! -f "$BASEDIR/$svc/dist/index.js" ]]; then
    echo "[BUILD] Compiling TypeScript for $svc..."
    if ! (cd "$BASEDIR/$svc" && npm run build); then
      err "Build failed for $svc — aborting startup."
      err "  Fix the TypeScript errors above, then re-run ./run.sh"
      exit 1
    fi
  fi
done

# ── Python agent dependency check (openai_agent + pydantic_agent) ────────────
# These services were silently crashing on a missing-deps or stub-venv state
# because they weren't in SVC_LIST. CLAUDE.md warns explicitly about silent
# skips here. We verify each .venv exists AND has a working python binary
# (a stub venv with no bin/python is what crashed pydantic_agent last run),
# then install requirements.txt. Loud failure on any error.
# Prefer Python 3.12+ for agent venvs — some packages (openai-agents>=0.17)
# require 3.10+ and system Python on macOS is often 3.9.
_pick_python() {
  for _py in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$_py" &>/dev/null; then
      local _maj; _maj=$("$_py" -c "import sys; print(sys.version_info.major)" 2>/dev/null)
      local _min; _min=$("$_py" -c "import sys; print(sys.version_info.minor)" 2>/dev/null)
      if [[ -n "$_maj" && -n "$_min" ]] && (( _maj > 3 || (_maj == 3 && _min >= 10) )) 2>/dev/null; then
        echo "$_py"; return
      fi
    fi
  done
  echo "python3"  # last resort — pip install will fail with a clear message
}
PY_CMD="$(_pick_python)"

PY_AGENTS=(langchain_agent openai_agent pydantic_agent)
for svc in "${PY_AGENTS[@]}"; do
  [[ -d "$BASEDIR/$svc" ]] || continue
  venv_python="$BASEDIR/$svc/.venv/bin/python"
  # Recreate venv if missing OR if it was built on Python < 3.10
  _venv_ok=false
  if [[ -x "$venv_python" ]]; then
    _vmin=$("$venv_python" -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo 0)
    _vmaj=$("$venv_python" -c "import sys; print(sys.version_info.major)" 2>/dev/null || echo 0)
    if (( _vmaj > 3 || (_vmaj == 3 && _vmin >= 10) )) 2>/dev/null; then
      _venv_ok=true
    else
      echo "[PYENV] $svc venv is Python ${_vmaj}.${_vmin} — rebuilding with ${PY_CMD}..."
      rm -rf "$BASEDIR/$svc/.venv"
    fi
  fi
  if [[ "$_venv_ok" == "false" ]]; then
    echo "[PYENV] Creating .venv for $svc (using ${PY_CMD})..."
    if ! (cd "$BASEDIR/$svc" && "$PY_CMD" -m venv .venv); then
      err "python3 -m venv failed for $svc — aborting startup."
      err "  Ensure Python 3.10+ is installed (brew install python@3.12)."
      exit 1
    fi
    (cd "$BASEDIR/$svc" && .venv/bin/pip install --upgrade pip --quiet)
  fi
  # Always sync requirements — fast no-op when current, recovers missing packages.
  if [[ -f "$BASEDIR/$svc/requirements.txt" ]]; then
    if ! (cd "$BASEDIR/$svc" && .venv/bin/pip install --quiet -r requirements.txt); then
      err "pip install failed for $svc — aborting startup."
      err "  Fix the error above, then re-run ./run.sh"
      exit 1
    fi
  fi
done

# ── CodeGraph index (Code Explorer) ──────────────────────────────────────────
# Rebuild the codegraph DB + stage the source the agent's grep/read tools read,
# so /code-explorer is always current locally. Fast (~1s, AST-only, no API cost);
# never fails startup — Code Explorer degrades gracefully on a missing/stale DB.
if command -v python3 >/dev/null 2>&1; then
  if python3 "$BASEDIR/scripts/build-codegraph.py" >/dev/null 2>&1; then
    python3 "$BASEDIR/scripts/build-codegraph.py" --stage-src "$BASEDIR/langchain_agent/repo-src" >/dev/null 2>&1 || true
    ok "CodeGraph index refreshed (Code Explorer)"
  else
    err "CodeGraph index build skipped (non-fatal) — Code Explorer may be stale"
  fi
else
  err "python3 not found — skipping CodeGraph index (Code Explorer disabled until built)"
fi

# ── Demo API Server (Express) on :3001 ────────────────────────────────────
# NODE_EXTRA_CA_CERTS points Node at mkcert's root CA so BFF→MCP-Gateway
# HTTPS probes can validate the gateway's mkcert-issued cert. Without this
# they fail with UNABLE_TO_VERIFY_LEAF_SIGNATURE and the agent UI surfaces
# "MCP Gateway unavailable; bypass not permitted".
#
# NODE_OPTIONS=--use-system-ca was tried first but doesn't work reliably on
# Node 24 (didn't pick up the mkcert root from the macOS System keychain
# in our local test). Pointing at rootCA.pem directly works on every Node
# version that supports NODE_EXTRA_CA_CERTS (Node 12+).
#
# Resolved at script time so a missing mkcert install becomes a clear
# message rather than a silent TLS failure later.
MKCERT_ROOT_PEM="$(mkcert -CAROOT 2>/dev/null)/rootCA.pem"
if [[ -f "$MKCERT_ROOT_PEM" ]]; then
  export NODE_EXTRA_CA_CERTS="$MKCERT_ROOT_PEM"
elif [[ "$USE_HTTPS" == "true" ]]; then
  echo "[WARN] mkcert root CA not found at expected path. Run \`mkcert -install\` once if BFF→MCP Gateway HTTPS probes fail."
fi

# ── Vault preflight (Phase 269 / agent vault-awareness follow-up) ────────────
# The BFF, MCP Gateway, and Agent Service each load secrets from the encrypted
# secrets.vault at startup and FAIL FAST if the vault file exists but
# VAULT_PASSWORD is unset (REGRESSION_PLAN §1 "Vault BFF startup" /
# "Vault Agent startup"). Without this preflight the operator would instead get
# three separate cryptic "refusing to start" failures in three log files.
# When no vault file exists, this is a transparent no-op — behavior is
# byte-identical to before (the common dev case on machines with no vault).
# Secret hygiene (T-269-27): VAULT_PASSWORD is only ever passed via the
# subshell environment, never as a CLI arg, and is never echoed.
VAULT_FILE="${VAULT_PATH:-$BASEDIR/secrets.vault}"
if [[ -f "$VAULT_FILE" ]]; then
  if [[ -z "${VAULT_PASSWORD:-}" ]]; then
    echo "[ERROR] secrets.vault present at ${VAULT_FILE} but VAULT_PASSWORD is not set."
    echo "        The BFF, MCP Gateway, and Agent Service will refuse to start."
    echo "        Fix: export VAULT_PASSWORD=... before ./run.sh"
    echo "        (or remove/rename ${VAULT_FILE} to fall back to .env / process.env)."
    exit 1
  fi
  # A non-empty but WRONG/ROTATED password passes the check above, then crashes
  # the BFF, MCP Gateway, and Agent Service with three opaque "open failed" logs.
  # Verify it actually DECRYPTS the vault here, once, up front. We treat ONLY a
  # confirmed decrypt failure (exit 3) as fatal; if the check itself can't run
  # (no node / missing deps → any other exit), we fall back to the prior
  # behavior and let each service validate at boot — so this never introduces a
  # spurious abort. VAULT_PASSWORD is passed via the subshell env, never echoed.
  _vault_check_rc=0
  VAULT_FILE="$VAULT_FILE" VAULT_PASSWORD="$VAULT_PASSWORD" VAULT_LIB="$BASEDIR/demo_api_server/lib/vault" \
    node -e 'const {openVault}=require(process.env.VAULT_LIB);openVault(process.env.VAULT_FILE,process.env.VAULT_PASSWORD).then(()=>process.exit(0)).catch(()=>process.exit(3));' \
    >/dev/null 2>&1 || _vault_check_rc=$?
  if [[ "$_vault_check_rc" -eq 3 ]]; then
    echo "[ERROR] VAULT_PASSWORD is set but does NOT decrypt ${VAULT_FILE} (wrong or rotated password)."
    echo "        The BFF, MCP Gateway, and Agent Service would each crash with an opaque 'open failed'."
    echo "        Fix: export the correct VAULT_PASSWORD (or rotate the vault) before ./run.sh."
    exit 1
  elif [[ "$_vault_check_rc" -ne 0 ]]; then
    echo "[VAULT][warn] Could not pre-verify VAULT_PASSWORD (rc=${_vault_check_rc}); continuing — services will validate at boot."
  fi
  echo "[VAULT] secrets.vault detected — passing VAULT_PASSWORD to vault-aware services."
fi

# refresh_service_envs: query PingOne by app name and write a correct .env
# for every service.  Replaces the old ensure_service_env / patch_* chain.
# Falls back silently if PingOne is unreachable — services start with whatever
# .env already exists on disk.
refresh_service_envs() {
  if [[ ! -f "${BASEDIR}/demo_api_server/.env" ]]; then
    return 0  # bootstrap not yet run — nothing to do
  fi
  CLIENT_URL="${CLIENT_URL:-}" bash "${BASEDIR}/scripts/run-node.sh" \
    demo_api_server/scripts/refresh-service-envs.js || true
}

# Start Jaeger (OTLP :4317, UI :16686) when missing — native BFF exports traces
# to localhost:4317 (OTEL_EXPORTER_OTLP_ENDPOINT). Uses the same compose service
# as run-docker.sh; no-op when the collector is already listening.
ensure_jaeger() {
  if port_listening "${JAEGER_OTLP_PORT}"; then
    return 0
  fi
  if [[ "$DOCKER_AVAILABLE" != "true" ]]; then
    warn "Jaeger not listening on :${JAEGER_OTLP_PORT} and Docker unavailable — tracing may be empty"
    return 0
  fi
  if [[ ! -f "${BASEDIR}/docker-compose.yml" ]]; then
    warn "Jaeger not started — docker-compose.yml not found; tracing may be empty"
    return 0
  fi
  echo "[TRACE]  Starting Jaeger (OTLP :${JAEGER_OTLP_PORT}, UI :${JAEGER_UI_PORT})..."
  COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-ai-demo}" \
    docker compose -f "${BASEDIR}/docker-compose.yml" up -d jaeger \
    >> "${LOG_JAEGER}" 2>&1 || true
}

# ── Pre-launch: write all service .envs from PingOne before any process starts ──
# refresh_service_envs queries PingOne by canonical app name (scope-topology.json),
# fetches live credentials, and writes a correct .env for every service.
# Falls back silently if PingOne is unreachable — idempotent and safe to re-run.
echo "[ENVS] Refreshing service .env files from PingOne..."
refresh_service_envs
ensure_jaeger

# ── Tier 1: Demo API Server (Express) on :3001 ───────────────────────────────
echo "[LAUNCH] Starting Demo API Server on ${API_HOST}:${API_PORT}..."
(
  cd "$BASEDIR/demo_api_server"
  PORT=${API_PORT} \
  NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}" \
  OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT}" \
  OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME}" \
  NODE_OPTIONS="${OTEL_NODE_OPTIONS}" \
  REACT_APP_CLIENT_URL=${CLIENT_URL} \
  FRONTEND_ADMIN_URL=${CLIENT_URL}/admin \
  FRONTEND_DASHBOARD_URL=${CLIENT_URL}/dashboard \
  MCP_GATEWAY_HTTP_URL="${MCP_GATEWAY_HTTP_URL:-${GW_URL}}" \
  SSL_CRT_FILE="${CERT_FILE}" \
  SSL_KEY_FILE="${KEY_FILE}" \
  VAULT_PASSWORD="${VAULT_PASSWORD:-}" \
  VAULT_PATH="${VAULT_PATH:-}" \
  BFF_DEV="${BFF_DEV:-0}" \
  nohup bash -c 'if [[ "${BFF_DEV:-0}" == "1" ]]; then exec npm run dev; else exec npm start; fi' > "${LOG_API}" 2>&1
) &
echo $! > "$PID_API"

# Gate: Tier 2 blocked until API server is healthy
wait_for_health "${API_PORT}" "/api/healthz" 30 "Demo API Server" "${LOG_API}" >/dev/null
# npm/node may not match the subshell PID — store the listener PID for cmd_stop.
_listener_pid=$(lsof -tiTCP:"${API_PORT}" -sTCP:LISTEN 2>/dev/null | head -1 || true)
if [[ -n "$_listener_pid" ]]; then
  echo "$_listener_pid" > "$PID_API"
fi
unset _listener_pid

# ── Tier 2: MCP Server, Gateway, HITL ────────────────────────────────────────

# ── Demo MCP Server on :8080 ──────────────────────────────────────────────
if [[ -d "$BASEDIR/demo_mcp_server" ]]; then
  echo "[BOT] Starting Demo MCP Server on :8080..."
  (
    cd "$BASEDIR/demo_mcp_server"
    VAULT_PASSWORD="${VAULT_PASSWORD:-}" \
    VAULT_PATH="${VAULT_PATH:-}" \
    NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}" \
    OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT}" \
    OTEL_SERVICE_NAME="mcp-server" \
    NODE_OPTIONS="${OTEL_NODE_OPTIONS}" \
    npm start > "${LOG_MCP}" 2>&1
  ) &
  echo $! > "$PID_MCP"
fi

# ── PingOne Authorization Server (mock) on :9001 ─────────────────────────────
# Standalone service that owns ALL authorization decisions: token introspection,
# act claim validation, scope enforcement, HITL. The MCP Gateway delegates here.
# Swap PINGAUTHORIZE_ENDPOINT on the gateway to real PingOne when ready.
if [[ -d "$BASEDIR/demo_authz_server" ]]; then
  echo "[AUTH]   Starting PingOne Authorization Server (mock) on :9001..."
  (
    cd "$BASEDIR/demo_authz_server"
    OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT}" \
    OTEL_SERVICE_NAME="authz-server" \
    NODE_OPTIONS="${OTEL_NODE_OPTIONS}" \
    npm start > "${LOG_AUTH}" 2>&1
  ) &
  echo $! > "$PID_AUTHZ"
fi

# ── MCP Gateway on :3005 ──────────────────────────────────────────────────────
# Routing-only: extracts bearer token, calls Authorization Server (:9001),
# then routes to the appropriate MCP server on PERMIT.
# Build is handled by the dependency check loop above.
if [[ -d "$BASEDIR/demo_mcp_gateway" ]]; then
  echo "[SHIELD]  Starting MCP Gateway on :3005..."
  (
    cd "$BASEDIR/demo_mcp_gateway"
    VAULT_PASSWORD="${VAULT_PASSWORD:-}" \
    VAULT_PATH="${VAULT_PATH:-}" \
    GW_INTROSPECTION_ENDPOINT="${GW_INTROSPECTION_ENDPOINT:-http://localhost:9001/as/introspect}" \
    OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT}" \
    OTEL_SERVICE_NAME="mcp-gateway" \
    NODE_OPTIONS="${OTEL_NODE_OPTIONS}" \
    npm start > "${LOG_GW}" 2>&1
  ) &
  echo $! > "$PID_GW"
fi

# ── PingGateway (IG) on :3036 ────────────────────────────────────────────────
# Started via its own docker-compose (ping-gateway/docker-compose.yml) so the
# JVM gets a clean writable /var/gateway (emptyDir-equivalent) every time.
# Non-blocking: `docker compose up -d` returns quickly; IG takes ~15s to bind
# port 8080 inside the container (published as host :3036). The Tier 2 wait
# below does NOT gate on PingGateway — it is optional for the demo to function.
# The BFF uses it only when ff_mcp_gateway_pinggateway is ON.
if [[ -d "$BASEDIR/ping-gateway" ]] && [[ "$DOCKER_AVAILABLE" == "true" ]]; then
  echo "[SHIELD]  Starting PingGateway (IG) on :3036..."
  docker compose -f "$BASEDIR/ping-gateway/docker-compose.yml" up -d \
    >> "${LOG_PG}" 2>&1 || true
fi

# ── HITL Service on :3009 ───────────────────────────────────────────────────
if [[ -d "$BASEDIR/demo_hitl_service" ]]; then
  echo "[ALERT] Starting HITL Service on :3009..."
  (
    cd "$BASEDIR/demo_hitl_service"
    PORT=3009 \
    OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT}" \
    OTEL_SERVICE_NAME="hitl-service" \
    NODE_OPTIONS="${OTEL_NODE_OPTIONS}" \
    npm start > "${LOG_HITL}" 2>&1
  ) &
  echo $! > "$PID_HITL"
fi

# Wait for Tier 2 services; gate Tier 3 on gateway health
wait_for_health 8080 "/health" 25 "Demo MCP Server"         "${LOG_MCP}"   >/dev/null
wait_for_health 9001 "/health" 10 "Authorization Server"    "${LOG_AUTH}" >/dev/null
wait_for_health 3005 "/health" 15 "MCP Gateway"             "${LOG_GW}"    >/dev/null
wait_for_health 3009 "/health" 15 "HITL Service"            "${LOG_HITL}"  >/dev/null

# ── Tier 3: Agent Service, MCP Invest, Mortgage, UI, LangChain ───────────────

# ── Agent Service on :3006 ──────────────────────────────────────────────────
# dist/ is guaranteed by the dependency check loop above (it builds or aborts).
if [[ -d "$BASEDIR/demo_agent_service" ]]; then
  echo "[CONNECT] Starting Agent Service on :3006..."
  (
    cd "$BASEDIR/demo_agent_service"
    PORT=3006 \
    BFF_TOOL_URL="http://127.0.0.1:${API_PORT}/internal/agent-tool" \
    VAULT_PASSWORD="${VAULT_PASSWORD:-}" \
    VAULT_PATH="${VAULT_PATH:-}" \
    OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT}" \
    OTEL_SERVICE_NAME="agent-service" \
    NODE_OPTIONS="${OTEL_NODE_OPTIONS}" \
    npm start > "${LOG_AGENT_SVC}" 2>&1
  ) &
  echo $! > "$PID_AGENT_SVC"
fi

# ── MCP Invest Server on :8081 ──────────────────────────────────────────────
if [[ -d "$BASEDIR/demo_mcp_invest" ]]; then
  echo "[INVEST] Starting MCP Invest Server on :8081..."
  (
    cd "$BASEDIR/demo_mcp_invest"
    PORT=8081 \
    OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT}" \
    OTEL_SERVICE_NAME="mcp-invest" \
    NODE_OPTIONS="${OTEL_NODE_OPTIONS}" \
    npm start > "${LOG_INVEST}" 2>&1
  ) &
  echo $! > "$PID_INVEST"
fi

# ── Mortgage Service on :8082 (Phase 266 Path A backend) ─────────────────────
# API-key-gated. Gateway swaps the user's OAuth bearer for X-API-Key and calls
# this service on the api_key disposition. Single GET /mortgage route returns
# a dummy mortgage record.
if [[ -d "$BASEDIR/demo_mortgage_service" ]]; then
  echo "[MORTGAGE] Starting Mortgage Service on :8082..."
  (
    cd "$BASEDIR/demo_mortgage_service"
    MORTGAGE_SERVICE_PORT=8082 npm start > "${LOG_MORTGAGE}" 2>&1
  ) &
  echo $! > "$PID_MORTGAGE"
fi

# ── Demo UI (Vite) on :4000 ───────────────────────────────────────────────
# Launched here (before the Tier 3 waits) so the UI's slow compile runs in
# parallel with the ~40s of agent/invest/mortgage health checks rather than after.
# REACT_APP_API_PORT  → picked up by src/setupProxy.js to proxy /api/* to :3001
# REACT_APP_API_URL   → used by apiClient.js for absolute axios calls
# Host binding (0.0.0.0, IPv4+IPv6) is set in demo_api_ui/vite.config.js
# (server.host = true). Vite ignores CRA's HOST env var, so it must live there.
echo "[WEB] Starting Demo UI on ${CLIENT_URL}..."
(
  cd "$BASEDIR/demo_api_ui"
  PORT=${UI_PORT} \
  HTTPS=${USE_HTTPS} \
  SSL_CRT_FILE=${CERT_FILE} \
  SSL_KEY_FILE=${KEY_FILE} \
  REACT_APP_API_URL=${API_URL} \
  REACT_APP_API_PORT=${API_PORT} \
  REACT_APP_API_HTTPS=${USE_HTTPS} \
  REACT_APP_CLIENT_URL=${CLIENT_URL} \
  DANGEROUSLY_DISABLE_HOST_CHECK=true \
  WDS_SOCKET_PORT=0 \
  npm start > "${LOG_UI}" 2>&1
) &
echo $! > "$PID_UI"

# ── LangChain Agent (chat WS :8889 + health :8890 + FastAPI :8887) ────────────
# Entry point is src/main.py, run as a module (`python -m src.main`) — it is an
# asyncio app that manages its own websockets server (8889) and health server
# (8890). Note: Port 8888 is occupied by OrbStack on macOS, so the FastAPI /run
# endpoint uses :8887 (configurable via AGUI_HTTP_PORT). The BFF proxies to this
# port via LANGCHAIN_AGENT_HTTP_URL. Reads langchain_agent/.env via python-dotenv.
# The venv is `.venv`.
if [[ -f "$BASEDIR/langchain_agent/src/main.py" ]]; then
  echo "[CHAIN] Starting LangChain Agent (chat WS :8889, health :8890, API :8887)..."
  (
    cd "$BASEDIR/langchain_agent"
    if [[ -x ".venv/bin/python" ]]; then
      PY=".venv/bin/python"
    elif [[ -x "venv/bin/python" ]]; then
      PY="venv/bin/python"
    else
      PY="python3"
    fi
    # Export OIDC vars from patched .env so startup succeeds even if dotenv load order differs.
    if [[ -f ".env" ]]; then
      set -a
      # shellcheck disable=SC1091
      source ".env" 2>/dev/null || true
      set +a
    fi
    # Set ports: 8887 for FastAPI, 8881 for health (8888/8889/8890 occupied by OrbStack)
    PYTHONPATH="${BASEDIR}/langchain_agent:${PYTHONPATH:-}" \
    AGUI_HTTP_PORT=8887 \
    HEALTH_HTTP_PORT=8881 \
    "$PY" -m src.main > "${LOG_AGENT}" 2>&1
  ) &
  echo $! > "$PID_AGENT"
fi

# ── OpenAI Agents SDK (port 8891) ────────────────────────────────────────────
# Launches unconditionally — the dep-install loop above will exit non-zero
# before this point if openai_agent/.venv is missing or broken. A file-
# existence guard here would silently skip launch and produce the "no agent"
# class of failure CLAUDE.md warns about.
echo "[OASDK] Starting OpenAI Agents SDK service (:8891)..."
(
  cd "$BASEDIR/openai_agent"
  .venv/bin/python -m src.main >> "$LOG_OASDK" 2>&1
) &
echo $! > "$PID_OASDK"

# ── Mastra Agent (port 8892) ─────────────────────────────────────────────────
# Mastra is in SVC_LIST above — install + build are guaranteed before this
# point. Launch unconditionally; if dist/index.js is missing, MODULE_NOT_FOUND
# in the log is a clearer failure than a silent skip.
echo "[MASTRA] Starting Mastra Agent (:8892)..."
(
  cd "$BASEDIR/mastra_agent"
  node dist/index.js >> "$LOG_MASTRA" 2>&1
) &
echo $! > "$PID_MASTRA"

# ── Pydantic AI Agent (port 8893) ────────────────────────────────────────────
echo "[PYDANTIC] Starting Pydantic AI Agent (:8893)..."
(
  cd "$BASEDIR/pydantic_agent"
  .venv/bin/python -m src.main >> "$LOG_PYDANTIC" 2>&1
) &
echo $! > "$PID_PYDANTIC"

# ── LM Studio auto-configure ─────────────────────────────────────────────────
# If LM Studio's local server is running (default :1234), ensure the target
# model is loaded so the demo works without manual setup. Non-blocking —
# failure just means the user needs to load the model manually in LM Studio.
(
  LMS_BASE="${LMSTUDIO_BASE_URL:-http://localhost:1234}"
  LMS_BASE="${LMS_BASE%/v1}"  # strip /v1 suffix if present
  LMS_DEFAULT_MODEL="${LMSTUDIO_DEFAULT_MODEL:-google/gemma-4-e2b}"

  # Single fetch — reachability + loaded-model list in one call
  LMS_MODELS=$(curl -sf --max-time 3 "${LMS_BASE}/api/v1/models" 2>/dev/null)
  if [ $? -eq 0 ] && [ -n "${LMS_MODELS}" ]; then
    echo "[LMS]  LM Studio server detected at ${LMS_BASE}"

    LOADED=$(echo "${LMS_MODELS}" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  loaded = [m['key'] for m in d.get('models',[]) if m.get('loaded_instances')]
  print(' '.join(loaded))
except: pass
" 2>/dev/null)

    if echo "${LOADED}" | grep -qF "${LMS_DEFAULT_MODEL}"; then
      echo "[LMS]  Model already loaded: ${LMS_DEFAULT_MODEL} — ready"
    else
      echo "[LMS]  Loading model: ${LMS_DEFAULT_MODEL}…"
      LOAD_RESULT=$(curl -sf --max-time 15 -X POST "${LMS_BASE}/api/v1/models/load" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"${LMS_DEFAULT_MODEL}\"}" 2>/dev/null)
      if [ $? -eq 0 ]; then
        echo "[LMS]  Model loaded: ${LMS_DEFAULT_MODEL}"
      else
        echo "[LMS]  Could not load model (not downloaded yet?) — use LM Studio UI to download ${LMS_DEFAULT_MODEL}"
      fi
    fi
  else
    echo "[LMS]  LM Studio server not detected — start it in LM Studio → Developer tab"
  fi

) &

# Wait for Tier 3 services (UI and LangChain were launched above to run in parallel)
wait_for_health 3006 "/health" 15 "Agent Service"     "${LOG_AGENT_SVC}" >/dev/null
wait_for_health 8081 "/health" 15 "MCP Invest Server" "${LOG_INVEST}"    >/dev/null
wait_for_health 8082 "/health" 10 "Demo Mortgage"     "${LOG_MORTGAGE}"  >/dev/null
# UI: port-only (CRA has no /health endpoint); full 90s budget since UI launched before waits
wait_for_port "${UI_PORT}" 90 "Demo UI" >/dev/null
# LangChain: warn-only, not a gate (health on 8881 due to OrbStack port conflicts)
wait_for_health 8881 "/health" 20 "LangChain Agent" "${LOG_AGENT}" >/dev/null || true

# ── Log janitor (intra-session size cap) ─────────────────────────────────────
_log_janitor_loop &
echo $! > "$PID_LOG_JANITOR"

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  [CLEAR]  DEMO STATE CLEARED${RESET} — all in-memory state reset on startup:"
echo -e "${DIM}      Token chain · App events · MCP audit · Pending consents${RESET}"

echo ""
echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${CYAN}${BOLD}   [BANK]  AI DEMO — STATUS                           ${RESET}"
echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
print_status_table
echo ""
echo -e "${MAGENTA}${BOLD}  ┌─ PORTS ─────────────────────────────────────────────────────┐${RESET}"
echo -e "${MAGENTA}${BOLD}  │${RESET}  [PORT]  Demo API Server           :${API_PORT}  ${YELLOW}(${PROTO_LABEL})${RESET}"
echo -e "${MAGENTA}${BOLD}  │${RESET}  [WEB]  Demo UI (React)        :${UI_PORT}  ${YELLOW}(${PROTO_LABEL})${RESET}"
echo -e "${MAGENTA}${BOLD}  │${RESET}  [BOT]  Demo MCP Server           :8080  ${YELLOW}(WebSocket)${RESET}"
echo -e "${MAGENTA}${BOLD}  │${RESET}  [CHAIN]  LangChain Agent    :8889  ${YELLOW}(chat WS)${RESET}  :8890  ${YELLOW}(health)${RESET}"
echo -e "${MAGENTA}${BOLD}  │${RESET}  [OASDK]  OpenAI Agents SDK         :8891${RESET}"
echo -e "${MAGENTA}${BOLD}  │${RESET}  [MASTRA] Mastra Agent               :8892${RESET}"
echo -e "${MAGENTA}${BOLD}  │${RESET}  [PYDANTIC] Pydantic AI Agent        :8893${RESET}"
echo -e "${MAGENTA}${BOLD}  └─────────────────────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "${GREEN}${BOLD}  ┌─ URLS ──────────────────────────────────────────────────────┐${RESET}"
echo -e "${GREEN}${BOLD}  │${RESET}  [WEB]  App            ${YELLOW}${BOLD}${CLIENT_URL}${RESET}"
echo -e "${GREEN}${BOLD}  │${RESET}  [CONFIG]   Admin Config   ${YELLOW}${BOLD}${CLIENT_URL}/config${RESET}"
echo -e "${GREEN}${BOLD}  │${RESET}  [SSL]  Admin Login    ${YELLOW}${BOLD}${API_URL}/api/auth/oauth/login${RESET}"
echo -e "${GREEN}${BOLD}  │${RESET}  [USER]  User Login     ${YELLOW}${BOLD}${API_URL}/api/auth/oauth/user/login${RESET}"
echo -e "${GREEN}${BOLD}  │${RESET}  [TRACE] Jaeger UI      ${YELLOW}${BOLD}http://localhost:${JAEGER_UI_PORT}${RESET}  ${DIM}(BFF, gateway, MCP, authz, HITL, agent)${RESET}"
echo -e "${GREEN}${BOLD}  └─────────────────────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "${MAGENTA}${BOLD}  ┌─ QUICK START ───────────────────────────────────────────────┐${RESET}"
echo -e "${MAGENTA}${BOLD}  │${RESET}  1. Open ${YELLOW}${CLIENT_URL}/config${RESET} → enter PingOne credentials"
echo -e "${MAGENTA}${BOLD}  │${RESET}  2. Open ${YELLOW}${CLIENT_URL}${RESET} → click ${WHITE}${BOLD}Login${RESET} to start an OAuth flow"
echo -e "${MAGENTA}${BOLD}  │${RESET}  3. After login: use the [BOT] FAB (bottom-right) for the Demo Agent"
echo -e "${MAGENTA}${BOLD}  │${RESET}     Ask: balance, accounts, transactions, transfer, withdraw"
echo -e "${MAGENTA}${BOLD}  └─────────────────────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "${WHITE}${BOLD}  ┌─ MANAGE ────────────────────────────────────────────────────┐${RESET}"
echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run.sh status${RESET}   — live service health check"
echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run.sh tail${RESET}     — pick log (or ${DIM}./run.sh tail all${RESET})"
echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run.sh stop${RESET}     — stop all services"
echo -e "${WHITE}${BOLD}  │${RESET}  ${DIM}tail -f ${LOG_API}${RESET}"
echo -e "${WHITE}${BOLD}  │${RESET}  ${DIM}tail -f ${LOG_UI}${RESET}"
echo -e "${WHITE}${BOLD}  │${RESET}  ${DIM}tail -f ${LOG_MCP}${RESET}"
echo -e "${WHITE}${BOLD}  └─────────────────────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# Only offer the interactive log-picker when stdout is a real terminal.
# In non-interactive contexts (CI, piped, Claude tool) stdin has no TTY so
# `read` returns immediately with an empty string, which hits the "Invalid
# choice" branch and exits 1 — misleading for a successful startup.
if [[ -t 1 ]]; then
  tail_demo_logs
fi
