#!/usr/bin/env bash
# run-docker.sh — Docker Compose launcher for the AI Demo.
#
# Always stops any running containers before starting (clean slate).
#
# Usage:
#   ./run-docker.sh                       start core + Code Search (rag) — stop first
#   ./run-docker.sh start full            start every compose service (~2.3GB Docker)
#   ./run-docker.sh all                   same as `start full`
#   ./run-docker.sh demo-sync             align demo-auth containers with admin FF toggles
#   ./run-docker.sh optional start <grp>  start optional group(s) on a running stack
#   ./run-docker.sh optional stop <grp>   stop optional group(s); core keeps running
#   ./run-docker.sh optional status       show which optional groups are up
#   ./run-docker.sh stop                  stop and remove containers (+ host model tiers)
#   ./run-docker.sh stop <svc>...         stop only the named service(s)
#   ./run-docker.sh restart               stop then start core + rag (same as default)
#   ./run-docker.sh restart <svc>...      recreate only the named service(s) — picks up env/compose changes
#   ./run-docker.sh build                 stop, rebuild all images, then start core + rag
#   ./run-docker.sh build <svc>...        rebuild + restart only the named service(s)
#   ./run-docker.sh logs [svc]            follow logs (all, or one service name)
#   ./run-docker.sh status                show container health table
#   ./run-docker.sh llamacpp restart      stop and restart host LLM backend (llama.cpp tiers or oMLX)
#   ./run-docker.sh promptfoo             run Phi step-narration eval (core promptfoo sidecar)
#   ./run-docker.sh help                  show this message
#
# Optional groups (for `optional start|stop`):
#   rag        Code Search — started with core by default; `optional stop rag` to free RAM
#   agents     Alternate agent frameworks — openai-agent, mastra-agent, pydantic-agent
#   tracing    Jaeger OTLP backend
#   demo-auth  Demo authz-server + demo mcp-gateway (auto via demo-sync)
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
# shellcheck source=scripts/demo-terminal.sh
source "${BASEDIR}/scripts/demo-terminal.sh"
demo_init_terminal

# Pin the Compose project name so the stack is reachable by the same DNS
# namespace regardless of which directory (main checkout or a git worktree)
# the launcher is run from. docker-compose.yml documents this requirement
# at the ping-gateway service. Without it, the default project name derives
# from the cwd basename (e.g. "aidemo2guardrails" from a worktree), and
# containers left over from a run under a different project name survive
# `down --remove-orphans` because Compose can't see them — producing the
# "container name /ai-demo-... is already in use" conflict on the next start.
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-ai-demo}"

# Auto-merge the local dev override (Vite HMR for the UI + `node --watch` for the
# BFF) when it's present. Passing -f explicitly disables Compose's implicit
# docker-compose.override.yml merge, so we add it back here. Set PROD_MODE=1 to
# run the nginx production build instead (skips the override).
# Compose resolves `env_file:` and relative bind mounts against the PROJECT
# DIRECTORY, which defaults to the directory holding the compose file. A git
# worktree carries no gitignored files, so every service's .env is absent there
# — and because each `env_file:` entry is `required: false`, Compose skips it
# silently and the service dies later on a missing variable instead of failing
# at startup. Observed 2026-08-01 with the stack launched from a worktree:
# agent-service logged `injected env (0) from .env` then
# `Missing required env var: PINGONE_TOKEN_ENDPOINT`; mcp-jwt-verifier died on
# `KeyError: 'PINGONE_JWKS_URI'`; langchain-agent hit `STARTUP BLOCKED`; and
# ping-gateway came up "healthy" with none of its 22 vars, including
# PG_OLB_SCOPE (the documented cause of write-path 502s).
#
# Pin the project directory to the main checkout so the real .env files always
# resolve. This matches how the containers already behave — their bind mounts
# serve the main checkout, not a worktree. Set ALLOW_WORKTREE_PROJECT_DIR=1 to
# opt out (e.g. deliberately testing a worktree's own compose file).
COMPOSE_PROJECT_DIR_ARGS=()
_git_common_dir="$(git -C "${BASEDIR}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "${_git_common_dir}" ]]; then
  MAIN_CHECKOUT="$(cd "$(dirname "${_git_common_dir}")" && pwd)"
  if [[ "${MAIN_CHECKOUT}" != "${BASEDIR}" && "${ALLOW_WORKTREE_PROJECT_DIR:-0}" != "1" ]]; then
    echo "⚠️  Launched from a worktree — pinning the Compose project directory to the main checkout:"
    echo "      worktree:       ${BASEDIR}"
    echo "      project dir:    ${MAIN_CHECKOUT}"
    echo "    A worktree has no gitignored .env files; without this every service"
    echo "    would start env-starved. Set ALLOW_WORKTREE_PROJECT_DIR=1 to override."
    COMPOSE_FILE="${MAIN_CHECKOUT}/docker-compose.yml"
    OVERRIDE_FILE="${MAIN_CHECKOUT}/docker-compose.override.yml"
    COMPOSE_PROJECT_DIR_ARGS=(--project-directory "${MAIN_CHECKOUT}")
  fi
fi

# `${a[@]+"${a[@]}"}` — bash 3.2 (the macOS system bash) treats an empty array
# splat as an unbound variable under `set -u`; this form expands to nothing.
COMPOSE_FILES=(${COMPOSE_PROJECT_DIR_ARGS[@]+"${COMPOSE_PROJECT_DIR_ARGS[@]}"} -f "${COMPOSE_FILE}")
if [[ "${PROD_MODE:-0}" != "1" && -f "${OVERRIDE_FILE}" ]]; then
  COMPOSE_FILES+=(-f "${OVERRIDE_FILE}")
fi

# Core banking demo — always started by default.
CORE_SERVICES=(
  ui mcp-server mcp-invest mcp-weather mortgage-service mcp-proxy
  ping-gateway langchain-agent agent-service hitl-service llm-proxy
  promptfoo-step-narration
)

# Optional groups — start on demand via `./run-docker.sh optional start <group>`.
OPTIONAL_GROUP_NAMES=(rag agents tracing demo-auth mcpgw)

# Also brought up on every `start` / `restart` / `build` (core stack). Still
# stoppable with `./run-docker.sh optional stop rag` without tearing down core.
DEFAULT_OPTIONAL_GROUPS=(rag)

# Compose profiles matching OPTIONAL_GROUP_NAMES (also used for `start full`).
FULL_STACK_PROFILE_ARGS=(--profile rag --profile agents --profile tracing --profile demo-auth --profile mcpgw)

# Return compose profile name(s) for an optional group (or `all`).
_optional_group_profiles() {
  case "$1" in
    rag)       echo "rag" ;;
    agents)    echo "agents" ;;
    tracing)   echo "tracing" ;;
    demo-auth) echo "demo-auth" ;;
    mcpgw)     echo "mcpgw" ;;
    all)       echo "rag agents tracing demo-auth mcpgw" ;;
    *) return 1 ;;
  esac
}

# Build deduplicated `--profile` flags for the given group names.
_optional_profile_args() {
  local groups=("$@") seen="" args=() g p
  for g in "${groups[@]}"; do
    for p in $(_optional_group_profiles "${g}"); do
      [[ " ${seen} " == *" ${p} "* ]] || { seen+=" ${p}"; args+=(--profile "$p"); }
    done
  done
  echo "${args[@]}"
}

# Return space-separated compose service names for an optional group (or `all`).
_optional_group_services() {
  case "$1" in
    rag)       echo "weaviate embeddings demo-mcp-code-search llamaindex-agent" ;;
    agents)    echo "openai-agent mastra-agent pydantic-agent" ;;
    tracing)   echo "jaeger" ;;
    demo-auth) echo "authz-server mcp-gateway mcp-jwt-verifier" ;;
    mcpgw)     echo "ping-mcpgw" ;;
    all)
      local g svc out=""
      for g in "${OPTIONAL_GROUP_NAMES[@]}"; do
        for svc in $(_optional_group_services "${g}"); do
          [[ " ${out} " == *" ${svc} "* ]] || out+=" ${svc}"
        done
      done
      echo "${out# }"
      ;;
    *) return 1 ;;
  esac
}

