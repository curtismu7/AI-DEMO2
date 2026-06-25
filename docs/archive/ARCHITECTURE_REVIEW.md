# Digital Assistant Architecture — Gap Review & Implementation Plan

**Date:** 2026-04-26  
**Source diagrams:** Lucidchart "Agent AI - Digital Assistant [WIP]" (Pages 1, 2, 4, 5)  
**Reviewed against:** current `main` branch

---

## 1. Architecture Overview (Target)

The diagrams describe five independently-runnable services plus two external policy services:

| # | Service | Boundary | OAuth identity |
|---|---------|----------|----------------|
| 1 | **OLB Application** (BFF + UI) | User-facing; holds user session | `client_id: olb-app` |
| 2 | **agent1** | AI orchestrator; calls MCP GW; holds LLM + Prompts + PKI Creds | `client_id: agent1` |
| 3 | **MCP Gateway** | Token-scoping router; prevents agent from calling MCP directly | `client_id: mcp-gw` → `aud: api.ping.demo` |
| 4 | **mcp-olb** | MCP server for OLB tools (balance, transfer, accounts) | `aud: api.ping.demo` |
| 5 | **mcp-invest** | MCP server for investments (balance only) | `aud: mcp-invest.ping.demo` |
| — | **PingAuthorize** | External; guards `tools/list` (client-cred check) + `tools/call` (1:1 tool→scope via OpenAPI) | — |
| — | **PingOne / PF / AIC** | External; token exchange, CIBA, orchestration | — |

### Token chain (Page 1 simplified)

```
User token        aud: olb-resource.ping.demo
   ↓ RFC 8693 TX (subject=user, actor=agent1 cred token)
GW token          aud: api.ping.demo   act: { sub: agent1 }
   ↓ RFC 8693 TX (MCP GW re-exchanges to narrow aud)
OLB token         aud: api.ping.demo  act: { sub: agent1 }  sub: user
   ↓ Bearer on JSON-RPC
mcp-olb verifies aud === api.ping.demo
```

Agent **never holds** the final `mcp-olb` / `mcp-invest` scoped token — MCP Gateway acquires it and forwards requests.

---

## 2. Current State vs Target

### 2.1 Services

| Target service | Current state | Gap |
|---|---|---|
| OLB Application (BFF + React UI) | `banking_api_server` + `banking_api_ui` — separate dirs, port 3001/3000 | **Exists.** Needs agent-facing API surface separated from UI-facing routes. |
| agent1 (AI orchestrator) | Token exchange logic is in BFF (`agentMcpTokenService.js`); `langchain_agent/` is a Python prototype | **Missing** as a standalone Node/TS service. Agent logic is embedded in BFF. |
| MCP Gateway | Not present. BFF proxies directly to `banking_mcp_server` via `mcpWebSocketClient.js` | **Missing.** BFF is simultaneously OLB App + MCP GW + token exchange in one process. |
| mcp-olb (OLB MCP server) | `banking_mcp_server` — single server for all banking tools | **Partial.** All tools are here; split by resource not done. |
| mcp-invest (Invest MCP server) | Not present | **Missing.** |
| PingAuthorize — `tools/list` guard | `mcpToolAuthorizationService.js` runs a PingAuthorize `McpFirstTool` decision on first tool call | **Partial.** First-tool decision exists; no explicit `tools/list` client-credential guard. |
| PingAuthorize — per-tool scope via OpenAPI | Commented as "could use OpenAPI" in `pingOneAuthorizeService.js` | **Missing.** |
| LLM (inference) | `langchain_agent/` Python prototype; `bankingAgentLangGraphService.js` in BFF | **Missing** as independently runnable service. |
| Guardrails (HITL decision) | `transactionConsentChallenge.js`, `cibaService.js` embedded in BFF | **Partial.** Implemented but embedded — not a separate service with its own API. |
| HITL UI / Webhook response | Dashboard `/dashboard/approve` in React UI; webhook in BFF routes | **Partial.** Present but not independently deployable. |
| Prompts store | Not found | **Missing.** |
| PKI Creds store | `client_secret` used everywhere; no cert-based agent identity | **Missing.** |

### 2.2 Token flows

