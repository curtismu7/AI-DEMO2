# Chat Request Flow — Servers Involved

When a user submits a prompt in the chat UI, the request passes through the following servers in order.

---

## Server List

| # | Server | Port | Technology | Role |
|---|--------|------|------------|------|
| 1 | **Frontend** | 4000 | nginx / React | Serves the UI |
| 2 | **Chat Interface** | 4000 | React (client-side) | User-facing chat component; submits prompts, renders SSE-streamed responses and token events |
| 3 | **BFF** (banking-api-server) | 3001 | Node.js / Express | Session auth, NL intent extraction, Intent Token minting; acts as tool-execution proxy for the agent |
| 4 | **Agent** | 3006 | TypeScript / LangGraph | Reasoning loop; decides when to call tools, assembles final answer, streams SSE back to browser |
| 5 | **LLM** | external | Anthropic API / LM Studio / Ollama | Large language model inference; called by the Agent on each reasoning step |
| 6 | **PingOne** | external | Ping Identity (SaaS) | OAuth token issuance (login, client credentials, RFC 8693 token exchange) |
| 7 | **Ping Agent Gateway** | 3005 | TypeScript | Authorization enforcement proxy; validates tokens, enforces policy, routes tool calls to upstream MCP servers |
| 8 | **PingOne Authorization Server** | 9001 | Node.js (mock) | Two inline calls per tool request: (1) RFC 7662 token introspection — is the token active? (2) PingOne Authorize policy decision — PERMIT / DENY / HITL required. In production, replaced by real PingOne Authorize. |
| 9 | **MCP Server** | 8080 | TypeScript / WebSocket | Primary banking MCP server; executes banking tools (accounts, transactions, transfers) |
| 10 | **MCP Invest** | 8081 | TypeScript / WebSocket | Investment vertical MCP server; executes investment tools |
| 11 | **Mortgage Service** | 8082 | Node.js / Express | API-key-authenticated resource server; serves mortgage, retail, healthcare, gear, and expense data. Called by Ping Agent Gateway via credential swap (OAuth bearer dropped, X-API-Key substituted) |
| 12 | **HITL Service** | 3009 | Node.js | Consent challenge store; created by Ping Agent Gateway on INDETERMINATE, holds pending approval with 10-min TTL, verified on retry to confirm user/agent/tool binding before tool is released |
| 13 | **Redis** | 6379 | Redis | Pub/sub for HITL consent signalling across BFF instances. Falls back to in-process EventEmitter on single-instance deployments |

---

## PingOne Application Reference

Every PingOne client used in the demo, cross-referenced to the flows above.

| PingOne App Name | Client ID (prefix) | Type | Auth Method | Env Var | Used In Flow | Role |
| --- | --- | --- | --- | --- | --- | --- |
| Demo AI App - User Login | `83572007` | WEB_APP | CLIENT_SECRET_POST | `PINGONE_USER_CLIENT_ID` | Flow 1 | End-user OIDC login. authorization_code + PKCE + refresh_token. Token stored server-side in BFF session. |
| Demo AI App - Admin Login | `8a711944` | WEB_APP | CLIENT_SECRET_POST | `PINGONE_ADMIN_CLIENT_ID` | Flow 1 (admin) | Admin OIDC login. authorization_code + PKCE + refresh_token. |
| Demo AI App - AI Agent Actor | `71e878ea` | WEB_APP | CLIENT_SECRET_POST | `PINGONE_AI_AGENT_ACTOR_CLIENT_ID` | Flow 2, 3, 7 | Two-Exchange Step 1 actor. Acquires CC token `aud=agentgateway.ping.demo`; used as `actor_token` in RFC 8693 Exchange #1. |
| Demo AI App - Token Exchanger | `f4dd707d` | WEB_APP | CLIENT_SECRET_POST | `PINGONE_TOKEN_EXCHANGER_CLIENT_ID` | Flow 3, 7 | Two-Exchange Step 2 actor + single-exchange actor. Acquires CC token `aud=mcpgateway.ping.demo`; used as `actor_token` in Exchange #2. |
| Demo AI App - MCP Gateway | `6586d3de` | WEB_APP | CLIENT_SECRET_POST | `PINGONE_MCP_GATEWAY_CLIENT_ID` | Flow 3, 7 | MCP gateway process identity. Holds grants to MCP Server resource; performs second token exchange to `mcpserver.ping.demo`. |
| Demo AI App - MCP Server Client | `c76a9868` | WEB_APP | CLIENT_SECRET_POST | *(not in .env)* | Internal | MCP server process client identity. Client credentials only, no grants. |
| Demo AI App - Introspection Worker | `89ad8921` | WORKER | CLIENT_SECRET_BASIC | `PINGONE_WORKER_CLIENT_ID` | Flow 3, 7 | RFC 7662 token introspection. Only client authorised to call `/as/introspect` against tokens issued by other clients. |
| ~~Demo AI App - Agent Actor~~ | ~~`f93d8ae5`~~ | WORKER | — | `AGENT_CLIENT_ID` (removed) | — | **Deleted 2026-06-14.** Was unused — `PINGONE_AI_AGENT_ACTOR_CLIENT_ID` always resolved first. |

