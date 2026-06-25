#!/usr/bin/env bash
# run-docker.sh — Docker Compose launcher for the AI Demo.
#
# Always stops any running containers before starting (clean slate).
#
# Usage:
#   ./run-docker.sh                       start all services (stop first)
#   ./run-docker.sh stop                  stop and remove containers (+ host Ollama)
#   ./run-docker.sh stop <svc>...         stop only the named service(s)
#   ./run-docker.sh restart               stop then start everything (same as default)
#   ./run-docker.sh restart <svc>...      recreate only the named service(s) — picks up env/compose changes
#   ./run-docker.sh build                 stop, rebuild all images, then start
#   ./run-docker.sh build <svc>...        rebuild + restart only the named service(s)
#   ./run-docker.sh logs [svc]            follow logs (all, or one service name)
#   ./run-docker.sh status                show container health table
#   ./run-docker.sh ollama restart        stop and restart host Ollama (containers untouched)
#   ./run-docker.sh help                  show this message
#
# Single-service commands take one OR MORE service names, e.g.
#   ./run-docker.sh restart ui demo-api-server
#
# Hot reload: when docker-compose.override.yml is present (it is, by default),
# the UI runs the Vite dev server (HMR) and the BFF runs `node --watch` — code
# edits reflect without a rebuild. Run with PROD_MODE=1 to use the nginx
# production build instead, e.g.  PROD_MODE=1 ./run-docker.sh start

set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${BASEDIR}/docker-compose.yml"
OVERRIDE_FILE="${BASEDIR}/docker-compose.override.yml"

# Auto-merge the local dev override (Vite HMR for the UI + `node --watch` for the
# BFF) when it's present. Passing -f explicitly disables Compose's implicit
# docker-compose.override.yml merge, so we add it back here. Set PROD_MODE=1 to
# run the nginx production build instead (skips the override).
COMPOSE_FILES=(-f "${COMPOSE_FILE}")
if [[ "${PROD_MODE:-0}" != "1" && -f "${OVERRIDE_FILE}" ]]; then
  COMPOSE_FILES+=(-f "${OVERRIDE_FILE}")
fi

# ── Colours ───────────────────────────────────────────────────────────────────
BOLD='\033[1m'
CYAN='\033[1;36m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
MAGENTA='\033[1;35m'
WHITE='\033[1;37m'
RED='\033[1;31m'
DIM='\033[2m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET}  $*"; }
warn() { echo -e "  ${YELLOW}!${RESET}  $*"; }
err()  { echo -e "  ${RED}✗${RESET}  $*" >&2; }

# ── Bind-mount preflight ──────────────────────────────────────────────────────
# docker-compose.yml bind-mounts two gitignored HOST paths into the BFF:
#   ./certs       -> /certs       (HTTPS cert + key)
#   ./LLM2.json   -> /LLM2.json   (Helix agent key)
# Docker auto-creates a MISSING bind source as an empty DIRECTORY. If that
# happens the BFF serves plain HTTP (its HTTPS healthcheck then fails and the
# whole stack is gated unhealthy) and the Helix key mount becomes a bogus dir.
# Guarantee both exist as the correct TYPE before every `up` (start + restart).
ensure_bind_mounts() {
  local certs_dir="${BASEDIR}/certs"
  local cert_file="${certs_dir}/api.ping.demo+2.pem"
  local key_file="${certs_dir}/api.ping.demo+2-key.pem"
  local llm2="${BASEDIR}/LLM2.json"

  # certs/ — generate with mkcert if missing; abort if we can't (an HTTPS stack
  # cannot come up healthy without them).
  if [[ ! -f "$cert_file" || ! -f "$key_file" ]]; then
    if command -v mkcert >/dev/null 2>&1; then
      warn "TLS certs missing — generating with mkcert..."
      mkdir -p "$certs_dir"
      local ca_root; ca_root="$(mkcert -CAROOT 2>/dev/null)" || ca_root=""
      [[ -n "$ca_root" && -f "$ca_root/rootCA.pem" && ! -f "$certs_dir/rootCA.pem" ]] \
        && cp "$ca_root/rootCA.pem" "$certs_dir/rootCA.pem"
      ( cd "$certs_dir" && mkcert api.ping.demo localhost 127.0.0.1 ) \
        && ok "TLS certs generated in certs/." \
        || { err "mkcert cert generation failed — run: cd ${certs_dir} && mkcert api.ping.demo localhost 127.0.0.1"; exit 1; }
    else
      err "Missing ${cert_file} and mkcert is not installed."
      err "Run ./install.sh once, or: brew install mkcert && mkcert -install && cd certs && mkcert api.ping.demo localhost 127.0.0.1"
      exit 1
    fi
  else
    ok "TLS certs present in certs/."
  fi

  # LLM2.json — must be a FILE. Replace a stray Docker-created directory, and
  # placeholder a missing key so the mount is a file (Helix stays unconfigured
  # until a real key is dropped in — the loader tolerates an empty/{} key).
  if [[ -d "$llm2" ]]; then
    warn "LLM2.json is a directory (Docker auto-created it) — replacing with a file."
    rm -rf "$llm2"
  fi
  if [[ ! -f "$llm2" ]]; then
    warn "LLM2.json missing — writing an empty placeholder (Helix disabled until a real key is provided)."
    echo '{}' > "$llm2"
  else
    ok "LLM2.json present."
  fi
}

