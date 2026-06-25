#!/usr/bin/env bash
# =============================================================================
# Banking Digital Assistant — Full Test Runner
# =============================================================================
# Usage:
#   ./run-tests.sh           # Run all tests (API unit + info about E2E)
#   ./run-tests.sh unit      # Run only the core regression suite (fastest)
#   ./run-tests.sh api       # Run all 10 API test suites
#   ./run-tests.sh e2e       # Run Playwright E2E UI tests (requires running servers)
#   ./run-tests.sh all       # Run everything
#
# Prerequisites:
#   npm install  (in demo_api_server/ and demo_api_ui/)
#   npx playwright install chromium  (in demo_api_ui/, one-time setup)
# =============================================================================

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-api}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

banner() {
  echo ""
  echo -e "${BLUE}══════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}══════════════════════════════════════════════════${NC}"
}

ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── API Unit / Integration Tests ────────────────────────────────────────────

run_api_tests() {
  banner "API Server Tests (Jest)"
  cd "$ROOT/demo_api_server"

  if [[ ! -d node_modules ]]; then
    warn "node_modules not found — running npm install first"
    npm install --silent
  fi

  if [[ "$MODE" == "unit" ]]; then
    echo "Running core regression suite (step-up-gate, authorize-gate, runtime-settings-api, transaction-flows)..."
    npm run test:unit
  else
    echo "Running all 10 API test suites..."
    npm run test:all
  fi

  ok "API tests completed"
}

# ── Playwright E2E Tests ─────────────────────────────────────────────────────

run_e2e_tests() {
  banner "Playwright E2E UI Tests"
  cd "$ROOT/demo_api_ui"

  if [[ ! -d node_modules ]]; then
    warn "node_modules not found — running npm install first"
    npm install --silent
  fi

  # Check Playwright browsers are installed
  if ! npx playwright --version > /dev/null 2>&1; then
    warn "Playwright not found — run: npm install && npx playwright install chromium"
    return 1
  fi

  echo ""
  echo -e "${YELLOW}NOTE: E2E tests require the demo_api_server running on port 3001.${NC}"
  echo -e "${YELLOW}      The webServer config will start the React dev server automatically.${NC}"
  echo ""
  echo "  To start the API server manually:"
  echo "    cd demo_api_server && node server.js &"
  echo ""

  # Check if API server is running
  if curl -s http://localhost:3001/api/healthz > /dev/null 2>&1; then
    ok "API server is reachable on :3001"
    npm run test:e2e
    ok "Playwright E2E tests completed"
  else
    warn "API server not running on :3001 — skipping E2E tests"
    echo "  Start it with: cd demo_api_server && node server.js"
    echo "  Then re-run:   ./run-tests.sh e2e"
    return 0
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BLUE}Banking Digital Assistant — Test Suite${NC}"
echo -e "Mode: ${YELLOW}$MODE${NC}"
echo ""

case "$MODE" in
  unit)
    run_api_tests
    ;;
  api)
    run_api_tests
    echo ""
    echo -e "${YELLOW}To run Playwright E2E tests:${NC}"
    echo "  Start API server:  cd demo_api_server && node server.js"
    echo "  Then run:          ./run-tests.sh e2e"
    ;;
  e2e)
    run_e2e_tests
    ;;
  all)
    run_api_tests
    run_e2e_tests
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo "Usage: $0 [unit|api|e2e|all]"
    exit 1
    ;;
esac

echo ""
ok "Done."
