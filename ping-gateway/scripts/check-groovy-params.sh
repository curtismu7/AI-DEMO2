#!/usr/bin/env bash
# check-groovy-params.sh — static parity check for p1az-decision.groovy.
#
# Proves (without running IG) that the Groovy decision filter:
#   1. emits every one of the 18 keys buildAuthorizeParameters() sends, and
#   2. POSTs to the mock policy path (/governance/pap/alpha/policy/<id>/decision)
#      AND builds the real PingOne Authorize Decision Endpoints URL
#      (.../decisionEndpoints/<id>) for the non-simulated backend.
#
# Exit 0 only when all hold.

set -euo pipefail

PG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GROOVY="$PG_DIR/scripts/groovy/p1az-decision.groovy"

# The 18 base keys from buildAuthorizeParameters() in
# demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts
KEYS=(
  DecisionContext McpMethod ToolName ClientId ActClientId ActChainDepth
  MayActSub TokenScopes TokenAudience TokenAudActual TokenExp TokenIat
  TokenNbf TokenIss TransactionAmount TransactionType ToAccountId Vertical
)

missing=0
echo "== Groovy parameter-key parity =="
for k in "${KEYS[@]}"; do
  if grep -qE "^[[:space:]]*${k}[[:space:]]*:" "$GROOVY"; then
    echo "  ok   $k"
  else
    echo "  MISSING $k"
    missing=$((missing + 1))
  fi
done

echo ""
echo "== Decision endpoint path =="
# Mock backend: demo_authz_server policy path.
if grep -q "/governance/pap/alpha/policy/" "$GROOVY"; then
  echo "  ok   mock backend posts to /governance/pap/alpha/policy/<id>/decision"
else
  echo "  MISSING governance/pap/alpha/policy path"
  missing=$((missing + 1))
fi
# Real backend: PingOne Authorize Decision Endpoints API. Ignore comment lines so
# only an actual URL-construction reference counts.
if grep -vE '^[[:space:]]*(//|\*|/\*)' "$GROOVY" | grep -q "/decisionEndpoints/"; then
  echo "  ok   real backend builds /decisionEndpoints/<id> URL"
else
  echo "  MISSING real backend decisionEndpoints URL construction"
  missing=$((missing + 1))
fi

echo ""
echo "== Live backend switch =="
if grep -q "X-Authz-Simulated" "$GROOVY"; then
  echo "  ok   reads X-Authz-Simulated header"
else
  echo "  MISSING X-Authz-Simulated header read"
  missing=$((missing + 1))
fi

echo ""
echo "== RAR PEP → PDP (practical rule) =="
# PingGateway must forward RarMaxAmount (cloud Trust Framework NUMBER attr) from TraT.
if grep -q "RarMaxAmount" "$GROOVY"; then
  echo "  ok   forwards RarMaxAmount from TraT to P1AZ"
else
  echo "  MISSING RarMaxAmount forward"
  missing=$((missing + 1))
fi
if grep -q "X-TraT-Context" "$GROOVY"; then
  echo "  ok   reads X-TraT-Context"
else
  echo "  MISSING X-TraT-Context read"
  missing=$((missing + 1))
fi
# Must NOT locally DENY on rar_intent_violation as the primary path (P1AZ decides).
if grep -qE "rar_intent_violation|rar_intent_required" "$GROOVY"; then
  echo "  WARN local RAR DENY strings present — prefer PDP-only (check this is not primary)"
fi

echo ""
echo "Missing/violations: $missing"
if [ "$missing" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