# ── Git sync preflight ────────────────────────────────────────────────────────
# run-docker builds from the WORKING TREE, not from git — so a build can quietly
# ship uncommitted edits or a branch that's behind origin. This is advisory: dev
# often deploys local changes on purpose, so it WARNS, never blocks. Silence with
# SKIP_GIT_CHECK=1. Tolerates being offline or outside a git repo.
git_sync_check() {
  [[ "${SKIP_GIT_CHECK:-0}" == "1" ]] && return 0
  command -v git >/dev/null 2>&1 || return 0
  git -C "${BASEDIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0

  local branch dirty upstream counts ahead behind clean=1
  branch="$(git -C "${BASEDIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

  # Refresh remote tracking refs; tolerate no network.
  if ! git -C "${BASEDIR}" fetch --quiet 2>/dev/null; then
    warn "git: couldn't reach remote — comparing against last-known origin."
  fi

  dirty="$(git -C "${BASEDIR}" status --porcelain 2>/dev/null || true)"
  if [[ -n "$dirty" ]]; then
    clean=0
    warn "git: $(printf '%s\n' "$dirty" | grep -c .) uncommitted change(s) on '${branch}' — these WILL be built."
  fi

  upstream="$(git -C "${BASEDIR}" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
  if [[ -n "$upstream" ]]; then
    counts="$(git -C "${BASEDIR}" rev-list --left-right --count "HEAD...${upstream}" 2>/dev/null || echo '0	0')"
    ahead="$(printf '%s' "$counts" | awk '{print $1+0}')"
    behind="$(printf '%s' "$counts" | awk '{print $2+0}')"
    if [[ "${behind}" -gt 0 ]]; then
      clean=0
      warn "git: '${branch}' is ${behind} commit(s) BEHIND ${upstream} — run: git pull"
    fi
    if [[ "${ahead}" -gt 0 ]]; then
      clean=0
      warn "git: '${branch}' is ${ahead} commit(s) ahead of ${upstream} (unpushed)."
    fi
  else
    clean=0
    warn "git: '${branch}' has no upstream — can't compare to remote."
  fi

  if [[ "$clean" == "1" ]]; then
    ok "git: '${branch}' clean and in sync with ${upstream}."
  else
    warn "Building from the working tree anyway (set SKIP_GIT_CHECK=1 to silence)."
  fi
}

# ── Ollama (host) lifecycle ───────────────────────────────────────────────────
# The dockerized BFF reaches Ollama on the HOST via host.docker.internal, which
# requires Ollama to bind 0.0.0.0 (not its 127.0.0.1 default) — otherwise the
# provider shows "not configured". We start it before the stack, stop it with the
# stack. The server is usually the macOS Ollama.app; on a headless host we fall
# back to `ollama serve`. The 0.0.0.0 bind is persisted across logins by a launchd
# setenv agent (install once: scripts/install-ollama-launchagent.sh).
# (k8s is unaffected — there Ollama runs as an in-cluster pod; see run-k8.sh.)
OLLAMA_BFF_MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"   # small, non-reasoning — answers under the SPA timeout
OLLAMA_AGENT_MODEL="qwen3:8b"                     # heavier reasoning for agent-service
_OLLAMA_PIDFILE="/tmp/demo-ollama.pid"

_ollama_up()        { curl -sf --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; }
_ollama_bound_all() { lsof -nP -iTCP:11434 -sTCP:LISTEN 2>/dev/null | grep -q '\*:11434'; }

# Start whichever server this host has, with OLLAMA_HOST=0.0.0.0 in scope.
_ollama_spawn() {
  if [[ "$(uname)" == "Darwin" && -d "/Applications/Ollama.app" ]]; then
    open -a Ollama 2>/dev/null || true        # app inherits OLLAMA_HOST from the setenv agent
  else
    OLLAMA_HOST="0.0.0.0" nohup ollama serve >/tmp/demo-ollama.log 2>&1 &
    echo $! > "$_OLLAMA_PIDFILE"
  fi
}

start_ollama() {
  command -v ollama >/dev/null 2>&1 || { warn "ollama not installed — 'Ollama only' agent mode disabled (brew install ollama)"; return 0; }
  # Persist + apply the network bind so containers can reach Ollama.
  [[ "$(uname)" == "Darwin" ]] && launchctl setenv OLLAMA_HOST 0.0.0.0 2>/dev/null || true
  export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0}"

  if _ollama_up && _ollama_bound_all; then
    ok "Ollama already running (0.0.0.0)"
  elif _ollama_up; then
    # Up but bound to loopback only (e.g. first boot before the setenv agent ran) —
    # restart so it rebinds on all interfaces; containers can't reach 127.0.0.1.
    warn "Ollama bound to loopback — restarting to expose 0.0.0.0 for containers"
    osascript -e 'quit app "Ollama"' 2>/dev/null || true
    pkill -f "ollama serve" 2>/dev/null || true
    sleep 2
    _ollama_spawn
  else
    _ollama_spawn
  fi

  local i=0; while [[ $i -lt 12 ]]; do _ollama_up && break; sleep 1; (( i++ )) || true; done
  if _ollama_up; then
    _ollama_bound_all && ok "Ollama ready (0.0.0.0:11434)" \
      || warn "Ollama up but not bound to 0.0.0.0 — containers may not reach it"
    ollama list 2>/dev/null | grep -q "$OLLAMA_BFF_MODEL"   || { echo "  Pulling ${OLLAMA_BFF_MODEL} (BFF NL intent)…";   ollama pull "$OLLAMA_BFF_MODEL"   || warn "pull ${OLLAMA_BFF_MODEL} failed"; }
    ollama list 2>/dev/null | grep -q "$OLLAMA_AGENT_MODEL" || { echo "  Pulling ${OLLAMA_AGENT_MODEL} (agent reasoning)…"; ollama pull "$OLLAMA_AGENT_MODEL" || warn "pull ${OLLAMA_AGENT_MODEL} failed"; }
  else
    warn "Ollama did not become ready — check /tmp/demo-ollama.log"
  fi
}

