#!/usr/bin/env bash
# Workload identity demo — full chain, verified live 2026-11-13.
#
#   1. Mint a PingFederate JWT (client_credentials) for the federated agent.
#   2. Call the Privilege gateway MCP door with the JWT (no Privilege secret exists).
#   3. Prove Pass Agent Token: the backend reports the token unchanged.
#   4. Control: a garbage bearer gets 401.
#
# Setup:
#   export PF_ROUTE_C_SECRET='<the pf-route-c-test client secret>'
#   (secret comes from your own store; never hardcoded, never echoed)
#
# Usage: ./privilege/scripts/workload-identity-call.sh
set -euo pipefail

PF_HOST="${PF_HOST:-https://cmuir-pf.ping-devops.com}"
CLIENT_ID="${PF_ROUTE_C_CLIENT_ID:-pf-route-c-test}"
GATEWAY="${GATEWAY:-https://mcpgw.ai-demo.ping-devops.com}"
APP="${APP:-pftoken}"           # Pass Agent Token agent app
RS_APP="${RS_APP:-pftoken-rs}"  # passthrough backend with whoami
SCOPES="${PF_SCOPES:-openid opensearch:read whoami:read}"

: "${PF_ROUTE_C_SECRET:?Set PF_ROUTE_C_SECRET (the pf-route-c-test client secret)}"

AUD="$GATEWAY/$APP/mcp"

echo "=== 1. Mint PingFederate workload token (client_credentials, resource=$AUD) ==="
TOKEN=$(curl -sS -m 20 "$PF_HOST/as/token.oauth2" \
  -u "$CLIENT_ID:$PF_ROUTE_C_SECRET" \
  -d grant_type=client_credentials \
  -d "scope=$SCOPES" \
  -d "resource=$AUD" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('access_token') or 'FAIL: '+str(d))")
[[ "$TOKEN" == FAIL* ]] && { echo "$TOKEN" >&2; exit 1; }
echo "minted (not shown). Decoded claims:"
echo "$TOKEN" | cut -d. -f2 | python3 -c "
import base64,sys,json
s=sys.stdin.read().strip(); s+='='*(-len(s)%4)
d=json.loads(base64.urlsafe_b64decode(s))
for k in ('iss','aud','sub','client_id','scope'): print(f'  {k}: {d.get(k)}')
print('  act.sub:', (d.get('act') or {}).get('sub'))"

echo
echo "=== 2. Call gateway MCP door with the workload token (tools/list) ==="
curl -sS -m 60 -w '\nHTTP %{http_code}\n' "$GATEWAY/$APP/mcp" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | grep -o '"name":"[A-Za-z]*Tool"' | sort -u || true

echo "=== 3. Pass Agent Token: backend reports the token unchanged (whoami) ==="
curl -sS -m 60 -w '\nHTTP %{http_code}\n' "$GATEWAY/$RS_APP/mcp" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"whoami","arguments":{}}}' \
  | tail -c 800

echo
echo "=== 4. Control: garbage bearer (expect 401) ==="
curl -sS -m 30 -o /dev/null -w 'HTTP %{http_code}\n' "$GATEWAY/$APP/mcp" \
  -H "Authorization: Bearer garbage-token-not-real" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}'

echo
echo "Expected: 200 with tools (step 2), whoami claims == PF token claims (step 3), 401 (step 4)."
