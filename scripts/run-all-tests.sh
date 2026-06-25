#!/usr/bin/env bash
# scripts/run-all-tests.sh — run all package test suites (CI-friendly).
# Usage: from repo root: bash scripts/run-all-tests.sh
#   or: npm test

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NODE_ENV=test
export CI=true

FAILED=0
step() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "▶ $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

step "demo_api_server — Jest (unit + integration under src/__tests__)"
( cd "$ROOT/demo_api_server" && npm test -- --forceExit ) || FAILED=1

step "demo_mcp_server — Jest (unit; integration: npm run test:integration in that package)"
( cd "$ROOT/demo_mcp_server" && npm run test:unit ) || FAILED=1

step "demo_api_ui — CRA Jest (non-interactive)"
( cd "$ROOT/demo_api_ui" && CI=true npm test -- --watchAll=false --passWithNoTests ) || FAILED=1

step "langchain_agent — pytest (see langchain_agent/scripts/run-pytest.sh)"
if command -v python3.12 >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
  ( cd "$ROOT/langchain_agent" && bash scripts/run-pytest.sh ) || FAILED=1
else
  echo "⚠ python3 not found; skipping langchain_agent pytest"
  FAILED=1
fi

step "langchain_agent/frontend — CRA Jest (stable subset; full: npm test in that package)"
( cd "$ROOT/langchain_agent/frontend" && npm run test:ci ) || FAILED=1

# ── New agents (openai/pydantic/mastra) — unit suites ────────────────────────
# Skip Python ones if the venv hasn't been provisioned (./run.sh creates it);
# fail loudly on missing pytest, not on a venv-not-set-up state.
step "openai_agent — pytest (unit)"
if [[ -x "$ROOT/openai_agent/.venv/bin/python" ]]; then
  ( cd "$ROOT/openai_agent" && .venv/bin/python -m pytest tests/ -q ) || FAILED=1
else
  echo "⚠ openai_agent/.venv missing — run ./run.sh once to provision it; skipping"
  FAILED=1
fi

step "pydantic_agent — pytest (unit)"
if [[ -x "$ROOT/pydantic_agent/.venv/bin/python" ]]; then
  ( cd "$ROOT/pydantic_agent" && .venv/bin/python -m pytest tests/ -q ) || FAILED=1
else
  echo "⚠ pydantic_agent/.venv missing — run ./run.sh once to provision it; skipping"
  FAILED=1
fi

step "mastra_agent — Jest (unit)"
( cd "$ROOT/mastra_agent" && npm test ) || FAILED=1

echo ""
if [ "$FAILED" -ne 0 ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Some test steps failed (exit 1)."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "All test steps passed."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
