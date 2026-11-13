#!/usr/bin/env bash
# GENAI (Anthropic Messages API) through the Privilege LLM gateway.
#
# What this proves: an external SaaS provider can consume our models over a
# plain REST endpoint in Anthropic's native Messages format, authenticated
# only with a gateway virtual key — the real provider key never leaves the
# gateway.
#
#   GenAI REST endpoint: POST https://mcpgw.ai-demo.ping-devops.com/llm/anthropic/v1/messages
#   Auth:                x-api-key: <virtual key>   (anthropic-version header required)
#
# Setup:
#   1. In the Privilege console create a virtual key bound to provider
#      Anthropic, with allowed models (e.g. claude-haiku-4-5-20251001).
#   2. Paste the key (sk-orion-...) as a single line in VIRTUAL_KEY.txt
#      at the repo root (first non-comment line is used).
#   3. Run:  ./privilege/scripts/test-genai.sh
#
# VERIFIED LIVE 2026-11-13: HTTP 200, completion "ok", streaming SSE works.
set -euo pipefail

GATEWAY="https://mcpgw.ai-demo.ping-devops.com"
MODEL="claude-haiku-4-5-20251001"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$HERE/VIRTUAL_KEY.txt" ]]; then KEYFILE="$HERE/VIRTUAL_KEY.txt";
elif [[ -f "$HERE/../../VIRTUAL_KEY.txt" ]]; then KEYFILE="$HERE/../../VIRTUAL_KEY.txt";
else KEYFILE="$HERE/VIRTUAL_KEY.txt"; fi
KEY=$(grep -v '^#' "$KEYFILE" | grep -v '^\s*$' | head -1 | tr -d '[:space:]')

if [[ -z "$KEY" ]]; then
  echo "No key in $KEYFILE — paste an Anthropic-bound virtual key first." >&2
  exit 1
fi

echo "=== GenAI: POST $GATEWAY/llm/anthropic/v1/messages (model: $MODEL) ==="
curl -sS -w '\nHTTP %{http_code}\n' "$GATEWAY/llm/anthropic/v1/messages" \
  -H "x-api-key: $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"'"$MODEL"'","max_tokens":8,"messages":[{"role":"user","content":"Reply with the single word ok"}]}'
