# Exposing model calls as REST endpoints — setup guide

## Goal

Make the demo's models available to external SaaS providers as plain REST
endpoints, in **both** API formats, through the Privilege LLM gateway.

| Format | Endpoint | Auth | Status (2026-11-13) |
| --- | --- | --- | --- |
| **GenAI** (Anthropic Messages) | `POST https://mcpgw.ai-demo.ping-devops.com/llm/anthropic/v1/messages` | virtual key as `x-api-key` + `anthropic-version: 2023-06-01` | ✅ verified 200 |
| **OpenAI** (chat completions, keyless lane) | `POST https://ai-demo.ping-devops.com/llm-gw/v1/chat/completions` | none (public ingress) | ✅ verified 200, model `gpt-oss-20b` |
| OpenAI (governed, gateway virtual key) | `POST https://mcpgw.ai-demo.ping-devops.com/llm/openai/v1/chat/completions` | virtual key as `Authorization: Bearer` | route correct; needs a live OpenAI-bound key |
| GenAI (Google native) | `POST https://mcpgw.ai-demo.ping-devops.com/llm/google/v1beta/models/gemini-2.5-flash:generateContent` | virtual key as `Authorization: Bearer` | key valid; upstream Google key invalid/billing depleted |

The gateway does **not** translate formats: use the route that matches the
key's provider. Each virtual key is bound to exactly one provider — wrong
route returns 403 `wrong_provider`.

## Setup: create a virtual key (console)

1. Sign in to the Privilege console (`https://local.procyon.ai:8643`).
2. **Agent Registry → virtual keys** → create a key:
   - Pick the **provider** (Anthropic / OpenAI / llama.cpp→saved as "custom" / Google).
     The provider's real API key must be in hand — Privilege stores it and injects
     it server-side; the caller's key is never forwarded.
   - Add the **allowed models** list (exact strings; e.g. `claude-haiku-4-5-20251001`,
     `gpt-4o-mini`, `meta.llama3-2-3b-instruct-v1:0`). A model not on the list is 403.
   - Set request/token rate limits, budget, expiry as needed.
3. Save. New keys are picked up **immediately**; edits to a key take ~4 minutes.
4. View the saved key and copy the `sk-orion-...` value — it is shown once.

Known upstream gotcha: the gateway forwards to a custom (llama.cpp) upstream
from inside its own pod, so the CustomUpstream BaseURL must be a URL the
gateway pod can reach (`https://ai-demo.ping-devops.com/llm-gw`), not a loopback.

## Usage

### GenAI format (1 curl, 1 script)

```bash
# curl — Anthropic Messages format
curl https://mcpgw.ai-demo.ping-devops.com/llm/anthropic/v1/messages \
  -H "x-api-key: <virtual-key>" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":8,"messages":[{"role":"user","content":"Reply with the single word ok"}]}'

# script (reads key from VIRTUAL_KEY.txt)
./privilege/scripts/test-genai.sh        # VERIFIED 200
```

SDK path for SaaS tenants: point the Anthropic SDK's base URL at
`https://mcpgw.ai-demo.ping-devops.com/llm/anthropic` and pass the virtual
key as the API key.

### OpenAI format (1 curl, 1 script)

```bash
# curl — OpenAI chat completions format, keyless lane (our llama.cpp endpoint)
curl https://ai-demo.ping-devops.com/llm-gw/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"gpt-oss-20b","max_tokens":32,"messages":[{"role":"user","content":"Reply with the single word ok"}]}'

# script — no setup needed
./privilege/scripts/test-openai.sh       # VERIFIED 200
```

Governed OpenAI-format variant (virtual key, gateway route):

```bash
curl https://mcpgw.ai-demo.ping-devops.com/llm/openai/v1/chat/completions \
  -H "Authorization: Bearer <virtual-key>" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-4o-mini","max_tokens":8,"messages":[{"role":"user","content":"ok"}]}'
```

SDK path for SaaS tenants: point the OpenAI SDK's base URL at
`https://mcpgw.ai-demo.ping-devops.com/llm/openai/v1` (or the keyless
`https://ai-demo.ping-devops.com/llm-gw/v1`).

### Streaming

Both lanes stream: add `"stream":true` (OpenAI format) or `"stream":true`
(Anthropic format returns SSE `message_start`/`content_block_delta` events).
Verified live on the Anthropic route 2026-11-13.

## Key file

`VIRTUAL_KEY.txt` (repo root) holds the virtual keys, one per line, with
comments recording each key's provider, route, and verification status.
`./privilege/scripts/test-llm-rest.sh` runs the full matrix against all lanes.

## Failure reference (live-verified 2026-11-13)

| Symptom | Cause | Fix |
| --- | --- | --- |
| 401 `virtual key expired or revoked` | key inactive in console | reinstate/recreate key |
| 403 `wrong_provider` | key bound to another provider | use the key's own route |
| 403 `model "..." not allowed for this key` | model not on key's list, or typo | add exact model string; wait ~4 min for edits |
| 404 page not found on `/llm/google/v1/...` | Google lane is `/v1beta` native, not `/v1` | use `.../v1beta/models/<model>:generateContent` |
| 404 page not found on `/llm/custom/...` | CustomUpstream unreachable from gateway pod | set BaseURL to `https://ai-demo.ping-devops.com/llm-gw` |
| 400 `API key not valid` from googleapis.com | RealKey under the Google key is dead | re-enter a valid Google AI Studio key in the console |
| 402 `prepayment credits are depleted` | AI Studio billing empty | top up at ai.studio/projects |