### configStore Resolution Chains

The BFF resolves PingOne client credentials through priority-ordered aliases in `configStore.js`:

| configStore key | Resolution order (first match wins) |
| --- | --- |
| `pingone_ai_agent_client_id` | `PINGONE_AI_AGENT_ACTOR_CLIENT_ID` → `PINGONE_AI_AGENT_CLIENT_ID` → `AI_AGENT_CLIENT_ID` → `AGENT_CLIENT_ID` |
| `pingone_mcp_token_exchanger_client_id` | `PINGONE_TOKEN_EXCHANGER_CLIENT_ID` → `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` → `PINGONE_MCP_EXCHANGER_CLIENT_ID` → `AGENT_OAUTH_CLIENT_ID` |
| `worker_client_id` | `PINGONE_WORKER_CLIENT_ID` → `PINGONE_INTROSPECTION_CLIENT_ID` |

With `.env` values `PINGONE_AI_AGENT_ACTOR_CLIENT_ID=71e878ea` and `PINGONE_TOKEN_EXCHANGER_CLIENT_ID=f4dd707d` set, the lower-priority aliases (`AGENT_CLIENT_ID`, `AGENT_OAUTH_CLIENT_ID`) are never reached.

---

## Flow 1 — Login / Session Establishment

Before a user can chat, they must authenticate via OAuth 2.0 Auth Code + PKCE.

```
Browser
  │
  ▼
Chat Interface :4000
  • user clicks "Sign In"
  │
  ▼
BFF :3001  GET /api/auth/oauth/user/login
  • generates PKCE code_verifier (64 random bytes) + code_challenge (SHA-256)
  • generates state (CSRF) + nonce (OIDC replay protection)
  • stores code_verifier, state, nonce in server-side session (LMDB / memory)
  │
  ▼  (302 redirect)
PingOne (external)  /authorize
  • user authenticates (username + password, MFA if enrolled)
  • returns auth code to BFF callback
  │
  ▼  (redirect back)
BFF :3001  GET /api/auth/oauth/callback
  • validates state (CSRF check)
  • exchanges auth code + code_verifier → POST PingOne /token
  • receives access_token, id_token, refresh_token
  • verifies id_token nonce
  • calls PingOne /me to fetch user claims
  • regenerates session ID (prevents session fixation)
  • stores tokens server-side in session (never sent to browser)
  • calls PingOne /as/introspect to validate token (fire-and-forget, for audit)
  │
  ▼  (redirect to /dashboard)
Chat Interface :4000
  • session cookie set (httpOnly, Secure)
  • user is now authenticated
```

**What's stored in session:** `accessToken`, `idToken`, `refreshToken`, `expiresAt`, `user` (id, email, role). Tokens never reach the browser — only the session cookie does.

---

## Flow 2 — Agent Actor Token Acquisition (BFF startup / cold-start)

The BFF acquires an actor token once at startup via client credentials (`agentMcpTokenService.js`). This token is reused across all requests until expiry (not fetched per-request). The `:3006` Agent service does NOT acquire its own CC actor token.

```
BFF :3001  (on startup, via agentMcpTokenService.js)
  │
  ▼
PingOne (external)  POST /token
  • grant_type=client_credentials
  • client_id=<AGENT_OAUTH_CLIENT_ID>
  • Authentication: client_secret_basic (default) or private_key_jwt (if USE_PKI_AGENT_CREDS=true)
  • returns actor access_token  → cached in memory
  │
  • concurrent cold-start requests await the same promise — only one CC grant fires
```

