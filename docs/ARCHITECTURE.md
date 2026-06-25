# Architecture — AI Agent Security Demo

> **What this is.** A multi-vertical demo that shows how to secure **AI agents** acting on a user's behalf, using PingOne (OAuth 2.0 / OIDC), RFC 8693 token exchange, the Model Context Protocol (MCP), a policy-driven authorization gateway, and human-in-the-loop (HITL) consent.
>
> **What this is not.** It is *not* a banking product. "Super Banking" is just the default **vertical** (theme). The same engine also drives healthcare, retail, workforce, and sporting-goods skins. The interesting part is the **identity + agent security pipeline**, not the domain data.

This document is the **full system overview**. Two companion documents go deeper:

- [SERVICE_TOPOLOGY.md](SERVICE_TOPOLOGY.md) — every service, its port/language, how they wire together, and the end-to-end request flow.
- [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) — OAuth login, the RFC 8693 delegation chain, the Authorize pipeline, HITL consent, and scopes.

**Related (Logseq):** [[SERVICE_TOPOLOGY]] · [[SECURITY_ARCHITECTURE]]

---

## 1. The big picture

```
                         Browser (SPA)
                              │ cookies only (no tokens)
                              ▼
                  ┌───────────────────────┐
                  │  BFF  (demo_api_server)│  Express, :3001 HTTPS
                  │  token custody · login │
                  │  agent routing · admin │
                  │  verticals · vault     │
                  └───────────────────────┘
            ┌──────────────┼───────────────────────────┐
            ▼              ▼                             ▼
   AI agent runtimes   MCP Gateway (:3005)        PingOne (OAuth/OIDC/
   (5 frameworks)      authz + token exchange      Authorize) — external
            │              │   ┌───────────────┐
            │              ├──►│ MCP server     │ :8080  (primary tools)
            │              ├──►│ MCP invest     │ :8081  (investment tools)
            │              ├──►│ Mortgage svc   │ :8082  (API-key resource)
            │              └──►│ HITL service   │ :3009  (consent challenges)
            ▼
   (agents reach tools through the gateway, never holding the user's token)
```

Two ideas hold the whole thing together:

1. **The browser never sees a token.** The BFF (Backend-for-Frontend) keeps all OAuth tokens server-side; the SPA only carries a session cookie. This is the standard BFF pattern and removes the entire class of XSS token-theft attacks.
2. **An agent acts *as* the user, but is *not* the user.** When an AI agent calls a tool, the system mints a delegated token via RFC 8693 token exchange that carries an `act` claim naming the agent. Every downstream service can see "this is *user X*, being acted for by *agent Y*," and policy decisions are made on that basis.

---

## 2. Component map

| Component | Dir | Lang | Port(s) | Role |
|---|---|---|---|---|
| **BFF** | `demo_api_server` | Node/Express | 3001 (HTTPS) | Token custody, OAuth login, agent routing, admin, verticals, vault, MCP proxy |
| **Frontend** | `demo_api_ui` | React + Vite → nginx | 4000 (HTTPS) | SPA; talks only to the BFF over cookies |
| **MCP Gateway** | `demo_mcp_gateway` | TypeScript | 3005 | Validates inbound tokens, runs Authorize policy, performs token exchange, routes tool calls, triggers HITL |
| **MCP Server (primary)** | `demo_mcp_server` | TypeScript | 8080 (WS + HTTP) | Primary tool server; introspects tokens; banking + vertical tools |
| **MCP Invest** | `demo_mcp_invest` | TypeScript | 8081 (WS) | Investment/portfolio tool server |
| **HITL Service** | `demo_hitl_service` | Node | 3009 | Human approval challenges (create / poll / respond) |
| **Mortgage Service** | `demo_mortgage_service` | Node | 8082 | API-key-gated resource (demonstrates token→API-key swap) |
| **Mock Authz Server** | `demo_authz_server` | Node | 9001 | Drop-in replacement for PingOne Authorize + introspection (dev/test) |
| **Agent Service** | `demo_agent_service` | TypeScript | 3006 (→3016 in Docker) | Reasoning-only agent (Helix / Anthropic) |
| **LangChain Agent** | `langchain_agent` | Python / FastAPI | 8888 (SSE), 8889 (WS), 8890 (health) | Full MCP-driven agent orchestrator |
| **Mastra Agent** | `mastra_agent` | TypeScript | 8892 | Agent runtime (Mastra framework) |
| **OpenAI Agent** | `openai_agent` | Python / FastAPI | 8891 | Agent runtime (OpenAI Agents SDK) |
| **Pydantic Agent** | `pydantic_agent` | Python / FastAPI | 8893 | Agent runtime (Pydantic AI) |
| **In-BFF agent** | `demo_api_server/services` | Node | via `runReasonLoop()` → TypeScript reasoning service at :3006 (`demo_agent_service`) | Heuristic-first fallback agent; BFF calls `agentReasoningClient.js` (`req.agentPath = 'reason_loop_3006'`), does not run LangGraph.js in-process |
| **PingGateway** | `ping-gateway` | Ping Identity IG | 3036 (host) → 8080 (internal) | Alternative MCP gateway (selected by `ff_mcp_gateway_pinggateway`, default `true`); performs RFC 8693 single-resource exchange, real→mock Authorize failover |
| **Agent Token Service** | `agent_token_service` | Node / Express | 8097 (standalone, not in compose) | Copilot Studio broker; mints PingOne `client_credentials` AI_AGENT tokens on request; caller auth = static `x-api-key` |

