# Service Topology & Request Flow

Companion to [ARCHITECTURE.md](ARCHITECTURE.md). This document is the concrete map: **every service, its port and language, what it depends on, and how a request actually flows through the system.** The authoritative source for wiring is [docker-compose.yml](../docker-compose.yml); this file explains it.

**Related (Logseq):** [[ARCHITECTURE]] · [[SECURITY_ARCHITECTURE]]

---

## 1. Service inventory

| Service | Container / dir | Lang / runtime | Host port → internal | Depends on | Talks to |
|---|---|---|---|---|---|
| BFF | `demo_api_server` | Node / Express | 3001 → 3001 (HTTPS) | mcp-server | SPA, all agents, MCP gateway, PingOne, HITL |
| Frontend | `demo_api_ui` | React/Vite → nginx | 4000 → 3000 (HTTPS) | BFF | BFF only (cookies) |
| MCP Gateway | `demo_mcp_gateway` | TypeScript | 3005 → 3005 | mcp-server, mcp-resource-server | MCP server, MCP invest, mortgage, HITL, Authorize |
| MCP Server | `demo_mcp_server` | TypeScript | 8080 → 8080 (WS+HTTP) | — | BFF (vertical tools) |
| MCP Invest | `demo_mcp_resource_server` | TypeScript | 8081 → 8081 (WS) | BFF | — |
| HITL Service | `demo_hitl_service` | Node | 3009 → 3009 | — | (called by gateway/BFF) |
| Mortgage Service | `demo_api_resource_server` | Node | 8082 → 8082 | BFF | (called via API key) |
| Mock Authz | `demo_authz_server` | Node | 9001 → 9001 | — | optionally PingOne |
| Agent Service | `demo_agent_service` | TypeScript | 3016 → 3006¹ | BFF, MCP gateway | BFF |
| LangChain Agent | `langchain_agent` | Python / uvicorn | 8888 / 8889 / 8890 | BFF, mcp-server | MCP servers (WS), BFF |
| Mastra Agent | `mastra_agent` | TypeScript | 8892 → 8892 | BFF, mcp-server | BFF (tool adapter) |
| OpenAI Agent | `openai_agent` | Python / uvicorn | 8891 → 8891 | BFF, mcp-server | BFF (tool adapter) |
| Pydantic Agent | `pydantic_agent` | Python / uvicorn | 8893 → 8893 | BFF, mcp-server | BFF (tool adapter) |
| Agent Token Service | `agent_token_service` | Node / Express | 8097 (host only) | — | PingOne token endpoint, gateway |

¹ Internal port 3006; mapped to host **3016** because OrbStack reserves 3006 on macOS.

² `agent_token_service` is a standalone Copilot Studio broker (not in docker-compose — run separately). It mints PingOne `client_credentials` tokens for a dedicated `AI_AGENT` app (scope `agent:invoke`, aud `agentgateway.ping.demo`). Callers authenticate with a static `x-api-key` (`BROKER_API_KEY`). Endpoints: `POST /token`, `GET /healthz`.

External: **PingOne** (OAuth/OIDC token endpoint, introspection, JWKS, and Authorize policy). The mock `demo_authz_server` (:9001) can stand in for PingOne Authorize + introspection offline.

---

## 2. Network topology

```
                          ┌─────────── ai-demo (Docker bridge) ───────────┐
   Browser ──HTTPS:4000──►│  ui (nginx)                                    │
                          │     │ proxies /api/* (HTTPS:3001)              │
                          │     ▼                                          │
                          │  banking-api-server (BFF) ◄──────────────┐    │
                          │     │                                     │    │
                          │     │ ws/http                  internal calls   │
                          │     ▼                                     │    │
                          │  mcp-server :8080   mcp-resource-server :8081      │    │
                          │     ▲                    ▲                │    │
                          │     │   ┌────────────────┘                │    │
                          │  mcp-gateway :3005 ──► mortgage :8082      │    │
                          │     │        └────────► hitl-service :3009 │    │
                          │     │                                      │    │
                          │  agent-service :3006   langchain :8888/9/90│    │
                          │  mastra :8892  openai :8891  pydantic :8893┘    │
                          └────────────────────────────────────────────────┘
                                         │ HTTPS (egress)
                                         ▼
                                      PingOne  (token / introspect / authorize)
```

Only the SPA (`:4000`) and the BFF (`:3001`) are meant to be reached from outside. Everything else is internal to the `ai-demo` network. In Kubernetes a NetworkPolicy enforces the same boundary.

---

## 3. Internal URLs (how services find each other)

From [docker-compose.yml](../docker-compose.yml):

