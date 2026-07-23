#!/usr/bin/env bash
# demo_api_server/scripts/promptfoo-step-narration.sh — host-side Phi (default) or full eval
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export OPENAI_API_BASE_URL="${OPENAI_API_BASE_URL:-http://localhost:8090/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-not-needed}"
ARGS=(-c promptfoo/step-narration.config.yaml)
if [[ "${1:-}" != "--full" ]]; then
  ARGS+=(--filter-providers phi-4-mini-instruct)
fi
cd "$ROOT"
exec npx promptfoo eval "${ARGS[@]}"
