#!/usr/bin/env bash
# Focused Code Explorer index suite (#772) — stdlib + pytest only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PY=""
for candidate in \
  "${PYTHON:-}" \
  "$ROOT/.venv/bin/python" \
  "$ROOT/../langchain_agent/.venv/bin/python" \
  python3.12 \
  python3
do
  if [ -n "$candidate" ] && command -v "$candidate" >/dev/null 2>&1 || [ -x "$candidate" ]; then
    if "$candidate" -c "import pytest" 2>/dev/null; then
      PY="$candidate"
      break
    fi
  fi
done
if [ -z "$PY" ]; then
  echo "pytest not found — create langchain_agent/.venv or: python3 -m pip install pytest" >&2
  exit 1
fi
export PYTHONPATH=src
exec "$PY" -m pytest \
  tests/test_codegraph_index_guard.py \
  tests/test_build_codegraph.py \
  tests/test_ensure_index.py \
  tests/test_codegraph_metadata.py \
  tests/test_retrieve.py \
  -q --tb=short "$@"
