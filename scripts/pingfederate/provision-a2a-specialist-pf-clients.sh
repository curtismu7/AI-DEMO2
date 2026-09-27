#!/usr/bin/env bash
# provision-a2a-specialist-pf-clients.sh — create PF OAuth clients for the 11
# A2A specialist Agent-2 apps, reusing the PingOne UUID client ids and the
# BFF's own secrets from demo_api_server/.env (per the 2026-09-22 A2A-under-PF
# runtime config, lost in the 2026-09-26 PF profile rebuild).
#
# Grants: CLIENT_CREDENTIALS + TOKEN_EXCHANGE (actor CC + Exchange #2 exchanger).
set -euo pipefail

PF_BASE="${PF_BASE:-https://local.ping-devops.com:9999/pf-admin-api/v1}"
if [[ -z "${PINGFEDERATE_ADMIN_PASSWORD:-}" ]]; then
  PINGFEDERATE_ADMIN_PASSWORD=$(docker inspect ai-demo-pingfederate \
    --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | awk -F= '$1=="PING_IDENTITY_PASSWORD"{print substr($0, index($0,"=")+1)}')
fi
AUTH="administrator:${PINGFEDERATE_ADMIN_PASSWORD}"
ENV_FILE="${ENV_FILE:-$(dirname "$0")/../../demo_api_server/.env}"

api() { curl -sk -u "$AUTH" -H "X-XSRF-Header: x" "$@"; }

VERTICALS="FINAID HOLDINGS IDENTITY INVESTMENT MEMBERSHIP PASSENGER PAYROLL PURCHASE RECORDS SUPPLIER TAX"

for V in $VERTICALS; do
  CID=$(grep -E "^PINGONE_A2A_${V}_AGENT_CLIENT_ID=" "$ENV_FILE" | cut -d= -f2-)
  CSEC=$(grep -E "^PINGONE_A2A_${V}_AGENT_CLIENT_SECRET=" "$ENV_FILE" | cut -d= -f2-)
  if [[ -z "$CID" || -z "$CSEC" ]]; then
    echo "skip $V — id/secret missing in .env"
    continue
  fi
  existing=$(api -o /dev/null -w '%{http_code}' "$PF_BASE/oauth/clients/$CID")
  body=$(cat <<EOF
{
  "clientId": "$CID",
  "name": "AI Demo A2A Specialist $V",
  "description": "A2A Agent-2 specialist (PF-mode) — $V",
  "enabled": true,
  "clientAuth": { "type": "SECRET", "secret": "$CSEC" },
  "grantTypes": ["CLIENT_CREDENTIALS", "TOKEN_EXCHANGE"],
  "bypassApprovalPage": true,
  "restrictScopes": false,
  "defaultAccessTokenManagerRef": { "id": "aiDemoPfJwtAtm" },
  "persistentGrantExpirationTime": 0
}
EOF
)
  if [[ "$existing" == "200" ]]; then
    code=$(api -X PUT -H "Content-Type: application/json" -d "$body" -o /tmp/pf-cli-resp.json -w '%{http_code}' "$PF_BASE/oauth/clients/$CID")
  else
    code=$(api -X POST -H "Content-Type: application/json" -d "$body" -o /tmp/pf-cli-resp.json -w '%{http_code}' "$PF_BASE/oauth/clients")
  fi
  echo "$V ($CID) -> HTTP $code"
  [[ "$code" == "200" || "$code" == "201" ]] || { head -c 300 /tmp/pf-cli-resp.json; echo; exit 1; }
done
echo done
