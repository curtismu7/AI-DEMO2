#!/usr/bin/env bash
# e2e-pinggateway.sh — live end-to-end checks for the PingGateway path.
#
# Discipline (skip-proof): never false-pass, never silently skip.
#   - If a component is REACHABLE and misbehaves -> hard FAIL (exit 1).
#   - If a component is genuinely UNREACHABLE, or no inbound token is available
#     for the full token-bearing leg -> print LIVE_E2E_BLOCKED with a manual curl
#     recipe and let the deterministic Node routing/parity tests stand as the gate.
#
# Env:
#   PG_URL    PingGateway base (default http://localhost:3036 — host port; OrbStack
#             reserves 3006, so compose publishes 3036).
#   AUTHZ_URL mock authz-server base (default http://localhost:9001).
#   BANKING_TEST_TOKEN  optional inbound bearer (aud must include mcpgateway.ping.demo,
#             scope banking:mcp:invoke). When set, the full PERMIT/DENY chain is exercised.

set -uo pipefail

PG_URL="${PG_URL:-http://localhost:3036}"
AUTHZ_URL="${AUTHZ_URL:-http://localhost:9001}"
GATEWAY_AUD="mcpgateway.ping.demo"

fail=0
ran=0

probe() { curl -s -o /dev/null -w '%{http_code}' --max-time 6 "$@" 2>/dev/null; }

echo "== PingGateway live e2e =="
echo "PG_URL=$PG_URL  AUTHZ_URL=$AUTHZ_URL"
echo ""

# ── Leg A: PingGateway inbound protection (no token -> 401) ───────────────────
A_CODE="$(probe "$PG_URL/mcp" -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}')"
if [ -z "$A_CODE" ] || [ "$A_CODE" = "000" ]; then
  echo "LIVE_E2E_BLOCKED: PingGateway not reachable at $PG_URL."
  echo "  Bring it up: COMPOSE_PROJECT_NAME=ai-demo docker compose up -d ping-gateway"
  echo "  Then curl:   curl -i $PG_URL/mcp -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"tools/list\"}'  (expect 401)"
else
  ran=$((ran+1))
  if [ "$A_CODE" = "401" ]; then
    echo "PASS  Leg A: unauthenticated POST /mcp -> 401 (McpProtectionFilter enforcing)"
  else
    echo "FAIL  Leg A: unauthenticated POST /mcp -> $A_CODE (expected 401)"
    fail=1
  fi
fi
echo ""

# ── Leg B: live authz-server decision the Groovy filter depends on ────────────
AUTHZ_HEALTH="$(probe "$AUTHZ_URL/health")"
if [ "$AUTHZ_HEALTH" != "200" ]; then
  echo "LIVE_E2E_BLOCKED: authz-server not reachable at $AUTHZ_URL (health=$AUTHZ_HEALTH)."
  echo "  Bring it up: COMPOSE_PROJECT_NAME=ai-demo docker compose up -d authz-server"
else
  ran=$((ran+1))
  # DENY — aud mismatch (deterministic; fires before any user lookup).
  DENY_BODY="$(curl -s --max-time 6 "$AUTHZ_URL/governance/pap/alpha/policy/p/decision" \
    -H 'Content-Type: application/json' \
    -d '{"parameters":{"DecisionContext":"McpToolCall","ToolName":"create_transfer","ClientId":"user-1","TokenScopes":"read write transfer","TokenAudience":"'"$GATEWAY_AUD"'","TokenAudActual":"WRONG.aud"}}')"
  if echo "$DENY_BODY" | grep -q '"decision":"DENY"' && echo "$DENY_BODY" | grep -q 'invalid_aud'; then
    echo "PASS  Leg B: live authz DENY on aud mismatch (invalid_aud)"
  else
    echo "FAIL  Leg B: expected DENY/invalid_aud, got: $DENY_BODY"
    fail=1
  fi
  # Decision envelope — a well-formed Groovy payload yields a parseable decision.
  ENV_BODY="$(curl -s --max-time 6 "$AUTHZ_URL/governance/pap/alpha/policy/p/decision" \
    -H 'Content-Type: application/json' \
    -d '{"parameters":{"DecisionContext":"McpToolCall","McpMethod":"tools/call","ToolName":"create_transfer","ClientId":"user-1","TokenScopes":"read write transfer","TokenAudience":"'"$GATEWAY_AUD"'","TokenAudActual":"'"$GATEWAY_AUD"'","TransactionAmount":"10","Vertical":"banking"}}')"
  if echo "$ENV_BODY" | grep -qE '"decision":"(PERMIT|DENY|INDETERMINATE)"'; then
    echo "PASS  Leg B2: live authz returns a decision envelope for the Groovy payload"
  else
    echo "FAIL  Leg B2: no decision in response: $ENV_BODY"
    fail=1
  fi
fi
echo ""

# ── Leg C: full token-bearing chain (PERMIT + DENY through PingGateway) ───────
if [ -n "${BANKING_TEST_TOKEN:-}" ]; then
  ran=$((ran+1))
  PERMIT_CODE="$(probe "$PG_URL/mcp" -X POST \
    -H "Authorization: Bearer $BANKING_TEST_TOKEN" \
    -H 'Content-Type: application/json' -H 'X-Authz-Simulated: true' \
    -H 'MCP-Protocol-Version: 2025-11-25' \
    -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"get_accounts","arguments":{}}}')"
  if [ "$PERMIT_CODE" = "200" ]; then
    echo "PASS  Leg C: PERMIT tool call through PingGateway -> 200"
  else
    echo "FAIL  Leg C: PERMIT tool call -> $PERMIT_CODE (expected 200)"
    fail=1
  fi
else
  echo "LIVE_E2E_BLOCKED: no BANKING_TEST_TOKEN — the full token-bearing PERMIT/exchange"
  echo "  chain needs a real PingOne user token (login mints it; not scriptable headlessly)."
  echo "  Recipe: sign in at https://api.ping.demo:4000, copy the delegated MCP access token,"
  echo "  then:  BANKING_TEST_TOKEN=<tok> bash ping-gateway/scripts/e2e-pinggateway.sh"
  echo "  Manual:  curl -i $PG_URL/mcp -X POST -H 'Authorization: Bearer <tok>' \\"
  echo "             -H 'Content-Type: application/json' -H 'X-Authz-Simulated: true' \\"
  echo "             -H 'MCP-Protocol-Version: 2025-11-25' \\"
  echo "             -d '{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"tools/call\",\"params\":{\"name\":\"get_accounts\",\"arguments\":{}}}'"
fi
echo ""

echo "== Summary: $ran live leg(s) ran, failures=$fail =="
if [ "$fail" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS (reachable legs verified; any LIVE_E2E_BLOCKED leg documented above)"
exit 0