This actor token becomes the `actor_token` in the RFC 8693 exchange when the BFF executes a tool call.

---

## Flow 3 — Chat Request (main path)

```
Browser
  │
  ▼
Chat Interface :4000
  • user submits prompt
  • renders streamed response + token events
  │
  ▼
BFF :3001  POST /api/agent/invoke  (agentInvokeRoute.js)
  • session auth (validates session cookie + token expiry)
  │
  ├── [if ff_intent_authorization_enabled=true]
  │     extractIntentFromPrompt (pre-execution intent gate)
  │     → returns HTTP 403 or 428 without invoking the agent if intent is blocked
  │
  ▼
  processAgentMessage
  • heuristic routing FIRST — if a heuristic matches, returns immediately (no call to :3006)
  │
  ├── (no heuristic match)
  │     NL intent extraction (see Flow 4)
  │     mints Intent Token (HMAC-SHA256, permitted_tools claim)
  │
  ▼
Agent :3006  POST /invoke
  • reasoning loop (runReasonLoop)
  ├──▶ LLM (external)
  │      Anthropic API / LM Studio / Ollama
  │      ← decides tool calls, assembles answer
  │
  └── (each tool call) — executeTool callback (JavaScript closure, BFF-side)
                               │
                               executeBffTool → runMcpToolPipeline
                               │
                               ├── [if ff_authorize_mcp_first_tool=true on first call]
                               │     evaluateMcpFirstToolGate (heuristic HITL check)
                               │     → returns 428 { error: 'hitl_required' } immediately
                               │       (pre-execution, before token exchange)
                               │
                               • RFC 8693 token exchange (BFF-side, agentMcpTokenService.js)
                               ▼
                           PingOne (external)  POST /token
                               • subject_token = user access token
                               • actor_token   = BFF actor token (AGENT_OAUTH_CLIENT_ID)
                               • audience      = mcp-gw
                               • returns delegated token (aud=mcp-gw, act.sub=agent)
                               │
                               ▼
                           callToolViaGateway → Ping Agent Gateway :3005
                               ├──▶ PingOne Authorization Server :9001  /as/introspect
                               │     RFC 7662 token introspection
                               │     is token active? (cached 30s dev / 5s prod)
                               │
                               ├──▶ PingOne Authorization Server :9001  /governance/.../decision
                               │     PingOne Authorize policy: PERMIT / DENY / INDETERMINATE
                               │     parameters include: tool name, user, agent, scopes,
                               │     transaction amount, intent token validity, HitlApproved
                               │
                               │   (if PERMIT)
                               ├──▶ MCP Server :8080        banking tools  (WebSocket)
                               ├──▶ MCP Invest :8081        investment tools  (WebSocket)
                               └──▶ Mortgage Service :8082  credential swap
                                     OAuth bearer dropped → X-API-Key + X-User-Sub
                                     serves: mortgage / retail / healthcare / gear / expense
  │
  ▼
Chat Interface :4000  (SSE stream back from Agent via BFF)
```

**Tool execution note:** `executeTool` is a JavaScript closure passed into `runReasonLoop` — it is not an HTTP endpoint. The `:3006` service does NOT POST back to the BFF; all tool execution happens BFF-side via `executeBffTool → runMcpToolPipeline → callToolViaGateway`.

**Token note:** The Ping Agent Gateway forwards the BFF-issued token unchanged to MCP Server and MCP Invest — no second RFC 8693 exchange occurs. The `aud=mcp-gw` token is valid at both the gateway and the downstream MCP servers by design.

---

## Flow 4 — NL Intent Extraction (inside BFF, before agent dispatch)

```
BFF :3001  /api/agent/invoke
  │
  ▼
NL Intent Parser (in-process)
  • heuristic matching: 0.95 confidence on exact match, 0.75 partial, 0.65 keyword
  • covers: balance, transfer, accounts, investment, mortgage, education topics
  │
  ├── (match found, confidence ≥ threshold)
  │     → intent + permitted_tools determined locally
  │     → Intent Token minted (no external call)
  │
  └── (no match)
        ▼
      LLM intent fallback (external)
        • calls Helix / Claude / LM Studio with HELIX_AGENT_DIRECTIVES
        • returns structured intent + tool permissions
        • Intent Token minted from LLM response
```

