#!/usr/bin/env bash
# Live Privilege MCP gateway smoke test — the "does the real gateway work" check.
#
# MANUAL, not CI. It needs a console token, which is a browser devtools artifact
# with a ~60-minute TTL and no programmatic way to mint it. Do not wire this into
# an automated suite — it would be red within the hour. The jest/vitest suites
# mock the gateway on purpose; this is the out-of-band real-path verification.
#
# Two independent things must be live for a full pass, and BOTH expire:
#   1. the console token (below, ~60 min)
#   2. a console policy granting your user the MCP app (whatever lifetime you set —
#      author it NON-expiring, or tests rot as the policy lapses)
#
# A tokenless 401 that passes while the authenticated call 403s is NOT a gateway
# regression — it is an expired/absent policy. That distinction is this script's
# main value; see docs/PRIVILEGE-MCP.md §2026-08-10.
#
# Usage:
#   bash scripts/privilege-smoke.sh '<console-auth_token-JWT>' [app-name]
#
#   Token: Privilege console > DevTools > Network > any XHR >
#          Request Headers > Cookie: auth_token=<this>
#   app-name defaults to mcp-pingone-admin (the app carrying the demo policy).
#
# Why a console token works when a PingOne token does not: the gateway's
# IssuerPublicKey is [] on current vendor builds, so it falls back to comparing
# the token kid against "infra-root-jwt". The console token IS signed with that
# kid; no PingOne-minted token is. This is a vendor-binary limitation, not config.
set -uo pipefail

TOK="${1:?paste the console auth_token JWT (DevTools > Network > any XHR > Cookie auth_token=)}"
APP="${2:-mcp-pingone-admin}"

FN="$APP.default.applications.procyon.ai"          # registered Frontend Name the gateway routes on
HOST="$APP.mcpgw.local.ping-devops.com"            # per-app client host (nginx rewrites it to FN)
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'

# Token TTL sanity — fail fast with a clear message rather than a confusing 401.
MIN=$(printf '%s' "$TOK" | cut -d. -f2 | python3 -c "
import sys,base64,json,time
try:
    s=sys.stdin.read().strip(); s+='='*(-len(s)%4)
    p=json.loads(base64.urlsafe_b64decode(s))
    print(int((p['exp']-time.time())/60))
except Exception: print('?')" 2>/dev/null || echo '?')
if [ "$MIN" = "?" ]; then
  echo "WARN: could not decode token exp — proceeding anyway"
elif [ "$MIN" -le 0 ] 2>/dev/null; then
  echo "FAIL: token expired ${MIN#-} min ago — copy a fresh auth_token from the console"; exit 2
else
  echo "token: ${MIN} min left | app: ${APP}"
fi

pass=0; fail=0
ck(){ if [ "$1" = "$2" ]; then echo "  PASS $3 ($1)"; pass=$((pass+1)); else echo "  FAIL $3 (got $1, want $2)"; fail=$((fail+1)); fi; }

# 1. Front door reachable, gateway demands a token. Proves nginx + routing + gateway health.
code=$(curl -sk --resolve "$HOST:443:127.0.0.1" -o /dev/null -w '%{http_code}' -m 10 \
  -X POST "https://$HOST/mcp" -H 'Content-Type: application/json' -d "$INIT")
ck "$code" 401 "front-door tokenless -> 401"

# 2. initialize with the console token -> 200 + a session id.
HDR=$(mktemp)
code=$(curl -sk --resolve "$HOST:443:127.0.0.1" -D "$HDR" -o /dev/null -w '%{http_code}' -m 15 \
  -X POST "https://$HOST/mcp" -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$INIT")
ck "$code" 200 "initialize (authenticated)"
if [ "$code" = "403" ]; then
  echo "       ^ 403 = auth+routing OK, POLICY denies. Author/renew a console policy"
  echo "         granting your user the '$APP' app. Not a gateway regression."
fi

# Strip CR — a stray \r folds Mcp-Session-Id into the next header and the backend
# then answers 404 "Unknown or expired MCP-Session-Id", which looks like a gateway bug.
SESS=$(awk 'tolower($1)=="mcp-session-id:"{gsub(/[\r\n]/,"");print $2}' "$HDR")
if [ -n "$SESS" ]; then echo "  PASS session issued ($SESS)"; pass=$((pass+1)); else echo "  FAIL no session id"; fail=$((fail+1)); fi

# 3. tools/list -> 200 with a non-zero tool count.
BODY=$(curl -sk --resolve "$HOST:443:127.0.0.1" -m 30 \
  -X POST "https://$HOST/mcp" -H "Authorization: Bearer $TOK" -H "Mcp-Session-Id: $SESS" \
  -H 'mcp-protocol-version: 2024-11-05' -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
N=$(printf '%s' "$BODY" | python3 -c "
import sys,re,json
m=re.search(r'data: (\{.*\})', sys.stdin.read())
d=json.loads(m.group(1)) if m else {}
print(len(d.get('result',{}).get('tools',[])))" 2>/dev/null || echo 0)
if [ "${N:-0}" -gt 0 ] 2>/dev/null; then echo "  PASS tools/list ($N tools)"; pass=$((pass+1)); else echo "  FAIL tools/list (0 tools)"; fail=$((fail+1)); fi

# 4. tools/call reaches the backend. A 200 envelope is the pass; the backend's own
#    "Insufficient scope" inside that 200 is downstream of Privilege and expected.
code=$(curl -sk --resolve "$HOST:443:127.0.0.1" -o /dev/null -w '%{http_code}' -m 30 \
  -X POST "https://$HOST/mcp" -H "Authorization: Bearer $TOK" -H "Mcp-Session-Id: $SESS" \
  -H 'mcp-protocol-version: 2024-11-05' -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_my_accounts","arguments":{}}}')
ck "$code" 200 "tools/call reaches backend"

rm -f "$HDR"
echo "---- $pass passed, $fail failed ----"
exit "$fail"