stop_ollama() {
  # Stop the server whether it's the GUI app or a headless `ollama serve`.
  [[ "$(uname)" == "Darwin" ]] && osascript -e 'quit app "Ollama"' 2>/dev/null || true
  if [[ -f "$_OLLAMA_PIDFILE" ]]; then
    kill "$(cat "$_OLLAMA_PIDFILE")" 2>/dev/null || true
    rm -f "$_OLLAMA_PIDFILE"
  fi
  pkill -f "ollama serve" 2>/dev/null || true
  ok "Ollama stopped"
}

# ── Preflight ─────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  err "docker not found — install Docker Desktop and try again."
  exit 1
fi

if [[ ! -f "${BASEDIR}/demo_api_server/.env" ]]; then
  err "demo_api_server/.env not found."
  echo ""
  echo "  Run bootstrap first:"
  echo "    cd demo_api_server && npm run pingone:bootstrap"
  echo ""
  exit 1
fi

# ── Service / port / log table (matches docker-compose.yml) ──────────────────
SERVICES=(
  "demo-api-server|BFF (Express)        |3001|https://api.ping.demo:3001"
  "ui|UI (React / nginx)   |4000|https://api.ping.demo:4000"
  "mcp-server|MCP Server            |8080|http://localhost:8080"
  "mcp-gateway|MCP Gateway           |3005|http://localhost:3005"
  "mcp-proxy|MCP Proxy             |8895|http://localhost:8895"
  "ping-gateway|Ping Gateway          |3036|http://localhost:3036"
  "langchain-agent|LangChain Agent      |8888|http://localhost:8888"
  "agent-service|Agent Service         |3016|http://localhost:3016"
  "hitl-service|HITL Service          |3009|http://localhost:3009"
  "mcp-invest|MCP Invest            |8081|http://localhost:8081"
  "mortgage-service|Mortgage Service     |8082|http://localhost:8082"
  "openai-agent|OpenAI Agent          |8891|http://localhost:8891"
  "mastra-agent|Mastra Agent          |8892|http://localhost:8892"
  "pydantic-agent|Pydantic AI Agent    |8893|http://localhost:8893"
  "authz-server|Authz Server          |9001|http://localhost:9001"
)

