# Phase 3: RFC 8693 Token Exchange & Tool Success
## Complete Happy Path: User Auth → Token Exchange → Tool Execution → Results

**Goal:** Implement the full successful tool invocation flow with RFC 8693 token exchange.

**Status:** Planning phase
**Last updated:** 2026-05-05

---

## Overview: What Phase 3 Does

User authorizes agent → obtains subject token → exchanges tokens via RFC 8693 → tool call succeeds → results flow back

**Diagram reference:** i4ai-ref-arch.mmd steps 19–49 (embedded step numbers in arrows)

---

## Phase 3 Breakdown

### Sub-phase 3A: User Authorization (Steps 19–25)
User already authenticated. Web App obtains **scoped subject token** with delegation support.

```
Step 19: CB → WA: Request token (resource: agent1, scope: balance)
Step 20: WA → PID: Token request (resource: agent1, scope: balance)
Step 21: PID → WA: Subject token (sub: user, aud: agent1, may_act: {sub: agent1}, scope: balance)
Step 22: WA → CB: Subject token
Step 23: CB → A: Subject token (sub: user, may_act: {sub: agent1})
```

**What's needed:**
- Chatbot/UI requests token with resource + scope
- Web App calls PingOne `/as/token` with resource indicator
- PingOne returns subject token with `may_act` claim (delegation support)
- Token flows to agent

### Sub-phase 3B: RFC 8693 Token Exchange (Steps 26–27)
Agent exchanges **actor token** (CC) + **subject token** (user) → **TX token** (delegated)

```
Step 26: A → PID: Token exchange (actor_token: agent CC, subject_token: user token, aud: mcp-gw)
Step 27: PID → A: TX token (sub: user, act: {sub: agent1}, aud: mcp-gw, scope: balance)
```

**Token shape:**
- **Input:** `actor_token` (agent CC), `subject_token` (user with may_act), `audience` (mcp-gw)
- **Output:** TX token with `sub=user`, `act=agent1`, `aud=mcp-gw`, `scope=balance`

### Sub-phase 3C: Tool Call with TX Token (Steps 28–32)
Agent calls tool via gateway with TX token. Gateway validates and exchanges for MCP token.

```
Step 28: A → AG: tools/call check_balance (JSON-RPC) with TX token
Step 29: AG → PA: Authorization check (TX token, tool: check_balance)
Step 30: PA → PID: Introspect TX token
Step 31: PID → PA: Token claims (sub, act, aud, scope)
Step 32: PA → AG: Permit
```

**Outcome:** Ping Authorize **PERMITS** because:
- Token has subject (`sub: user`)
- Token has actor (`act: agent1`)
- Token has correct scope (`balance`)
- `aud` matches policy

Then gateway exchanges TX → MCP token:

```
Step 33: AG → PID: Token exchange (subject_token: TX token, aud: mcp)
Step 34: PID → AG: MCP token (sub: user, act: {sub: agent1}, aud: mcp, scope: balance)
```

### Sub-phase 3D: MCP Tool Execution (Steps 35–40)
MCP calls resource server with exchanged token.

```
Step 35: AG → MCP: tools/call check_balance (JSON-RPC) with MCP token
Step 36: MCP → PID: Token exchange (subject_token: MCP token, aud: resource-server)
Step 37: PID → MCP: RS token (sub: user, act: {sub: agent1}, aud: resource-server, scope: balance)
Step 38: MCP → RS: GET /balance (RS token)
Step 39: RS → PID: Introspect RS token
Step 40: PID → RS: Token claims (sub, act, aud, scope)
Step 41: RS → MCP: Balance data ($2,450.32)
```

### Sub-phase 3E: Results Flow Back (Steps 42–49)
Tool result flows back through layers.

```
Step 42: MCP → AG: Tool result
Step 43: AG → A: Tool result
Step 44: A → LLM: Tool result + context
Step 45: LLM → A: Natural language response
Step 46: A → CB: Response
Step 47: CB → U: Display in chatbot interface
Step 48: CB → WA: Response + context
Step 49: WA → U: Also sync to dashboard/full UI
```

---

## Implementation Components

### 1. Subject Token Acquisition Service

**File:** `banking_api_server/services/subjectTokenService.js` (new)

**Purpose:** Request scoped subject token from PingOne with delegation support

**Key parameters:**
- `scope`: What the user is authorizing (e.g., "banking:read")
- `resource`: Target audience for token (e.g., "agent1")
- `may_act`: Allow agent to act on behalf (must include agent client_id)