_optional_group_desc() {
  case "$1" in
    rag)       echo "Code Search (Weaviate + embeddings + MCP code-search + LlamaIndex /ask)" ;;
    agents)    echo "Alternate agent frameworks (OpenAI / Mastra / Pydantic)" ;;
    tracing)   echo "Jaeger OTLP tracing backend" ;;
    demo-auth) echo "Demo Authorize AS + Demo Agent Gateway (Node mcp-gateway)" ;;
    mcpgw)     echo "PingOne Privilege MCPGW (JIT least-privilege + session recording)" ;;
    all)       echo "Every optional group" ;;
    *)         echo "Unknown group" ;;
  esac
}

# Expand group names (or `all`) into a deduplicated list of compose service names.
_optional_resolve_groups() {
  local groups=("$@") resolved="" g svc
  [[ ${#groups[@]} -eq 0 ]] && return 1
  for g in "${groups[@]}"; do
    local svcs
    svcs="$(_optional_group_services "${g}")" || return 1
    for svc in ${svcs}; do
      [[ " ${resolved} " == *" ${svc} "* ]] || resolved+=" ${svc}"
    done
  done
  echo "${resolved# }"
}

# ── Colours (from scripts/demo-terminal.sh) ───────────────────────────────────
ok()   { demo_ok "$@"; }
warn() { demo_warn "$@"; }
err()  { demo_err "$@"; }

# ── Bind-mount preflight ──────────────────────────────────────────────────────
# docker-compose.yml bind-mounts two gitignored HOST paths into the BFF:
#   ./certs       -> /certs       (HTTPS cert + key)
#   ./LLM2.json   -> /LLM2.json   (Helix agent key)
# Docker auto-creates a MISSING bind source as an empty DIRECTORY. If that
# happens the BFF serves plain HTTP (its HTTPS healthcheck then fails and the
# whole stack is gated unhealthy) and the Helix key mount becomes a bogus dir.
# Guarantee both exist as the correct TYPE before every `up` (start + restart).
ensure_bind_mounts() {
  local llm2="${BASEDIR}/LLM2.json"

  bash "${BASEDIR}/scripts/ensure-dev-certs.sh"
  # PingGateway -> MCP server mTLS is ON by default. Without this the
  # keystore is missing and mcp-server rejects every gateway call with
  # "no client certificate presented". Idempotent; regenerates only when
  # a file is missing or the cert expired.
  bash "${BASEDIR}/scripts/ensure-gateway-mtls-certs.sh"

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

  # pingcli — must be a FILE at demo_api_server/bin/pingcli for the /pingcli demo page.
  # Docker/OrbStack cannot bind-mount /opt/homebrew; copy the host binary into the
  # repo (already bind-mounted as /app) before `up`. Skip with a warning when absent.
  local pingcli_bin="${BASEDIR}/demo_api_server/bin/pingcli"
  if [[ -d "$pingcli_bin" ]]; then
    warn "demo_api_server/bin/pingcli is a directory (Docker auto-created it) — removing."
    rm -rf "$pingcli_bin"
  fi
  local pingcli_src=""
  if command -v pingcli >/dev/null 2>&1; then
    pingcli_src="$(command -v pingcli)"
  elif [[ -x /opt/homebrew/bin/pingcli ]]; then
    pingcli_src="/opt/homebrew/bin/pingcli"
  elif [[ -x /usr/local/bin/pingcli ]]; then
    pingcli_src="/usr/local/bin/pingcli"
  fi
  if [[ -n "$pingcli_src" ]]; then
    mkdir -p "${BASEDIR}/demo_api_server/bin"
    cp -f "$pingcli_src" "$pingcli_bin"
    chmod +x "$pingcli_bin"
    ok "pingcli staged at demo_api_server/bin/pingcli (from ${pingcli_src})."
  else
    warn "pingcli not found on host — /pingcli demo page commands will fail until installed."
    warn "Install: brew install pingidentity/tap/pingcli"
  fi
}

# ── Vault preflight ───────────────────────────────────────────────────────────
# docker-compose.yml bind-mounts the committed encrypted secrets.vault into the
# BFF, which loads it into configStore at startup and FAILS FAST (exit 1) if the
# vault file is present but VAULT_PASSWORD is unset OR wrong — otherwise the
# ai-demo-api-server container just crash-loops with an opaque "open failed".
# VAULT_PASSWORD reaches the container via the env_file (demo_api_server/.env);
# we read it from the same file here to verify it actually DECRYPTS before `up`.
# When no vault file exists this is a transparent no-op (env-only dev machines).
# Mirrors run.sh's preflight. VAULT_PASSWORD is only ever passed via the subshell
# environment, never as a CLI arg, and is never echoed.
vault_preflight() {
  local vault_file="${VAULT_PATH:-$BASEDIR/secrets.vault}"
  [[ -f "$vault_file" ]] || { ok "No secrets.vault — BFF uses .env / process.env values."; return 0; }

  # Auto-load VAULT_PASSWORD from demo_api_server/.env (the BFF's env_file) when
  # not already set in the shell. Only VAULT_PASSWORD is extracted; the file is
  # never sourced. Strips surrounding single/double quotes.
  local vp="${VAULT_PASSWORD:-}"
  if [[ -z "$vp" && -f "$BASEDIR/demo_api_server/.env" ]]; then
    vp=$(grep -E '^VAULT_PASSWORD=' "$BASEDIR/demo_api_server/.env" 2>/dev/null | head -1 | sed 's/^VAULT_PASSWORD=//; s/^"//; s/"$//' | tr -d "'" || true)
  fi

  if [[ -z "$vp" ]]; then
    err "secrets.vault present at ${vault_file} but VAULT_PASSWORD is not set."
    err "The BFF will refuse to start (exit 1)."
    err "Fix: add VAULT_PASSWORD=... to demo_api_server/.env (or export it) before ./run-docker.sh."
    exit 1
  fi

  # A wrong/rotated password passes the presence check above, then crash-loops
  # the BFF. Verify it actually DECRYPTS here, once, up front. Only a confirmed
  # decrypt failure (exit 3) is fatal; if the check itself can't run (no node /
  # missing deps → any other exit) we fall back to letting the BFF validate at
  # boot, so this never introduces a spurious abort.
  local rc=0
  VAULT_FILE="$vault_file" VAULT_PASSWORD="$vp" VAULT_LIB="$BASEDIR/demo_api_server/lib/vault" \
    node -e 'const {openVault}=require(process.env.VAULT_LIB);openVault(process.env.VAULT_FILE,process.env.VAULT_PASSWORD).then(()=>process.exit(0)).catch(()=>process.exit(3));' \
    >/dev/null 2>&1 || rc=$?
  if [[ "$rc" -eq 3 ]]; then
    err "VAULT_PASSWORD is set but does NOT decrypt ${vault_file} (wrong or rotated password)."
    err "The BFF would crash with an opaque 'open failed'. Fix the password in demo_api_server/.env before ./run-docker.sh."
    exit 1
  elif [[ "$rc" -ne 0 ]]; then
    warn "Could not run vault decrypt preflight (node/deps unavailable) — the BFF will validate at boot."
  else
    ok "secrets.vault verified — VAULT_PASSWORD decrypts it."
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

  # Ignore generated/runtime paths that churn every dev run (repo-src is
  # regenerated by build-codegraph --stage-src; LMDB is rewritten on boot).
  dirty="$(git -C "${BASEDIR}" status --porcelain 2>/dev/null \
    | grep -Ev '^.. (langchain_agent/repo-src/|demo_api_server/data/persistent/lmdb/data\.mdb$)' || true)"
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

# ── Local LLM (host) lifecycle ───────────────────────────────────────────────
# This launcher always uses llamacpp. oMLX would take :8090 on the host, which
# is the port the llm-proxy container binds — running it here means the
# container is skipped and tier routing never engages. oMLX is reserved for
# ./run.sh, where nothing competes for the port.
#
#   llamacpp — 2-tier llama.cpp proxy; llm-proxy container on :8090 routes to
#              host tiers :8091 (small) / :8096 (big) via tier-manager :8097
#   omlx/mlx — native-only; resolve_llm_backend downgrades them here with a warning
#
# (k8s is unaffected — there llama.cpp runs as an in-cluster pod; see run-k8.sh.)
# shellcheck source=demo_llm_proxy/resolve-llm-backend.sh
source "${BASEDIR}/demo_llm_proxy/resolve-llm-backend.sh"
# Called bare, not in $( ): a command substitution resolves in a subshell and
# LLM_BACKEND_RESOLVE_WARN dies with it, silently swallowing the downgrade
# notice. RESOLVED_LLM_BACKEND is exported by the resolver for exactly this.
resolve_llm_backend docker >/dev/null
_LLM_BACKEND="${RESOLVED_LLM_BACKEND}"
if [[ -n "${LLM_BACKEND_RESOLVE_WARN:-}" ]]; then
  warn "${LLM_BACKEND_RESOLVE_WARN}"
fi
LLAMACPP_MODEL="${LLAMACPP_MODEL:-phi-4-mini-instruct}"   # model id label reported to services
_LLAMACPP_PIDFILE="/tmp/demo-llamacpp.pid"          # legacy single-server pidfile (cleanup only)
_TIERS_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/demo_llm_proxy/start-local-models.sh"
_OMLX_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/demo_llm_proxy/start-omlx.sh"
_MLX_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/demo_llm_proxy/start-mlx.sh"

_local_llm_ready() {
  curl -sf --max-time 2 http://127.0.0.1:8090/health >/dev/null 2>&1 \
    || curl -sf --max-time 2 http://127.0.0.1:8090/v1/models >/dev/null 2>&1
}

_proxy_up() { _local_llm_ready; }

# Core services for compose up — omit llm-proxy when host oMLX owns :8090.
_effective_core_services() {
  local svc
  for svc in "${CORE_SERVICES[@]}"; do
    [[ ("${_LLM_BACKEND}" == "omlx" || "${_LLM_BACKEND}" == "mlx") && "${svc}" == "llm-proxy" ]] && continue
    echo "${svc}"
  done
}

# When docker-compose.override.yml selects the Vite dev stage, ensure the UI image
# is built with `target: dev` — otherwise a cached nginx prod image gets `npm start`.
_dev_ui_build_arg() {
  if [[ "${PROD_MODE:-0}" != "1" && -f "${OVERRIDE_FILE}" ]]; then
    echo "ui"
  fi
}

# Legacy guard: a raw llama-server bound to :8090 shadows the llm-proxy
# container on IPv4 (both listen; IPv4 clients then hit the wrong backend).
_clear_8090_squatter() {
  local pids
  # `|| true`: with an empty :8090 (the normal cold-start state) lsof exits 1,
  # and under `set -euo pipefail` this standalone assignment would abort the
  # whole script before `docker compose up`. Guard it — no squatter is fine.
  pids=$(lsof -nP -iTCP:8090 -sTCP:LISTEN 2>/dev/null | awk '$1 ~ /^llama/ {print $2}' | sort -u) || true
  if [[ -n "$pids" ]]; then
    warn "raw llama-server bound to :8090 shadows the LLM proxy — stopping it (PID ${pids})"
    kill $pids 2>/dev/null || true
    rm -f "$_LLAMACPP_PIDFILE"
  fi

  # oMLX is a Python process, so the llama-only match above walks straight past
  # it. Left running it holds :8090 and the llm-proxy container fails to bind —
  # the exact failure this launcher no longer opts into. A ./run.sh session
  # earlier in the day is the usual way it ends up here.
  if lsof -nP -iTCP:8090 -sTCP:LISTEN >/dev/null 2>&1; then
    if [[ -f "$_OMLX_SCRIPT" ]]; then
      warn "host oMLX holds :8090 — stopping it so the llm-proxy container can bind"
      bash "$_OMLX_SCRIPT" stop 2>/dev/null || true
    else
      warn "something still holds :8090 — the llm-proxy container may fail to bind"
    fi
  fi
}

# Swap / residency: the tier-manager daemon on :8097 starts host llama-server
# processes when the llm-proxy container asks. Policy (residencyPolicy.js via
# apply-residency-policy.sh) runs automatically:
#   ≥32GB → dual 8091,8096 (phi + gpt-oss, no swap eviction)
#   <32GB → refuse dual, pin :8091 (24GB Air strategy B)
#   LLM_PROXY_FORCE_DUAL=1 overrides the refuse
#   LLM_PROXY_RESIDENT_TIERS= (empty) → classic one-tier swap
# Bind host tiers on 0.0.0.0 so Docker can reach them via host.docker.internal.
# PingAWS/k8s: one-tier Deployments via tier-manager-k8 (not this host path).
_TIER_MANAGER_PIDFILE="/tmp/demo-tier-manager.pid"
_LLM_RESIDENT_TIERS=""
_LLM_PIN_TIER="${LLM_PROXY_PIN_TIER:-}"
_LLAMA_LISTEN_HOST="${LLAMA_ARG_HOST:-0.0.0.0}"
_manager_up() { curl -sf --max-time 2 http://127.0.0.1:8097/health >/dev/null 2>&1; }

# Apply RAM policy → _LLM_RESIDENT_TIERS / _LLM_PIN_TIER (also exported for compose).
_apply_llm_residency_policy() {
  # shellcheck source=demo_llm_proxy/apply-residency-policy.sh
  source "$(dirname "$_TIERS_SCRIPT")/apply-residency-policy.sh"
  apply_llm_residency_policy "$(dirname "$_TIERS_SCRIPT")"
  _LLM_RESIDENT_TIERS="${LLM_PROXY_RESIDENT_TIERS:-}"
  _LLM_PIN_TIER="${LLM_PROXY_PIN_TIER:-}"
  _LLAMA_LISTEN_HOST="${LLAMA_ARG_HOST:-0.0.0.0}"
  if [[ "${_LLM_RESIDENCY_MODE:-}" == "pin-phi" || "${_LLM_RESIDENCY_MODE:-}" == "pin" ]]; then
    warn "${_LLM_RESIDENCY_REASON:-low-RAM pin}"
  else
    ok "${_LLM_RESIDENCY_REASON:-llm residency policy applied}"
  fi
}

# Always (re)start so a stale manager without RESIDENT_TIERS cannot keep running.
_restart_tier_manager() {
  if [[ -f "$_TIER_MANAGER_PIDFILE" ]]; then
    kill "$(cat "$_TIER_MANAGER_PIDFILE")" 2>/dev/null || true
    rm -f "$_TIER_MANAGER_PIDFILE"
  fi
  # Clear a manager started outside this script (same port).
  local old
  old=$(lsof -nP -iTCP:8097 -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | sort -u) || true
  if [[ -n "$old" ]]; then
    kill $old 2>/dev/null || true
    sleep 1
  fi
  LLM_PROXY_RESIDENT_TIERS="${_LLM_RESIDENT_TIERS}" \
  LLAMA_ARG_HOST="${_LLAMA_LISTEN_HOST}" \
    nohup node "$(dirname "$_TIERS_SCRIPT")/tier-manager.js" > /tmp/demo-tier-manager.log 2>&1 &
  echo $! > "$_TIER_MANAGER_PIDFILE"
  local i=0; while [[ $i -lt 10 ]]; do _manager_up && return 0; sleep 1; (( i++ )) || true; done
  return 1
}

_start_tier_manager() {
  _manager_up && return 0
  _restart_tier_manager
}

start_llamacpp() {
  if [[ "${_LLM_BACKEND}" == "mlx" ]]; then
    if ! is_macos; then
      warn "LLM_BACKEND=mlx requires macOS — starting llama.cpp tiers instead"
    elif [[ -x "${_MLX_SCRIPT}" ]] || [[ -f "${_MLX_SCRIPT}" ]]; then
      docker compose "${COMPOSE_FILES[@]}" stop llm-proxy 2>/dev/null || true
      if bash "$_MLX_SCRIPT" start; then
        ok "mlx-lm on :8090 — containers use host.docker.internal:8090 (llm-proxy container skipped)"
        return 0
      fi
      warn "mlx-lm failed to start — see /tmp/mlx-models/ (log: mlx-8090.log)"
      _LLM_BACKEND="llamacpp"
    else
      warn "start-mlx.sh not found — bash demo_llm_proxy/setup-mlx-venv.sh"
      _LLM_BACKEND="llamacpp"
    fi
  fi
  if [[ "${_LLM_BACKEND}" == "omlx" ]]; then
    if ! is_apple_silicon_mac; then
      warn "oMLX requires Apple Silicon Mac — starting llama.cpp tiers instead"
      _LLM_BACKEND="llamacpp"
    elif command -v omlx >/dev/null 2>&1; then
      docker compose "${COMPOSE_FILES[@]}" stop llm-proxy 2>/dev/null || true
      if bash "$_OMLX_SCRIPT" start; then
        ok "oMLX on :8090 — containers use host.docker.internal:8090 (llm-proxy container skipped)"
        return 0
      fi
      warn "oMLX failed to start — see /tmp/omlx-models/ (log: omlx-8090.log)"
      if [[ -z "${LLM_BACKEND:-}" ]]; then
        warn "Auto-falling back to llama.cpp tiers"
        _LLM_BACKEND="llamacpp"
      else
        return 0
      fi
    else
      warn "omlx not installed — brew tap jundot/omlx && brew install omlx"
      warn "  models: bash demo_llm_proxy/download-omlx-models.sh fetch"
      if [[ -z "${LLM_BACKEND:-}" ]]; then
        warn "Auto-falling back to llama.cpp tiers"
        _LLM_BACKEND="llamacpp"
      else
        return 0
      fi
    fi
  fi
  command -v llama-server >/dev/null 2>&1 || { warn "llama-server not installed — local LLM tiers disabled (brew install llama.cpp)"; return 0; }
  _clear_8090_squatter
  _apply_llm_residency_policy
  export LLAMA_ARG_HOST="${_LLAMA_LISTEN_HOST}"
  export LLM_PROXY_RESIDENT_TIERS="${_LLM_RESIDENT_TIERS}"
  export LLM_PROXY_PIN_TIER="${_LLM_PIN_TIER}"
  # Fresh manager so RESIDENT_TIERS / LLAMA_ARG_HOST always match this start.
  _restart_tier_manager || warn "tier-manager failed to start — model swapping disabled (log: /tmp/demo-tier-manager.log)"
  # oMLX/mlx paths stop llm-proxy; bring it back when we fall through to llama.cpp.
  # Compose picks up LLM_PROXY_* from the exported env above.
  docker compose "${COMPOSE_FILES[@]}" up -d --no-deps llm-proxy 2>/dev/null || true
  if [[ -n "${_LLM_RESIDENT_TIERS}" ]]; then
    if bash "$_TIERS_SCRIPT" ensure-set "${_LLM_RESIDENT_TIERS}"; then
      ok "tier-manager on :8097, resident tiers ${_LLM_RESIDENT_TIERS} (host ${_LLAMA_LISTEN_HOST}) — llm-proxy :8090"
    else
      warn "resident tiers failed — verify GGUFs: bash demo_llm_proxy/download-models.sh (logs: /tmp/llama-models/)"
    fi
  elif [[ -n "${_LLM_PIN_TIER}" ]]; then
    if bash "$_TIERS_SCRIPT" ensure "${_LLM_PIN_TIER}"; then
      ok "tier-manager on :8097, pinned :${_LLM_PIN_TIER} (host ${_LLAMA_LISTEN_HOST}) — llm-proxy :8090"
    else
      warn "pinned tier :${_LLM_PIN_TIER} failed — verify GGUFs: bash demo_llm_proxy/download-models.sh (logs: /tmp/llama-models/)"
    fi
  elif bash "$_TIERS_SCRIPT" ensure-available; then
    ok "tier-manager on :8097, smallest tier loaded (:8091) — llm-proxy container serves :8090 and swaps on demand"
  else
    warn "smallest tier failed to start — verify GGUFs: bash demo_llm_proxy/download-models.sh (logs: /tmp/llama-models/)"
  fi
}

stop_llamacpp() {
  if [[ "${_LLM_BACKEND}" == "mlx" ]]; then
    bash "$_MLX_SCRIPT" stop 2>/dev/null || true
    ok "mlx-lm stopped"
    return 0
  fi
  if [[ "${_LLM_BACKEND}" == "omlx" ]]; then
    bash "$_OMLX_SCRIPT" stop 2>/dev/null || true
    ok "oMLX stopped"
    return 0
  fi
  bash "$_TIERS_SCRIPT" stop 2>/dev/null || true
  if [[ -f "$_TIER_MANAGER_PIDFILE" ]]; then
    kill "$(cat "$_TIER_MANAGER_PIDFILE")" 2>/dev/null || true
    rm -f "$_TIER_MANAGER_PIDFILE"
  fi
  _clear_8090_squatter
  rm -f "$_LLAMACPP_PIDFILE"
  ok "model tiers + tier-manager stopped"
}

# ── Preflight ─────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  err "docker not found — install Docker Desktop and try again."
  exit 1
fi

_RUN_DOCKER_CMD_EARLY="${1:-start}"
if [[ "${_RUN_DOCKER_CMD_EARLY}" != "stop" && "${_RUN_DOCKER_CMD_EARLY}" != "help" && "${_RUN_DOCKER_CMD_EARLY}" != "--help" && "${_RUN_DOCKER_CMD_EARLY}" != "-h" ]]; then
  if ! docker info >/dev/null 2>&1; then
    err "Docker daemon not running — start OrbStack or Docker Desktop, then retry."
    exit 1
  fi
fi
unset _RUN_DOCKER_CMD_EARLY

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
  "jaeger|Jaeger (tracing UI)    |16686|http://localhost:16686"
  "ui|UI (React / nginx)   |4000|https://local.ping-devops.com:4000"
  "mcp-server|MCP Server            |8080|http://localhost:8080"
  "mcp-gateway|MCP Gateway           |3005|http://localhost:3005"
  "mcp-proxy|MCP Proxy             |8895|http://localhost:8895"
  "ping-gateway|Ping Gateway          |3036|http://localhost:3036"
  "langchain-agent|LangChain Agent      |8888|http://localhost:8888"
  "agent-service|Agent Service         |3016|http://localhost:3016"
  "hitl-service|HITL Service          |3009|http://localhost:3009"
  "mcp-invest|MCP Invest            |8081|http://localhost:8081"
  "mcp-weather|MCP Weather           |8896|http://localhost:8896"
  "mcp-jwt-verifier|MCP JWT Verifier     |8083|http://localhost:8083"
  "mortgage-service|Mortgage Service     |8082|http://localhost:8082"
  "openai-agent|OpenAI Agent          |8891|http://localhost:8891"
  "mastra-agent|Mastra Agent          |8892|http://localhost:8892"
  "pydantic-agent|Pydantic AI Agent    |8893|http://localhost:8893"
  "authz-server|Authz Server          |9001|http://localhost:9001"
  "promptfoo-step-narration|promptfoo (eval)      |-|./run-docker.sh promptfoo"
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

# ── Docker helpers ────────────────────────────────────────────────────────────

# Run any command with a wall-clock cap (used for docker info and compose).
_cmd_with_timeout() {
  local secs="$1"
  shift
  "$@" &
  local pid=$!
  local waited=0
  while kill -0 "${pid}" 2>/dev/null && (( waited < secs )); do
    sleep 1
    ((waited++)) || true
  done
  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    return 124
  fi
  wait "${pid}"
}

# True when the Docker daemon answers within a few seconds.
_docker_daemon_ready() {
  _cmd_with_timeout 8 docker info >/dev/null 2>&1
}

# Run `docker compose …` with a wall-clock cap so a hung daemon does not block stop.
_compose_with_timeout() {
  local secs="$1"
  shift
  docker compose "${COMPOSE_FILES[@]}" "$@" &
  local pid=$!
  local waited=0
  while kill -0 "${pid}" 2>/dev/null && (( waited < secs )); do
    if (( waited > 0 && waited % 5 == 0 )); then
      echo -e "${DIM}  … still stopping (${waited}s)${RESET}"
    fi
    sleep 1
    ((waited++)) || true
  done
  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    return 124
  fi
  wait "${pid}"
}

# Force-remove containers/network left when profiled services keep ai-demo_ai-demo alive.
_purge_leftover_stack() {
  local ids cnt
  ids="$(docker ps -aq --filter "name=ai-demo-" 2>/dev/null || true)"
  if [[ -n "${ids}" ]]; then
    cnt="$(wc -w <<< "${ids}" | tr -d ' ')"
    warn "Purging ${cnt} leftover ai-demo container(s)..."
    # shellcheck disable=SC2086
    docker rm -f ${ids} 2>/dev/null || true
  fi
  docker network rm ai-demo_ai-demo 2>/dev/null || true
  # `network rm` returns before the daemon finishes tearing the network down.
  # The next `compose up` then creates a fresh ai-demo_ai-demo and the lagging
  # removal deletes it out from under the starting containers — the start dies
  # with "failed to set up container networking: network ai-demo_ai-demo not
  # found". Block until it is really gone (~5s ceiling; proceed anyway after).
  local waited=0
  while docker network inspect ai-demo_ai-demo >/dev/null 2>&1; do
    (( waited >= 50 )) && { warn "network ai-demo_ai-demo still present after 5s — continuing"; break; }
    sleep 0.1
    (( waited++ )) || true
  done
}

# Post-start gate: every core service must actually be RUNNING before the script
# reports success. Two real failures motivated this and both reported success:
#   - `up -d ... ${otel_services}` in cmd_demo_sync is `>/dev/null 2>&1 || true`,
#     so an mcp-server that failed to come up was silent — the gateway then
#     PERMITted the tool call and returned 502 with no backend behind it.
#   - the UI container raced the BFF, Vite died before binding :4000, and the
#     container still showed Up (it has no healthcheck).
# One restart is attempted per down service; anything still down is reported by
# name so the operator sees it instead of a broken demo step.
_verify_core_running() {
  local svc cname down=() fixed=() err_svc=()
  for svc in "${_CORE_UP[@]}" demo-api-server; do
    # Compose service -> container name (demo-api-server is the one that differs).
    cname="ai-demo-${svc}"
    [[ "${svc}" == "demo-api-server" ]] && cname="ai-demo-api-server"
    docker inspect -f '{{.State.Running}}' "${cname}" 2>/dev/null | grep -q true && continue
    down+=("${svc}")
  done

  if [[ ${#down[@]} -gt 0 ]]; then
    warn "Core service(s) not running after start: ${down[*]} — retrying once"
    docker compose "${COMPOSE_FILES[@]}" up -d "${down[@]}" 2>&1 | tail -3
    sleep 5
    for svc in "${down[@]}"; do
      cname="ai-demo-${svc}"
      [[ "${svc}" == "demo-api-server" ]] && cname="ai-demo-api-server"
      docker inspect -f '{{.State.Running}}' "${cname}" 2>/dev/null | grep -q true \
        && fixed+=("${svc}") \
        || err_svc+=("${svc}")
    done
    [[ ${#fixed[@]} -gt 0 ]] && ok "Recovered: ${fixed[*]}"
  fi

  # The UI has no healthcheck, so Running is not enough — confirm Vite bound the
  # port. A dead dev server here renders a blank dashboard with no other signal.
  if printf '%s\n' "${_CORE_UP[@]}" | grep -qx 'ui'; then
    if ! docker exec ai-demo-ui sh -c 'netstat -tln 2>/dev/null | grep -q ":4000 "' 2>/dev/null; then
      warn "UI container is up but Vite is not listening on :4000 (it can lose the race with the BFF) — restarting it"
      docker restart ai-demo-ui >/dev/null 2>&1 || true
      sleep 12
      if docker exec ai-demo-ui sh -c 'netstat -tln 2>/dev/null | grep -q ":4000 "' 2>/dev/null; then
        ok "UI recovered — Vite listening on :4000"
      else
        warn "UI still not serving :4000 — check: ./run-docker.sh logs ui"
      fi
    fi
  fi

  if [[ ${#err_svc[@]} -gt 0 ]]; then
    warn "STILL DOWN after retry: ${err_svc[*]} — the demo will fail on any step that needs them."
    warn "Check: ./run-docker.sh logs <service>"
    return 1
  fi
  return 0
}

_compose_down() {
  if ! _docker_daemon_ready; then
    warn "Docker daemon not running — skipping compose down (start OrbStack or Docker Desktop)"
    return 0
  fi
  echo "Stopping containers (all profiles)..."
  local down_rc=0
  # Pass every compose profile so optional-group containers (rag, tracing,
  # agents, demo-auth) stop too — otherwise the shared network stays in use
  # and `down` blocks at "Network ai-demo_ai-demo Removing".
  if [[ $# -gt 0 ]]; then
    _compose_with_timeout 90 "${FULL_STACK_PROFILE_ARGS[@]}" down --timeout 5 "$@" --remove-orphans || down_rc=$?
  else
    _compose_with_timeout 90 "${FULL_STACK_PROFILE_ARGS[@]}" down --timeout 5 --remove-orphans || down_rc=$?
  fi
  if [[ "${down_rc}" -ne 0 ]]; then
    warn "compose down timed out — forcing stop"
    _compose_with_timeout 30 "${FULL_STACK_PROFILE_ARGS[@]}" kill 2>/dev/null || true
    _compose_with_timeout 30 "${FULL_STACK_PROFILE_ARGS[@]}" rm -f 2>/dev/null || true
  fi
  _purge_leftover_stack
}

# ── Commands ──────────────────────────────────────────────────────────────────

cmd_stop() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [DOCKER]  AI DEMO — STOPPING                                    ${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  _compose_down
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
    _compose_down -v
    ok "All containers, networks, and volumes removed."
  else
    _compose_down
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

# True when a service needs the gitignored TLS bind mount (UI dev HTTPS or BFF).
_needs_tls_bind_mounts() {
  for svc in "$@"; do
    [[ "${svc}" == "demo-api-server" || "${svc}" == "ui" ]] && return 0
  done
  return 1
}

# True if "demo-api-server" is among the given service names (vault + demo-sync).
_includes_bff() {
  for svc in "$@"; do [[ "${svc}" == "demo-api-server" ]] && return 0; done
  return 1
}

cmd_stop_one() {
  _require_services "$@"
  echo ""
  echo -e "${CYAN}${BOLD}   [DOCKER]  Stopping ${*} (others untouched)${RESET}"
  echo ""
  if ! _compose_with_timeout 60 stop --timeout 5 "$@"; then
    warn "compose stop timed out — killing ${*}"
    docker compose "${COMPOSE_FILES[@]}" kill "$@" 2>/dev/null || true
  fi
  ok "Stopped: ${*}."
  echo ""
}

cmd_restart_one() {
  _require_services "$@"
  echo ""
  echo -e "${CYAN}${BOLD}   [DOCKER]  Restarting ${*} (others untouched)${RESET}"
  echo ""
  git_sync_check; echo ""
  _needs_tls_bind_mounts "$@" && { ensure_bind_mounts; echo ""; }
  _includes_bff "$@" && { vault_preflight; echo ""; }
  docker compose "${COMPOSE_FILES[@]}" up -d --force-recreate --no-deps "$@"
  ok "Restarted: ${*}."
  if _includes_bff "$@"; then
    cmd_demo_sync
  fi
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
  _needs_tls_bind_mounts "${services[@]}" && { ensure_bind_mounts; echo ""; }
  _includes_bff "${services[@]}" && { vault_preflight; echo ""; }
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
# intentional host model tiers on :8091 and :8096 are never touched (not in SERVICES).
# When LLM_BACKEND=omlx or mlx, the host owns :8090 and the llm-proxy container is skipped.
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

# Wait until the BFF health probe responds (used before demo-sync reads LMDB flags).
_wait_bff_healthy() {
  local i=0
  while [[ $i -lt 30 ]]; do
    if curl -sk --max-time 2 https://api.ping.demo:3001/api/healthz >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    ((i++)) || true
  done
  return 1
}

# Read ff_authorize_simulated + ff_mcp_gateway_pinggateway from the running BFF.
# Prints "sim pgw trc" as 0/1 tokens. Falls back to 0 1 1 (real P1AZ + PingGateway + tracing on) on failure.
_read_demo_stack_flags() {
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'ai-demo-api-server'; then
    echo "0 1 1"
    return 0
  fi
  # configStore loads LMDB asynchronously, so ensureInitialized() MUST be awaited
  # here: a bare getEffective() in a fresh process returns env/registry defaults
  # and reports simulated=0 while the running BFF is enforcing simulated=1 —
  # demo-sync then stops authz-server out from under the gateway and every tool
  # call fails closed with a policy DENY.
  # The require() chain can log to stdout before the flags (e.g. otel's
  # "[otel] tracing to ..." banner), so take the LAST line and validate its
  # shape — anything else falls back to the real-stack default.
  local out
  out="$(docker exec ai-demo-api-server node -e "
    const cs = require('./services/configStore');
    (async () => {
      await cs.ensureInitialized();
      const t = (v) => (v === true || v === 'true') ? '1' : '0';
      const sim = t(cs.getEffective('ff_authorize_simulated'));
      const pgw = t(cs.getEffective('ff_mcp_gateway_pinggateway'));
      const trc = (cs.getEffective('ff_tracing') === false || cs.getEffective('ff_tracing') === 'false') ? '0' : '1';
      process.stdout.write('\n' + sim + ' ' + pgw + ' ' + trc);
    })();
  " 2>/dev/null | tail -n 1)"
  if [[ "${out}" =~ ^[01]\ [01]\ [01]$ ]]; then
    echo "${out}"
  else
    echo "0 1 1"
  fi
}

# Keep demo-auth profile containers up and route per admin Quick Flag toggles.
# The containers themselves are ALWAYS kept running: the RAR / intent-binding
# demo is pinned to the Node Demo Agent Gateway (the only component with
# RFC 9396 RAR enforcement — PR #603), and that gateway's introspection +
# decision endpoints live on authz-server. Quick Flags now only decide which
# gateway mcp-proxy and the BFF ROUTE tool calls through (PingGateway vs demo).
cmd_demo_sync() {
  echo ""
  echo -e "${CYAN}${BOLD}   [DOCKER]  Demo stack sync (Quick Flags → containers)${RESET}"
  echo ""

  if ! _wait_bff_healthy; then
    warn "BFF not healthy yet — skipping demo-sync (core uses real P1AZ + PingGateway by default)."
    echo ""
    return 0
  fi

  local flags sim pgw trc need_authz=0 need_demo_gw=0
  flags="$(_read_demo_stack_flags)"
  sim="${flags%% *}"
  pgw="$(echo "${flags}" | awk '{print $2}')"
  trc="$(echo "${flags}" | awk '{print $3}')"
  [[ -z "${trc}" ]] && trc=1

  [[ "${sim}" == "1" ]] && need_authz=1
  [[ "${pgw}" == "0" ]] && { need_demo_gw=1; need_authz=1; }

  ok "Ensuring demo-auth containers are up (RAR demo needs the Demo Agent Gateway; routing: simulated=${sim}, pingGateway=${pgw})"
  docker compose "${COMPOSE_FILES[@]}" --profile demo-auth up -d authz-server mcp-gateway

  # mcp-proxy is core — point it at the active gateway (PingGateway by default).
  local proxy_gw_url="http://ping-gateway:8080"
  [[ ${need_demo_gw} -eq 1 ]] && proxy_gw_url="http://mcp-gateway:3005"
  MCP_GATEWAY_HTTP_URL="${proxy_gw_url}" \
    docker compose "${COMPOSE_FILES[@]}" up -d --force-recreate --no-deps mcp-proxy >/dev/null 2>&1 || true
  # BFF compose default is ping-gateway:8080; only recreate when Quick Flags select demo GW.
  if [[ ${need_demo_gw} -eq 1 ]]; then
    MCP_GATEWAY_HTTP_URL="${proxy_gw_url}" \
      docker compose "${COMPOSE_FILES[@]}" up -d --force-recreate --no-deps demo-api-server >/dev/null 2>&1 || true
  fi

  # Tracing (ff_tracing): OFF stops Jaeger and recreates the instrumented
  # services with an empty OTLP endpoint so otel-instrument.js no-ops. ON is the
  # compose default — ensure Jaeger is up.
  # The demo-auth-gated services are always up now (see the sync above), so
  # they are always part of the instrumented set.
  local otel_services="demo-api-server mcp-server agent-service hitl-service mcp-invest authz-server mcp-gateway"
  if [[ "${trc}" == "0" ]]; then
    ok "Tracing OFF — stopping Jaeger and recreating instrumented services without OTLP export"
    docker compose "${COMPOSE_FILES[@]}" stop jaeger 2>/dev/null || true
    OTEL_EXPORTER_OTLP_ENDPOINT="" \
      docker compose "${COMPOSE_FILES[@]}" --profile demo-auth up -d --force-recreate --no-deps ${otel_services} >/dev/null 2>&1 || true
  else
    ok "Tracing ON — ensuring Jaeger is up and instrumented services export spans"
    # No --force-recreate: with OTEL_EXPORTER_OTLP_ENDPOINT unset here, compose
    # resolves the default endpoint and recreates only services whose endpoint
    # drifted (e.g. left empty by a prior OFF) — no churn in the steady state.
    docker compose "${COMPOSE_FILES[@]}" --profile demo-auth up -d --no-deps jaeger ${otel_services} >/dev/null 2>&1 || true
  fi
  echo ""
}

cmd_optional_start() {
  local groups=("$@")
  local profile_args
  profile_args="$(_optional_profile_args "${groups[@]}")" || {
    err "Usage: ./run-docker.sh optional start <group>..."
    echo ""
    cmd_optional_help
    exit 1
  }

  echo ""
  echo -e "${CYAN}${BOLD}   [DOCKER]  Starting optional: ${groups[*]}${RESET}"
  echo ""

  # Profile-gated services require `--profile`; `up -d` respects depends_on.
  # shellcheck disable=SC2206
  local _profiles=( ${profile_args} )
  docker compose "${COMPOSE_FILES[@]}" "${_profiles[@]}" up -d
  ok "Started profile(s): ${groups[*]}"

  if [[ " ${groups[*]} " == *" rag "* ]] || [[ " ${groups[*]} " == *" all "* ]]; then
    warn "RAG embeddings warm up on first request — Code Search may 503 for ~30s."
    warn "Weaviate needs a healthy leader after first start; retry index/search if you see 500."
  fi

  if [[ " ${groups[*]} " == *" mcpgw "* ]] || [[ " ${groups[*]} " == *" all "* ]]; then
    local token_file="${BASEDIR}/ping-mcpgw/config/proxy-token"
    if [[ -z "${PRIVILEGE_PROXY_TOKEN:-}" && ! -f "${token_file}" ]]; then
      warn "Privilege proxy has no enrollment token."
      warn "  Set PRIVILEGE_PROXY_TOKEN env or create ${token_file}"
      warn "  (Get the JWT from Privilege Cloud → Gateway wizard)"
    fi
  fi
  echo ""
  print_status_table
  echo ""
}

cmd_optional_stop() {
  local groups=("$@")
  local services profile_args
  services="$(_optional_resolve_groups "${groups[@]}")" || {
    err "Usage: ./run-docker.sh optional stop <group>..."
    echo ""
    cmd_optional_help
    exit 1
  }
  profile_args="$(_optional_profile_args "${groups[@]}")"

  echo ""
  echo -e "${CYAN}${BOLD}   [DOCKER]  Stopping optional: ${groups[*]}${RESET}"
  echo ""
  # shellcheck disable=SC2206
  local _profiles=( ${profile_args} )
  docker compose "${COMPOSE_FILES[@]}" "${_profiles[@]}" stop ${services}
  ok "Stopped: ${services}"
  echo ""
}

cmd_optional_status() {
  echo ""
  echo -e "${CYAN}${BOLD}   [DOCKER]  Optional service groups (compose profiles)${RESET}"
  echo ""
  local g svc
  for g in "${OPTIONAL_GROUP_NAMES[@]}"; do
    local svcs up=0 down=0 profile_args
    profile_args="$(_optional_profile_args "${g}")"
    # shellcheck disable=SC2206
    local _profiles=( ${profile_args} )
    svcs="$(_optional_group_services "${g}")"
    echo -e "  ${BOLD}${g}${RESET}  — $(_optional_group_desc "${g}")  ${DIM}(profile: ${g})${RESET}"
    for svc in ${svcs}; do
      local state
      state="$(docker compose "${COMPOSE_FILES[@]}" "${_profiles[@]}" ps --format '{{.State}}' "${svc}" 2>/dev/null | head -1 || true)"
      if [[ "${state}" == "running" ]]; then
        echo -e "    ${GREEN}✓${RESET}  ${svc}"
        ((up++)) || true
      else
        echo -e "    ${DIM}○${RESET}  ${svc}  (${state:-stopped})"
        ((down++)) || true
      fi
    done
    if [[ ${down} -eq 0 ]]; then
      echo -e "    ${GREEN}group up${RESET}"
    elif [[ ${up} -eq 0 ]]; then
      echo -e "    ${DIM}group stopped${RESET}  — start: ./run-docker.sh optional start ${g}"
    else
      echo -e "    ${YELLOW}partially up${RESET}  — start: ./run-docker.sh optional start ${g}"
    fi
    echo ""
  done
}

cmd_optional_help() {
  echo "  Optional groups:"
  local g
  for g in "${OPTIONAL_GROUP_NAMES[@]}" all; do
    echo "    ${g}  — $(_optional_group_desc "${g}")"
  done
  echo ""
  echo "  Note: rag starts with core by default; use optional stop/start to toggle."
  echo "  Examples:"
  echo "    ./run-docker.sh optional stop rag"
  echo "    ./run-docker.sh optional start rag"
  echo "    ./run-docker.sh optional start agents"
  echo "    ./run-docker.sh optional status"
  echo ""
}

cmd_start() {
  local build_flag=""
  local stack="${DEMO_STACK:-core}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --build) build_flag="--build"; shift ;;
      full|all) stack="full"; shift ;;
      core) stack="core"; shift ;;
      *) shift ;;
    esac
  done

  demo_machine_banner docker

  # Always stop first — clean slate
  cmd_stop

  # Defense-in-depth: a container left over from a different Compose project
  # (e.g. a prior run under a different cwd, or a manual `docker run` using the
  # same `container_name`) survives `down --remove-orphans` because Compose
  # only removes containers it owns. Force-remove any container claiming an
  # `ai-demo-*` name so `up` can recreate it. Sourced from the compose config
  # so new services are picked up automatically.
  local stale_names
  stale_names="$(docker compose "${COMPOSE_FILES[@]}" config --format json 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(s.get("container_name","") for s in d.get("services",{}).values() if s.get("container_name")))' 2>/dev/null || true)"
  if [[ -n "${stale_names}" ]]; then
    local removed=0
    for name in ${stale_names}; do
      if docker rm -f "${name}" >/dev/null 2>&1; then
        ((removed++))
      fi
    done
    if [[ ${removed} -gt 0 ]]; then
      warn "Removed ${removed} stale container(s) from a previous Compose project."
    fi
  fi

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

  # Verify the encrypted secrets.vault decrypts before `up` — the BFF fails fast
  # (exit 1) if the vault is present but VAULT_PASSWORD is unset/wrong.
  vault_preflight
  echo ""

  # Auto-provision the apikey-dispatch service key (vault + .env) BEFORE `up`
  # so mortgage-service boots with a non-default key on fresh clones and any
  # rotation is picked up by the recreated containers. Fails soft.
  # Force a fresh key with: ROTATE_SERVICE_KEYS=1 ./run-docker.sh start
  node demo_api_server/scripts/ensure-service-keys.js
  echo ""

  # Host llama.cpp must be up + bound 0.0.0.0 before the BFF starts so it isn't
  # reported "not configured" on the first request.
  start_llamacpp
  echo ""

  _CORE_UP=($(_effective_core_services))
  # shellcheck disable=SC2206
  _DEFAULT_PROFILES=($(_optional_profile_args "${DEFAULT_OPTIONAL_GROUPS[@]}"))
  # shellcheck disable=SC2206
  _DEFAULT_OPTIONAL_SVCS=($(_optional_resolve_groups "${DEFAULT_OPTIONAL_GROUPS[@]}"))

  # Clear any stale bare-metal listener (e.g. a leftover ./run.sh vite on :4000)
  # that would silently shadow a Docker container's published port.
  clear_stale_host_listeners
  echo ""

  if [[ "${build_flag}" == "--build" ]]; then
    ok "Rebuilding images..."
    echo ""
    if [[ "${stack}" == "full" ]]; then
      docker compose "${COMPOSE_FILES[@]}" "${FULL_STACK_PROFILE_ARGS[@]}" up --build -d
    else
      docker compose "${COMPOSE_FILES[@]}" "${_DEFAULT_PROFILES[@]}" up --build -d \
        demo-api-server "${_CORE_UP[@]}" "${_DEFAULT_OPTIONAL_SVCS[@]}"
    fi
  else
    ok "Ensuring demo-api-server is up to date..."
    echo ""
    local _boot_build=(demo-api-server)
    local _ui_dev; _ui_dev="$(_dev_ui_build_arg)"
    [[ -n "${_ui_dev}" ]] && _boot_build+=("${_ui_dev}")
    docker compose "${COMPOSE_FILES[@]}" up -d --build "${_boot_build[@]}"
    if [[ "${stack}" == "full" ]]; then
      ok "Starting full stack (core + all compose profiles)..."
      docker compose "${COMPOSE_FILES[@]}" "${FULL_STACK_PROFILE_ARGS[@]}" up -d
    else
      if [[ "${_LLM_BACKEND}" == "omlx" ]]; then
        ok "Starting core + Code Search (${#_CORE_UP[@]} services + BFF + rag, llm-proxy skipped — host oMLX on :8090) — real P1AZ + PingGateway; demo-auth profile off until FF flipped."
      elif [[ "${_LLM_BACKEND}" == "mlx" ]]; then
        ok "Starting core + Code Search (${#_CORE_UP[@]} services + BFF + rag, llm-proxy skipped — host mlx-lm on :8090) — real P1AZ + PingGateway; demo-auth profile off until FF flipped."
      else
        ok "Starting core + Code Search (${#_CORE_UP[@]} services + BFF + rag) — real P1AZ + PingGateway; demo-auth profile off until FF flipped."
      fi
      ok "After toggling Quick Flags: ./run-docker.sh demo-sync"
      docker compose "${COMPOSE_FILES[@]}" "${_DEFAULT_PROFILES[@]}" up -d \
        "${_CORE_UP[@]}" "${_DEFAULT_OPTIONAL_SVCS[@]}"
    fi
  fi

  echo ""
  cmd_demo_sync

  # Runs AFTER demo-sync: that step recreates instrumented services (mcp-server
  # among them) with its errors suppressed, so this is the first point where the
  # real end state is known.
  echo ""
  _verify_core_running || true

  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [DOCKER]  AI DEMO — STATUS                                      ${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  print_status_table
  echo ""
  echo -e "${GREEN}${BOLD}  ╭─ URLS ──────────────────────────────────────────────────────╮${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [WEB]    App            ${YELLOW}${BOLD}https://local.ping-devops.com:4000${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [CONFIG] Admin Config   ${YELLOW}${BOLD}https://local.ping-devops.com:4000/config${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [LOGIN]  Admin Login    ${YELLOW}${BOLD}https://api.ping.demo:3001/api/auth/oauth/login${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [USER]   User Login     ${YELLOW}${BOLD}https://api.ping.demo:3001/api/auth/oauth/user/login${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [TRACE]  Jaeger UI      ${YELLOW}${BOLD}http://localhost:16686${RESET}  ${DIM}(service: demo-api-server)${RESET}"
  echo -e "${GREEN}${BOLD}  ╰─────────────────────────────────────────────────────────────╯${RESET}"
  echo ""
  echo -e "${MAGENTA}${BOLD}  ╭─ PORTS ─────────────────────────────────────────────────────╮${RESET}"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  BFF (Express)          :3001  ${YELLOW}(HTTPS)${RESET}"
  echo -e "${MAGENTA}${BOLD}  │${RESET}  Jaeger (tracing UI)    :16686"
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
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh${RESET}                   start core + Code Search (rag)"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh start full${RESET}        start every compose service"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh optional stop rag${RESET}   stop Code Search / RAG (free RAM)"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh optional status${RESET}     show optional group state"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh restart${RESET}           restart core + rag"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh restart${RESET} <svc>     restart specific service(s)"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh build${RESET}             rebuild all images"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh build${RESET} <svc>       rebuild specific service(s)"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh stop${RESET}              stop all containers"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh stop${RESET} <svc>        stop specific service(s)"
  echo -e "${WHITE}${BOLD}  │${RESET}"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh logs${RESET}              pick service to tail"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh logs${RESET} <svc>        tail specific service"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh status${RESET}            show container health"
  echo -e "${WHITE}${BOLD}  │${RESET}  ${BOLD}./run-docker.sh llamacpp restart${RESET}  restart host LLM (llama.cpp tiers or oMLX)"
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
  echo -e "${GREEN}${BOLD}  │${RESET}  [WEB]    App            ${YELLOW}${BOLD}https://local.ping-devops.com:4000${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [CONFIG] Admin Config   ${YELLOW}${BOLD}https://local.ping-devops.com:4000/config${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [LOGIN]  Admin Login    ${YELLOW}${BOLD}https://api.ping.demo:3001/api/auth/oauth/login${RESET}"
  echo -e "${GREEN}${BOLD}  │${RESET}  [TRACE]  Jaeger UI      ${YELLOW}${BOLD}http://localhost:16686${RESET}"
  echo -e "${GREEN}${BOLD}  ╰─────────────────────────────────────────────────────────────╯${RESET}"
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
}

cmd_llamacpp_restart() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [LLAMA.CPP]  Restarting model tiers 8091 + 8096 (containers untouched)${RESET}"
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

# Run Phi narration/hallucination eval in the always-on promptfoo core sidecar.
cmd_promptfoo() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${CYAN}${BOLD}   [PROMPTFOO]  Step narration eval (Phi → :8090)${RESET}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  if ! curl -sf --max-time 3 http://127.0.0.1:8090/health >/dev/null 2>&1; then
    err "nothing healthy on :8090 — start the stack (./run-docker.sh) and ensure Phi is loaded"
    exit 1
  fi
  if ! docker compose "${COMPOSE_FILES[@]}" ps --status running --services 2>/dev/null | grep -qx 'promptfoo-step-narration'; then
    docker compose "${COMPOSE_FILES[@]}" up -d --build promptfoo-step-narration
  fi
  docker compose "${COMPOSE_FILES[@]}" exec -T promptfoo-step-narration \
    promptfoo eval -c promptfoo/step-narration.config.yaml --filter-providers phi-4-mini-instruct
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
  echo "    (default)             Stop existing containers, then start core + Code Search (rag)"
  echo "    start full            Stop existing containers, then start every compose service"
  echo "    all                   Same as 'start full'"
  echo "    optional start <grp>  Start optional group(s) on a running stack (no teardown)"
  echo "    optional stop <grp>   Stop optional group(s); core keeps running"
  echo "    optional status       Show which optional groups are up"
  echo "    demo-sync             Start/stop demo-auth containers to match Quick Flag toggles"
  echo "    stop                  Stop and remove all containers (+ host model tiers)"
  echo "    stop <svc>...         Stop only the named service(s); others keep running"
  echo "    restart               Same as default — stop then start core + rag"
  echo "    restart <svc>...      Recreate only the named service(s); picks up env/compose"
  echo "                          changes (use 'build' for code changes); others untouched"
  echo "    build                 Stop, rebuild all images, then start core + rag"
  echo "    build full            Stop, rebuild all images, then start everything"
  echo "    build <svc>...        Rebuild + restart only the named service(s); others untouched"
  echo "    logs                  Interactive log picker (pick service by number)"
  echo "    logs <service>        Tail a specific service directly"
  echo "    status                Show container health table"
  echo "    llamacpp restart      Stop and restart host LLM backend (llama.cpp tiers or oMLX)"
  echo "    promptfoo             Run Phi step-narration eval (core promptfoo sidecar → :8090)"
  echo "    help                  Show this message"
  echo ""
  cmd_optional_help
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
  echo "    ./run-docker.sh                             # start core + Code Search (rag)"
  echo "    ./run-docker.sh start full                  # start every compose service"
  echo "    ./run-docker.sh demo-sync                   # apply Quick Flag toggles to containers"
  echo "    ./run-docker.sh optional stop rag           # free Code Search RAM when unused"
  echo "    ./run-docker.sh optional start rag          # re-enable Code Search"
  echo "    ./run-docker.sh optional start agents       # alt agent frameworks"
  echo "    ./run-docker.sh optional status             # see what's running"
  echo "    DEMO_STACK=full ./run-docker.sh start       # env override for full stack"
  echo "    ./run-docker.sh build                       # rebuild core images"
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
  machine|specs)
    demo_machine_banner docker
    exit 0
    ;;
  start)
    cmd_start "$@"
    ;;
  all)
    cmd_start full "$@"
    ;;
  optional)
    sub="${1:-}"
    shift || true
    case "${sub}" in
      start)
        [[ $# -gt 0 ]] || { err "Usage: ./run-docker.sh optional start <group>..."; cmd_optional_help; exit 1; }
        cmd_optional_start "$@"
        ;;
      stop)
        [[ $# -gt 0 ]] || { err "Usage: ./run-docker.sh optional stop <group>..."; cmd_optional_help; exit 1; }
        cmd_optional_stop "$@"
        ;;
      status)
        cmd_optional_status
        ;;
      help|--help|-h|"")
        cmd_optional_help
        ;;
      *)
        err "Unknown optional subcommand: ${sub}"
        cmd_optional_help
        exit 1
        ;;
    esac
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
    if [[ "${1:-}" == "full" ]]; then
      shift || true
      cmd_start --build full "$@"
    elif [[ -n "${1:-}" ]]; then
      cmd_build_one "$@"
    else
      cmd_start --build "$@"
    fi
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
  promptfoo)
    cmd_promptfoo
    ;;
  status)
    cmd_status
    ;;
  demo-sync)
    cmd_demo_sync
    print_status_table
    echo ""
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
