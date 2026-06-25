#!/usr/bin/env bash
# se-update-pingone.sh — Re-run PingOne bootstrap for the SE cluster URL.
#
# Use this when:
#   - OAuth callbacks are going to the wrong URL (api.ping.demo:4000 instead of ai-demo.ping-devops.com)
#   - You need to re-register redirect URIs in PingOne after changing PUBLIC_APP_URL
#   - PingOne app settings drifted and need to be reconciled
#
# After running this, secrets are re-created and the BFF is restarted automatically.

set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")" && pwd)"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
die()     { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

ENV_FILE="$BASEDIR/demo_api_server/.env"
[[ -f "$ENV_FILE" ]] || die "demo_api_server/.env not found — run install-se.sh first"

derive_ns() {
  [[ -n "${SE_NAMESPACE:-}" ]] && echo "$SE_NAMESPACE" && return
  local email=""
  [[ -n "${PING_EMAIL:-}" ]] && email="$PING_EMAIL"
  [[ -z "$email" ]] && \
    email="$(grep -E '^PING_EMAIL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  [[ -z "$email" ]] && die "Cannot derive namespace — set SE_NAMESPACE=ping-devops-<you> or PING_EMAIL=you@pingidentity.com"
  local slug; slug="$(echo "${email%%@*}" | tr -d '.' | tr '[:upper:]' '[:lower:]')"
  echo "ping-devops-${slug}"
}

NS="$(derive_ns)"
info "Namespace: $NS"

# ── Read worker creds from .env ───────────────────────────────────────────────
ENV_ID="$(grep ^PINGONE_ENVIRONMENT_ID "$ENV_FILE" | cut -d= -f2)"
WORKER_ID="$(grep ^PINGONE_WORKER_CLIENT_ID "$ENV_FILE" | cut -d= -f2)"
WORKER_SECRET="$(grep ^PINGONE_WORKER_CLIENT_SECRET "$ENV_FILE" | cut -d= -f2)"

[[ -z "$ENV_ID" ]]     && die "PINGONE_ENVIRONMENT_ID not found in demo_api_server/.env"
[[ -z "$WORKER_ID" ]]  && die "PINGONE_WORKER_CLIENT_ID not found in demo_api_server/.env"
[[ -z "$WORKER_SECRET" ]] && die "PINGONE_WORKER_CLIENT_SECRET not found in demo_api_server/.env"

info "Running PingOne bootstrap (PUBLIC_APP_URL=https://ai-demo.ping-devops.com)..."
(
  cd "$BASEDIR/demo_api_server"
  PUBLIC_APP_URL="https://ai-demo.ping-devops.com" \
  PINGONE_BOOTSTRAP_ENV_ID="$ENV_ID" \
  PINGONE_BOOTSTRAP_CLIENT_ID="$WORKER_ID" \
  PINGONE_BOOTSTRAP_CLIENT_SECRET="$WORKER_SECRET" \
    npm run pingone:bootstrap:ci
)
success "PingOne bootstrap complete."

# ── Verify redirect URIs were written correctly ───────────────────────────────
ADMIN_URI="$(grep ^PINGONE_ADMIN_REDIRECT_URI "$ENV_FILE" | cut -d= -f2)"
USER_URI="$(grep ^PINGONE_USER_REDIRECT_URI "$ENV_FILE" | cut -d= -f2)"
info "Redirect URIs in .env:"
echo "  Admin: $ADMIN_URI"
echo "  User:  $USER_URI"
if [[ "$USER_URI" == *"api.ping.demo"* ]]; then
  die "Redirect URIs still point at api.ping.demo — bootstrap may have failed or .env was overwritten"
fi

# ── Re-create k8s secrets ─────────────────────────────────────────────────────
info "Updating k8s secrets..."
K8S_NAMESPACE="$NS" bash "$BASEDIR/k8s/create-secrets.sh"
success "Secrets updated."

# ── Restart BFF to pick up new creds ─────────────────────────────────────────
info "Restarting demo-api-server..."
kubectl rollout restart deployment/demo-api-server -n "$NS"
kubectl rollout status  deployment/demo-api-server -n "$NS" --timeout=120s

# ── Verify live ───────────────────────────────────────────────────────────────
LIVE_URI="$(kubectl exec -n "$NS" deploy/demo-api-server -- sh -c 'echo $PINGONE_USER_REDIRECT_URI' 2>/dev/null || true)"
success "Live redirect URI: $LIVE_URI"

echo ""
echo -e "${GREEN}PingOne update complete.${NC}"
echo "  Try signing in at: https://ai-demo.ping-devops.com"