| From → To | URL |
|---|---|
| BFF → MCP server (WS) | `ws://mcp-server:8080` |
| BFF → MCP server (HTTP) | `http://mcp-server:8080` |
| BFF → Banking resource | `https://banking-api-server:3001` |
| Gateway → MCP server | `ws://mcp-server:8080` |
| Gateway → MCP invest | `ws://mcp-resource-server:8081` |
| Agent service → BFF | `https://banking-api-server:3001` |
| LangChain → BFF / MCP | `https://banking-api-server:3001` / `ws://mcp-server:8080` |
| Mastra/OpenAI/Pydantic → BFF / MCP | `https://banking-api-server:3001` / `ws://mcp-server:8080` |

Public-facing URLs (must match PingOne redirect URIs): `https://api.ping.demo:4000` for the app, with `/api/auth/oauth/callback` and `/api/auth/oauth/user/callback` registered.

---

## 4. The BFF as the hub

The BFF (`demo_api_server`, Express on :3001) is the center of gravity. Major responsibilities:

- **Auth** — OAuth login/callback (PKCE), session lifecycle, CIBA backchannel.
- **Token custody** — holds user access/ID tokens in the server-side session (LMDB-backed, in-memory fallback, ~24h TTL). The browser only ever gets cookies (`connect.sid` + signed identity/PKCE cookies).
- **Agent routing** — selects heuristic vs LLM, dispatches to an in-process or external agent runtime, mediates tool calls.
- **MCP proxy** — proxies/initiates MCP traffic and performs the RFC 8693 token exchange (re-audiencing the user token to `aud=mcp-gateway`). The gateway performs its own downstream exchange internally before forwarding to MCP servers.
- **Verticals** — serves manifests (`/api/verticals/me`, set-active), executes vertical-specific tool actions.
- **Admin** — config/feature flags, demo users, audit, vault admin (`/api/admin/vault/*`).
- **Vault** — decrypts `secrets.vault` at startup into the config store.

Two trust boundaries worth naming:

- **Browser ↔ BFF:** cookies only. No token ever crosses into JS.
- **BFF ↔ internal services:** shared internal secrets (e.g. `BFF_INTERNAL_SECRET`, `X-HITL-Internal-Secret`) and/or bearer tokens, on the private network.

---

## 5. Agent runtimes — two execution shapes

The five runtimes fall into two patterns:

**A. MCP-native (agent calls tools itself):** `langchain_agent` connects over WebSocket to the MCP servers and discovers/calls tools directly (token supplied via its OAuth manager).

**B. BFF-mediated (agent delegates tool execution):** `demo_agent_service`, `mastra_agent`, `openai_agent`, `pydantic_agent` reason about the request and return their reasoning/tool-call decisions to the BFF. The BFF executes the tool via `runMcpToolPipeline` → `callToolViaGateway`, keeping full token custody. The agent services themselves never make HTTP calls to a BFF-internal tool endpoint — the BFF drives execution. These agent services accept `POST /run` (and reasoning endpoints) guarded by `BFF_INTERNAL_SECRET`.

Either way, the security pipeline (Authorize → token exchange → HITL → resource scope check) is identical — the runtime is swappable, the guarantees are not.

---

## 6. Request flow — read path ("show my accounts")

```
1. SPA → BFF            POST /api/agent/invoke        (cookie auth)
   [if ff_intent_authorization_enabled=true: BFF runs extractIntentFromPrompt
    BEFORE the agent; may return 403 (denied) or 428 (consent required) here]
2. BFF                  processAgentMessage: heuristic routing runs first;
                        intent = list_accounts matched → short-circuits LLM
                        (in mode 'heuristics' no LLM call ever occurs)
3. BFF                  RFC 8693 exchange → token aud=mcp-gateway (act=agent)
4. BFF → Gateway        tools/call get_my_accounts
5. Gateway middleware   introspect token (RFC 7662, GatewayIntrospectionClient)
                        → GatewayTokenPolicy.validate
                        → PingOneAuthorizeClient.evaluate → PERMIT (read, low risk)
6. Gateway              internal RFC 8693 exchange → token aud=mcp-server
7. Gateway → MCP server tools/call get_my_accounts (delegated token)
8. MCP server           execute → result
9. result → Gateway → BFF → SPA (rendered per vertical render rules)
```

## 7. Request flow — write path with HITL ("transfer $100")

```
1–4.  as above (steps 1–4 of §6), but intent = transfer
5.    Gateway middleware: introspect → GatewayTokenPolicy.validate
        → PingOneAuthorizeClient.evaluate → HITL obligation
6.    Gateway → POST /challenges (HITL service)  → {challengeId, pending}
7.    Gateway → caller: HTTP 403 {error:'hitl_required', hitl:true, challengeId}
        (or JSON-RPC -32002 on the WebSocket path)
8.    Human approves in the HITL UI → POST /challenges/:id/respond (approve)
9.    BFF retries the tool call carrying the challenge id
10.   Gateway verifies the receipt (status=approved, not expired,
        userId+agentId+tool match) → proceeds
11.   Gateway internal RFC 8693 exchange → MCP server → execute (write)
12.   result → Gateway → BFF → SPA
```

