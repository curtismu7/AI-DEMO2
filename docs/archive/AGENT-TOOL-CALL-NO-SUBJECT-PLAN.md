# Agent Tool Call (No Subject Token) Plan
## Implementing i4ai-ref-arch.mmd Steps 11–18: Tool Call → 403 Deny

**Goal:** Implement the agent tool invocation flow where the agent tries to call a tool with only its CC token (no subject token), triggering a 403 Forbidden response from Ping Authorize.

**Status:** Planning phase
**Last updated:** 2026-05-05

---

## i4ai Diagram (Steps 11–18)

```
Step 11: CB→A: Invoke check_balance tool
Step 12: A→LLM: Tool list + chatbot prompt
Step 13: LLM→A: Determine tool to use (check_balance)

Note over A: Tool call — agent context only (no user subject token)
Step 14: A→AG: tools/call check_balance (JSON-RPC)
Step 15: AG→PA: Authorization check (agent token)
Step 16: PA→AG: Deny (insufficient_scope: balance, no subject token)
Step 17: AG→A: HTTP 403 Forbidden (insufficient_scope: balance, no subject token)
Step 18: A→CB: User context required (resource: agent1, scope: balance)
```

---

## Current Implementation State

### What Exists (from Phase 1)
- ✓ `POST /api/banking-agent/init` returns available tools
- ✓ Agent CC token acquisition
- ✓ Agent Gateway integration for tools/list

### What's Missing (Phase 2)
- ✗ Tool invocation endpoint (`POST /api/banking-agent/tool-call`)
- ✗ Delegation to Agent Gateway for `tools/call`
- ✗ Handling 403 DENY from Ping Authorize
- ✗ Returning user context requirement to chatbot
- ✗ Token event tracking for authorization flow

---

## Architecture: Tool Invocation Flow

### User Request
```
Chatbot: "What is my current account balance?"
  ↓
Agent LLM: Selects check_balance tool
  ↓
Agent: Need to call tools/call check_balance with CC token (step 14)
  ↓
Agent Gateway: Check auth with Ping Authorize (step 15)
  ↓
Ping Authorize: Introspect CC token (step 16)
  ↓
DENY: "insufficient_scope: balance, no subject token"
  ↓
Agent: Return to chatbot (step 18)
  → "User context required (resource: agent1, scope: balance)"
```

---

## Required Changes

### 1. Tool Call Handler (Steps 14–17)

**File:** `banking_api_server/services/agentToolCallService.js` (new)

**Purpose:** Handle agent tool invocation via Agent Gateway with policy gating.

**Implementation:**
- Accept: tool name, parameters, agent CC token
- Call Agent Gateway `tools/call` JSON-RPC endpoint
- Send agent CC token as Bearer
- Agent Gateway calls Ping Authorize
- Ping Authorize validates token and scope
- Handle 403 Forbidden response (insufficient_scope)
- Extract error details: required scope, reason
- Log token event (authorization check)

**Function signature:**
```javascript
async function callToolWithAgentToken(req, toolName, params, agentCCToken) {
  // Returns:
  // - On success: { result, tokenEvents }
  // - On 403 DENY: throws error with code='insufficient_scope'
  //   - error.requiredScope: scope needed (e.g., 'banking:read')
  //   - error.reason: 'no subject token' or similar
  //   - error.resource: agent audience (e.g., 'agent1')
}
```

---

### 2. Updated `/api/banking-agent/message` Endpoint

**File:** `banking_api_server/routes/bankingAgentRoutes.js` (modify)

**Current behavior:** Routes to `processAgentMessage` in `bankingAgentLangGraphService.js`

**New behavior:**
- When agent selects a tool:
  1. Attempt to call tool via Agent Gateway with CC token only
  2. On 403 DENY: catch error and return to user/chatbot
  3. Response: `{ requiresUserContext: true, requiredScope, resource }`
  4. Chatbot prompts user for authorization

**Response shape (on 403):**
```javascript
{
  success: false,
  requiresUserContext: true,
  requiredScope: 'banking:read',        // What scope is needed
  resource: 'agent1',                   // Agent resource/audience
  message: 'User context required to access account information',
  tokenEvents: [ /* Authorization flow events */ ]
}
```

---

### 3. Agent Tool Call Service

**File:** `banking_api_server/services/agentToolCallService.js` (new)

**Key functions:**

#### `callToolWithAgentToken(req, toolName, params, agentCCToken)`
- Build tools/call JSON-RPC payload
- Send to Agent Gateway with agent CC token
- Handle 3 outcomes:
  - **Success (200):** Return tool result
  - **403 Deny:** Extract scope requirement, return error
  - **Other errors:** Network, timeout, gateway down

#### `parseAuthDenialError(gatewayError, gatewayResponse)`
- Extract error from JSON-RPC response
- Determine required scope from error data
- Extract resource/audience requirement
- Map Ping Authorize denial codes to user-friendly messages