| Token | Current state | Gap |
|---|---|---|
| User token (aud: banking RS) | Issued by PingOne, held in BFF session — `oauthService.js` | **Exists.** |
| RFC 8693 TX: user + agent → delegated token | `agentMcpTokenService.js` — subject_token=user, actor_token=agent CC | **Exists.** |
| Delegated token → MCP server | BFF sends to `banking_mcp_server` directly | **Partial.** aud is MCP server URI but no GW re-exchange step. |
| `may_act` → `act` claim conversion | Handled in `agentMcpTokenService.js` | **Exists.** |
| mcp-gw-scoped token (separate GW client) | Not implemented — no `mcp-gw` OAuth client | **Missing.** |
| Per-MCP-server audience token (mcp-olb, mcp-invest) | Single `mcp_resource_uri` env var — one aud for everything | **Missing.** |

### 2.3 RFC 9728 Protected Resource Metadata

| Location | Current state | Gap |
|---|---|---|
| BFF (`/.well-known/oauth-protected-resource`) | Implemented in `routes/protectedResourceMetadata.js` | **Exists.** |
| `mcp-olb` / `mcp-invest` (each must advertise own `authorization_servers` + `scopes_supported`) | Not implemented — MCP server has no HTTP metadata endpoint | **Missing** on MCP servers. |

### 2.4 Summary counts

- **Exists (green):** User OAuth flow, RFC 8693 TX (user+agent), BFF RFC 9728 metadata, `tools/list` scope filter, first-tool PingAuthorize gate, HITL consent challenge (embedded), token chain panel.
- **Partial (yellow):** PingAuthorize integration, MCP server (tools exist, needs split), HITL (needs extraction), agent identity (token exchange done, PKI missing).
- **Missing (red):** MCP Gateway service, mcp-invest server, agent1 as standalone service, per-MCP-server aud token, PingAuthorize OpenAPI per-tool scope, Prompts store, PKI Creds, LLM service, HITL as standalone service.

---

## 3. Server Separation — What Each Service Needs to Run Alone

### Service 1: OLB Application BFF (`banking_api_server`)
**Already independent.** `npm start` in `banking_api_server/`.  
Needs: strip agent/MCP-proxy code into a separate package once agent1 is built; keep OAuth, session, user-facing routes.

### Service 2: agent1 (`banking_agent_service/` — new)
New Node.js/TypeScript service.  
Needs own `package.json`, own `AGENT_OAUTH_CLIENT_ID`, own `AGENT_CLIENT_SECRET` (or PKI cert).  
Responsibilities: receive task request from OLB App → call PingOne to exchange token → call MCP Gateway → stream result back.

### Service 3: MCP Gateway (`banking_mcp_gateway/` — new)
New lightweight Express + WS proxy.  
Needs own `package.json`, own `MCP_GW_CLIENT_ID` (client credentials for `aud: api.ping.demo`).  
Responsibilities: receive JSON-RPC from agent1 → re-exchange token to target MCP server aud → forward to mcp-olb or mcp-invest → return response.

### Service 4: mcp-olb (`banking_mcp_server` — rename/refocus)
Existing `banking_mcp_server/` becomes mcp-olb.  
Tools: `get_my_accounts`, `get_account_balance`, `get_sensitive_account_details`, `get_my_transactions`, `create_deposit`, `create_withdrawal`, `create_transfer`, `sequential_think`.  
Add: `/.well-known/oauth-protected-resource` endpoint serving `aud: api.ping.demo` + `scopes_supported`.  
Validate `aud === api.ping.demo` on every inbound token.

### Service 5: mcp-invest (`banking_mcp_invest/` — new TypeScript)
New MCP server with investment-account tools (at minimum: `get_investment_balance`).  
Own `package.json`. Validates `aud === mcp-invest.ping.demo`.  
Add: `/.well-known/oauth-protected-resource` serving invest metadata.

---

## 4. Implementation Plan

### Phase A — Split and harden existing services (no new services)

**A-1: RFC 9728 on mcp-olb (banking_mcp_server)**
- Add HTTP endpoint `GET /.well-known/oauth-protected-resource` served alongside the WebSocket port.
- Document responds with `resource`, `authorization_servers`, `scopes_supported` for `api.ping.demo`.
- Add `aud` validation on every inbound `tools/call` token — reject if `aud !== MCP_OLB_RESOURCE_URI`.
- Env vars needed: `MCP_OLB_RESOURCE_URI`, `PINGONE_ENVIRONMENT_ID`.

