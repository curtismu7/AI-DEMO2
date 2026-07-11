---
name: agent-demo-triage
description: Use when the demo agent misbehaves — replies with the "Heuristics-only mode — no LLM" capability catalog, an "Unknown action" toast, 502/503 from /api/mcp/tool ("Insufficient scope", "Gateway Policy Denied", mcp_authorize_unavailable, "backend rejected the service API key"), "unknown provider in reasonOnce", a use-case chip phrase not understood, or the mode picker not matching actual routing. Also use BEFORE editing agent routing, use-case triggers, feature flags, scopes, or gateway config.
---

# Agent Demo Triage

## Overview

The agent pipeline (UI mode picker → `/nl` or `/api/agent/invoke` → BFF → agent-service/llama → PingGateway → MCP servers) fails **silently**: most breakages surface as the polite "I can help with… (Heuristics-only mode — no LLM)" catalog card, not an error. Never trust the rendered reply — diagnose from container logs and the signature table below. All confirmed on 2026-07-10 against live failures.

## Verify first, guess never

```bash
# Full proof suites (from demo_api_ui, E2E_CUSTOMER_*/E2E_BASE_URL set — see spec headers):
npx playwright test tests/e2e/evidence-screenshots.real.spec.js --config=playwright.real.config.js   # 12 chips × heuristics+llamacpp, screenshots → demo_api_ui/evidence/<date>/
npx playwright test tests/e2e/use-cases-agent.real.spec.js --config=playwright.real.config.js        # every vertical × use-case trigger via /api/agent/invoke

# Offline use-case trigger audit (seconds, no stack needed) — run after ANY useCases.js or vertical intents change:
cd demo_api_server && node -e "
const {parseHeuristic,resolveVerticalCtx}=require('./services/nlIntentParser');
const {USE_CASES,VERTICALS,resolveUseCase}=require('./config/useCases.js');
let f=[];for(const v of VERTICALS){const c=resolveVerticalCtx(v);for(const u of USE_CASES){const t=(resolveUseCase(u.id,v)||u).trigger;if(!t||t.type!=='chip')continue;const r=parseHeuristic(t.text,v,c,{});if(!r||r.kind==='none')f.push(v+' '+u.id+' \"'+t.text+'\"')}}
console.log(f.length?f.join('\n'):'all triggers match');"
```

## Failure signature → root cause → fix

