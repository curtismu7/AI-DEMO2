#!/usr/bin/env bash
# run-real-tests.sh — Run the real API test suite against the live BFF.
#
# Usage:
#   ./scripts/run-real-tests.sh                        # all suites
#   ./scripts/run-real-tests.sh shared                 # shared (health, oauth, token-chain, mcp)
#   ./scripts/run-real-tests.sh banking                # banking vertical only
#   ./scripts/run-real-tests.sh healthcare             # healthcare vertical only
#   ./scripts/run-real-tests.sh retail                 # retail vertical only
#   ./scripts/run-real-tests.sh sporting-goods         # sporting-goods vertical only
#   ./scripts/run-real-tests.sh workforce              # workforce vertical only
#   ./scripts/run-real-tests.sh admin                  # admin vertical only
#   ./scripts/run-real-tests.sh smoke                  # health check only (fast)
#
# Credentials: reads DEMO_USER_USERNAME / DEMO_USER_PASSWORD from demo_api_server/.env
# if PINGONE_TEST_USER / PINGONE_TEST_PASSWORD are not already set.
#
# Requires: BFF running at https://api.ping.demo:3001
#           ./run.sh must be running before invoking this script.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BFF_ENV="$REPO_ROOT/demo_api_server/.env"
SUITE="${1:-}"

# Load credentials from demo_api_server/.env if not already in environment
if [[ -f "$BFF_ENV" ]]; then
  DEMO_USER_USERNAME="${DEMO_USER_USERNAME:-$(grep '^DEMO_USER_USERNAME=' "$BFF_ENV" | cut -d= -f2-)}"
  DEMO_USER_PASSWORD="${DEMO_USER_PASSWORD:-$(grep '^DEMO_USER_PASSWORD=' "$BFF_ENV" | cut -d= -f2-)}"
  DEMO_ADMIN_USERNAME="${DEMO_ADMIN_USERNAME:-$(grep '^DEMO_ADMIN_USERNAME=' "$BFF_ENV" | cut -d= -f2-)}"
  DEMO_ADMIN_PASSWORD="${DEMO_ADMIN_PASSWORD:-$(grep '^DEMO_ADMIN_PASSWORD=' "$BFF_ENV" | cut -d= -f2-)}"
fi

export PINGONE_TEST_USER="${PINGONE_TEST_USER:-$DEMO_USER_USERNAME}"
export PINGONE_TEST_PASSWORD="${PINGONE_TEST_PASSWORD:-$DEMO_USER_PASSWORD}"
export PINGONE_TEST_ADMIN_USER="${PINGONE_TEST_ADMIN_USER:-$DEMO_ADMIN_USERNAME}"
export PINGONE_TEST_ADMIN_PASSWORD="${PINGONE_TEST_ADMIN_PASSWORD:-$DEMO_ADMIN_PASSWORD}"
export RUN_REAL_TESTS=true

if [[ -z "$PINGONE_TEST_USER" || -z "$PINGONE_TEST_PASSWORD" ]]; then
  echo "❌ No test credentials. Set PINGONE_TEST_USER + PINGONE_TEST_PASSWORD or add DEMO_USER_USERNAME/PASSWORD to demo_api_server/.env" >&2
  exit 1
fi

# Quick BFF health check
if ! curl -sk https://api.ping.demo:3001/api/health | grep -q '"status":"healthy"'; then
  echo "❌ BFF is not healthy at https://api.ping.demo:3001 — start with ./run.sh first" >&2
  exit 1
fi

cd "$REPO_ROOT/demo_api_server"

case "$SUITE" in
  "")              PATTERN="tests/real/" ;;
  smoke)           PATTERN="tests/real/shared/health" ;;
  shared)          PATTERN="tests/real/shared" ;;
  banking)         PATTERN="tests/real/banking" ;;
  healthcare)      PATTERN="tests/real/healthcare" ;;
  retail)          PATTERN="tests/real/retail" ;;
  sporting-goods)  PATTERN="tests/real/sporting-goods" ;;
  workforce)       PATTERN="tests/real/workforce" ;;
  admin)           PATTERN="tests/real/admin" ;;
  *)               PATTERN="tests/real/$SUITE" ;;
esac

echo "▶ Running real API tests: ${SUITE:-all} …"
echo "  BFF: https://api.ping.demo:3001"
echo "  User: $PINGONE_TEST_USER"
echo ""

npx jest --config=jest.real.config.js --runInBand --testPathPattern="$PATTERN"