**Function:**
```javascript
async function getSubjectTokenWithDelegation(req, userId, scope, resource) {
  // Request: POST /as/token
  //   grant_type: authorization_code (user already has it)
  //   scope: "banking:read"
  //   resource: "agent1"
  //   may_act: "[agent_client_id]"
  // Response: { subject_token, may_act: {sub: agent1}, ... }
}
```

### 2. RFC 8693 Token Exchange Service

**File:** `banking_api_server/services/rfc8693TokenExchangeService.js` (new or extend existing)

**Purpose:** Perform RFC 8693 token exchange per spec

**Key function:**
```javascript
async function exchangeTokens(req, actorToken, subjectToken, audience) {
  // Per RFC 8693 §3.2.1
  // Request: POST /as/token
  //   grant_type: "urn:ietf:params:oauth:grant-type:token-exchange"
  //   subject_token: <user access token>
  //   subject_token_type: "urn:ietf:params:oauth:token-type:access_token"
  //   actor_token: <agent CC token>
  //   actor_token_type: "urn:ietf:params:oauth:token-type:access_token"
  //   resource: <audience>
  // Response: { access_token (TX token), act: {sub: agent1}, ... }
}
```

**Token events:**
- `token_exchange_request_started`
- `token_exchange_success` (with act claim info)
- `token_exchange_failed` (if error)

### 3. Updated Tool Call Service

**File:** `banking_api_server/services/agentToolCallService.js` (modify)

**Add:** Support for calling tools with **TX token** (not just CC token)

**New variant function:**
```javascript
async function callToolWithDelegatedToken(req, toolName, params, txToken) {
  // Same as CC version but:
  // - Send TX token instead of CC token
  // - On success: tool executes (no 403)
  // - Returns: { success: true, result: {...}, tokenEvents: [...] }
}
```

### 4. Updated Message Handler

**File:** `banking_api_server/routes/bankingAgentRoutes.js` (modify POST /message)

**New logic after Phase 2's 403 DENY:**

When response is `requiresUserContext: true`:
1. Frontend shows "Authorize" button
2. User authorizes in browser (OAuth consent)
3. Frontend obtains subject token from Web App
4. Frontend sends message again with subject token in request body OR
5. Backend obtains fresh subject token from session

Then, when tool call is attempted:
- Use TX token (from RFC 8693 exchange)
- Tool call succeeds
- Return results to chatbot

### 5. Session Token Storage

**File:** `banking_api_server/middleware/agentSessionMiddleware.js` (modify)

**Add:** Fields to track delegated tokens

```javascript
req.agentContext = {
  userId: ...,
  accessToken: ..., // user token
  subjectToken: null, // scoped subject token (populated in Phase 3)
  agentCCToken: null, // agent CC token (from Phase 1)
  txToken: null, // delegated TX token (from Phase 3)
  txTokenExpiresAt: null,
  tokenEvents: [],
};
```

---

## Response Flow

### User Asks for Balance (with Authorization)

**Step 1: Frontend gets subject token**
- User clicks "Authorize"
- Browser OAuth consent flow
- Web App requests scoped token: `scope=banking:read, resource=agent1`
- PingOne returns subject token with `may_act` claim

**Step 2: Frontend retries with subject token**
```bash
POST /api/banking-agent/message
Authorization: Bearer <user_session_token>
Content-Type: application/json

{
  "message": "What is my account balance?",
  "subjectToken": "<scoped_subject_token>"
}
```

**Step 3: Backend exchanges tokens**
- Gets agent CC token (from session or fresh)
- Exchanges: CC + subject → TX token
- Stores TX token in session

**Step 4: Tool call with TX token**
- Calls `callToolWithDelegatedToken()` with TX token
- Gateway validates TX token with Ping Authorize
- Ping Authorize introspects and validates act claim
- Tool succeeds
- Result flows back

**Step 5: Response to chatbot**
```json
{
  "success": true,
  "reply": "Your checking account balance is $2,450.32. Recent transactions: ...",
  "toolsCalled": ["get_account_balance"],
  "tokenEvents": [
    { "type": "subject_token_obtained", "scope": "banking:read", ... },
    { "type": "token_exchange_rfc8693", "act": "agent1", "aud": "mcp-gw" },
    { "type": "tool_call_success", "toolName": "get_account_balance" },
    { "type": "token_exchange_for_mcp", "aud": "mcp" },
    { "type": "token_exchange_for_rs", "aud": "resource-server" },
    { "type": "resource_server_call", "endpoint": "GET /balance" }
  ]
}
```

