#!/usr/bin/env bash
# se-update-config.sh — Push config/env changes to the SE cluster (no rebuild).
#
# Use this when you changed:
#   - demo_api_server/.env (secrets, redirect URIs, PingOne creds)
#   - k8s/02-configmap.yaml (configmap values)
#   - k8s/aws/nginx-http-configmap.yaml (nginx proxy config)
#   - Any other k8s manifest (deployments, services, ingress)
#
# Does NOT rebuild Docker images. Restarts only affected pods.

set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ping-email.sh
source "$BASEDIR/scripts/ping-email.sh"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
die()     { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

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
info "Namespace: $NS"

# ── Re-create secrets from .env files ────────────────────────────────────────
info "Updating k8s secrets from .env files..."
K8S_NAMESPACE="$NS" bash "$BASEDIR/k8s/create-secrets.sh"
success "Secrets updated."

# ── Re-apply configmaps + manifests via deploy.sh ────────────────────────────
info "Re-applying manifests (configmaps, deployments, ingress)..."
K8S_NAMESPACE="$NS" \
PUBLIC_APP_URL="https://ai-demo.ping-devops.com" \
  bash "$BASEDIR/k8s/aws/deploy.sh"

success ""
echo -e "${GREEN}Config update complete.${NC} App: https://ai-demo.ping-devops.com"
echo ""
echo "  If you changed redirect URIs in .env, also re-run the PingOne bootstrap:"
echo "    cd demo_api_server"
echo "    PUBLIC_APP_URL=https://ai-demo.ping-devops.com \\"
echo "      PINGONE_BOOTSTRAP_ENV_ID=\$(grep ^PINGONE_ENVIRONMENT_ID .env | cut -d= -f2) \\"
echo "      PINGONE_BOOTSTRAP_CLIENT_ID=\$(grep ^PINGONE_WORKER_CLIENT_ID .env | cut -d= -f2) \\"
echo "      PINGONE_BOOTSTRAP_CLIENT_SECRET=\$(grep ^PINGONE_WORKER_CLIENT_SECRET .env | cut -d= -f2) \\"
echo "      npm run pingone:bootstrap:ci"