The LLM fallback is only called when the heuristic returns no match — the majority of common banking prompts are resolved locally at zero cost.

---

## Flow 5 — HITL (Human-in-the-Loop consent required)

HITL can be triggered by two paths. In both cases `runMcpToolPipeline` returns a `kind='block'` error to the BFF, which surfaces the consent prompt to the user. There is no LangGraph `interrupt` SSE event, no `/api/agent/consent/:runId` endpoint, and no Redis pub/sub involved in HITL signalling.

### Path A — Heuristic pre-execution gate (BFF-side, before token exchange)

```text
BFF :3001  executeBffTool
  │
  ▼
evaluateMcpFirstToolGate  (heuristic check, pre-execution)
  • evaluates tool name / context against configured policy
  • if consent required → returns HTTP 428 { error: 'hitl_required' } immediately
  • no token exchange, no gateway call, no HITL Service call at this point
  │
  ▼
Chat Interface :4000
  • receives 428, renders consent modal
  │
  ▼  (user approves)
BFF :3001  POST /api/agent/invoke  (retry with consent signal)
  • gate now passes; flow continues to token exchange + gateway (Flow 3)
```

### Path B — Gateway policy decision returns INDETERMINATE (LLM path)

```text
Ping Agent Gateway :3005
  • PingOne Authorization Server returns INDETERMINATE (consent required)
  ├──▶ HITL Service :3009  POST /challenges
  │     • stores pending challenge (tool, userId, agentId, context, 10-min TTL)
  │     • returns challengeId
  │     • fires notification (CIBA push / email / log)
  │
  • Gateway returns HTTP 403  { error: 'hitl_required', hitl: true, challengeId }
  │   (HTTP transport) — or JSON-RPC error code -32002 (WebSocket transport)
  │
  ▼
BFF :3001  runMcpToolPipeline
  • surfaces as kind='block' error
  │
  ▼
Chat Interface :4000
  • renders consent modal: "This action requires your approval" + Approve / Deny buttons
  │
  ▼  (user approves — consent recorded out-of-band, e.g. CIBA push)
BFF :3001  POST /api/agent/invoke  (retry)
  • tool call retried with _hitl_challenge_id argument
  │
  ▼
BFF :3001  runMcpToolPipeline  (retry)
  • strips _hitl_challenge_id from tool args
  ├──▶ HITL Service :3009  GET /challenges/:challengeId
  │     • verifies: status=approved, not expired, userId/agentId/tool all match
  │     • anti-replay: rejects cross-user or wrong-tool receipts
  │
  ▼
Ping Agent Gateway :3005
  • sends HitlApproved=true to PingOne Authorization Server
  ├──▶ PingOne Authorization Server :9001  → returns PERMIT
  │
  ▼
MCP Server :8080 / MCP Invest :8081 / Mortgage Service :8082
  • tool call executes normally
  • result flows back to Agent → Chat Interface
```

---

## Flow 6 — MFA / Step-Up Authentication

Triggered when a transaction exceeds the step-up threshold (default: $250 transfer/withdrawal) and the user's current session token does not carry `acr: Multi_factor`.

```
Chat Interface :4000
  • user submits a high-value transaction via agent
  │
  ▼
BFF :3001  POST /api/transactions (or via agent tool)
  • step-up gate evaluates: amount ≥ threshold AND acr ≠ 'Multi_factor'
  • returns HTTP 428  { error: 'step_up_required', step_up_acr: 'Multi_factor' }
  │
  ▼
Chat Interface :4000
  • receives 428, displays MFA challenge UI

  ── Device Auth path ──────────────────────────────────────
  │
  ▼
BFF :3001  POST /api/auth/mfa/challenge
  ├──▶ PingOne (external)  POST /auth/v1/device-authentications
  │     • user access token identifies the user (oauthId / PingOne UUID)
  │     • returns daId + list of enrolled devices
  │
  ▼
Chat Interface :4000
  • user selects device (FIDO2 / OTP / push)
  │
  ▼
BFF :3001  PUT /api/auth/mfa/challenge/:daId
  ├──▶ PingOne (external)  (verify OTP / FIDO2 assertion / push approval)
  │     • returns COMPLETED status
  │
  • sets req.session.stepUpVerified = now + 5min TTL  (single-use flag)

  ── Retry ─────────────────────────────────────────────────
  │
  ▼
Chat Interface :4000
  • retries original transaction
  │
  ▼
BFF :3001  POST /api/transactions
  • consumes stepUpVerified flag → effectiveAcr = 'Multi_factor'
  • step-up gate now passes
  • transaction proceeds normally through agent → MCP tool path
```

