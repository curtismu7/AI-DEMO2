#!/usr/bin/env bash
# Mint a PingFederate workload token and decode its claims. Token itself is
# never printed. Secret comes from env PF_ROUTE_C_SECRET.
#
# Usage: ./privilege/scripts/workload-identity-mint.sh
set -euo pipefail

PF_HOST="${PF_HOST:-https://cmuir-pf.ping-devops.com}"
CLIENT_ID="${PF_ROUTE_C_CLIENT_ID:-pf-route-c-test}"
GATEWAY="${GATEWAY:-https://mcpgw.ai-demo.ping-devops.com}"
APP="${APP:-pftoken}"
SCOPES="${PF_SCOPES:-openid opensearch:read whoami:read}"

: "${PF_ROUTE_C_SECRET:?Set PF_ROUTE_C_SECRET (the pf-route-c-test client secret)}"

TOKEN=$(curl -sS -m 20 "$PF_HOST/as/token.oauth2" \
  -u "$CLIENT_ID:$PF_ROUTE_C_SECRET" \
  -d grant_type=client_credentials \
  -d "scope=$SCOPES" \
  -d "resource=$GATEWAY/$APP/mcp" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('access_token') or 'FAIL: '+str(d))")
[[ "$TOKEN" == FAIL* ]] && { echo "$TOKEN" >&2; exit 1; }

echo "Token minted (not shown). Claims:"
echo "$TOKEN" | cut -d. -f2 | python3 -c "
import base64,sys,json
s=sys.stdin.read().strip(); s+='='*(-len(s)%4)
print(json.dumps(json.loads(base64.urlsafe_b64decode(s)), indent=1))"

# To run the full demo:  ./privilege/scripts/workload-identity-call.sh
