#!/usr/bin/env bash
# scripts/run-remote-tests.sh — run the test suite on a remote test Mac over SSH.
#
# Usage:
#   ./scripts/run-remote-tests.sh           # all tests on testmac
#   ./scripts/run-remote-tests.sh unit      # fast regression only
#   ./scripts/run-remote-tests.sh e2e       # Playwright (stack must be running)
#   ./scripts/run-remote-tests.sh all testmac
#
# Environment:
#   REMOTE_DIR  path on test Mac (default: ~/AI-demo-test)
#
set -euo pipefail

MODE="${1:-all}"
HOST="${2:-testmac}"
REMOTE_DIR="${REMOTE_DIR:-~/AI-demo-test}"

if [[ "$MODE" == "testmac" || "$MODE" == *.local ]]; then
  HOST="$MODE"
  MODE="all"
fi

red() { printf '\033[31m%s\033[0m\n' "$*"; }

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && {
  sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

case "$MODE" in
  unit|api|e2e|all) ;;
  *)
    red "Unknown mode: $MODE (expected unit, api, e2e, or all)"
    exit 1
    ;;
esac

echo "== run-remote-tests ($MODE on $HOST) =="
ssh "$HOST" bash -s -- "$REMOTE_DIR" "$MODE" <<'REMOTE'
set -euo pipefail
cd "$1"
MODE="$2"
./run-tests.sh "$MODE"
REMOTE
