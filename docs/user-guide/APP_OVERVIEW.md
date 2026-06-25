# App Overview — All Services

This is a **multi-vertical AI-agent-security demonstration** — it shows how PingOne secures AI agents (real OAuth, RFC 8693 token exchange, HITL consent, step-up MFA), not a real bank. The default vertical is **Super Banking**; the same security pipeline also powers **healthcare, retail, workforce, and sporting-goods** verticals, plus a shared **admin-console** overlay.

Comprehensive breakdown of all **13 services** (Node.js, TypeScript, and Python).

---

## Core Banking Services

### 1. demo_api_server (Node.js - CommonJS)

- **Port:** 3001 (HTTPS: `https://api.ping.demo:3001`)
- **Entry Point:** `server.js`
- **Role:** Express BFF (Backend-for-Frontend) — the **main API gateway**

**Responsibilities:**
- PingOne OAuth flow and session management
- Token custody (all tokens server-side, never exposed to browser)
- Routes all `/api/*` calls from React UI
- RFC 8693 token exchange for MCP tools
- HITL consent challenges and transactional workflows
- Loads encrypted vault secrets at startup
- Proxy target for React SPA via `setupProxy.js`

**Key Files:**
- `server.js` — main Express server
- `routes/oauth.js`, `routes/oauthUser.js` — OAuth flow handlers
- `services/mcpToolPipeline.js` — orchestration of MCP tool calls
- `services/agentMcpTokenService.js` — RFC 8693 token exchange
- `middleware/auth.js` — JWT/session validation

---

### 2. demo_api_ui (React - CRA)

- **Port:** 4000 (HTTPS: `https://api.ping.demo:4000`)
- **Entry Point:** `src/App.js` (React Router + React Query)
- **Role:** Single-page React application

**Responsibilities:**
- Customer dashboard (accounts, transactions, transfers)
- Admin console (feature flags, user management, vertical editor)
- Marketing landing page
- Token Chain UI (OAuth flow visualization)
- Real-time agent chat interface

**Technical Details:**
- Uses `bffAxios` for all API calls (cookie-based, no bearer token to browser)
- Session managed via httpOnly `connect.sid` cookie
- Vertical provider with SSE-backed live switching
- Theme tokens and customization support

**Key Files:**
- `src/App.js` — main router and layout
- `src/components/BankingAgent.js` — agent UI component
- `src/components/UserDashboard.js` — customer dashboard
- `src/vertical/VerticalProvider.js` — vertical switching state
- `src/services/bffAxios.js` — authenticated API client

---

## MCP (Model Context Protocol) Services

### 3. demo_mcp_server (TypeScript)

- **Port:** 8080 (loopback only)
- **Entry Point:** `dist/index.js` (compiled from `src/index.ts`)
- **Role:** MCP tool server — exposes banking operations as JSON-RPC tools

**Responsibilities:**
- Defines all banking tools (accounts, transactions, transfers, deposits, withdrawals)
- Validates scopes against user's token
- Calls BankingAPIClient to fetch/mutate banking data from BFF
- WebSocket handler for agent communication
- Tool definition schema and scope enforcement

**Technical Details:**
- TypeScript with strict type checking
- Requires `npm run build` after any code changes
- Compiled output goes to `dist/index.js`
- Shares token validation patterns with gateway

**Key Files:**
- `src/server/BankingMCPServer.ts` — main server
- `src/tools/BankingToolRegistry.ts` — static map of tools
- `src/tools/BankingToolProvider.ts` — tool execution logic
- `src/banking/BankingAPIClient.ts` — calls to BFF
- `src/auth/TokenIntrospector.ts` — token validation

---

### 4. demo_mcp_gateway (TypeScript)

- **Port:** 3005 (loopback only)
- **Entry Point:** `dist/index.js` (compiled from `src/index.ts`)
- **Role:** Intermediary between agents and MCP servers

**Responsibilities:**
- Routes JSON-RPC tool calls to correct backend
- RFC 8693 token exchange (swaps user token for target-specific access token)
- **API-key swapping:** converts bearer token to API key for mortgage service
- Validates inbound agent tokens via JWT decode + PingOne JWKS
- Enforces authorization policies (scope narrowing, `act` claim validation)
- Connects to canonical HITL service for approval workflows

**Technical Details:**
- TypeScript with strict security focus
- Requires `npm run build` after code changes
- Handles both WebSocket and HTTP requests
- Implements defense-in-depth authentication

**Key Files:**
- `src/index.ts` — main entry point
- `src/server/GatewayServer.ts` — gateway server
- `src/proxy.ts` — request routing logic
- `src/auth/McpTokenExchangeClient.ts` — RFC 8693 exchange
- `src/router.ts` — tool dispatch to backends
- `src/apiKeyDispatch.ts` — API-key swapping logic

---

### 5. demo_mcp_invest (TypeScript)