# True if $1 is one of the compose service names in SERVICES.
is_known_service() {
  local want="${1:-}"
  [[ -z "${want}" ]] && return 1
  for entry in "${SERVICES[@]}"; do
    [[ "${entry%%|*}" == "${want}" ]] && return 0
  done
  return 1
}

# Compact name→port table of every service (used by help + unknown-service errors).
print_service_table() {
  echo -e "  ${WHITE}${BOLD}SERVICE                       PORT${RESET}"
  echo -e "  ${DIM}──────────────────────────────────────────${RESET}"
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r svc label port _ <<< "${entry}"
    printf "  ${BOLD}%-28s${RESET} %s\n" "${svc}" ":${port}"
  done
}

# ── Helpers ───────────────────────────────────────────────────────────────────

print_status_table() {
  echo -e "  ${WHITE}${BOLD}SERVICE                       STATUS        PORT${RESET}"
  echo -e "  ${DIM}──────────────────────────────────────────────────────────${RESET}"
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r svc label port _ <<< "${entry}"
    state=$(docker compose "${COMPOSE_FILES[@]}" ps --format '{{.State}}' "${svc}" 2>/dev/null | head -1 || true)
    if [[ "${state}" == "running" ]]; then
      status_str="${GREEN}${BOLD}running${RESET}"
    elif [[ -n "${state}" ]]; then
      status_str="${RED}${BOLD}${state}${RESET}"
    else
      status_str="${DIM}stopped${RESET}"
    fi
    printf "  ${BOLD}%-30s${RESET} %-25b %s\n" "${label}" "${status_str}" ":${port}"
  done
}