External dependency: **PingOne** (authorization server, OIDC provider, and — optionally — the live Authorize policy engine). The mock `demo_authz_server` stands in for PingOne Authorize when running offline. The `authorize_mode` configStore key (`AUTHORIZE_MODE` env) selects the active engine: `pingone` (strict, Docker default), `simulated`, or `pingone_with_fallback`.

---

## 3. The four planes

The system is easiest to reason about as four planes.

### 3.1 Presentation plane — the SPA + verticals

A React SPA served by nginx. It calls only the BFF, always with `credentials: 'include'` — never a bearer token. It is **multi-vertical**: a `VerticalProvider` fetches the active vertical's manifest from the BFF and applies theme tokens (CSS variables), terminology, agent persona, dashboard hero cards, and quick-action "chips" at runtime. Switching verticals re-themes the whole app without a redeploy.

A **vertical** is a config bundle under `demo_api_server/config/verticals/<id>/`:

- `manifest.json` (schemaVersion 3) — identity, theme `cssVars`, terminology, agent persona, dashboard chips + `llmChipGroups`, hero cards, render rules, scopes, delegation labels, optional feature page, demo users.
- `mock-data.json` — the sample data the vertical renders.

Live verticals: **banking** (default), **healthcare**, **retail**, **workforce**, **sporting-goods**, plus an **admin-console** overlay and a **shared** config bundle. Adding a vertical is config-only (see the `add-vertical` / `new-vertical` skills).

Three dedicated demo surfaces complement the vertical dashboards:

- **Security Showcase** — a tabbed chip panel embedded in the agent UI, exposing six live attack scenarios (enabled across all five verticals).
- **Live Policy Console** (`/pingone-authorize`) — overhauled PingOne Authorize page with a live policy tree, recent decisions panel, and Evaluate presets; open to any authenticated user; warms the Authorize connection on boot and page load.
- **AI Control Plane** (`/ai-control-plane`) — cross-platform agent governance; stopping an agent revokes its Ping identity so access dies on every platform simultaneously; includes a Compliance Report view with CSV/JSON export.

### 3.2 Agent plane — pluggable reasoning runtimes

The demo deliberately ships **five interchangeable agent runtimes** so you can compare frameworks against the *same* security backend:

- **demo_agent_service** (TS, :3006) — reasoning-only; the BFF keeps token custody and drives it via `runReasonLoop()` in `agentReasoningClient.js`.
- **langchain_agent** (Python, LangGraph) — full orchestrator; discovers and calls MCP tools itself over WebSocket.
- **mastra_agent** (TS), **openai_agent** (Python), **pydantic_agent** (Python) — each wraps a different SDK and executes tools through a BFF-internal tool adapter.
- **In-BFF agent** (`demoAgentLangGraphService.js`) — the always-available fallback; calls `runReasonLoop()` to drive `demo_agent_service` at :3006 (does not run LangGraph.js in-process).

Routing is **hybrid and operator-selectable**:

