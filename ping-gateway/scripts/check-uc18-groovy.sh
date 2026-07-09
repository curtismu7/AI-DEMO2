#!/usr/bin/env bash
# check-uc18-groovy.sh — static checks for uc18-rate-limit.groovy + route wiring.
set -euo pipefail

PG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GROOVY="$PG_DIR/scripts/groovy/uc18-rate-limit.groovy"
ROUTES_DIR="$PG_DIR/config/routes"

missing=0

echo "== UC18 Groovy filter =="
for needle in 'rate_limited' 'tools/call' 'X-UC18-Rate-Limit' 'PG_RATE_LIMIT_ENABLED' 'p1az-decision'; do
  if grep -q "$needle" "$GROOVY" 2>/dev/null; then
    echo "  ok   contains $needle"
  else
    echo "  MISSING $needle in uc18-rate-limit.groovy"
    missing=$((missing + 1))
  fi
done

echo ""
echo "== Route wiring (Uc18RateLimit before P1AZDecision) =="
for route in "$ROUTES_DIR"/*.json; do
  base=$(basename "$route")
  if grep -q 'p1az-decision.groovy' "$route"; then
    if grep -q 'uc18-rate-limit.groovy' "$route"; then
      echo "  ok   $base"
    else
      echo "  MISSING uc18-rate-limit.groovy in $base"
      missing=$((missing + 1))
    fi
  fi
done

echo ""
echo "Missing/violations: $missing"
if [ "$missing" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