- **Port:** 8081 (loopback only)
- **Entry Point:** `dist/index.js` (compiled from `src/index.ts`)
- **Role:** Secondary MCP server for investment/portfolio tools

**Responsibilities:**
- Provides investment and portfolio management tools
- Separate tool namespace from main banking MCP server
- Allows agents to query investment accounts and positions

**Technical Details:**
- Same architecture as demo_mcp_server
- Requires `npm run build` after code changes
- Routed through gateway like all other backends

---

## Specialized Services

### 6. demo_hitl_service (Node.js - Plain JS)

- **Port:** 3009 (loopback only)
- **Entry Point:** `src/index.js`
- **Role:** Human-in-the-Loop approval workflow service

**Responsibilities:**
- Canonical HITL service (single source of truth for all platforms)
- Create pending approval challenges for high-value transactions
- Store and manage challenge decisions
- Validate approval receipts for anti-replay protection
- Return decisions to waiting callers (BFF and gateway)

**Workflow:**
1. A transfer above the consent threshold (default **$250**) is gated: the caller receives **HTTP 428** plus a `consentChallengeId` instead of executing.
2. MCP Gateway → POST `/challenges` (create the consent challenge).
3. Dashboard human → POST `/challenges/:id/respond` (approve/deny).
4. The caller retries the original request, this time presenting the approval receipt; the service verifies the receipt (anti-replay) before the transfer completes.

> MFA step-up (default **$500**) is a separate gate from HITL consent.

**Key Files:**
- `src/index.js` — main server
- `src/routes/challenges.js` — challenge endpoints
- `src/services/challengeStore.js` — in-memory challenge storage

---

### 7. demo_mortgage_service (Node.js - Plain JS)

- **Port:** 8082 (loopback only)
- **Entry Point:** `server.js`
- **Role:** Dummy backend for API-key-gated operations

**Responsibilities:**
- Returns single mortgage record payload
- Uses `X-API-Key` header authentication (no OAuth)
- Demonstrates **token swapping pattern** for downstream services

**Architecture Pattern:**
- User → BFF (bearer token)
- Gateway → Mortgage Service (API key)
- The **gateway** swaps the user/agent bearer token for a service-specific API key at its trust boundary — the BFF never performs this swap
- User has no visibility into mortgage APIs; only the gateway can invoke them

**Key Files:**
- `server.js` — main server
- `routes/mortgages.js` — mortgage endpoints

---

### 8. demo_agent_service (TypeScript)

- **Port:** 3016 → 3006 (loopback only)
- **Entry Point:** `dist/index.js` (compiled from `src/index.ts`)
- **Role:** Internal reasoning engine for agents

**Responsibilities:**
- Stateless reasoning steps for agent decision-making
- Shared-secret gated via `BFF_INTERNAL_SECRET` (no user token)
- Receives tool-call context and returns reasoning results
- Vault-encrypted configuration support

**Technical Details:**
- POST `/api/agent/reason` endpoint
- Runs inside BFF's internal network (not exposed to agents directly)
- Requires `npm run build` after code changes

**Key Files:**
- `src/index.ts` — main entry point
- `src/reasonRoute.ts` — reasoning endpoint
- `src/vault.ts` — vault decryption

---

## Agent Runtime Services

**These 4 agent runtimes run concurrently** — they are NOT mutually exclusive and are NOT "picked one at startup." Each listens on its own port and is selected **per request**. They come in two integration shapes: **MCP-native** (the runtime talks directly to the MCP gateway) and **BFF-mediated** (the runtime is driven through the BFF). All share the same PingOne `AGENT_CLIENT_ID` and `PINGONE_AI_AGENT_*` credentials.

### 9. langchain_agent (Python - uvicorn)

- **Ports:**
  - 8888 (uvicorn FastAPI server)
  - 8889 (WebSocket chat interface)
  - 8890 (health + LangSmith tracing inspector)
- **Entry Point:** `python -m src.main`
- **Role:** LangChain-based agent runtime

**Responsibilities:**
- Agentic loop with LangChain, tool use, memory management
- Connects to demo_mcp_gateway for banking operations
- Distributed tracing via LangSmith
- Chat interface via WebSocket
- Session management and conversation history

**Setup:**
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

**Key Files:**
- `src/main.py` — main entry point
- `src/agent/langchain_mcp_agent.py` — agent implementation
- `src/mcp/connection.py` — MCP connection handling
- `src/api/websocket_handler.py` — WebSocket chat

---

### 10. openai_agent (Python)

- **Port:** 8891
- **Entry Point:** `python -m src.main`
- **Role:** OpenAI Agents SDK runtime (alternative to LangChain)

**Responsibilities:**
- Uses OpenAI's native agent API for tool use
- Shares same gateway + tool infrastructure
- Alternative framework for comparison/flexibility

**Setup:**
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

---

