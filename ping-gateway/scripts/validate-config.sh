#!/usr/bin/env bash
# validate-config.sh - PingGateway route/config sanity checks.
#
# 1. Every route JSON (and admin.json) is valid JSON (jq empty).
# 2. Every ${env['VAR']} placeholder referenced in the route files has a
#    matching VAR= line in .env.example (0 unresolved required).
#
# Exit 0 only when both checks pass. Run from anywhere.

set -euo pipefail

# Resolve the ping-gateway dir (this script lives in ping-gateway/scripts/).
PG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTES_DIR="$PG_DIR/config/routes"
ENV_EXAMPLE="$PG_DIR/.env.example"

fail=0

echo "== JSON validity =="
JSON_FILES=("$ROUTES_DIR"/*.json "$PG_DIR/config/admin.json")
for f in "${JSON_FILES[@]}"; do
  if jq empty "$f" >/dev/null 2>&1; then
    echo "  ok   $(basename "$f")"
  else
    echo "  FAIL $(basename "$f") (invalid JSON)"
    fail=1
  fi
done

echo ""
echo "== Placeholder <-> .env.example cross-check =="
if [ ! -f "$ENV_EXAMPLE" ]; then
  echo "  FAIL .env.example not found at $ENV_EXAMPLE"
  exit 1
fi

# Collect every ${env['VAR']} referenced across the route files.
referenced="$(grep -ohE "\\\$\{env\['[^']+'\]\}" "$ROUTES_DIR"/*.json \
  | sed -E "s/.*\['([^']+)'\].*/\1/" | sort -u)"

# Keys defined in .env.example (left of the first =).
defined="$(grep -oE '^[A-Z0-9_]+=' "$ENV_EXAMPLE" | sed 's/=$//' | sort -u)"

unresolved=0
for var in $referenced; do
  if echo "$defined" | grep -qx "$var"; then
    echo "  ok   $var"
  else
    echo "  MISSING $var (referenced in a route but not in .env.example)"
    unresolved=$((unresolved + 1))
    fail=1
  fi
done

echo ""
echo "Unresolved placeholders: $unresolved"
if [ "$fail" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
