#!/usr/bin/env bash
# Test the Privilege LLM gateway's REST model endpoints with a virtual key.
# Put the key on a single line in VIRTUAL_KEY.txt, then run this script.
#
# Also shows the keyless path: our own llama.cpp REST endpoint
# (https://ai-demo.ping-devops.com/llm-gw/v1/chat/completions) needs no key.
#
# Usage: ./privilege/scripts/test-llm-rest.sh [keyfile]
set -euo pipefail

GATEWAY="https://mcpgw.ai-demo.ping-devops.com"
DIRECT="https://ai-demo.ping-devops.com/llm-gw/v1/chat/completions"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$HERE/VIRTUAL_KEY.txt" ]]; then KEYFILE="$HERE/VIRTUAL_KEY.txt";
elif [[ -f "$HERE/../../VIRTUAL_KEY.txt" ]]; then KEYFILE="$HERE/../../VIRTUAL_KEY.txt";
else KEYFILE="$HERE/VIRTUAL_KEY.txt"; fi
KEY=$(grep -v '^#' "$KEYFILE" | grep -v '^\s*$' | head -1 | tr -d '[:space:]')

if [[ -z "$KEY" ]]; then
  echo "No key found in $KEYFILE — paste a virtual key (sk-orion-...) there first." >&2
  exit 1
fi

echo "=== 1. Anthropic (GenAI Messages) API format: POST /llm/anthropic/v1/messages ==="
curl -sS -w '\nHTTP %{http_code}\n' "$GATEWAY/llm/anthropic/v1/messages" \
  -H "x-api-key: $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":8,"messages":[{"role":"user","content":"Reply with the single word ok"}]}'

echo
echo "=== 2. Streaming (Anthropic format, stream=true) ==="
curl -sS -N -w '\nHTTP %{http_code}\n' "$GATEWAY/llm/anthropic/v1/messages" \
  -H "x-api-key: $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":32,"stream":true,"messages":[{"role":"user","content":"Count from 1 to 3"}]}' | head -8

echo
echo "=== 3. Google (native GenAI route): POST /llm/google/v1beta/models/gemini-2.5-flash:generateContent ==="
# NOTE: the Google lane is /v1beta (not /v1) and speaks Gemini's native
# generateContent format, NOT OpenAI chat-completions. Verified live 2026-11-13.
curl -sS -w '\nHTTP %{http_code}\n' "$GATEWAY/llm/google/v1beta/models/gemini-2.5-flash:generateContent" \
  -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Reply with the single word ok"}]}],"generationConfig":{"maxOutputTokens":8}}'

echo
echo "=== 4. Negative control: model not on the key's allow-list ==="
curl -sS -w '\nHTTP %{http_code}\n' "$GATEWAY/llm/anthropic/v1/messages" \
  -H "x-api-key: $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-opus-4-6","max_tokens":8,"messages":[{"role":"user","content":"ok"}]}'

echo
echo "=== 5. Keyless alternative: our llama.cpp REST endpoint (no virtual key) ==="
echo "    POST $DIRECT"
curl -sS -w '\nHTTP %{http_code}\n' "$DIRECT" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-oss-20b","max_tokens":16,"messages":[{"role":"user","content":"Reply with the single word ok"}]}'
