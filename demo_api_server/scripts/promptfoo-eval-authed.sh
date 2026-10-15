#!/usr/bin/env bash
# Run the agent promptfoo eval signed in as the demo customer.
# Needs the local stack up with aic_login_enabled OFF (see promptfoo/auth-cookie.js).
# Extra args go to `promptfoo eval`, e.g. --filter-providers heuristics
set -euo pipefail
cd "$(dirname "$0")/.."
export E2E_BASE_URL="${E2E_BASE_URL:-https://local.ping-devops.com:4000}"
export PROMPTFOO_BASE_URL="$E2E_BASE_URL"
# The local stack serves a self-signed cert; skip verification only for this process.
export NODE_TLS_REJECT_UNAUTHORIZED=0
AGENT_COOKIE="$(node promptfoo/auth-cookie.js)"
export AGENT_COOKIE
# -j 1: one request at a time. Concurrent requests share one session and each makes
# ~10 PingOne calls, so parallelism trips PingOne Authorize rate limiting (429) and
# the run then measures the quota, not the agent. Pass -j N after this to override.
exec npx promptfoo eval -c promptfoo/agent-eval.yaml --no-progress-bar -j 1 "$@"