---

## Files to Create / Modify

| File | Action | Status |
|------|--------|--------|
| `banking_api_server/services/subjectTokenService.js` | **Create** | Pending |
| `banking_api_server/services/rfc8693TokenExchangeService.js` | **Create** | Pending |
| `banking_api_server/services/agentToolCallService.js` | **Modify** | Pending |
| `banking_api_server/routes/bankingAgentRoutes.js` | **Modify** | Pending |
| `banking_api_server/middleware/agentSessionMiddleware.js` | **Modify** | Pending |

---

## Critical Details: RFC 8693 Compliance

### Token Exchange Request
```
grant_type: urn:ietf:params:oauth:grant-type:token-exchange
subject_token: <user access token>
subject_token_type: urn:ietf:params:oauth:token-type:access_token
actor_token: <agent CC token>
actor_token_type: urn:ietf:params:oauth:token-type:access_token
resource: <audience (e.g., mcp-gw)>
```

### Token Exchange Response
```json
{
  "access_token": "<TX token with act claim>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "banking:read",
  "act": { "sub": "agent1" }
}
```

### Validation at Each Layer
- **Gateway (PA):** Validates `sub=user`, `act=agent1`, `aud=mcp-gw`, `scope`
- **MCP:** Validates `sub=user`, `act=agent1`, `aud=mcp`, `scope`
- **Resource Server:** Validates `sub=user`, `act=agent1`, `aud=resource-server`, `scope`

---

## Error Handling

| Scenario | HTTP | Response |
|----------|------|----------|
| Subject token missing | 403 | `{ requiresUserContext: true }` |
| Subject token expired | 401 | `{ error: 'token_expired', requiresAuth: true }` |
| Token exchange fails | 502 | `{ error: 'token_exchange_failed' }` |
| Act claim missing | 403 | `{ error: 'insufficient_delegation' }` |
| Tool authorization denied | 403 | `{ error: 'tool_not_authorized' }` |
| Resource server error | 502 | `{ error: 'resource_server_error' }` |
| Success | 200 | `{ success: true, reply: "...", tokenEvents: [...] }` |

---

## Integration Points

**From Phase 1:**
- Agent CC token acquisition (reuse `agentCCTokenService`)
- Token event logging infrastructure

**From Phase 2:**
- Tool call service (extend with delegated token variant)
- Authorization denial handling

**New in Phase 3:**
- Subject token acquisition
- RFC 8693 token exchange
- Multi-layer token validation
- Complete result flow

---

## Success Criteria

- [ ] `subjectTokenService.js` created with subject token acquisition
- [ ] `rfc8693TokenExchangeService.js` created with RFC 8693 exchange
- [ ] `agentToolCallService.callToolWithDelegatedToken()` implemented
- [ ] `POST /api/banking-agent/message` handles subject token + tool execution
- [ ] Token events logged for each hop (subject, exchange, MCP, RS)
- [ ] Results flow back through all layers
- [ ] `npm run build` succeeds
- [ ] No regressions in Phases 1 & 2
- [ ] Token Chain UI panel shows all token exchanges

---

## Testing Checklist

- [ ] Frontend obtains subject token with delegation support
- [ ] Backend receives and stores subject token
- [ ] Token exchange with agent CC token succeeds
- [ ] TX token has `act` claim with agent client_id
- [ ] Tool call with TX token succeeds (no 403 deny)
- [ ] Gateway exchanges TX → MCP token
- [ ] MCP exchanges MCP → RS token
- [ ] Resource server validates all three tokens correctly
- [ ] Tool result flows back: RS → MCP → AG → Agent → LLM → Chatbot → UI
- [ ] Token Chain panel shows all 8-10 token events
- [ ] User sees final response with balance and transactions

---

## Complexity Notes

Phase 3 is the most complex:
- **4 token types:** CC, subject, TX, MCP, RS (5 total)
- **3 layers of exchange:** A↔PID, AG↔PID, MCP↔PID
- **3 layers of validation:** AG (PA), MCP, RS
- **Full distributed flow:** Agent → Gateway → MCP → RS → back up chain

But once implemented, it's a **complete working system** demonstrating:
- RFC 8693 token exchange
- Delegated authorization
- Multi-layer token validation
- Distributed tool invocation
- Proper `act` claim handling for audit

