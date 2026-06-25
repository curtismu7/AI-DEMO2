#!/usr/bin/env bash
# check-groovy-params.sh — static parity check for p1az-decision.groovy.
#
# Proves (without running IG) that the Groovy decision filter:
#   1. emits every one of the 18 keys buildAuthorizeParameters() sends, and
#   2. POSTs to the /governance/pap/alpha/policy/<id>/decision path (not the
#      legacy decisionEndpoints API).
#
# Exit 0 only when both hold.

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
if grep -q "/governance/pap/alpha/policy/" "$GROOVY"; then
  echo "  ok   posts to /governance/pap/alpha/policy/<id>/decision"
else
  echo "  MISSING governance/pap/alpha/policy path"
  missing=$((missing + 1))
fi
# Ignore comment lines: the script documents the legacy decisionEndpoints URL
# format in a comment; only an actual (non-comment) reference is a violation.
if grep -vE '^[[:space:]]*(//|\*|/\*)' "$GROOVY" | grep -q "decisionEndpoints"; then
  echo "  FAIL still references the legacy decisionEndpoints API"
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
echo "Missing/violations: $missing"
if [ "$missing" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
