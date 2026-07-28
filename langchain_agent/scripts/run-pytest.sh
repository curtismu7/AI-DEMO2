#!/usr/bin/env bash
# langchain_agent/scripts/run-pytest.sh — Python tests with local venv (Python 3.11, matches Dockerfile).
# With no arguments: runs a **stable** subset (fast, expected green).
# With arguments: forwards to pytest (e.g. `bash scripts/run-pytest.sh tests/` for full suite).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PY="${PYTHON:-python3.11}"
if ! command -v "$PY" >/dev/null 2>&1; then PY="python3"; fi
if [ ! -d .venv ]; then
  "$PY" -m venv .venv
fi
.venv/bin/pip install -q -r requirements.txt

STABLE=(
  tests/test_config_settings.py
  tests/test_chat_models.py
  tests/test_auth_models.py
  tests/test_mcp_models.py
  tests/test_error_handling.py
  tests/test_encryption.py
  tests/test_logging.py
  # Code Explorer index hardening (#772) — stdlib-only, no guardrails import.
  tests/test_codegraph_index_guard.py
  tests/test_build_codegraph.py
  tests/test_ensure_index.py
  tests/test_codegraph_metadata.py
)

if [ "$#" -eq 0 ]; then
  exec .venv/bin/python -m pytest "${STABLE[@]}" -q --tb=short
fi
exec .venv/bin/python -m pytest "$@"
