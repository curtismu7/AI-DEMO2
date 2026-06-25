# Token Flow — Super Banking demo

Complete reference for OAuth token lifecycle: how tokens are obtained, what resource and scopes they carry, how they are exchanged (BFF-side RFC 8693 delegation), and how decoded claims reach the UI.

> **Architecture decision:** This demo uses a **single BFF-side RFC 8693 exchange per tool call** — the BFF performs one token exchange and the gateway forwards that token unchanged (HTTP path). This produces the `act` claim chain required for auditable agentic delegation.

---

## Token Inventory

| Token | Grant | Resource (audience) | Scopes |
|-------|-------|---------------------|--------|
| **User Access Token** (customer) | Auth Code + PKCE | `https://ai-agent.pingdemo.com` | `openid profile email offline_access banking:read banking:write banking:ai:agent` |
| **Admin Access Token** | Auth Code | `https://ai-agent.pingdemo.com` | `openid profile email offline_access banking:read banking:write banking:admin banking:sensitive banking:ai:agent` |
| **AI Agent Actor CC Token** *(exchange actor)* | Client Credentials | `https://agent-gateway.pingdemo.com` | Agent client's registered scopes |
| **BFF-Exchanged MCP Token** *(single RFC 8693 result)* | RFC 8693 Exchange (BFF-side, one per tool call) | `https://resource-server.pingdemo.com` | Narrowed to tool-specific scope (see Tool → Scope table); carries nested `act` delegation chain |
| **Worker Token** | Client Credentials | PingOne Management API | No scope in body (PingOne worker convention) |
| **Refresh Token** | Returned with Auth Code (`offline_access`) | — | — |
| **ID Token** | Returned with Auth Code (`openid`) | — | Identity claims |

> **Note:** The BFF performs **one** RFC 8693 exchange per tool call. There is no separate "Agent Exchanged Token (intermediate)" and "Final MCP Token" as two distinct BFF-issued tokens. The gateway receives the BFF-exchanged token and forwards it **unchanged** to the upstream MCP server (HTTP path).

---

## Scope Definitions

| Scope | Meaning |
|-------|---------|
| `openid` | OIDC — enables ID token and userinfo endpoint |
| `profile` | OIDC — name, given_name, family_name |
| `email` | OIDC — email address |
| `offline_access` | Enables refresh token issuance |
| `banking:read` | Read accounts and transactions |
| `banking:write` | Write — deposits, withdrawals, transfers |
| `banking:admin` | Full admin access across all users |
| `banking:sensitive` | Sensitive data (full account number, routing) |
| `banking:ai:agent` | AI agent identification / delegation delegation scope |
| `ai_agent` | AI agent identity (OIDC-side agent identity) |
| `admin:read` | Admin-only read (audit logs, system status) |
| `admin:write` | Admin-only write |
| `users:read` | Read user list |
| `users:manage` | Manage user accounts |

---

## MCP Tool → Required Scope

| Tool(s) | Required Scope(s) on User AT | Scope Passed to Exchange |
|---------|------------------------------|--------------------------|
| `get_my_accounts`, `get_account_balance`, `get_my_transactions` | `banking:read` | `banking:read` |
| `create_transfer`, `create_deposit`, `create_withdrawal` | `banking:write` | `banking:write` |
| `query_user_by_email` | `ai_agent` | `ai_agent` |
| `admin_list_all_users`, `admin_get_user_details` | `admin:read`, `users:read` | `admin:read users:read` |
| `admin_delete_user`, `admin_manage_accounts` | `admin:write`, `users:manage` | `admin:write users:manage` |
| `admin_view_audit_logs`, `admin_system_status` | `admin:read` | `admin:read` |

**Scope resolution logic** (`agentMcpTokenService.js`):

- **Path A** — User AT directly carries tool scope → passes that scope to PingOne
- **Path B** — User AT carries only `banking:ai:agent` → passes tool scopes to PingOne Authorize policy to decide
- **Fail** — User AT has neither → `403 missing_exchange_scopes`
- **Guard** — User AT must carry ≥ 5 distinct scopes before any exchange is attempted (`MIN_USER_SCOPES_FOR_MCP = 5`)

---

## 2-Exchange Delegation Flow

