#!/usr/bin/env bash
# Set a Privilege MCP application's FRONT-END OAuth config.
#
# WHY THIS SCRIPT EXISTS
#   With ResourceOAuth empty, the gateway has no issuer to validate against, so
#   AuthzMiddleware.IssuerPublicKey is [] and it falls back to comparing the
#   token's kid with "infra-root-jwt". No PingOne-minted token can ever match.
#   Filling these fields is what makes a normal PingOne access token work, and
#   what makes the gateway able to emit the 401 WWW-Authenticate challenge with
#   authorization_uri/token_uri that MCP clients bootstrap from.
#
#   These fields are NOT exposed in the Privilege console UI. They live on the
#   Application object and are only reachable through cyctl.
#
# THE TWO THINGS THAT WASTED A DAY
#   1. --apigw is https://console.privilege.pingone.com — NOT
#      https://privilege.pingone.com. The latter is the gateway/data host and
#      answers cyctl with errors that look like auth failures.
#   2. cyctl needs an HS256 console session token. It rejects PingOne tokens
#      (RS256) and the proxy's own (ES256) on algorithm alone, and
#      `cyctl token jwt` cannot bootstrap because it needs a token itself.
#
# Usage:  bash scripts/set-privilege-frontend-oauth.sh '<console-admin-JWT>' [app-name]
#
#   Get the JWT from the Privilege console: DevTools > Network > any XHR >
#   Request Headers > Authorization: Bearer <this>.  It lasts ~60 minutes.
set -euo pipefail

TOKEN="${1:-}"
APP="${2:-MCP-aidemo}"

if [ -z "$TOKEN" ]; then
  echo "usage: bash scripts/set-privilege-frontend-oauth.sh '<console-admin-JWT>' [app-name]" >&2
  echo >&2
  echo "  Privilege console > DevTools > Network > any XHR >" >&2
  echo "  Request Headers > Authorization: Bearer <this>   (~60 min lifetime)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/ping-mcpgw/procyon/config/pingone.env"

TENANT="${PRIVILEGE_TENANT:-8d4d7a4c-de40-4f71-9b98-0c3507cd4d1b}"
APIGW="https://console.privilege.pingone.com"     # see note 1 above
CONTAINER="${MCPGW_CONTAINER:-ai-demo-ping-mcpgw}"

# The gateway acts as the OAuth client. Entry path drives the per-app endpoints
# (/aidemo/mcp, /aidemo/authorize, /aidemo/token, /aidemo/callback), matching
# Ping's own MCP Gateway Authentication Flow diagram.
ENTRY="${ENTRY_PATH:-aidemo}"
GW="${GATEWAY_BASE:-https://mcpgw.local.ping-devops.com}"
BASE="https://auth.pingone.com/$TENANT/as"

if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE — the OIDC client id/secret live there" >&2
  exit 1
fi
CID="$(grep -E '^OIDC_CLIENT_ID=' "$ENV_FILE" | cut -d= -f2-)"
SEC="$(grep -E '^OIDC_CLIENT_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
if [ -z "$CID" ] || [ -z "$SEC" ]; then
  echo "OIDC_CLIENT_ID / OIDC_CLIENT_SECRET not set in $ENV_FILE" >&2
  exit 1
fi

cy() {
  docker exec "$CONTAINER" /procyon/bin/cyctl "$@" \
    --apigw "$APIGW" --tenant "$TENANT" --token "$TOKEN"
}

echo "############ BEFORE ############"
cy object application get "$APP" --detail 2>&1 | head -40

echo
echo "############ UPDATE ############"
# --spec-mcp-app-config-resource-o-auth-use-pkce is REQUIRED, not optional:
# the PingOne application enforces pkceEnforcement=S256_REQUIRED, and without
# it the gateway's authorize call fails with "code_challenge is required".
cy object application update "$APP" \
  --spec-mcp-app-config-entry-path                    "/$ENTRY" \
  --spec-mcp-app-config-resource-o-auth-client-id     "$CID" \
  --spec-mcp-app-config-resource-o-auth-client-secret "$SEC" \
  --spec-mcp-app-config-resource-o-auth-auth-url      "$BASE/authorize" \
  --spec-mcp-app-config-resource-o-auth-token-url     "$BASE/token" \
  --spec-mcp-app-config-resource-o-auth-scopes        "openid profile email" \
  --spec-mcp-app-config-resource-o-auth-use-pkce \
  --spec-oidc-relying-party-redirect-ur-ls-elems      "$GW/$ENTRY/callback" 2>&1 | head -20

echo
echo "############ AFTER ############"
cy object application get "$APP" --detail 2>&1 | head -40

cat <<'NEXT'

Next:
  1. Register the same callback on the PingOne application:
       <GATEWAY_BASE>/<ENTRY_PATH>/callback
  2. Re-probe. A gateway with front-end OAuth configured answers a tokenless
     POST /mcp with 401 AND a WWW-Authenticate header carrying authorization_uri
     and token_uri. No header means the config did not take.
  3. Read it back with the console API (never the console UI):
       privilege/PRIVILEGE-MCP.md, section "the console API reads the real config"
NEXT