**Error handling:**
- `insufficient_scope` → 403 Forbidden (needs subject token)
- Gateway unreachable → 502 Bad Gateway
- Invalid tool name → 400 Bad Request
- Timeout → 504 Gateway Timeout

---

## Mapping to i4ai Diagram

| Step | Actor | Action | Implementation | File |
|------|-------|--------|-----------------|------|
| 11 | Chatbot | Invoke tool | User sends message via `/api/banking-agent/message` | bankingAgentRoutes.js |
| 12 | Agent | Prepare context | LangGraph processes message, selects tool | bankingAgentLangGraphService.js |
| 13 | LLM | Determine tool | LLM recommends check_balance | (existing) |
| 14 | Agent | Call tool/list | `callToolWithAgentToken()` sends to AG | agentToolCallService.js |
| 15 | AG | Check auth | Gateway calls Ping Authorize | (external) |
| 16 | PA | Introspect | Ping Authorize introspects CC token | (external) |
| 17 | AG | Return 403 | Gateway returns DENY response | (external) |
| 18 | Agent | Return error | Catch 403, return user context requirement | agentToolCallService.js |

---

## Response Flow

### Success (should not happen in this phase — user token required)
```json
{
  "success": true,
  "result": { "balance": 2450.32 },
  "tokenEvents": [...]
}
```

### 403 DENY (expected — drives Phase 3)
```json
{
  "success": false,
  "requiresUserContext": true,
  "requiredScope": "banking:read",
  "resource": "agent1",
  "message": "User context required. Please authorize the agent to access account information.",
  "error": "insufficient_scope",
  "tokenEvents": [
    { "type": "tool_call_request_started", "toolName": "check_balance" },
    { "type": "agent_authorization_check", "decision": "DENY", "reason": "insufficient_scope: balance, no subject token" }
  ]
}
```

---

## Error Cases (Happy Path + 403 Only)

| Case | HTTP | Response |
|------|------|----------|
| Success (tool result) | 200 | `{ success: true, result: {...} }` |
| 403 Deny (no subject) | 403 | `{ requiresUserContext: true, ... }` |
| Agent not initialized | 401 | `{ error: 'session_expired' }` |
| Agent not configured | 503 | `{ error: 'agent_not_configured' }` |
| Tool name invalid | 400 | `{ error: 'invalid_tool' }` |
| Gateway unreachable | 502 | `{ error: 'gateway_unavailable' }` |

**Note:** Other error paths (step-up MFA, HITL consent, etc.) are orthogonal to this phase.

---

## Files to Create / Modify

| File | Action | Status |
|------|--------|--------|
| `banking_api_server/services/agentToolCallService.js` | **Create** | Pending |
| `banking_api_server/routes/bankingAgentRoutes.js` | **Modify** | Pending |
| `banking_api_server/services/bankingAgentLangGraphService.js` | **Modify** (if needed) | Pending |

---

## Verification Steps

1. **Token Validation**
   - Agent CC token is sent with tool call
   - Verify token is used (not user token)
   - Check Authorization header: `Bearer <cc_token>`

2. **403 Response Handling**
   - Gateway returns JSON-RPC error with code `insufficient_scope`
   - Error data includes `reason: 'no subject token'`
   - Error data includes `aud: 'agent1'` or `resource: 'agent1'`

3. **Chatbot Response**
   - Agent returns `requiresUserContext: true`
   - Includes `requiredScope` and `resource`
   - Chatbot can prompt user for authorization

4. **Token Events**
   - `tool_call_request_started` event logged
   - `agent_authorization_check` event with DENY details
   - Events appear in Token Chain UI panel

5. **No Regressions**
   - Existing `/api/banking-agent/init` still works
   - Other agent routes unaffected
   - Session validation unchanged

---

## Success Criteria

- [ ] `agentToolCallService.js` created with `callToolWithAgentToken()` function
- [ ] `callToolWithAgentToken()` sends JSON-RPC tools/call to Agent Gateway
- [ ] 403 DENY handled with `requiresUserContext` response
- [ ] Token events logged for authorization flow
- [ ] Chatbot receives error with scope requirement
- [ ] `npm run build` succeeds in banking_api_ui
- [ ] No regressions in existing routes
- [ ] Error handling for unreachable gateway, invalid tools, etc.

---

## Integration Points (Phase 3)

Once Phase 2 completes, Phase 3 will:
1. User authorizes agent (browser consent flow)
2. Web App obtains scoped subject token from PingOne
3. RFC 8693 token exchange (CC token + subject token → TX token)
4. Agent calls tools/call with TX token
5. Ping Authorize PERMITS with TX token
6. Tool execution succeeds
7. Results flow back to chatbot

For now: Agent returns "user context required" and stops.
