#!/usr/bin/env bash
# Run the snapshot regression suite with a "tests actually ran" guard.
#
# `node --test snapshots/*.test.js` exits 0 when the glob matches nothing, so a
# gitignored or moved test file turns the gate green while running zero tests —
# the same "0 tests == pass" trap scripts/test-service-suite.sh was built to
# close. This wrapper fails loudly instead.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

shopt -s nullglob
files=("$ROOT"/snapshots/*.test.js)
if [ ${#files[@]} -eq 0 ]; then
  echo "ERROR: no snapshot tests matched snapshots/*.test.js — the drift/cloud-delta" >&2
  echo "       protection would silently pass. Check .gitignore re-includes them." >&2
  exit 1
fi

echo "snapshots: running ${#files[@]} test file(s)"
exec node --test "${files[@]}"
