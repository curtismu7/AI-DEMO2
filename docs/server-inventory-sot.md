# AI-DEMO2 — Server Inventory (Source of Truth)

> Generated from `docker-compose.yml` + live `docker ps` / `docker images`.
> Compose project prefix: `ai-demo2`. Network: `ai-demo` (bridge). All services `restart: unless-stopped` unless noted.
> **Image sizes** = built/pulled image on disk. **Writable layer** = per-container delta from `docker ps --size` (small = stateless).

## Summary

- **20 compose services** total (19 auto-start + 1 gated behind the `demo-attack` profile).
- **Plus 4 host `llama-server` tiers** on ports 8091–8094 — NOT in compose; started via `demo_llm_proxy/start-local-models.sh`. The `llm-proxy` routes to these.
- Two images are third-party pulls (weaviate, llama.cpp); the rest are locally built from this repo.

## Full inventory

| Service | Container | Host→Container port | Image size | Lang / base | What it does |
|---|---|---|---|---|---|
| **demo-api-server** | ai-demo-api-server | 3001→3001 | 1.81 GB | Node (Express, HTTPS/mkcert) | **BFF** — the backend-for-frontend. Fronts every backend, owns sessions, token chain, admin, reports. Build context is repo root (references `scope-topology.json`, `docs/`). |
| **ui** | ai-demo-ui | 4000→4000 | 1.46 GB | Node build → nginx (HTTPS) | React/Vite frontend, served by nginx over HTTPS. The demo web app. |
| **mcp-server** | ai-demo-mcp-server | 8080→8080 | 257 MB | Node (WebSocket) | Primary **MCP server** (OLB / online-banking tools) over WebSocket, plain HTTP, internal only. |
| **mcp-invest** | ai-demo-mcp-invest | 8081→8081 | 201 MB | Node/TS | Second **MCP server** exposing investment tools. |
| **mcp-gateway** | ai-demo-mcp-gateway | 3005→3005 | 218 MB | Node/TS proxy | **Custom** auth-enforcing MCP gateway → routes to mcp-server (WS) + mcp-invest, enforces PingAuthorize introspection (`MCP_GW_P1AZ_ENABLED`). Build context = repo root. |
| **ping-gateway** | ai-demo-ping-gateway | 3036→8080 | 583 MB | Ping Identity IG (`forgeops-public/ig:latest`) | **Alternative** MCP gateway using the real PingGateway product; config = routes + Groovy in `ping-gateway/config`. Selected vs mcp-gateway by `ff_mcp_gateway_pinggateway`. HTTP transport to backends. |
| **mcp-proxy** | ai-demo-mcp-proxy | 8895→8895 | 192 MB | Node | HTTP-to-MCP sidecar — exposes MCP tools as plain REST for non-MCP callers. |
| **agent-service** | ai-demo-agent-service | 3016→3006 | 367 MB | Node/TS (LangGraph) | Agent orchestration / Helix routing service. **Host port 3016** because OrbStack reserves 3006 on macOS (internal port stays 3006). |
| **langchain-agent** | ai-demo-langchain-agent | 8888/8889/8890 | 730 MB | Python (uvicorn) | LangChain agent runtime. 8888 = AG-UI SSE / FastAPI, 8889 = WebSocket chat, 8890 = health. Entry: `./scripts/startup.sh`. |
| **openai-agent** | ai-demo-openai-agent | 8891→8891 | 368 MB | Python (uvicorn) | OpenAI-SDK agent runtime variant. |
| **pydantic-agent** | ai-demo-pydantic-agent | 8893→8893 | 741 MB | Python (uvicorn) | Pydantic-AI agent runtime variant. |
| **mastra-agent** | ai-demo-mastra-agent | 8892→8892 | 401 MB | Node/TS (Mastra) | Mastra agent runtime variant. |
| **hitl-service** | ai-demo-hitl-service | 3009→3009 | 213 MB | Node (plain JS) | Human-in-the-loop consent service (CIBA-style approvals). |
| **mortgage-service** | ai-demo-mortgage-service | 8082→8082 | 200 MB | Node (plain JS) | Mock mortgage backend/business API. |
| **authz-server** | ai-demo-authz-server | 9001→9001 | 209 MB | Node | **Mock PingOne Authorization server** — token introspection + policy decisions. Build context = repo root (consumes `scope-topology.json`). |
| **llm-proxy** | ai-demo-llm-proxy | 8090→8090 | 194 MB | Node smart router | Classifies each LLM request and routes to the smallest capable of 4 host `llama-server` tiers (8091–8094), cascading on overload. BFF + agent-service target this via `LLAMACPP_BASE_URL`. Reaches host via `host.docker.internal`. |
| **weaviate** | ai-demo-weaviate | internal only (8080) | 274 MB | `semitechnologies/weaviate:latest` | Vector DB backing RAG code search. No host port; healthcheck via `wget /v1/meta`. Data in `weaviate-data` volume. |
| **embeddings** | ai-demo-embeddings | 8084→8080 | 1.21 GB | `ghcr.io/ggml-org/llama.cpp:server` | llama.cpp in `--embedding` mode (NOT Ollama). OpenAI-compatible `/v1/embeddings`. GGUF model `nomic-embed-text-v1.5:Q8_0` (~140 MB) cached in `embed-models` volume. `start_period: 180s` warmup. |
| **demo-mcp-code-search** | ai-demo-mcp-code-search | 8095→8095 | 334 MB | Node | RAG code-search MCP service over weaviate + embeddings. `/health` stays green while embedder warms (index/search 503 until ready). |
| **ungoverned-agent** | ai-demo-ungoverned-agent | none (no host port) | 3.24 GB | Node + headless browser | **Demo attack prop — does NOT auto-start.** Gated behind `profiles: ["demo-attack"]`; run on demand: `docker compose run --rm ungoverned-agent`. A headless browser that rides a logged-in bank session and moves money via the UI (no agent identity/scope/consent/audit). Needs a real PingOne customer session cookie/token. |