```
1. User login (Auth Code + PKCE)
   PingOne → User Access Token
   aud:    https://ai-agent.pingdemo.com
   scope:  openid profile email offline_access
           banking:read banking:write banking:ai:agent
   may_act.sub: PINGONE_AI_AGENT_CLIENT_ID  ← must be set in PingOne policy
   stored: req.session.oauthTokens.accessToken  (server-side httpOnly, never in browser)

2. Agent called: POST /api/agent/invoke  (agentInvokeRoute.js line 89)
   BFF pre-checks:
   ├─ mcp_resource_uri is configured
   ├─ scopeCount(userAT) ≥ 5  (MIN_USER_SCOPES_FOR_MCP)
   ├─ may_act.sub === PINGONE_AI_AGENT_CLIENT_ID
   └─ [if ff_intent_authorization_enabled=true] intent authorization gate runs BEFORE agent

   LLM execution: BFF calls runReasonLoop → external TypeScript reasoning service (:3006)
   Tool execution: BFF-side via executeBffTool → runMcpToolPipeline
   (LangChain does NOT call the gateway directly)

BFF-side RFC 8693 Exchange (one exchange per tool call)
   BFF gets AI Agent Actor CC Token
   (Client Credentials → aud: https://agent-gateway.pingdemo.com)

   RFC 8693 POST {PingOne}/as/token:
   grant_type         = urn:ietf:params:oauth:grant-type:token-exchange
   subject_token      = User AT
   subject_token_type = urn:ietf:params:oauth:token-type:access_token
   actor_token        = AI Agent Actor CC Token
   actor_token_type   = urn:ietf:params:oauth:token-type:access_token
   audience           = https://resource-server.pingdemo.com
   scope              = banking:read  (tool-specific)
   client_id          = PINGONE_AI_AGENT_CLIENT_ID
   ─────────────────────────────────────────────────────────────
   → BFF-Exchanged MCP Token
      sub:   <user's sub>  (preserved — RFC 8693 §3)
      aud:   https://resource-server.pingdemo.com
      act:   { "sub": "ai-agent-client-id" }
      scope: banking:read  (narrowed to this tool)

3. BFF-Exchanged MCP Token sent as Bearer → banking-mcp-gateway (port 3005)
   Gateway forwards token UNCHANGED to upstream MCP server (HTTP path)
   MCP Server validates: aud ✓  scope ✓  act chain ✓
   Tool executes → result returned to BFF

4. UI receives decoded claims only (never raw tokens)
   GET /api/tokens/session-preview → tokenEvents[]
   GET /api/mcp/tool/events?trace=<uuid> → live token events streamed via SSE (flowTraceId)
   POST agent invoke response     → live tokenEvents[] per tool call
```

---

## `may_act` / `act` Claims (RFC 8693)

### `may_act` — prospective permission (on User AT, before exchange)

PingOne must be configured to add `may_act.sub = PINGONE_AI_AGENT_CLIENT_ID` to the user's access token at login. This authorizes Exchange #1. Without it the exchange is rejected.

Feature flag `ff_inject_may_act`: BFF writes it into the in-memory claim snapshot for testing (JWT itself is unchanged).

### `act` — current actor chain (on Final MCP Token)

The BFF-side single exchange produces an `act` claim encoding the delegation chain:

```json
{
  "sub": "user-subject-id",
  "act": {
    "sub": "ai-agent-client-id"
  }
}
```

Reading the chain: **AI Agent** acted on behalf of **the user**. Subject preservation is verified after the exchange — if `exchangedToken.sub !== userSub` a `subject-preservation-mismatch` warning event is emitted (RFC 8693 §3).

---

## Agent-to-Agent (A2A) Delegation — chained exchange + nested `act`

A2A adds a SECOND agent. Every vertical has its own **specialist** (Agent 2) that the generalist assistant (Agent 1 = the existing AI Agent) delegates a narrow, sensitive read to. Registry: `demo_api_server/config/a2aSpecialists.js`.

| Vertical | Specialist (Agent 2) | Gated tool | Scope (derived from SoT) |
|---|---|---|---|
| banking | Investment Advisor | `get_portfolio_summary` / `get_investment_*` | `invest:read` |
| healthcare | Records Specialist | `sensitive_patient_records` | `read` |
| retail | Purchase Specialist | `sensitive_order_history` | `read` |
| sporting-goods | Membership Specialist | `sensitive_membership_details` | `read` |
| workforce | Payroll Specialist | `sensitive_payroll_details` | `read` |

**Chained RFC 8693** (`a2aDelegationService.js`): Exchange #1 (user subject + Agent 1 actor → `aud:a2a-intermediate`, `act:{agent1}`) then Exchange #2 (that token as subject + Agent 2 actor → `aud:mcpgateway`), which **nests** the actor chain:

```json
{
  "sub": "user-subject-id",
  "act": { "sub": "specialist-agent", "act": { "sub": "generalist-agent" } }
}
```

