#!/usr/bin/env bash
# se-update-code.sh — Rebuild changed service(s) and redeploy to the SE cluster.
#
# Use this when you changed source code in any service.
#
# Usage:
#   ./se-update-code.sh               # rebuild ALL services + redeploy
#   ./se-update-code.sh bff           # rebuild only demo-api-server + redeploy
#   ./se-update-code.sh frontend      # rebuild only frontend + redeploy
#   ./se-update-code.sh mcp           # rebuild only mcp-server + redeploy
#   ./se-update-code.sh gateway       # rebuild only mcp-gateway + redeploy
#   ./se-update-code.sh agent         # rebuild only langchain-agent + redeploy
#
# SERVICE shortcuts → docker-compose service → GHCR image → k8s deployment:
#   bff       demo_api_server     → ai-demo-demo-api-server → demo-api-server
#   frontend  demo_api_ui         → ai-demo-frontend           → frontend
#   mcp       oauth-mcp           → ai-demo-mcp-server         → mcp-server
#   gateway   demo_mcp_gateway    → ai-demo-mcp-gateway        → mcp-gateway
#   agent     langchain_agent     → ai-demo-langchain-agent    → langchain-agent
#   agentsvc  demo_agent_service  → ai-demo-agent-service      → agent-service
#   authz     demo_authz_server   → ai-demo-authz-server       → mcp-gateway (sidecar)
#   mastra    mastra_agent        → ai-demo-mastra-agent       → mastra-agent
#   openai    openai_agent        → ai-demo-openai-agent       → openai-agent
#   pydantic  pydantic_agent      → ai-demo-pydantic-agent     → pydantic-agent
#   hitl      demo_hitl_service   → ai-demo-hitl-service       → hitl-service
#   invest    demo_mcp_resource_server     → ai-demo-mcp-resource-server         → mcp-resource-server
#   mortgage  demo_api_resource_server → ai-demo-api-resource-server → api-resource-server

set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ping-email.sh
source "$BASEDIR/scripts/ping-email.sh"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
die()     { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

# ── Service map lookup functions (bash 3.2 compatible — no declare -A) ────────
compose_svc() {
  case "$1" in
    bff)      echo "demo-api-server" ;;
    frontend) echo "ui" ;;
    mcp)      echo "mcp-server" ;;
    gateway)  echo "mcp-gateway" ;;
    agent)    echo "langchain-agent" ;;
    agentsvc) echo "agent-service" ;;
    authz)    echo "authz-server" ;;
    mastra)   echo "mastra-agent" ;;
    openai)   echo "openai-agent" ;;
    pydantic) echo "pydantic-agent" ;;
    hitl)     echo "hitl-service" ;;
    invest)   echo "mcp-resource-server" ;;
    mortgage) echo "api-resource-server" ;;
    *)        echo "" ;;
  esac
}

ghcr_img() {
  case "$1" in
    bff)      echo "ai-demo-demo-api-server" ;;
    frontend) echo "ai-demo-frontend" ;;
    mcp)      echo "ai-demo-mcp-server" ;;
    gateway)  echo "ai-demo-mcp-gateway" ;;
    agent)    echo "ai-demo-langchain-agent" ;;
    agentsvc) echo "ai-demo-agent-service" ;;
    authz)    echo "ai-demo-authz-server" ;;
    mastra)   echo "ai-demo-mastra-agent" ;;
    openai)   echo "ai-demo-openai-agent" ;;
    pydantic) echo "ai-demo-pydantic-agent" ;;
    hitl)     echo "ai-demo-hitl-service" ;;
    invest)   echo "ai-demo-mcp-resource-server" ;;
    mortgage) echo "ai-demo-api-resource-server" ;;
    *)        echo "" ;;
  esac
}

# SE builds run under their own compose project (SE_COMPOSE_PROJECT) so the
# production-stage images they produce get tags like ai-demo-se-ui — NEVER the
# dev stack's ai-demo-* tags. Building prod images onto the dev tags broke the
# running dev stack: the next `docker compose up -d` recreated ai-demo-ui from
# the nginx (prod) image while the dev override still ran `npm start`, and the
# container crash-looped with exit 127 (npm: not found).
SE_COMPOSE_PROJECT="ai-demo-se"

local_img() {
  # Compose default image naming: <project>-<service>.
  local svc; svc="$(compose_svc "$1")"
  [[ -n "$svc" ]] && echo "${SE_COMPOSE_PROJECT}-${svc}" || echo ""
}