Status codes you will see: **403** (deny, failed verification, or HITL required — carries `hitl:true` flag when HITL), **200** (permitted/approved). JSON-RPC path uses **-32002** for HITL required.

## 8. Request flow — Copilot Studio path

```text
1. Microsoft Copilot Studio agent  → agent_token_service POST /token
   (authenticates with BROKER_API_KEY — static x-api-key)
2. agent_token_service             → PingOne client_credentials grant
   (dedicated AI_AGENT app; scope agent:invoke, aud agentgateway.ping.demo)
3. agent_token_service             → caller: { access_token }
4. Copilot agent                   → MCP Gateway (PingGateway :3036 or Node :3005)
   with the minted bearer token
5. Gateway                         → Authorize policy → PERMIT/DENY/HITL
6. Gateway                         → upstream MCP server (RFC 8693 exchange)
```

Token custody for this flow is platform-side: the Copilot agent holds the short-lived access token; `agent_token_service` holds only the `BROKER_API_KEY` and the PingOne client secret server-side and never stores the minted token.

## 9. Tool routing inside the gateway (Node gateway)

| Route target | Backend | Transport | Example tools |
|---|---|---|---|
| `olb` (default) | `demo_mcp_server` | WS | `get_my_accounts`, `create_transfer`, `create_deposit` |
| `invest` | `demo_mcp_resource_server` | WS | `get_portfolio_summary`, `get_investment_balance` |
| `apikey` | `demo_api_resource_server` | HTTP + `X-API-Key` | `show_mortgage`, large-purchase |
| `dualtoken` | resource `/identity` | HTTP + Bearer | `user_profile_card` |
| `bankingdata` | resource `/accounts`/`/transactions` | HTTP + Bearer | `demo_show_accounts` |

The gateway picks the target by tool name, performs any required token exchange (re-audiencing), and forwards. The `apikey` route is intentional: it shows the gateway translating a delegated user token into a service API key at the trust boundary, so the downstream service never sees user identity.

**Gateway selection.** `ff_mcp_gateway_pinggateway` (default `true`) selects between the **PingGateway** (`ping-gateway`, IG, host port 3036, internal 8080) and the **Node gateway** (`demo_mcp_gateway`, port 3005). Both warm their PingOne Authorize connection on startup. PingGateway performs its own RFC 8693 single-resource exchange and supports real→mock Authorize failover (switchable via `X-Authz-Simulated`).

**Authorize engine.** The `authorize_mode` configStore key (env `AUTHORIZE_MODE`) selects the PDP: `pingone` (strict, Docker default), `simulated` (mock authz server only), or `pingone_with_fallback` (real PingOne with simulated fallback). This is the engine selector only; it has no effect on LLM or agent mode.

**AG-UI streaming.** `ff_agui_enabled` (default `true`) enables SSE-based agent-run streaming via `routes/agentRun.js`. The BFF injects decoded token-chain events (never raw JWTs) before the agent stream; traces are held in-memory keyed by `runId` (1h TTL). Proxies to agent runtimes: LangChain :8888, OpenAI :8891, Mastra :8892, Pydantic :8893.

---

## 10. Deployment shapes

- **Local Docker Compose** — `docker-compose up --build`; mkcert certs mounted read-only; internal `ai-demo` bridge network.
- **`./run.sh`** — preferred local launcher (start / stop / status / tail); auto-loads `VAULT_PASSWORD`.
- **Kubernetes** (`k8s/`) — namespace + ResourceQuota + NetworkPolicy, ConfigMap (public + internal URLs, cert paths), `03-secrets.yaml.template`, and per-service deployments (`10-frontend`, `20-api-server`, `30-mcp-server`, `40-agent-service`, `50-redis`).
- **Render** (`render.yaml`) — MCP server as a Docker web service.

---

## 11. Quick port reference

| Port | Service |
|---|---|
| 4000 | Frontend (nginx, HTTPS) |
| 3001 | BFF (HTTPS) |
| 3005 | MCP Gateway |
| 3009 | HITL Service |
| 3016 → 3006 | Agent Service |
| 8080 | MCP Server (primary) |
| 8081 | MCP Invest |
| 8082 | Mortgage Service |
| 8888 / 8889 / 8890 | LangChain Agent (SSE / WS / health) |
| 8891 | OpenAI Agent |
| 8892 | Mastra Agent |
| 8893 | Pydantic Agent |
| 9001 | Mock Authz Server |
| 3036 | PingGateway (Ping Identity IG, host) |
| 8097 | Agent Token Service (standalone, Copilot Studio broker) |