1. A deterministic **heuristic floor** (`nlIntentParser`) matches common intents with zero LLM cost and zero latency.
2. If the heuristic returns no match, an **LLM path** takes over (Helix / Ping AI, Anthropic Claude, OpenAI, or a local LM Studio endpoint) — **except** in mode `heuristics` (mode 1), where no LLM is ever called; a no-match returns a static capability catalog instead. The `forceHeuristic` flag overrides mode and forces heuristic-only resolution regardless of the active mode.

`agentModeResolver` is the single source of truth that maps user-facing modes (e.g. *Heuristics only*, *Heuristics + Helix* (default), *Just Claude*, *LM Studio*) to a provider + heuristic toggle.

**Copilot Studio platform-driven variant.** Microsoft Copilot Studio agents reach the demo via a sixth execution shape: the Copilot platform drives the agent loop externally. A lightweight `agent_token_service` broker (Node, :8097, not in docker-compose) holds the PingOne `AI_AGENT` client secret server-side and mints a `client_credentials` token (scope `agent:invoke`, aud `agentgateway.ping.demo`) on request, authenticated by a static `BROKER_API_KEY`. Token custody is platform-side — the Copilot agent holds the short-lived token; the broker never stores it.

**AG-UI event streaming.** `ff_agui_enabled` (default `true`) enables SSE streaming of agent-run events from `routes/agentRun.js`. The BFF injects decoded token-chain events inline (never raw JWTs) so the frontend can render the delegation chain in real time. An in-memory trace store keyed by `runId` retains events for 1 hour.

**Agent-to-Agent (A2A) delegation.** Beyond a single agent, the generalist assistant can delegate a narrow, sensitive read to a **per-vertical specialist agent** (a second agent — Investment Advisor, Records Specialist, etc.; registry `config/a2aSpecialists.js`). This is a generic overlay (`config/verticals/a2a/`) merged into any vertical when `ff_a2a_delegation` is on. The delegation runs a **chained RFC 8693 exchange** producing a nested `act` chain (`act:{specialist, act:{generalist}}`, subject still the user) — **no `may_act`**; PingOne Authorize decides over the chain and DENYs the sensitive tool unless a specialist is delegated (act depth ≥ 2). See `docs/TOKEN_FLOW.md` and ARCHITECTURE-TRUTHS T-12.

### 3.3 Tool plane — MCP gateway and tool servers

Agents do not call resource servers directly. They go through the **MCP Gateway**, which is the security choke point (see §3.4). The gateway routes each tool to its backend:

- **`olb`** (default) → `demo_mcp_server` (accounts, balances, transfers, deposits, withdrawals, vertical tools).
- **`invest`** → `demo_mcp_invest` (portfolio, holdings, investment transactions).
- **`apikey`** → `demo_mortgage_service` (token is swapped for a service API key — shows credential-translation at the edge).
- **`dualtoken` / `bankingdata`** → BFF/resource HTTP endpoints.

MCP servers speak JSON-RPC 2.0 over WebSocket (and a streamable HTTP transport): `initialize` → `tools/list` → `tools/call`. Each MCP server independently validates the bearer token (RFC 7662 introspection or local JWT/JWKS) and enforces scopes — defense in depth, not trust-the-gateway.

### 3.4 Identity & policy plane — the security pipeline

This is the point of the demo. For any agent-initiated tool call:

1. **Authenticate the user** — Authorization Code + PKCE against PingOne; tokens land in the server-side session, browser gets a cookie.
2. **Delegate to the agent** — RFC 8693 token exchange mints a token whose subject is the user and whose `act` claim is the agent, audienced for the MCP gateway.
3. **Authorize the action** — the gateway calls PingOne Authorize (or the mock) and gets back **PERMIT / DENY / STEP-UP / HITL**.
4. **Narrow the token** — the MCP gateway forwards the original bearer token to the backend MCP server unchanged (no second BFF-side RFC 8693 exchange). The BFF performs exactly **one** RFC 8693 exchange per tool call (step 2 above).
5. **Gate with a human if required** — on a HITL obligation the gateway returns JSON-RPC error `-32002` (WebSocket path) or HTTP 403 `{error:'hitl_required', hitl:true, challengeId}` (HTTP path), creates a challenge in the HITL service, and only proceeds once a human approves (with anti-replay binding on user + agent + tool). Note: HTTP 428 is emitted only by the BFF's own pre-gateway `evaluateMcpFirstToolGate` in `mcpToolPipeline.js`, not by the gateway itself.
6. **Enforce again at the resource** — the MCP server re-validates the token and checks scopes.