### 11. mastra_agent (TypeScript - Node.js)

- **Port:** 8892
- **Entry Point:** `node dist/index.js` (compiled from `src/index.ts`)
- **Role:** Mastra framework agent runtime

**Responsibilities:**
- Lightweight TS-based agent framework
- Faster cold-start than Python alternatives
- Native Node.js integration

**Setup:**
```bash
npm install
npm run build
```

**Key Files:**
- `src/index.ts` — main entry point
- `src/agentFactory.ts` — agent creation
- `src/runHandler.ts` — tool execution

---

### 12. pydantic_agent (Python - Pydantic AI)

- **Port:** 8893
- **Entry Point:** `python -m src.main`
- **Role:** Pydantic AI agent runtime (newest framework)

**Responsibilities:**
- Structured output guarantees via Pydantic
- Type-safe agent implementation
- Alternative agent framework

**Setup:**
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

---

### 13. demo_authz_server (Mock PingOne Authorize)

- **Port:** 9001 (loopback only)
- **Role:** Drop-in mock of the PingOne Authorize decision endpoint

**Responsibilities:**
- Returns policy decisions (permit / deny / step-up / HITL obligation) without a live PingOne Authorize tenant
- Lets the gateway and BFF exercise the full authorization pipeline offline
- Must stay in parity with the real PingOne Authorize request/response shape

---

## Traffic Flow Map

```
┌─ Browser (User)
│
└→ React SPA (ui:4000)
   │
   └→ BFF (api:3001) [Token Custodian]
      │
      ├→ PingOne OAuth endpoints
      │  (token, JWKS, discovery)
      │
      ├→ MCP Gateway (gw:3005)
      │  │  [gateway swaps token → API key at its trust boundary]
      │  ├→ MCP Server (mcp:8080) → BankingAPIClient → BFF /api/
      │  ├→ MCP Invest (inv:8081)
      │  ├→ Mortgage Service (mort:8082) [via gateway API-key swap]
      │  └→ Mock Authz Server (authz:9001) [policy decisions]
      │
      ├→ HITL Service (hitl:3009)
      │  [428 + consentChallengeId → approve → retry + receipt-verify]
      │
      ├→ Agent Service (agent:3016→3006)
      │  [Internal reasoning]
      │
      └→ Agent Runtimes (concurrent; selected per request):
         lc:8888, oai:8891, mastra:8892, pydantic:8893
         └→ MCP gateway (MCP-native) or BFF (BFF-mediated)
```

---

## Service Summary Table

| Service | Tech | Port | Purpose |
|---------|------|------|---------|
| **api_server** | Node.js | 3001 | Main BFF — OAuth, sessions, API routes, token custody |
| **api_ui** | React | 4000 | Dashboard, admin, landing — SPA |
| **mcp_server** | TypeScript | 8080 | Banking tools (accounts, transfers, transactions) |
| **mcp_gateway** | TypeScript | 3005 | Routes tools, token exchange, API-key swapping |
| **mcp_invest** | TypeScript | 8081 | Investment/portfolio tools |
| **hitl_service** | Node.js | 3009 | Human approval for high-value transactions |
| **mortgage_service** | Node.js | 8082 | Dummy API-key-gated backend |
| **agent_service** | TypeScript | 3016→3006 | Internal reasoning (shared-secret gated) |
| **langchain_agent** | Python | 8888 | LangChain agent runtime (concurrent) |
| **openai_agent** | Python | 8891 | OpenAI SDK agent runtime (concurrent) |
| **mastra_agent** | TypeScript | 8892 | Mastra agent runtime (concurrent) |
| **pydantic_agent** | Python | 8893 | Pydantic AI agent runtime (concurrent) |
| **authz_server** | Node.js | 9001 | Mock PingOne Authorize decision endpoint |

---

## Key Rules

1. **TypeScript services** need `npm run build` → `dist/` after edits
2. **Python services** need `.venv` with `pip install -r requirements.txt`
3. **All 4 agent runtimes run concurrently** — selected per request, not picked at startup
4. **No tokens in browser** — all in BFF; React gets httpOnly cookie only
5. **Start all:** `./run.sh` from repo root (auto-installs, auto-builds, auto-venv)

---

## Configuration

- **Default host:** `api.ping.demo` (HTTPS via mkcert)
- **Session store:** Upstash REST KV (Vercel), TCP Redis (local), SQLite fallback
- **Environment variables:** See `docs/ENV_VARS.md`
- **PingOne config:** See `docs/PINGONE_CONFIG.md`

---

## Related Documentation

- [Environment Variables](ENV_VARS.md)
- [PingOne Configuration](PINGONE_CONFIG.md)
- [OAuth Configuration](../../demo_api_server/config/oauth.js)
- [MCP Specification](https://modelcontextprotocol.io)
- [Regression Plan](../../REGRESSION_PLAN.md) — do-not-break areas