k8s_dep() {
  case "$1" in
    bff)      echo "demo-api-server" ;;
    frontend) echo "frontend" ;;
    mcp)      echo "mcp-server" ;;
    gateway)  echo "mcp-gateway" ;;
    agent)    echo "langchain-agent" ;;
    agentsvc) echo "agent-service" ;;
    authz)    echo "mcp-gateway" ;;
    mastra)   echo "mastra-agent" ;;
    openai)   echo "openai-agent" ;;
    pydantic) echo "pydantic-agent" ;;
    hitl)     echo "hitl-service" ;;
    invest)   echo "mcp-resource-server" ;;
    mortgage) echo "api-resource-server" ;;
    *)        echo "" ;;
  esac
}

# Every key here must exist in local_img/ghcr_img/k8s_dep/compose_svc — the "build
# and push ALL" loop and the "roll every deployment" loop both iterate this list,
# so a key missing here is silently skipped by a full deploy while still working
# when named explicitly. agent-service was in all four maps but not this list.
ALL_KEYS="bff frontend mcp gateway agent agentsvc authz mastra openai pydantic hitl invest mortgage"

GITHUB_OWNER="${GITHUB_OWNER:-}"
if [[ -z "$GITHUB_OWNER" ]]; then
  GITHUB_OWNER="$(git -C "$BASEDIR" remote get-url origin 2>/dev/null | sed 's|.*github.com[:/]\([^/]*\)/.*|\1|' | tr '[:upper:]' '[:lower:]' || true)"
  [[ -z "$GITHUB_OWNER" ]] && die "Set GITHUB_OWNER (your GitHub username) — could not auto-detect from git remote"
fi
REGISTRY="ghcr.io/${GITHUB_OWNER}"
TAG="${IMAGE_TAG:-latest}"

# Derive SE namespace (same logic as run-k8.sh)
derive_ns() {
  [[ -n "${SE_NAMESPACE:-}" ]] && echo "$SE_NAMESPACE" && return
  local email=""
  [[ -n "${PING_EMAIL:-}" ]] && email="$(sanitize_ping_email "$PING_EMAIL")"
  [[ -z "$email" && -f "$BASEDIR/demo_api_server/.env" ]] && \
    email="$(sanitize_ping_email "$(grep -E '^PING_EMAIL=' "$BASEDIR/demo_api_server/.env" 2>/dev/null | cut -d= -f2- || true)")"
  [[ -z "$email" ]] && die "Cannot derive namespace — set SE_NAMESPACE=ping-devops-<you> or PING_EMAIL=you@pingidentity.com (@pingidentity.com only)"
  local slug; slug="$(echo "${email%%@*}" | tr -d '.' | tr '[:upper:]' '[:lower:]')"
  echo "ping-devops-${slug}"
}

NS="$(derive_ns)"
SERVICE="${1:-}"

# ── Build-input preflight ─────────────────────────────────────────────────────
# langchain_agent/repo-src/ is a GENERATED staging dir (gitignored) that the
# langchain-agent Dockerfile COPYs — a clean checkout has none and the build
# fails with "repo-src: not found". Generate it when missing.
if [[ -z "$SERVICE" || "$SERVICE" == "agent" ]] && [[ ! -d "$BASEDIR/langchain_agent/repo-src" ]]; then
  info "langchain_agent/repo-src missing — generating (build-codegraph.py --stage-src)..."
  python3 "$BASEDIR/scripts/build-codegraph.py" --stage-src "$BASEDIR/langchain_agent/repo-src" \
    || die "repo-src generation failed — run: python3 scripts/build-codegraph.py --stage-src langchain_agent/repo-src"
fi

# langchain_agent/codegraph.db is the bake input for /app/codegraph.db in the
# agent image. Dockerfile `touch`es an empty placeholder when this file is
# missing/empty → Code Explorer 503 "index not available". Build+copy if needed.
if [[ -z "$SERVICE" || "$SERVICE" == "agent" ]] && [[ ! -s "$BASEDIR/langchain_agent/codegraph.db" ]]; then
  info "langchain_agent/codegraph.db missing/empty — building CodeGraph index for image bake..."
  python3 "$BASEDIR/scripts/build-codegraph.py" \
    || die "CodeGraph index build failed — run: python3 scripts/build-codegraph.py"
  cp -f "$BASEDIR/.codegraph/demo-codegraph.db" "$BASEDIR/langchain_agent/codegraph.db" \
    || die "Failed to bake langchain_agent/codegraph.db"
  success "Baked langchain_agent/codegraph.db ($(wc -c < "$BASEDIR/langchain_agent/codegraph.db") bytes)"
fi

# ── GHCR login ────────────────────────────────────────────────────────────────
info "Logging in to GHCR..."
docker logout ghcr.io >/dev/null 2>&1 || true
gh auth token | docker login ghcr.io -u "$GITHUB_OWNER" --password-stdin \
  || die "GHCR login failed — run: gh auth login"