tail_logs() {
  local svc="${1:-}"
  if [[ -n "${svc}" ]]; then
    echo -e "${DIM}  Following logs for ${svc} — Ctrl+C to stop${RESET}"
    echo ""
    docker compose "${COMPOSE_FILES[@]}" logs -f --tail=50 "${svc}"
  else
    # Interactive picker when no service specified and we're on a TTY
    if [[ ! -t 1 ]]; then
      docker compose "${COMPOSE_FILES[@]}" logs -f --tail=50
      return
    fi
    echo ""
    echo -e "${WHITE}${BOLD}  Pick a service to tail (or 'all'):${RESET}"
    echo ""
    local i=1
    for entry in "${SERVICES[@]}"; do
      IFS='|' read -r svc label port _ <<< "${entry}"
      printf "    ${BOLD}%2d${RESET}  %s\n" "${i}" "${label}"
      i=$(( i + 1 ))
    done
    echo ""
    printf "  ${BOLD}Choice [1-%d, all, q]:${RESET} " "${#SERVICES[@]}"
    read -r choice < /dev/tty
    echo ""
    if [[ "${choice}" == "q" || -z "${choice}" ]]; then
      return
    elif [[ "${choice}" == "all" ]]; then
      docker compose "${COMPOSE_FILES[@]}" logs -f --tail=50
    elif [[ "${choice}" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#SERVICES[@]} )); then
      IFS='|' read -r picked_svc _ _ _ <<< "${SERVICES[$(( choice - 1 ))]}"
      echo -e "${DIM}  Following ${picked_svc} — Ctrl+C to stop${RESET}"
      echo ""
      docker compose "${COMPOSE_FILES[@]}" logs -f --tail=50 "${picked_svc}"
    else
      err "Invalid choice: ${choice}"
    fi
  fi
}

# ── Commands ──────────────────────────────────────────────────────────────────

cmd_stop() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [DOCKER]  AI DEMO — STOPPING                                    ${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  docker compose "${COMPOSE_FILES[@]}" down --remove-orphans 2>/dev/null || true
  ok "All containers stopped and removed."
  echo ""
}

cmd_down() {
  local remove_volumes="${1:-}"
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  if [[ "$remove_volumes" == "-v" ]]; then
    echo -e "${CYAN}${BOLD}   [DOCKER]  AI DEMO — DOWN (removing volumes)                     ${RESET}"
  else
    echo -e "${CYAN}${BOLD}   [DOCKER]  AI DEMO — DOWN                                       ${RESET}"
  fi
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  if [[ "$remove_volumes" == "-v" ]]; then
    docker compose "${COMPOSE_FILES[@]}" down -v --remove-orphans 2>/dev/null || true
    ok "All containers, networks, and volumes removed."
  else
    docker compose "${COMPOSE_FILES[@]}" down --remove-orphans 2>/dev/null || true
    ok "All containers and networks stopped and removed (volumes preserved)."
  fi
  echo ""
}

# ── Single / multi-service operations ─────────────────────────────────────────
# Operate on ONLY the named service(s), leaving every other container running.
# Each accepts one or more service names (e.g. `restart ui demo-api-server`).
# --no-deps keeps Docker from pulling dependency services into the action.
# `restart` force-recreates so env / compose changes ARE picked up (a plain
# `docker compose restart` reuses the old container); use `build` for code
# changes that need a fresh image.
_require_services() {
  if [[ $# -eq 0 ]]; then
    err "No service specified."
    echo ""
    print_service_table
    echo ""
    exit 1
  fi
  for svc in "$@"; do
    if ! is_known_service "${svc}"; then
      err "Unknown service: ${svc}"
      echo ""
      print_service_table
      echo ""
      exit 1
    fi
  done
}

# True if "demo-api-server" is among the given service names (its HTTPS health
# depends on the gitignored bind mounts existing as the right type).
_includes_bff() {
  for svc in "$@"; do [[ "${svc}" == "demo-api-server" ]] && return 0; done
  return 1
}

cmd_stop_one() {
  _require_services "$@"
  echo ""
  echo -e "${CYAN}${BOLD}   [DOCKER]  Stopping ${*} (others untouched)${RESET}"
  echo ""
  docker compose "${COMPOSE_FILES[@]}" stop "$@"
  ok "Stopped: ${*}."
  echo ""
}

cmd_restart_one() {
  _require_services "$@"
  echo ""
  echo -e "${CYAN}${BOLD}   [DOCKER]  Restarting ${*} (others untouched)${RESET}"
  echo ""
  git_sync_check; echo ""
  _includes_bff "$@" && { ensure_bind_mounts; echo ""; }
  docker compose "${COMPOSE_FILES[@]}" up -d --force-recreate --no-deps "$@"
  ok "Restarted: ${*}."
  echo ""
}

cmd_build_one() {
  local build_opts=""
  local services=()

  for arg in "$@"; do
    if [[ "$arg" == "--no-cache" || "$arg" == "--pull" ]]; then
      build_opts="${build_opts} ${arg}"
    else
      services+=("$arg")
    fi
  done

  _require_services "${services[@]}"
  echo ""
  echo -e "${CYAN}${BOLD}   [DOCKER]  Rebuilding + restarting ${services[@]} (others untouched)${RESET}"
  echo ""
  git_sync_check; echo ""
  _includes_bff "${services[@]}" && { ensure_bind_mounts; echo ""; }
  docker compose "${COMPOSE_FILES[@]}" up -d --build${build_opts} --no-deps "${services[@]}"
  ok "Rebuilt and restarted: ${services[@]}."
  echo ""
}

cmd_start() {
  local build_flag="${1:-}"

  # Always stop first — clean slate
  cmd_stop

  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [DOCKER]  AI DEMO — STARTING                                    ${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""

  # Advisory: warn if the working tree is dirty or out of sync with origin —
  # run-docker builds from local files, not from git.
  git_sync_check
  echo ""

  # Guarantee the gitignored bind-mount sources exist as the right type before
  # `up` — otherwise Docker creates empty dirs and the BFF comes up unhealthy.
  ensure_bind_mounts
  echo ""

  # Host Ollama must be up + bound 0.0.0.0 before the BFF starts so it isn't
  # reported "not configured" on the first request.
  start_ollama
  echo ""

  if [[ "${build_flag}" == "--build" ]]; then
    ok "Rebuilding images..."
    echo ""
    docker compose "${COMPOSE_FILES[@]}" up --build -d
  else
    docker compose "${COMPOSE_FILES[@]}" up -d
  fi

  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [DOCKER]  AI DEMO — STATUS                                      ${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  print_status_table
  echo ""
  echo -e "${GREEN}${BOLD}  ╭─ URLS ──────────────────────────────────────────────────────╮${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [WEB]    App            ${YELLOW}${BOLD}https://api.ping.demo:4000${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [CONFIG] Admin Config   ${YELLOW}${BOLD}https://api.ping.demo:4000/config${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [LOGIN]  Admin Login    ${YELLOW}${BOLD}https://api.ping.demo:3001/api/auth/oauth/login${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [USER]   User Login     ${YELLOW}${BOLD}https://api.ping.demo:3001/api/auth/oauth/user/login${RESET}"
  echo -e "${GREEN}${BOLD}  ╰─────────────────────────────────────────────────────────────╯${RESET}"
  echo ""
  echo -e "${MAGENTA}${BOLD}  ╭─ PORTS ─────────────────────────────────────────────────────╮${RESET}"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  BFF (Express)          :3001  ${YELLOW}(HTTPS)${RESET}"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  UI (React / nginx)     :4000  ${YELLOW}(HTTPS)${RESET}"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  MCP Server             :8080  ${YELLOW}(WebSocket)${RESET}"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  MCP Gateway            :3005"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  LangChain Agent        :8888  ${YELLOW}(SSE)${RESET}  :8889  ${YELLOW}(WS)${RESET}  :8890  ${YELLOW}(health)${RESET}"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  OpenAI Agent           :8891"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  Mastra Agent           :8892"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  Pydantic AI Agent      :8893"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  Agent Service          :3016"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  HITL Service           :3009"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  Mortgage Service       :8082"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  Authz Server           :9001"
  echo -e "${MAGENTA}${BOLD}  ╰─────────────────────────────────────────────────────────────╯${RESET}"
  echo ""
  echo -e "${WHITE}${BOLD}  ╭─ AVAILABLE COMMANDS ────────────────────────────────────────╮${RESET}"
  echo -e "${WHITE}${BOLD}  │${RESET}"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh${RESET}                   start all (default)"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh restart${RESET}           restart all containers"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh restart${RESET} <svc>     restart specific service(s)"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh build${RESET}             rebuild all images"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh build${RESET} <svc>       rebuild specific service(s)"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh stop${RESET}              stop all containers"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh stop${RESET} <svc>        stop specific service(s)"
  echo -e "${WHITE}${BOLD}  │${RESET}"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh logs${RESET}              pick service to tail"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh logs${RESET} <svc>        tail specific service"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh status${RESET}            show container health"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh ollama restart${RESET}    restart host Ollama"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh help${RESET}              show full help"
  echo -e "${WHITE}${BOLD}  │${RESET}"
  echo -e "${WHITE}${BOLD}  ╰─────────────────────────────────────────────────────────────╯${RESET}"
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""

  # Interactive log picker on TTY
  if [[ -t 1 ]]; then
    tail_logs
  fi
}

cmd_status() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [DOCKER]  AI DEMO — SERVICE STATUS                              ${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  print_status_table
  echo ""
  echo -e "${GREEN}${BOLD}  ╭─ URLS ──────────────────────────────────────────────────────╮${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [WEB]    App            ${YELLOW}${BOLD}https://api.ping.demo:4000${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [CONFIG] Admin Config   ${YELLOW}${BOLD}https://api.ping.demo:4000/config${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [LOGIN]  Admin Login    ${YELLOW}${BOLD}https://api.ping.demo:3001/api/auth/oauth/login${RESET}"
  echo -e "${GREEN}${BOLD}  ╰─────────────────────────────────────────────────────────────╯${RESET}"
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
}

cmd_ollama_restart() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [OLLAMA]  Restarting Ollama (containers untouched)${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  stop_ollama
  echo ""
  start_ollama
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${WHITE}${BOLD}  AVAILABLE COMMANDS${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "  ${BOLD}./run-docker.sh restart${RESET}        restart all containers"
  echo -e "  ${BOLD}./run-docker.sh status${RESET}         show container health"
  echo -e "  ${BOLD}./run-docker.sh logs${RESET}           tail container logs"
  echo -e "  ${BOLD}./run-docker.sh stop${RESET}           stop all containers"
  echo -e "  ${BOLD}./run-docker.sh help${RESET}           show full help"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
}

cmd_help() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [DOCKER]  AI DEMO — run-docker.sh                               ${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  echo -e "${WHITE}${BOLD}  Usage:${RESET}  ./run-docker.sh [command] [options]"
  echo ""
  echo -e "${WHITE}${BOLD}  Commands:${RESET}"
  echo "    (default)             Stop existing containers, then start all services"
  echo "    stop                  Stop and remove all containers (+ host Ollama)"
  echo "    stop <svc>...         Stop only the named service(s); others keep running"
  echo "    restart               Same as default — stop then start everything"
  echo "    restart <svc>...      Recreate only the named service(s); picks up env/compose"
  echo "                          changes (use 'build' for code changes); others untouched"
  echo "    build                 Stop, rebuild all images, then start"
  echo "    build <svc>...        Rebuild + restart only the named service(s); others untouched"
  echo "    logs                  Interactive log picker (pick service by number)"
  echo "    logs <service>        Tail a specific service directly"
  echo "    status                Show container health table"
  echo "    ollama restart        Stop and restart host Ollama (containers untouched)"
  echo "    help                  Show this message"
  echo ""
  echo -e "${WHITE}${BOLD}  Service Names (one or more for stop/restart/build; one for logs):${RESET}"
  print_service_table
  echo ""
  echo -e "${WHITE}${BOLD}  Port Layout:${RESET}"
  echo "    BFF (Express)          :3001  (HTTPS)"
  echo "    UI (React / nginx)     :4000  (HTTPS)"
  echo "    MCP Server             :8080  (WebSocket)"
  echo "    MCP Gateway            :3005"
  echo "    LangChain Agent        :8888 (SSE) :8889 (WS) :8890 (health)"
  echo "    OpenAI Agent           :8891"
  echo "    Mastra Agent           :8892"
  echo "    Pydantic AI Agent      :8893"
  echo "    Agent Service          :3016"
  echo "    HITL Service           :3009"
  echo "    Mortgage Service       :8082"
  echo "    Authz Server           :9001"
  echo ""
  echo -e "${WHITE}${BOLD}  One-time Setup:${RESET}"
  echo "    1. Bootstrap PingOne:  cd demo_api_server && npm run pingone:bootstrap"
  echo "    2. Add to /etc/hosts:  echo '127.0.0.1  api.ping.demo' | sudo tee -a /etc/hosts"
  echo "    3. Install mkcert CA:  mkcert -install"
  echo "    4. ./run-docker.sh"
  echo ""
  echo -e "${WHITE}${BOLD}  Examples:${RESET}"
  echo "    ./run-docker.sh                        # start everything"
  echo "    ./run-docker.sh build                       # rebuild all images first"
  echo "    ./run-docker.sh restart ui                  # recreate just the UI"
  echo "    ./run-docker.sh restart ui demo-api-server  # recreate the UI + BFF together"
  echo "    ./run-docker.sh build demo-api-server       # rebuild + restart just the BFF"
  echo "    ./run-docker.sh stop mcp-gateway            # stop just the MCP gateway"
  echo "    ./run-docker.sh logs demo-api-server        # tail BFF logs"
  echo "    ./run-docker.sh stop                        # tear down everything"
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
COMMAND="${1:-start}"
shift || true

case "${COMMAND}" in
  start|all)
    cmd_start
    ;;
  restart)
    if [[ -n "${1:-}" ]]; then cmd_restart_one "$@"; else cmd_start; fi
    ;;
  down)
    cmd_down "${1:-}"
    ;;
  stop)
    if [[ -n "${1:-}" ]]; then
      cmd_stop_one "$@"
    else
      cmd_stop
      stop_ollama
    fi
    ;;
  build)
    # Handle `build restart <svc>` by stripping redundant 'restart' keyword
    if [[ "${1:-}" == "restart" ]]; then
      shift || true
    fi
    if [[ -n "${1:-}" ]]; then cmd_build_one "$@"; else cmd_start --build; fi
    ;;
  logs)
    tail_logs "${1:-}"
    ;;
  ollama)
    if [[ "${1:-}" == "restart" ]]; then
      cmd_ollama_restart
    else
      err "Unknown ollama subcommand: ${1:-}"
      echo ""
      echo "  Usage: ./run-docker.sh ollama restart"
      echo ""
      exit 1
    fi
    ;;
  status)
    cmd_status
    ;;
  help|--help|-h)
    cmd_help
    ;;
  *)
    err "Unknown command: ${COMMAND}"
    cmd_help
    exit 1
    ;;
esac
