#!/usr/bin/env bash
# scripts/demo-readiness-local.sh — run `demo:ready --target local` against
# this Mac's Docker stack and its local PingOne readiness lane.
#
# It only supplies the LOCAL target's settings and then runs the normal CLI:
#   - target URLs for the local stack (BFF, PingGateway, PingOne Authorize)
#   - the expected revision = the main checkout's HEAD (what Docker serves)
#   - the PingOne worker URL, and its bearer token read from the vault
# Nothing is written, and the token is never printed.
#
# A single target is diagnostic: this cannot return READY. No PingFederate lane
# exists yet, so the run reports that lane as blocked and stops before the audit.
#
# Usage: npm run demo:ready:local [-- --json]
set -euo pipefail

MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
ENV_FILE="$MAIN/demo_api_server/.env"
# `|| true`: a setting that is absent is an empty value, not a script failure.
env_value() { { grep -m1 "^$1=" "$2" 2>/dev/null || true; } | cut -d= -f2- | sed 's/^"//; s/"$//'; }

PINGONE_ENV_ID="$(env_value PINGONE_ENVIRONMENT_ID "$ENV_FILE")"
PINGONE_REGION="$(env_value PINGONE_REGION "$ENV_FILE")"
VAULT_PASSWORD_VALUE="$(env_value VAULT_PASSWORD "$ENV_FILE")"
[ -n "$PINGONE_ENV_ID" ] || { echo "[demo-readiness-local] PINGONE_ENVIRONMENT_ID is not set in demo_api_server/.env" >&2; exit 1; }
[ -n "$VAULT_PASSWORD_VALUE" ] || { echo "[demo-readiness-local] VAULT_PASSWORD is not set in demo_api_server/.env" >&2; exit 1; }

vault_get() {
  VAULT_PASSWORD="$VAULT_PASSWORD_VALUE" VAULT_PATH="$MAIN/secrets.vault" \
    node "$MAIN/demo_api_server/scripts/vault.js" get "$1" 2>/dev/null \
    || { echo "[demo-readiness-local] could not read $1 from the vault" >&2; exit 1; }
}
WORKER_TOKEN="$(vault_get DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN)"
PF_WORKER_TOKEN="$(vault_get DEMO_READINESS_LOCAL_PINGFEDERATE_WORKER_TOKEN)"

export DEMO_READINESS_LOCAL_BFF_URL="https://api.ping.demo:3001"
# The MCP route, not the gateway root: the root has no route (404), while /mcp
# answers 401 without a token — reachable and enforcing, which is what the
# audit's route probe looks for.
export DEMO_READINESS_LOCAL_GATEWAY_URL="https://api.ping.demo:3036/mcp"
export DEMO_READINESS_LOCAL_AUTHORIZE_URL="https://api.pingone.${PINGONE_REGION:-com}/v1/environments/${PINGONE_ENV_ID}/decisionEndpoints"
export DEMO_READINESS_LOCAL_EXPECTED_REVISION="$(git -C "$MAIN" rev-parse HEAD)"
export DEMO_READINESS_LOCAL_PINGONE_WORKER_URL="https://api.ping.demo:4444"
export DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN="$WORKER_TOKEN"
export DEMO_READINESS_LOCAL_PINGONE_IDENTITY_REF="$(env_value DEMO_READINESS_LOCAL_PINGONE_IDENTITY_REF "$MAIN/.env")"
: "${DEMO_READINESS_LOCAL_PINGONE_IDENTITY_REF:=readiness-pingone-local}"
export DEMO_READINESS_LOCAL_PINGONE_IDENTITY_REF
export DEMO_READINESS_LOCAL_PINGFEDERATE_WORKER_URL="https://api.ping.demo:4445"
export DEMO_READINESS_LOCAL_PINGFEDERATE_WORKER_TOKEN="$PF_WORKER_TOKEN"
DEMO_READINESS_LOCAL_PINGFEDERATE_IDENTITY_REF="$(env_value DEMO_READINESS_LOCAL_PINGFEDERATE_IDENTITY_REF "$MAIN/.env")"
: "${DEMO_READINESS_LOCAL_PINGFEDERATE_IDENTITY_REF:=readiness-pingfederate-local}"
export DEMO_READINESS_LOCAL_PINGFEDERATE_IDENTITY_REF
# PingOne Management API readback for the audit (read-only). The secret comes
# from the vault, which is authoritative over demo_api_server/.env.
export PINGONE_ENVIRONMENT_ID="$PINGONE_ENV_ID"
export PINGONE_REGION="${PINGONE_REGION:-com}"
export PINGONE_WORKER_CLIENT_ID="$(env_value PINGONE_WORKER_CLIENT_ID "$ENV_FILE")"
PINGONE_WORKER_CLIENT_SECRET="$(vault_get PINGONE_WORKER_CLIENT_SECRET)"
export PINGONE_WORKER_CLIENT_SECRET
export PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID="$(env_value PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID "$ENV_FILE")"
export PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID="$(env_value PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID "$ENV_FILE")"
# Non-secret PingFederate settings: the declared side of the Gateway Exchange #3
# readback (what refresh-service-envs.js generates for PingGateway).
for name in PF_ISSUER PF_ISSUER_URI PF_TOKEN_ENDPOINT PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID \
  PF_STANDARD_AGENT_EXCHANGE_CLIENT_ID PF_AI_AGENT_ACTOR_CLIENT_ID PF_MCP_SERVICE_ACTOR_CLIENT_ID; do
  export "$name=$(env_value "$name" "$ENV_FILE")"
done
# PingFederate Admin API readback for the audit (read-only GETs). The local
# admin console serves a self-signed certificate, so verification is skipped for
# those reads alone — never process-wide.
export PINGFEDERATE_ADMIN_API_BASE="https://local.ping-devops.com:9999/pf-admin-api/v1"
PINGFEDERATE_ADMIN_PASSWORD="$(vault_get PF_ADMIN_CONSOLE_PASSWORD)"
export PINGFEDERATE_ADMIN_PASSWORD
export PINGFEDERATE_ADMIN_TLS_INSECURE=1
# The local stack's certificates are issued by mkcert's CA.
export NODE_EXTRA_CA_CERTS="$MAIN/certs/mkcert-rootCA.pem"

exec node "$MAIN/scripts/demo-readiness.js" --target local "$@"
