#!/usr/bin/env bash
# tests/integration/test-agents-e2e.sh
#
# End-to-end smoke test for the 4 agent frameworks (langchain, openai_agents,
# mastra, pydantic_ai). For each running agent service:
#   1. POSTs a minimal /run payload to its loopback port
#   2. Asserts SSE response includes RUN_STARTED + at least one TEXT_MESSAGE_CONTENT
#      or RUN_FINISHED — i.e. the agent reached the LLM, not just spun up
#   3. Asserts no RUN_ERROR or AGENT_UNREACHABLE
#
# Hard requirements (test FAILS, does not skip, per scope decision 2026-05-28):
#   - LM Studio listening on http://localhost:1234 with at least one model loaded
#   - All 4 agent services started (./run.sh first)
#
# Exit codes:
#   0 = all 4 agents passed
#   1 = at least one failure (prints which) or missing prerequisite
#
# Usage: bash tests/integration/test-agents-e2e.sh
#    or: npm run verify:agents

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GW_SECRET="${BFF_INTERNAL_SECRET:-dev-shared-secret-change-me}"
LMS_BASE="${LMSTUDIO_BASE_URL:-http://localhost:1234}"
LMS_BASE="${LMS_BASE%/v1}"
CURL_TIMEOUT=45

# Per-agent: name, AG-UI /run SSE port. langchain_agent runs three listeners
# (uvicorn :8888 for /run SSE, websockets :8889 for chat WS, health :8890);
# the AG-UI proxy in routes/agentRun.js targets :8888 (verified by the
# agentRun.framework-routing.test.js suite).
AGENT_NAMES=(langchain openai_agents mastra pydantic_ai)
AGENT_PORTS=(8888       8891         8892    8893)

FAILED=0
PASSED=0

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }
pass() { printf "  \033[1;32m[PASS]\033[0m %s\n" "$1"; PASSED=$((PASSED+1)); }
fail() { printf "  \033[1;31m[FAIL]\033[0m %s\n" "$1"; FAILED=$((FAILED+1)); }
info() { printf "         %s\n" "$1"; }

# ── Preflight: LM Studio ─────────────────────────────────────────────────────
step "Preflight — LM Studio"
LMS_MODELS=$(curl -sf --max-time 3 "${LMS_BASE}/api/v1/models" 2>/dev/null || true)
if [[ -z "${LMS_MODELS}" ]]; then
  fail "LM Studio not reachable at ${LMS_BASE}/api/v1/models"
  info "Start LM Studio's local server (Developer tab) and load a small model"
  info "before running this test. The agent services need a real LLM endpoint."
  exit 1
fi
LMS_LOADED=$(echo "${LMS_MODELS}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
loaded = [m['key'] for m in d.get('models',[]) if m.get('loaded_instances')]
print(loaded[0] if loaded else '')
" 2>/dev/null || true)
if [[ -z "${LMS_LOADED}" ]]; then
  fail "LM Studio is running but no models are loaded"
  info "Load a model in LM Studio (e.g. google/gemma-4-e2b) before running this test."
  exit 1
fi
pass "LM Studio reachable; loaded model: ${LMS_LOADED}"

# ── Preflight: each agent's port is listening ────────────────────────────────
step "Preflight — agent ports listening"
for i in "${!AGENT_NAMES[@]}"; do
  name="${AGENT_NAMES[$i]}"
  port="${AGENT_PORTS[$i]}"
  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    pass "${name} listening on :${port}"
  else
    fail "${name} NOT listening on :${port} — start it via ./run.sh"
  fi
done
if [[ "${FAILED}" -ne 0 ]]; then
  echo
  info "Cannot run e2e tests without all agent services up. Exiting."
  exit 1
fi

# ── For each agent: POST /run and validate SSE stream ────────────────────────
# Uses the model LM Studio actually has loaded, via the BFF context.model
# override, so the test works regardless of each agent's default LLM_MODEL.
RUN_PAYLOAD=$(cat <<JSON
{
  "threadId": "e2e-thread",
  "runId": "e2e-run",
  "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
  "tools": [],
  "context": {
    "model": "${LMS_LOADED}",
    "bffToolUrl": "http://127.0.0.1:3001/internal/agent-tool",
    "sessionId": "e2e-session"
  }
}
JSON
)

assert_sse_response() {
  local name="$1"
  local port="$2"
  local response="$3"

  if [[ -z "${response}" ]]; then
    fail "${name}: no response body"
    return 1
  fi

  if ! grep -q 'RUN_STARTED' <<<"${response}"; then
    fail "${name}: missing RUN_STARTED event"
    info "First 200 chars of response: ${response:0:200}"
    return 1
  fi

  if grep -q 'RUN_ERROR' <<<"${response}"; then
    local err_msg
    err_msg=$(grep 'RUN_ERROR' <<<"${response}" | head -1 | sed 's/.*"message"[^"]*"\([^"]*\)".*/\1/' | head -c 200)
    fail "${name}: emitted RUN_ERROR: ${err_msg}"
    return 1
  fi

  if grep -q 'AGENT_UNREACHABLE' <<<"${response}"; then
    fail "${name}: AGENT_UNREACHABLE event in stream"
    return 1
  fi

  # RUN_FINISHED OR TEXT_MESSAGE_CONTENT proves the agent actually reached
  # the LLM and started streaming. Some agents only emit TEXT_MESSAGE_CONTENT
  # for non-empty replies; either is a pass.
  if ! grep -qE '(RUN_FINISHED|TEXT_MESSAGE_CONTENT)' <<<"${response}"; then
    fail "${name}: stream contained RUN_STARTED but no RUN_FINISHED or TEXT_MESSAGE_CONTENT — agent likely hung"
    return 1
  fi

  pass "${name}: RUN_STARTED + completion event, no RUN_ERROR"
  return 0
}

step "End-to-end /run smoke tests"
for i in "${!AGENT_NAMES[@]}"; do
  name="${AGENT_NAMES[$i]}"
  port="${AGENT_PORTS[$i]}"
  info "${name} (:${port}) → POST /run"
  response=$(curl -sN --max-time "${CURL_TIMEOUT}" \
    -X POST "http://127.0.0.1:${port}/run" \
    -H 'Content-Type: application/json' \
    -H "x-internal-gateway-secret: ${GW_SECRET}" \
    -d "${RUN_PAYLOAD}" 2>&1 || true)
  assert_sse_response "${name}" "${port}" "${response}" || true
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "${FAILED}" -eq 0 ]]; then
  printf "\033[1;32mAll %d agent e2e tests passed.\033[0m\n" "${PASSED}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  printf "\033[1;31m%d failed, %d passed.\033[0m\n" "${FAILED}" "${PASSED}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