Full detail, claim shapes, and decision rules live in [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md).

---

## 4. End-to-end: "transfer $100 from checking to savings"

```
SPA ──/api/agent/...──► BFF ──► Agent runtime (reason: intent = transfer)
                          │
                          ├─ RFC 8693 exchange (ONE per tool call): user+agent ► token aud=mcp-gateway (act=agent)
                          │
                          ▼
                     MCP Gateway ──► Authorize policy?  ──► HITL (transfers need consent)
                          │                                   │
                          │          403 {hitl_required} / WS error -32002 + challengeId
                          │◄── human approves in HITL service ┘
                          │
                          │  (gateway forwards original bearer token — no second exchange)
                          ▼
                     MCP server (tools/call make_transfer)
                          │ introspect token (RFC 7662) + scope check (write)
                          ▼
                     execute ► result ► gateway ► BFF ► SPA
```

A read like "show my accounts" follows the same path but the heuristic floor often resolves the intent with no LLM call, Authorize returns PERMIT immediately, and no HITL challenge is raised.

---

## 5. Standards used

| Standard | Spec | Used for |
|---|---|---|
| OAuth 2.0 | RFC 6749 | Base authorization framework |
| Bearer tokens | RFC 6750 | `Authorization: Bearer` to APIs and tools |
| PKCE | RFC 7636 | Auth-code flow for the SPA/BFF |
| JWT / JWKS | RFC 7519 / 7517 | Token format + signature verification |
| OIDC Core | OIDC 1.0 | User identity, ID token, userinfo |
| OIDC CIBA | CIBA 1.0 | Backchannel / decoupled consent |
| Token Exchange | RFC 8693 | Delegation chain with `act` / `may_act` |
| Introspection | RFC 7662 | MCP servers + gateway validate tokens |
| Revocation | RFC 7009 | Kill tokens on logout |
| MCP | MCP 2024-11-05 | Agent ↔ tool calling over JSON-RPC |
| BFF pattern | IETF draft / OWASP | Tokens server-side; cookie to browser |

---

## 6. Deployment

- **Local (default):** `./run.sh` (preferred over `run-bank.sh`) or `docker-compose up --build`. HTTPS via mkcert certs in `./certs/`; everything on the internal `ai-demo` Docker network. Requires `127.0.0.1 api.ping.demo` in `/etc/hosts` and a bootstrapped `demo_api_server/.env`.
- **Secrets:** an encrypted **vault** (`secrets.vault`, AES-256-GCM, Argon2id KDF) is decrypted at startup with `VAULT_PASSWORD` and loaded into the in-memory config store. The vault holds secrets only — not bootstrap config.
- **Kubernetes:** manifests in `k8s/` — namespace + ResourceQuota + NetworkPolicy, ConfigMap (URLs, cert paths), secrets template, and per-service deployments.
- **Cloud PaaS:** `render.yaml` describes a Render deployment of the MCP server.

---

## 7. Where to look

| You want to understand… | Start here |
|---|---|
| Who talks to whom, on what port | [SERVICE_TOPOLOGY.md](SERVICE_TOPOLOGY.md) |
| The token chain and policy decisions | [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) |
| Service wiring (authoritative) | [docker-compose.yml](../docker-compose.yml) |
| OAuth login + sessions | `demo_api_server/routes/oauth.js`, `middleware/auth.js` |
| RFC 8693 exchange | `demo_api_server/services/rfc8693TokenExchangeService.js`, `demo_mcp_gateway/src/auth/McpTokenExchangeClient.ts` |
| Authorize pipeline | `demo_api_server/services/pingOneAuthorizeService.js`, `simulatedAuthorizeService.js`, `demo_mcp_gateway/src/pingAuthorizeGuard.ts` |
| Agent routing | `demo_api_server/services/agentModeResolver.js`, `nlIntentParser.js` |
| Verticals | `demo_api_server/config/verticals/`, `services/verticalManifest/` |
| MCP tools | `demo_mcp_server/src/tools/`, `demo_mcp_invest/src/tools/` |

> Note: the repository root contains many historical planning/phase docs. This file, `SERVICE_TOPOLOGY.md`, `SECURITY_ARCHITECTURE.md`, and `docker-compose.yml` are the current-state sources of truth for architecture.