**Step-up triggers:** `step_up_enabled=true` (now on by default), amount ≥ threshold, transaction type in `[transfer, withdrawal]`, user `acr` does not satisfy `Multi_factor`.

---

## Flow 7 — Direct MCP Chip (🔌 chip)

Each vertical's chip panel includes one `🔌 Direct MCP` chip (mode: `'direct'`). This path is MCP 2025-11-25 spec-compliant: natural language is still parsed to produce a typed `tools/call` invocation — the "direct" aspect is that the LangGraph agent loop is bypassed entirely. The BFF acts as the MCP client.

**MCP spec compliance:** The MCP spec defines `tools/call` as a typed JSON-RPC invocation: `{ method: "tools/call", params: { name: "<tool>", arguments: {} } }`. A real MCP client does `initialize` → `tools/list` (discovery) → `tools/call` with resolved arguments. In this flow, the chip's natural-language message goes through the BFF heuristic NL parser to resolve the tool name and parameters — then the BFF issues a typed `tools/call` directly, skipping only the agent reasoning loop.

```
Browser
  │
  ▼
Chat Interface :4000
  • user clicks 🔌 Direct MCP chip
  │
  ▼  (step 1: NL intent resolution)
BFF :3001  POST /api/banking-agent/nl  { message: "<chip message>", provider: "heuristic", vertical: "<id>" }
  • heuristic NL parser resolves action + params (same parser as Flow 3)
  • returns { kind, action, params } — typed intent, no LLM needed
  │
  ▼  (step 2: typed MCP tools/call)
BFF :3001  POST /api/mcp/tool  { tool: "<resolved tool>", params: <resolved params> }
  • session auth (validates session cookie)
  • RFC 8693 token exchange (subject_token=user, actor_token=agent, audience=mcp-gw)
  │                          ↕
  │                      PingOne (external)  POST /token
  │                          returns delegated token (aud=mcp-gw, act.sub=agent)
  │
  ▼
Ping Agent Gateway :3005
  ├──▶ PingOne Authorization Server :9001  /as/introspect
  │     RFC 7662 token introspection
  │
  ├──▶ PingOne Authorization Server :9001  /governance/.../decision
  │     PingOne Authorize policy: PERMIT / DENY / INDETERMINATE
  │
  │   (if PERMIT)
  └──▶ MCP Server :8080  tools/call  { name: "<tool>", arguments: <params> }  (WebSocket)
        returns JSON-RPC result
  │
  ▼
BFF :3001  → HTTP 200  { result: <mcp_result>, tokenEvents: [...] }
  │
  ▼
Chat Interface :4000
  • normalises result (normalizeAgentToolResult)
  • sets token chain events for Token Chain panel
  • renders raw JSON result in chat
```

**What this path skips vs Flow 3:**

- LangGraph agent reasoning loop
- LLM inference (tool selection and argument construction are done by the heuristic NL parser)

**What this path keeps (same as Flow 3 tool execution):**

