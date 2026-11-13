#!/usr/bin/env bash
# OPENAI-format (chat completions API) through the Privilege LLM gateway —
# served by our own llama.cpp REST endpoint, NO virtual key required.
#
# What this proves: an external SaaS provider can consume our self-hosted
# model with a plain OpenAI-format POST. Any OpenAI SDK works by changing
# only the base URL. This is the keyless lane: identity/rate-limits/
# guardrails come from the gateway virtual-key routes instead
# (see test-llm-rest.sh test 1 for the governed OpenAI-format example).
#
#   OpenAI REST endpoint: POST https://ai-demo.ping-devops.com/llm-gw/v1/chat/completions
#   Auth:                 none (public ingress; llama-server tier has no --api-key)
#   Format:               OpenAI chat completions, model "gpt-oss-20b"
#
# Setup: none — this endpoint is already live. Just run:
#   ./privilege/scripts/test-openai.sh
#
# VERIFIED LIVE 2026-11-13: HTTP 200, chat.completion from gpt-oss-20b.
set -euo pipefail

DIRECT="https://ai-demo.ping-devops.com/llm-gw/v1/chat/completions"

echo "=== OpenAI format: POST $DIRECT (model: gpt-oss-20b, no key) ==="
curl -sS -w '\nHTTP %{http_code}\n' "$DIRECT" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-oss-20b","max_tokens":32,"messages":[{"role":"user","content":"Reply with the single word ok"}]}'
