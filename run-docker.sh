#!/usr/bin/env bash
# run-docker.sh — Docker Compose launcher for the AI Demo.
#
# Always stops any running containers before starting (clean slate).
#
# Usage:
#   ./run-docker.sh                       start all services (stop first)
#   ./run-docker.sh stop                  stop and remove containers (+ host model tiers)
#   ./run-docker.sh stop <svc>...         stop only the named service(s)
#   ./run-docker.sh restart               stop then start everything (same as default)
#   ./run-docker.sh restart <svc>...      recreate only the named service(s) — picks up env/compose changes
#   ./run-docker.sh build                 stop, rebuild all images, then start
#   ./run-docker.sh build <svc>...        rebuild + restart only the named service(s)
#   ./run-docker.sh logs [svc]            follow logs (all, or one service name)
#   ./run-docker.sh status                show container health table
#   ./run-docker.sh llamacpp restart      stop and restart host model tiers 8091-8096 (containers untouched)
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

# ── Local LLM (host) lifecycle — multi-model proxy ───────────────────────────
# :8090 is the multi-model LLM proxy (the llm-proxy container running
# demo_llm_proxy/router.js) — NEVER bind a raw llama-server straight onto it.
# The proxy classifies each request and routes to 4 tier llama-server backends
# on host ports 8091-8096, managed by demo_llm_proxy/start-local-models.sh
# (GGUFs verified by demo_llm_proxy/download-models.sh). Dockerized services
# reach the proxy at http://llm-proxy:8090 (in-network) or
# host.docker.internal:8090; the proxy reaches the tiers via
# host.docker.internal:8091-8096. We start the tiers before the stack and stop
# them with the stack.
# (k8s is unaffected — there llama.cpp runs as an in-cluster pod; see run-k8.sh.)
LLAMACPP_MODEL="${LLAMACPP_MODEL:-gemma-3-4b-it}"   # model id label reported to services
_LLAMACPP_PIDFILE="/tmp/demo-llamacpp.pid"          # legacy single-server pidfile (cleanup only)
_TIERS_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/demo_llm_proxy/start-local-models.sh"

_proxy_up() { curl -sf --max-time 2 http://127.0.0.1:8090/health >/dev/null 2>&1; }

# Legacy guard: a raw llama-server bound to :8090 shadows the llm-proxy
# container on IPv4 (both listen; IPv4 clients then hit the wrong backend).
_clear_8090_squatter() {
  local pids
  pids=$(lsof -nP -iTCP:8090 -sTCP:LISTEN 2>/dev/null | awk '$1 ~ /^llama/ {print $2}' | sort -u)
  if [[ -n "$pids" ]]; then
    warn "raw llama-server bound to :8090 shadows the LLM proxy — stopping it (PID ${pids})"
    kill $pids 2>/dev/null || true
    rm -f "$_LLAMACPP_PIDFILE"
  fi
}

start_llamacpp() {
  command -v llama-server >/dev/null 2>&1 || { warn "llama-server not installed — local LLM tiers disabled (brew install llama.cpp)"; return 0; }
  _clear_8090_squatter
  # Start the 4 tier backends (idempotent — already-running tiers are left alone).
  # :8090 itself is served by the llm-proxy container once the stack is up.
  if bash "$_TIERS_SCRIPT" start; then
    ok "model tiers ready on :8091-8096 — llm-proxy container serves :8090"
  else
    warn "model tiers failed to start — verify GGUFs: bash demo_llm_proxy/download-models.sh (logs: /tmp/llama-models/)"
  fi
}

stop_llamacpp() {
  bash "$_TIERS_SCRIPT" stop 2>/dev/null || true
  _clear_8090_squatter
  rm -f "$_LLAMACPP_PIDFILE"
  ok "model tiers stopped"
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

# ── Host port-conflict preflight ──────────────────────────────────────────────
# A stale bare-metal `./run.sh` session (or any non-Docker process) holding a
# port Docker publishes will SILENTLY shadow the container: `docker ps` shows
# the mapping as bound, but the OS routes localhost:<port> to the host process
# that grabbed it first. Symptom: a false "Required servers not running" modal
# even though every container is healthy (the UI's :4000 is served by the stale
# host vite, whose proxy points at a dev API port that isn't running).
#
# Before `up`, clear any NON-Docker listener on a Docker-published port. Docker's
# own forwarders (OrbStack / com.docker / vpnkit) are left alone, and the
# intentional host model tiers on :8091-8096 are never touched (not in SERVICES);
# :8090 IS in SERVICES (llm-proxy container), so a stale host listener there —
# e.g. a legacy raw llama-server — gets cleared, which is exactly what we want.
clear_stale_host_listeners() {
  local cleared=0 entry _svc _label port pids pid cmd
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r _svc _label port _ <<< "${entry}"
    port="${port//[[:space:]]/}"
    [[ -z "${port}" ]] && continue
    pids=$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
    [[ -z "${pids}" ]] && continue
    for pid in ${pids}; do
      cmd=$(ps -o comm= -p "${pid}" 2>/dev/null || true)
      # Skip Docker/OrbStack's own port forwarders — those ARE the container.
      case "${cmd}" in
        *[Dd]ocker*|*[Oo]rb[Ss]tack*|*vpnkit*|*containerd*) continue ;;
      esac
      warn "Port ${port} held by non-Docker process '${cmd##*/}' (pid ${pid}) — a stale ./run.sh session would shadow the container. Stopping it."
      kill "${pid}" 2>/dev/null || true
      cleared=1
    done
  done
  if [[ "${cleared}" == "1" ]]; then
    sleep 1
    ok "Cleared stale bare-metal listeners on Docker-published ports"
  else
    ok "No host/port conflicts — Docker owns all published ports"
  fi
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

  # Host llama.cpp must be up + bound 0.0.0.0 before the BFF starts so it isn't
  # reported "not configured" on the first request.
  start_llamacpp
  echo ""

  # Clear any stale bare-metal listener (e.g. a leftover ./run.sh vite on :4000)
  # that would silently shadow a Docker container's published port.
  clear_stale_host_listeners
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
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh llamacpp restart${RESET}  restart host model tiers"
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

cmd_llamacpp_restart() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [LLAMA.CPP]  Restarting model tiers 8091-8096 (containers untouched)${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  stop_llamacpp
  echo ""
  start_llamacpp
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
  echo "    stop                  Stop and remove all containers (+ host model tiers)"
  echo "    stop <svc>...         Stop only the named service(s); others keep running"
  echo "    restart               Same as default — stop then start everything"
  echo "    restart <svc>...      Recreate only the named service(s); picks up env/compose"
  echo "                          changes (use 'build' for code changes); others untouched"
  echo "    build                 Stop, rebuild all images, then start"
  echo "    build <svc>...        Rebuild + restart only the named service(s); others untouched"
  echo "    logs                  Interactive log picker (pick service by number)"
  echo "    logs <service>        Tail a specific service directly"
  echo "    status                Show container health table"
  echo "    llamacpp restart      Stop and restart host model tiers 8091-8096 (containers untouched)"
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
      stop_llamacpp
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
  llamacpp)
    if [[ "${1:-}" == "restart" ]]; then
      cmd_llamacpp_restart
    else
      err "Unknown llamacpp subcommand: ${1:-}"
      echo ""
      echo "  Usage: ./run-docker.sh llamacpp restart"
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
