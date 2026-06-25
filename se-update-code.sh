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
#   mcp       demo_mcp_server     → ai-demo-mcp-server         → mcp-server
#   gateway   demo_mcp_gateway    → ai-demo-mcp-gateway        → mcp-gateway
#   agent     langchain_agent     → ai-demo-langchain-agent    → langchain-agent
#   authz     demo_authz_server   → ai-demo-authz-server       → mcp-gateway (sidecar)
#   mastra    mastra_agent        → ai-demo-mastra-agent       → mastra-agent
#   openai    openai_agent        → ai-demo-openai-agent       → openai-agent
#   pydantic  pydantic_agent      → ai-demo-pydantic-agent     → pydantic-agent
#   hitl      demo_hitl_service   → ai-demo-hitl-service       → hitl-service
#   invest    demo_mcp_invest     → ai-demo-mcp-invest         → mcp-invest
#   mortgage  demo_mortgage_service → ai-demo-mortgage-service → mortgage-service

set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")" && pwd)"
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
    authz)    echo "authz-server" ;;
    mastra)   echo "mastra-agent" ;;
    openai)   echo "openai-agent" ;;
    pydantic) echo "pydantic-agent" ;;
    hitl)     echo "hitl-service" ;;
    invest)   echo "mcp-invest" ;;
    mortgage) echo "mortgage-service" ;;
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
    authz)    echo "ai-demo-authz-server" ;;
    mastra)   echo "ai-demo-mastra-agent" ;;
    openai)   echo "ai-demo-openai-agent" ;;
    pydantic) echo "ai-demo-pydantic-agent" ;;
    hitl)     echo "ai-demo-hitl-service" ;;
    invest)   echo "ai-demo-mcp-invest" ;;
    mortgage) echo "ai-demo-mortgage-service" ;;
    *)        echo "" ;;
  esac
}

local_img() {
  case "$1" in
    bff)      echo "ai-demo-demo-api-server" ;;
    frontend) echo "ai-demo-ui" ;;
    mcp)      echo "ai-demo-mcp-server" ;;
    gateway)  echo "ai-demo-mcp-gateway" ;;
    agent)    echo "ai-demo-langchain-agent" ;;
    authz)    echo "ai-demo-authz-server" ;;
    mastra)   echo "ai-demo-mastra-agent" ;;
    openai)   echo "ai-demo-openai-agent" ;;
    pydantic) echo "ai-demo-pydantic-agent" ;;
    hitl)     echo "ai-demo-hitl-service" ;;
    invest)   echo "ai-demo-mcp-invest" ;;
    mortgage) echo "ai-demo-mortgage-service" ;;
    *)        echo "" ;;
  esac
}

k8s_dep() {
  case "$1" in
    bff)      echo "demo-api-server" ;;
    frontend) echo "frontend" ;;
    mcp)      echo "mcp-server" ;;
    gateway)  echo "mcp-gateway" ;;
    agent)    echo "langchain-agent" ;;
    authz)    echo "mcp-gateway" ;;
    mastra)   echo "mastra-agent" ;;
    openai)   echo "openai-agent" ;;
    pydantic) echo "pydantic-agent" ;;
    hitl)     echo "hitl-service" ;;
    invest)   echo "mcp-invest" ;;
    mortgage) echo "mortgage-service" ;;
    *)        echo "" ;;
  esac
}

ALL_KEYS="bff frontend mcp gateway agent authz mastra openai pydantic hitl invest mortgage"

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
  [[ -n "${PING_EMAIL:-}" ]] && email="$PING_EMAIL"
  [[ -z "$email" && -f "$BASEDIR/demo_api_server/.env" ]] && \
    email="$(grep -E '^PING_EMAIL=' "$BASEDIR/demo_api_server/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  [[ -z "$email" ]] && die "Cannot derive namespace — set SE_NAMESPACE=ping-devops-<you> or PING_EMAIL=you@pingidentity.com"
  local slug; slug="$(echo "${email%%@*}" | tr -d '.' | tr '[:upper:]' '[:lower:]')"
  echo "ping-devops-${slug}"
}

NS="$(derive_ns)"
SERVICE="${1:-}"

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
  docker compose -f "$BASEDIR/docker-compose.yml" build "$svc"
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
  docker compose -f "$BASEDIR/docker-compose.yml" build
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
GITHUB_OWNER="$GITHUB_OWNER" \
K8S_NAMESPACE="$NS" \
PUBLIC_APP_URL="https://ai-demo.ping-devops.com" \
  bash "$BASEDIR/k8s/aws/deploy.sh"

success ""
echo -e "${GREEN}Update complete.${NC} App: https://ai-demo.ping-devops.com"