build_and_push() {
  local key="$1"
  local l_img; l_img="$(local_img "$key")"
  local g_img; g_img="$(ghcr_img "$key")"
  local svc;   svc="$(compose_svc "$key")"
  local uri="${REGISTRY}/${g_img}:${TAG}"

  info "Building ${svc}..."
  # --profile demo-auth: mcp-gateway and authz-server sit behind that compose
  # profile; without it their builds are silently skipped and the tag/push
  # step ships whatever stale local image happens to exist.
  docker compose -p "$SE_COMPOSE_PROJECT" -f "$BASEDIR/docker-compose.yml" --profile demo-auth build "$svc"
  info "Pushing → ${uri}"
  docker tag "${l_img}:latest" "$uri"
  docker push "$uri"
  success "Pushed ${g_img}"
}

roll_deployment() {
  local key="$1"
  local dep; dep="$(k8s_dep "$key")"
  info "Rolling deployment/${dep} in $NS..."
  kubectl rollout restart "deployment/${dep}" -n "$NS"
  kubectl rollout status  "deployment/${dep}" -n "$NS" --timeout=120s
  success "${dep} updated."
}

# ── Build + push ──────────────────────────────────────────────────────────────
if [[ -z "$SERVICE" ]]; then
  info "Building ALL services..."
  # --profile demo-auth: see build_and_push — profile-gated services must build
  # too or the loop below pushes stale local images for them.
  docker compose -p "$SE_COMPOSE_PROJECT" -f "$BASEDIR/docker-compose.yml" --profile demo-auth build
  for key in $ALL_KEYS; do
    l_img="$(local_img "$key")"
    g_img="$(ghcr_img "$key")"
    uri="${REGISTRY}/${g_img}:${TAG}"
    docker tag "${l_img}:latest" "$uri" 2>/dev/null || true
    docker push "$uri"
    info "  pushed ${g_img}"
  done
  success "All images pushed."
else
  [[ -n "$(ghcr_img "$SERVICE")" ]] || die "Unknown service '$SERVICE'. Valid: ${ALL_KEYS}"
  build_and_push "$SERVICE"
fi

# ── Re-deploy manifests (applies config + rolls pods) ────────────────────────
info "Re-deploying manifests to $NS..."
DEPLOY_START_EPOCH="$(date +%s)"
# deploy.sh's per-deployment rollout wait is known to time out on llm-proxy
# while llama-tier5 loads its model, aborting the script and leaving later
# deployments on pre-push images. Don't die here — the smoke checks below
# verify rollout completeness and pod freshness and fail loudly instead.
GITHUB_OWNER="$GITHUB_OWNER" \
K8S_NAMESPACE="$NS" \
PUBLIC_APP_URL="https://ai-demo.ping-devops.com" \
  bash "$BASEDIR/k8s/aws/deploy.sh" \
  || warn "deploy.sh exited nonzero (usually the llm-proxy rollout wait) — smoke checks will verify what actually landed"

# ── Force pod refresh for what we actually built ─────────────────────────────
# kubectl apply is a no-op when the k8s YAML is unchanged, which is the common
# case — only the image tag moved, under a mutable `:latest` tag. That leaves
# the deployment "successfully rolled out" (nothing to roll) while its pod
# still runs the pre-push image. Force a restart of exactly what we built so a
# fresh push always lands, regardless of whether the manifest also changed.
if [[ -n "$SERVICE" ]]; then
  roll_deployment "$SERVICE"
else
  info "Force-restarting deployments to pick up freshly pushed images..."
  seen=""
  for key in $ALL_KEYS; do
    dep="$(k8s_dep "$key")"
    case " $seen " in *" $dep "*) continue ;; esac
    seen="$seen $dep"
    roll_deployment "$key"
  done
fi

# ── Post-deploy smoke checks (fail at deploy time, not demo time) ─────────────
# A single-service push (-n "$SERVICE") only ever touches that one deployment —
# every other running pod legitimately predates it, so scope check 2/7's
# staleness scan to just what this run actually rolled (see roll_deployment
# calls above); the full (-z "$SERVICE") path leaves this empty and checks
# everything, same as before.
SMOKE_SCOPE=""
[ -n "$SERVICE" ] && SMOKE_SCOPE="$(k8s_dep "$SERVICE")"
info "Running post-deploy smoke checks..."
SE_NAMESPACE="$NS" DEPLOY_START_EPOCH="$DEPLOY_START_EPOCH" SMOKE_CHECK_DEPLOYMENTS="$SMOKE_SCOPE" \
  bash "$BASEDIR/k8s/smoke.sh" \
  || die "Smoke checks failed — see [FAIL] lines above for what is degraded and how to fix it."

success ""
echo -e "${GREEN}Update complete.${NC} App: https://ai-demo.ping-devops.com"