## Host-side (not in compose)

| Process | Port | What it does |
|---|---|---|
| llama-server tier 1 | 8091 | Local LLM backend (smallest) — target of llm-proxy |
| llama-server tier 2 | 8092 | Local LLM backend |
| llama-server tier 3 | 8093 | Local LLM backend |
| llama-server tier 4 | 8094 | Local LLM backend (largest) |

Start with: `bash demo_llm_proxy/start-local-models.sh` (or `demo_llm_proxy/start-local-models.sh`).

## Port map (quick reference)

| Port | Service |
|---|---|
| 3001 | demo-api-server (BFF) |
| 3005 | mcp-gateway |
| 3009 | hitl-service |
| 3016 | agent-service (→3006 internal) |
| 3036 | ping-gateway (→8080 internal) |
| 4000 | ui |
| 8080 | mcp-server |
| 8081 | mcp-invest |
| 8082 | mortgage-service |
| 8084 | embeddings (→8080 internal) |
| 8090 | llm-proxy |
| 8091–8094 | host llama-server tiers |
| 8095 | demo-mcp-code-search |
| 8888–8890 | langchain-agent (SSE / WS / health) |
| 8891 | openai-agent |
| 8892 | mastra-agent |
| 8893 | pydantic-agent |
| 8895 | mcp-proxy |
| 9001 | authz-server |
| — | weaviate (internal), ungoverned-agent (on-demand) |

## Dependency / boot notes (SoT constraints)

- **`scope-topology.json` is the single source of truth** for scopes; `demo-api-server`, `mcp-gateway`, and `authz-server` all build from repo root to consume it (see `topology:verify` no-drift gate).
- **mcp-gateway vs ping-gateway** are two implementations of the *same* role (auth-enforcing MCP proxy). Toggle: `ff_mcp_gateway_pinggateway`. Transport differs: mcp-gateway=WebSocket, ping-gateway=HTTP.
- **agent-service host port is 3016** (not 3006) to dodge OrbStack's macOS reservation.
- **demo-mcp-code-search** depends on `weaviate` (healthy) + `embeddings` (started, not healthy — it warms for up to 180s).
- **llm-proxy is useless without the host llama-server tiers** (8091–8094) running first.
- **Data persistence**: named volumes `ai-demo-bff-data`, `weaviate-data`, `embed-models`; ping-gateway `/var/gateway` must stay ephemeral (no named volume, else stale `ig.pid`).
- **ungoverned-agent** is intentionally excluded from normal `up` (profile `demo-attack`).

## How to regenerate this

```bash
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Size}}' | grep ai-demo
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep -iE 'ai-demo2|forgeops|weaviate|llama'
grep -nE '^  # ──|^  [a-z][a-z0-9-]*:$|ports:|dockerfile:' docker-compose.yml
```