**No `may_act`.** The token endpoint just builds the chain; **PingOne Authorize decides** over it. Tools flagged `a2aDelegated` in `scope-topology.json` are DENIED unless the act chain depth ≥ 2 (a specialist delegated by the generalist) — the generalist alone (depth 1) is denied, so the sensitive tool is reachable **only via delegation**. The gateway passes `ActChainDepth` to Authorize; the BFF simulated engine + `demo_authz_server` apply the identical rule (parity). Gated behind `ff_a2a_delegation`.

---

## How Decoded Claims Reach the UI

All raw tokens stay **server-side only**. The browser only ever receives decoded JWT payload objects:

| Endpoint | What it returns |
|----------|-----------------|
| `GET /api/tokens/session-preview` | `tokenEvents[]` with decoded User AT claims; "waiting" placeholders for pending MCP exchange |
| `GET /api/tokens/chain` | Full token chain: `banking-app-token`, `agent-token`, `exchanged-token-mcp` — decoded payload only |
| `GET /api/token-chain` | Full ordered event chain from `tokenChainService` Map |
| `GET /api/mcp/tool/events?trace=<uuid>` | **SSE stream** — live token events keyed by `flowTraceId`; UI subscribes per tool call to receive decoded claims as they are produced |
| `POST /api/agent/invoke` (response) | Live `tokenEvents[]` per tool call with exchange details |
| `GET /api/tokens/userinfo` | BFF proxies PingOne `/userinfo`; enriched profile claims |

Each `tokenEvent` shape:
```json
{
  "id": "user-token",
  "label": "User Access Token",
  "status": "active",
  "jwtFullDecode": { "header": {}, "claims": {} },
  "explanation": "User authenticated via Authorization Code + PKCE...",
  "rfc": "RFC 6749, RFC 7636",
  "exchangeDetails": {
    "actPresent": true,
    "audMatches": true,
    "scopeNarrowed": true
  }
}
```


---

## Gateway-First Token Flow (Phase 243 — MCP Gateway)

> **Note:** The Phase 243 design section below describes a superseded design (gateway performing its own RFC 8693 re-exchange on PERMIT). Current behavior is described above: the BFF performs ONE exchange; the gateway forwards the BFF-exchanged token **unchanged** to the upstream MCP server (HTTP path). The gateway runs PingOne Authorize policy evaluation per call but does NOT re-exchange the token on PERMIT.
>
> **Architecture change (Phase 243):** When `MCP_GATEWAY_HTTP_URL` is configured on the BFF,
> all MCP tool calls are routed through the **banking-mcp-gateway** service rather than
> directly to the MCP server. The gateway owns RFC 9728 protected resource metadata
> and runs PingOne Authorize policy evaluation per call.

### Token Chain with Gateway (Phase 243)

```
Final MCP Token                      Gateway-Issued Upstream Token
(aud = MCP_GW_RESOURCE_URI)      →   (aud = MCP_UPSTREAM_RESOURCE_URI)
           |                                       |
           v                                       v
   banking-mcp-gateway                  banking_mcp_server
   (port 3005)                          (port 8080)
```

**Full end-to-end chain:**
```
1–2. Same as 2-Exchange path above → Final MCP Token (aud = MCP_GW_RESOURCE_URI)

3. BFF: POST /mcp → banking-mcp-gateway
   Bearer: Final MCP Token (aud = MCP_GW_RESOURCE_URI)
   
   Gateway pipeline (PingGateway filter chain equivalent):
   ├─ McpValidationFilter equivalent: Origin check, Accept header, JSON-RPC 2.0 format
   ├─ McpProtectionFilter equivalent: Decode + validate JWT (aud, exp, sub)
   │   GatewayTokenPolicy: reject if aud ∈ upstream URIs (D-05 anti-bypass)
   ├─ PingOne Authorize: POST /governance/pap/alpha/policy/{workerId}/decision
   │   Decision context: method, toolName, clientId, scopes, audience
   │   PERMIT → forward token unchanged (HTTP path)
   │   DENY   → HTTP 403 {error:'insufficient_scope', decision:'DENY'}
   │   INDETERMINATE → HITL: JSON-RPC -32002 (WS) or HTTP 403
   │                         {error:'hitl_required', challengeId, hitl:true} (HTTP)
   └─ Gateway forwards BFF-exchanged token UNCHANGED to upstream MCP server

4. Gateway → upstream MCP server (port 8080)
   Bearer: BFF-exchanged token (unchanged, aud = MCP_UPSTREAM_RESOURCE_URI)
   
   Upstream enforcement (D-05):
   ├─ MCP_GATEWAY_MODE=true: HttpMCPTransport.enforceUpstreamContract()
   │   Reject if aud includes MCP_GW_RESOURCE_URI (anti-bypass)
   │   Accept only if aud = MCP_UPSTREAM_RESOURCE_URI
   └─ authManager.validateAgentToken() — signature + claims

5. Tool executes → result returned gateway → BFF

6. UI receives decoded claims only — NO raw tokens leave the BFF (D-04)
   Tool execution is BFF-side via executeBffTool → runMcpToolPipeline.
   LangChain does NOT call the gateway directly; the LLM path uses runReasonLoop
   against the external TypeScript reasoning service (:3006).
   Result returned without token exposure to the model context window.
```

