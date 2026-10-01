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
env_value() { grep -m1 "^$1=" "$2" 2>/dev/null | cut -d= -f2- | sed 's/^"//; s/"$//'; }

PINGONE_ENV_ID="$(env_value PINGONE_ENVIRONMENT_ID "$ENV_FILE")"
PINGONE_REGION="$(env_value PINGONE_REGION "$ENV_FILE")"
VAULT_PASSWORD_VALUE="$(env_value VAULT_PASSWORD "$ENV_FILE")"
[ -n "$PINGONE_ENV_ID" ] || { echo "[demo-readiness-local] PINGONE_ENVIRONMENT_ID is not set in demo_api_server/.env" >&2; exit 1; }
[ -n "$VAULT_PASSWORD_VALUE" ] || { echo "[demo-readiness-local] VAULT_PASSWORD is not set in demo_api_server/.env" >&2; exit 1; }

WORKER_TOKEN="$(VAULT_PASSWORD="$VAULT_PASSWORD_VALUE" VAULT_PATH="$MAIN/secrets.vault" \
  node "$MAIN/demo_api_server/scripts/vault.js" get DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN 2>/dev/null)" \
  || { echo "[demo-readiness-local] could not read the worker token from the vault" >&2; exit 1; }

export DEMO_READINESS_LOCAL_BFF_URL="https://api.ping.demo:3001"
export DEMO_READINESS_LOCAL_GATEWAY_URL="https://api.ping.demo:3036"
export DEMO_READINESS_LOCAL_AUTHORIZE_URL="https://api.pingone.${PINGONE_REGION:-com}/v1/environments/${PINGONE_ENV_ID}/decisionEndpoints"
export DEMO_READINESS_LOCAL_EXPECTED_REVISION="$(git -C "$MAIN" rev-parse HEAD)"
export DEMO_READINESS_LOCAL_PINGONE_WORKER_URL="https://api.ping.demo:4444"
export DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN="$WORKER_TOKEN"
export DEMO_READINESS_LOCAL_PINGONE_IDENTITY_REF="$(env_value DEMO_READINESS_LOCAL_PINGONE_IDENTITY_REF "$MAIN/.env")"
: "${DEMO_READINESS_LOCAL_PINGONE_IDENTITY_REF:=readiness-pingone-local}"
export DEMO_READINESS_LOCAL_PINGONE_IDENTITY_REF
# The local stack's certificates are issued by mkcert's CA.
export NODE_EXTRA_CA_CERTS="$MAIN/certs/mkcert-rootCA.pem"

exec node "$MAIN/scripts/demo-readiness.js" --target local "$@"