**A-2: Per-tool scope enforcement at mcp-olb**
- `filterToolsByScope` already exists — wire it on `tools/list` (it is currently called but confirm it is enforced).
- On `tools/call`: verify the inbound token contains the tool's required scope before executing. Return `{error: "insufficient_scope"}` if missing.

**A-3: Env-variable isolation for each server**
- Document a `.env.mcp-olb`, `.env.mcp-invest`, `.env.mcp-gateway`, `.env.agent` template.
- Each service reads ONLY its own credentials; no shared secret files.

---

### Phase B — MCP Gateway service

**B-1: Scaffold `banking_mcp_gateway/`**
```
banking_mcp_gateway/
  package.json          (name: "banking-mcp-gateway")
  src/
    index.ts            entry point, Express HTTP + WS listener
    proxy.ts            JSON-RPC proxy logic
    tokenExchange.ts    RFC 8693 re-exchange: agent's GW token → per-server token
    router.ts           route by tool → mcp-olb or mcp-invest
  .env.example
```

**B-2: Token re-exchange in gateway**
- Accept inbound JSON-RPC with Bearer token (aud: api.ping.demo).
- Validate token locally (JWT verify or introspect).
- Call PingOne `/as/token` with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` to narrow aud to target MCP server (`api.ping.demo` or `mcp-invest.ping.demo`).
- Forward JSON-RPC to target MCP server with new Bearer token.
- Return response to agent.

**B-3: Route table**
```
tools: [get_my_accounts, get_account_balance, get_sensitive_account_details,
        get_my_transactions, create_deposit, create_withdrawal, create_transfer]
  → mcp-olb  (WS_OLB_URL env)

tools: [get_investment_balance, ...]
  → mcp-invest  (WS_INVEST_URL env)
```

**B-4: PingAuthorize `tools/list` guard**
- On `tools/list` from agent: call PingAuthorize (or local policy) to verify agent's client_id is allowed to discover tools on this gateway.
- Return filtered list based on client_id's permitted tool namespaces.

---

### Phase C — agent1 standalone service

**C-1: Scaffold `banking_agent_service/`**
```
banking_agent_service/
  package.json          (name: "banking-agent-service")
  src/
    index.ts            Express API: POST /api/agent/task
    agentOrchestrator.ts  LLM call + MCP GW tool dispatch
    tokenResolver.ts    RFC 8693 TX: user token → GW-scoped delegated token
    promptStore.ts      loads system prompts from JSON/DB
    agentIdentity.ts    loads PKI cert or client_secret for actor_token
  .env.example
```

**C-2: Token flow in agent1**
1. Receive task request with user's access token (from OLB App, forwarded in Authorization header).
2. Call PingOne token exchange: `subject_token=user_token`, `actor_token=agent_cc_token`, `audience=api.ping.demo` → get GW-scoped delegated token.
3. POST JSON-RPC to MCP Gateway with GW-scoped token.
4. Stream results to OLB App.

**C-3: Prompts store**
- `src/prompts/` directory with JSON files per use case (transfer, balance-check, etc.).
- `promptStore.ts` loads and interpolates at runtime; no hardcoded system prompts.

**C-4: PKI Creds (future)**
- Replace `AGENT_CLIENT_SECRET` with a PKCS#12 cert loaded from `AGENT_CERT_PATH`.
- Use `private_key_jwt` client authentication on PingOne token requests.
- Gate behind feature flag `USE_PKI_AGENT_CREDS` — fall back to client_secret when false.

---

### Phase D — mcp-invest service

**D-1: Scaffold `banking_mcp_invest/`**
- Clone `banking_mcp_server/` structure.
- Keep only investment-relevant tools (start with `get_investment_balance`).
- Set `MCP_INVEST_RESOURCE_URI=https://mcp-invest.ping.demo`.
- Serve `/.well-known/oauth-protected-resource` with invest scopes.

---

### Phase E — PingAuthorize per-tool scope (OpenAPI integration)

**E-1: Publish OpenAPI spec for each MCP server**
- `banking_mcp_server/openapi.json` — each tool becomes a `POST /tools/{toolName}` path with `security: [{bearerAuth: [required_scope]}]`.
- `banking_mcp_invest/openapi.json` — same pattern.