### Security Properties (Phase 243)

| Decision | Enforcement |
|----------|-------------|
| D-01: Real gateway (not a stub) | `banking-mcp-gateway/` service, port 3005 |
| D-02: Gateway owns RFC 9728 | `GET /.well-known/oauth-protected-resource` on gateway (not upstream) |
| D-03: Gateway handles token passing/exchange | `McpTokenExchangeClient` in gateway |
| D-04: NO TOKENS TO LLM | `callToolViaGateway` result-only return; LangChain gets tool result, not token |
| D-05: aud = next hop only | `GatewayTokenPolicy` + `HttpMCPTransport.enforceUpstreamContract` |
| D-06: PingOne Authorize does policy | `PingOneAuthorizeClient.evaluate()` per call |

### Gateway Env Vars (banking-mcp-gateway)

| Variable | Purpose |
|----------|---------|
| `MCP_GW_RESOURCE_URI` | Inbound audience — what tokens must be issued for (gateway) |
| `UPSTREAM_MCP_URL` | Upstream MCP server base URL (default `http://localhost:8080`) |
| `PINGAUTHORIZE_ENDPOINT` | PingOne Authorize base URL |
| `PINGAUTHORIZE_WORKER_ID` | Policy worker ID for per-call decisions |
| `MCP_OLB_RESOURCE_URI` | Upstream audience for OLB banking tools |
| `MCP_INVEST_RESOURCE_URI` | Upstream audience for invest tools |
| `MCP_ACCEPTED_ORIGINS` | Regex for CORS origin validation |

### BFF Env Vars (banking-mcp-gateway cutover)

| Variable | Purpose |
|----------|---------|
| `MCP_GATEWAY_HTTP_URL` | When set, BFF routes tools through gateway (default: bypass) |
| `MCP_GATEWAY_TIMEOUT_MS` | Per-call timeout (default 30000 ms) |

### Upstream MCP Server Env Vars (hardening)

| Variable | Purpose |
|----------|---------|
| `MCP_GATEWAY_MODE` | When `true`, upstream enforces next-hop contract (D-05) |
| `MCP_UPSTREAM_RESOURCE_URI` | Expected upstream audience in gateway-issued tokens |
| `MCP_GW_RESOURCE_URI` | Gateway audience — rejected at upstream (anti-bypass) |


---

## Environment Variables Reference

| Variable | Value | Purpose |
|----------|-------|---------|
| `ENDUSER_AUDIENCE` | `https://ai-agent.pingdemo.com` | User AT audience |
| `AI_AGENT_INTERMEDIATE_AUDIENCE` | `https://ai-agent.pingdemo.com` | Exchange #1 intermediate token audience |
| `AGENT_GATEWAY_AUDIENCE` | `https://agent-gateway.pingdemo.com` | AI Agent actor CC token audience |
| `BANKING_API_RESOURCE_URI` | `https://resource-server.pingdemo.com` | Banking API resource server |
| `PINGONE_RESOURCE_MCP_GATEWAY_URI` | `https://mcp-gateway.pingdemo.com` | MCP Exchanger CC token audience |
| `PINGONE_RESOURCE_TWO_EXCHANGE_URI` | `https://resource-server.pingdemo.com` | Exchange #2 final MCP token audience |

---

## Key Source Files

| File | Role |
|------|------|
| `demo_api_server/config/oauthUser.js` | User PKCE flow scopes, dynamic scope logic |
| `demo_api_server/config/scopes.js` | `BANKING_SCOPES` constants + tool scope map |
| `demo_api_server/services/agentMcpTokenService.js` | 1-exchange + 2-exchange paths, scope resolution |
| `demo_api_server/services/oauthService.js` | `performTokenExchangeAs()`, CC token helpers |
| `demo_api_server/services/mcpWebSocketClient.js` | `MCP_TOOL_SCOPES` mapping |
| `demo_api_server/routes/tokens.js` | `GET /api/tokens/session-preview`, `/chain`, `/userinfo` |
| `demo_api_server/routes/ciba.js` | CIBA step-up flow |
| `banking_api_ui/src/context/TokenChainContext.js` | Live token event state in UI |
| `banking_api_ui/src/context/useFlowMilestones.js` | `addMilestone()` hook for flow timeline |