| Log/UI signature | Root cause | Fix |
|---|---|---|
| Catalog card in an LLM mode + agent-service log `unknown provider in reasonOnce` | **Stale agent-service image** (no src mount — rebuilds are NOT automatic) | `docker compose build agent-service && docker compose up -d agent-service` |
| Catalog card + agent-service log `exceeds the available context size (4096 tokens)` | llama-server `--ctx-size` too small for the ~5k-token reasoning prompt | Keep `--ctx-size 16384` in `demo_llm_proxy/start-local-models.sh`; restart via `start-local-models.sh` |
| Every invoke prompt skips heuristics; BFF log `Heuristic disabled via ff_heuristic_enabled` | Flag left off by a test/toggle | `PATCH /api/admin/feature-flags {"updates":{"ff_heuristic_enabled":true}}` |
| `/api/mcp/tool` 503 `mcp_authorize_unavailable` / "failing closed" | Authorize backend unreachable and failover=deny | Real PingOne Authorize is fully provisioned and PREFERRED (verified PERMIT 2026-07-11: `ff_authorize_simulated=false` → ping-gateway `[P1AZ] backend=real` via `P1AZ_REAL_BASE` + decision endpoint `84d45731…`). Only if real breaks: fall back to `ff_authorize_simulated=true` + authz-server up (`docker compose --profile demo-auth up -d authz-server`) — simulated is the last resort, not the default |
| Authz log `DENY — aud mismatch … expected mcpgateway.ping.demo` | Token aud is the PingGateway HTTPS URL; authz expects the bare name | authz-server env `MCP_GW_RESOURCE_URI` must be the dual list `mcpgateway.ping.demo,https://api.ping.demo:3036/mcp` (compose pins it); rebuild if the image predates comma-list support |
| Authz log `user_lookup_failed` | authz-server lacks `PINGONE_WORKER_CLIENT_ID/SECRET` | compose env_file includes `demo_api_server/.env` for authz-server |
| Writes 502 `Insufficient scope for tool 'create_transfer'` (reads fine) | Gateway edge exchange requests read-only scopes | `PG_OLB_SCOPE=read write mcp:invoke` in `ping-gateway/.env` (+ `refresh-service-envs.js`); restart ping-gateway. Also ensure `ff_gateway_brokered_exchange` is consistently set (re-PATCH it) — a drifted mirror causes a BFF/gateway split-brain |
| `apikey-dispatch: backend rejected the service API key` (mortgage/invest) | Vault `DEMO_MORTGAGE_SERVICE_KEY` ≠ mortgage-service `MORTGAGE_SERVICE_API_KEY`; service **refuses default keys** | Mint one key; `printf '%s' "$K" \| node demo_api_server/scripts/vault.js set DEMO_MORTGAGE_SERVICE_KEY` (UPPERCASE name; `VAULT_PASSWORD` is in `demo_api_server/.env`), same for `DEMO_INVEST_SERVICE_KEY`; set `MORTGAGE_SERVICE_API_KEY=$K` in root `.env`; `docker compose up -d mortgage-service` |
| "❌ Unknown action: `<id>`" toast | Heuristic parser returns an action `runAction` has no case for | Add the case in `AIAgent.js` (LLM modes → `sequential_think`; heuristics → needs-an-LLM reply) |
| Use-case chip phrase → catalog card in ONE vertical only | Missing `perVertical` on the use case (banking phrase leaks into other verticals) | Add `perVertical: READ_PER_VERTICAL` or `AMOUNT_PER_VERTICAL(n)` in `config/useCases.js`; re-run the offline audit above |
| Code Explorer: Search says `mcp_server_unavailable`, Ask says "fetch failed" | The `rag` profile services aren't running (weaviate, embeddings, demo-mcp-code-search, llamaindex-agent) | `docker compose --profile rag up -d weaviate embeddings demo-mcp-code-search llamaindex-agent`; restart the BFF so the default index runs; check `GET /api/code-search/default-status` (want `state:"ready"`) |
| Code Explorer Ask: HTTP 200 with sources but EMPTY `answer` | Swap-mode llm-proxy treats `model` as a MINIMUM tier, so a loaded gpt-oss (reasoning model) serves phi-pinned requests — its text lands in `reasoning_content`, `content` stays empty | llamaindex agent's `_completion_text` falls back to reasoning_content; keep `AGENT_MAX_TOKENS` >= 3000. Verify: `tests/e2e/code-explorer-check.real.spec.js` |
| Default codebase index `state:"error"`, embeddings log `input (N tokens) is too large` / `larger than the max context size` | Embed server batch/ctx smaller than a chunk (nomic-embed trained ctx = 2048; `-b/-ub` must equal `-c`), or oversized single-line chunks | compose pins `-c 2048 -b 2048 -ub 2048`; `embeddings.ts` truncates chunks (`MAX_EMBED_CHARS=3500`, ~2 chars/token) and batches 64/request; BFF indexer uses 50-file batches (400-file POSTs wedged) |
| Helix mode: every reply is `ProviderClient httpx errored … provider` (or a Google `extra_forbidden: thinking` error) | The Helix tenant agent's promptDriver names a provider/option its provider-service rejects; check `GET {helix_base_url}/dpc/jas/helix/v1/environments/{env}/providers` for valid provider→model pairs | Fix the agent's driver in the Helix console (or PUT a draft via the admin API) — anthropic-only options like `thinking` must be removed for google. Until published, set config `helix_agent_version=draft` (configStore-registered) to run the staged draft; flip back after Publish |
| Picker shows one mode, requests carry another provider | Mode commit is async (`POST /api/langchain/config`); `AGENT_MODE` env pins server-side `agent_mode` (env beats DB in `getEffective`) | Trust the request body `provider` field as ground truth; wait for the commit POST before sending |

## Deployment invariants (check before any demo)

- Containers **without src mounts** (rebuild after pulling/editing their code): `agent-service`, `authz-server`, `mcp-server`, `ping-gateway`. BFF and UI hot-reload from the checkout.
- BFF runs `node --watch` — editing watched server files mid-demo restarts it (~35s outage, transient 502s).
- Flags that must hold on this deployment: `ff_heuristic_enabled=true`, `ff_authorize_simulated=false` (real PingOne Authorize — simulated is a last resort, see the 503 row), `ff_gateway_brokered_exchange` explicitly re-asserted after any flag surgery.
- llama backends healthy: `curl -s localhost:8090/health` → phi-4-mini `healthy:true`; ctx 16384.
- New use case or vertical intent? The offline trigger audit must print `all triggers match` before it ships.

## Common mistakes

- Judging from the rendered reply: the catalog card is the fallback for at least five distinct root causes — always read `docker logs` for `ai-demo-agent-service`, `ai-demo-api-server`, `ai-demo-ping-gateway`, `ai-demo-authz-server`.
- Blaming llama being "down": the proxy health endpoint being green does not mean the reasoning call succeeds (ctx overflow and stale-image both fail with healthy backends).
- Writing test evidence into `test-results/` — Playwright wipes it at run start; evidence belongs in `demo_api_ui/evidence/`.
- Fixing PingOne scope grants for the writes-502 — the miss is local (`PG_OLB_SCOPE`), not in the tenant.