**E-2: Configure PingAuthorize**
- Create a Decision Endpoint or Policy for `DecisionContext=McpToolCall`.
- Input: `{ clientId, toolName, tokenScopes, tokenAud }`.
- PingAuthorize reads OpenAPI spec for tool's required scope and evaluates.
- Return: `PERMIT | DENY | INDETERMINATE(STEP_UP | HITL)`.

**E-3: MCP Gateway enforces PA decision**
- Before forwarding `tools/call` to target MCP server, call PingAuthorize decision endpoint.
- On `DENY`: return JSON-RPC error `{code: -32001, message: "access_denied"}`.
- On `INDETERMINATE/HITL`: trigger HITL flow (Phase F).

---

### Phase F — HITL as standalone service

**F-1: Extract `banking_hitl_service/`**
- Move `transactionConsentChallenge.js`, CIBA polling, and consent webhook from BFF into dedicated service.
- Expose: `POST /hitl/challenge`, `GET /hitl/:id/status`, `POST /hitl/:id/respond`.

**F-2: HITL flow (Page 4/5 diagrams)**
1. MCP Gateway receives `HITL` obligation from PingAuthorize.
2. MCP Gateway calls `banking_hitl_service POST /hitl/challenge` with tool details + user context.
3. HITL service sends push notification (CIBA or email) to user.
4. User approves via Dashboard (`/dashboard/approve`) or webhook.
5. HITL service `POST /hitl/:id/respond {decision: approved}`.
6. MCP Gateway resumes `tools/call` with HITL receipt.

---

## 5. Phased Rollout Order

| Phase | Deliverable | Effort | Depends on |
|---|---|---|---|
| A | RFC 9728 on mcp-olb + aud validation + per-tool scope enforce | Small | — |
| B | MCP Gateway service | Medium | A |
| C | agent1 standalone service | Medium | B |
| D | mcp-invest service | Small | A |
| E | PingAuthorize OpenAPI per-tool scope | Medium | B, D |
| F | HITL standalone service | Medium | B |
| G | PKI Creds for agent1 | Small | C |

---

## 6. Start Scripts (each service independently runnable)

```bash
# OLB BFF
cd banking_api_server && npm start        # port 3001

# mcp-olb (rename of banking_mcp_server)
cd banking_mcp_server && npm start        # port 3003 (WS) + 3004 (HTTP metadata)

# MCP Gateway (new)
cd banking_mcp_gateway && npm start       # port 3005

# agent1 (new)
cd banking_agent_service && npm start     # port 3006

# mcp-invest (new)
cd banking_mcp_invest && npm start        # port 3007 (WS) + 3008 (HTTP metadata)

# HITL service (new, extracted from BFF)
cd banking_hitl_service && npm start      # port 3009

# OLB UI
cd banking_api_ui && npm start            # port 3000
```

Root `package.json` can add a `npm run start:all` script using `concurrently`.

---

## 7. Env Var Matrix

| Variable | OLB BFF | agent1 | MCP GW | mcp-olb | mcp-invest | HITL |
|---|---|---|---|---|---|---|
| `PINGONE_ENVIRONMENT_ID` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `OAUTH_CLIENT_ID` (OLB app) | ✓ | — | — | — | — | — |
| `AGENT_OAUTH_CLIENT_ID` | — | ✓ | — | — | — | — |
| `MCP_GW_CLIENT_ID` | — | — | ✓ | — | — | — |
| `MCP_OLB_RESOURCE_URI` | — | — | ✓ | ✓ | — | — |
| `MCP_INVEST_RESOURCE_URI` | — | — | ✓ | — | ✓ | — |
| `WS_OLB_URL` | — | — | ✓ | — | — | — |
| `WS_INVEST_URL` | — | — | ✓ | — | — | — |
| `PINGONE_AUTHORIZE_ENDPOINT` | ✓ | — | ✓ | — | — | — |
| `HITL_SERVICE_URL` | — | — | ✓ | — | — | — |
| `CIBA_ENDPOINT` | — | — | — | — | — | ✓ |

---

*Generated from diagram review — Page 1 "Agent - GW/Authorize", Page 2 "Less Exchanges", Page 4 "A2A-DA", Page 5 "A2A-Worker[HITL]"*