- NL intent parsing (heuristic — resolves typed tool + params from the chip's message)
- Session auth
- RFC 8693 token exchange → PingOne
- Gateway introspection + PingOne Authorize policy decision
- HITL gate (if tool triggers consent)
- Token Chain events

**NL action → MCP tool resolution:**

| NL result | MCP tool |
| --- | --- |
| `kind:banking, action:accounts` | `get_my_accounts` |
| `kind:banking, action:vertical_feature_demo` | `featurePage.mcpTool` from the active vertical's manifest |
| `kind:vertical, action:<name>` | `<name>` (action IS the tool name for plugin verticals) |

**Per-vertical chip messages and resolved tools:**

| Vertical | Chip ID | Chip message | NL action | MCP Tool |
| --- | --- | --- | --- | --- |
| Super Banking | `bk-direct` | `get my accounts` | `accounts` | `get_my_accounts` |
| CareConnect | `hc-direct` | `get my health record` | `vertical_feature_demo` | `show_health_record` |
| Great Buy | `rt-direct` | `list my orders` | `list_orders` (plugin) | `list_orders` |
| Super Sports | `sg-direct` | `show my gear order` | `vertical_feature_demo` | `show_gear_order` |
| WX Workforce | `wf-direct` | `show expense report` | `vertical_feature_demo` | `show_expense_report` |

---

## Active Feature Flags (enabled 2026-06-14)

These flags were turned on to move the demo from simulated to real PingOne enforcement:

| Flag | Effect on Flow |
| --- | --- |
| `ff_authorize_deposits` | Deposits flow through PingOne Authorize policy (not just transfers) |
| `ff_authorize_mcp_first_tool` | First MCP tool call per agent session is gated by PingOne Authorize (`DecisionContext=McpFirstTool`) |
| `step_up_enabled` | Step-up MFA (Flow 6) is active — users are challenged for real on high-value transactions |
| `ff_agent_restrictions` | PingOne Authorize resource server gate + `AgentRestrictions` attribute enforced on agent tokens |

Flags are persisted in LMDB (`demo_api_server/data/persistent/lmdb`) and survive restarts. Toggle via admin UI or:

```bash
curl -X PATCH http://localhost:3001/api/admin/feature-flags \
  -H 'Content-Type: application/json' \
  -d '{"ff_authorize_deposits":true,"ff_authorize_mcp_first_tool":true,"step_up_enabled":true,"ff_agent_restrictions":true}'
```

**Still simulated (not yet real):**

| Flag | Needed for full enforcement |
| --- | --- |
| `PINGONE_AUTHORIZE_ENABLED` | Set `true` to stop all simulated policy decisions |
| `ff_authorize_simulated` | Set `false` once a real Decision Endpoint is configured |
| `authorize_failover_mode` | Change to `deny` to fail-closed instead of falling back to simulation |

---

## Notes

- **PingOne Authorization Server** is a local mock of PingOne Authorize. In a production deployment, `PINGAUTHORIZE_ENDPOINT` points directly at PingOne Authorize and the sidecar is removed.
- **Token introspection** is **on by default**. The gateway sends a `POST` to `GW_INTROSPECTION_ENDPOINT` with `token_type_hint=access_token` and client credentials via `client_secret_post` (Basic auth also supported). Defaults to `http://localhost:9001/as/introspect` (run.sh / docker-compose) or `http://127.0.0.1:9001/as/introspect` (k8s sidecar). Clear the variable to disable.
- **Ping Agent Gateway forwards the token unchanged** — no second RFC 8693 exchange at the gateway. The BFF-issued token (`aud=mcp-gw`) is accepted by MCP Server and MCP Invest directly.
- **Mortgage Service** uses a credential swap — OAuth bearer dropped at the gateway, replaced with `X-API-Key`. User identity forwarded as `X-User-Sub`. The API key (`DEMO_MORTGAGE_SERVICE_KEY`) is sourced from the encrypted vault at gateway startup; falls back to `'demo-mortgage-key-0000'` if the vault entry is absent.
- **HITL Service** challenge is bound to a specific user, agent, and tool — the receipt is verified on retry to prevent replay attacks.
- **Chat Interface** renders the consent modal (HITL) and MFA challenge UI, and is responsible for re-submitting requests after approval.
- **Redis** is used only for HITL consent pub/sub across BFF instances. Falls back to in-process EventEmitter on single-instance deployments (HITL will not work across instances without Redis).
- **Agent actor token** is acquired once via client credentials at Agent startup and cached until expiry — not fetched per tool call.
- **NL intent LLM fallback** (Helix / Claude) is only called when the heuristic parser finds no match. Most common banking prompts are resolved locally.
- **PingGateway (ForgeOps IG)** — a `ping-gateway/` directory contains an alternative deployment configuration using Ping Identity's Java-based API gateway in place of the Node.js Ping Agent Gateway. It is not active in the default Docker or run.sh setup. When deployed, it sits in front of the MCP servers and handles token introspection, PingOne Authorize policy decisions, and MCP routing via Groovy filter scripts — the same responsibilities as the Ping Agent Gateway. Set `MCP_GW_P1AZ_ENABLED=false` on the Node.js gateway when PingGateway is deployed to avoid double-calling the policy per request.
