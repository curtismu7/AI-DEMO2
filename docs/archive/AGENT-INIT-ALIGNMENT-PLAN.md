# Agent Initialization Alignment Plan
## Aligning `/api/banking-agent/init` with i4ai-ref-arch.mmd (Steps 1–10)

**Goal:** Implement the happy-path agent initialization flow from the sequence diagram.
**Status:** Planning phase
**Last updated:** 2026-05-05

---

## Current State vs. i4ai Diagram

### Current Implementation
**Route:** `POST /api/banking-agent/init`

```javascript
// banking_api_server/routes/bankingAgentRoutes.js lines 21–37
router.post('/init', async (req, res) => {
  const { userId, accessToken } = req.agentContext || {};
  if (!userId || !accessToken) {
    return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
  }
  res.json({ 
    sessionId: req.session.id, 
    initialized: true,
    agentReady: true 
  });
});
```

**Current behavior:**
1. ✓ Validates user session (via `agentSessionMiddleware`)
2. ✓ Returns `initialized: true`
3. ✗ **Missing:** Does NOT fetch agent CC token
4. ✗ **Missing:** Does NOT request tools/list from Agent Gateway
5. ✗ **Missing:** Does NOT perform Ping Authorize policy evaluation
6. ✗ **Missing:** Does NOT return available tools to caller

### i4ai Diagram (Steps 1–10)

```
Step 1: User → Chatbot: "What is my current account balance..."
Step 2: Chatbot → Agent: Process user request via Agent
Step 3: Agent → PingOne: Token request (client_credentials)        ← AGENT CC TOKEN
Step 4: PingOne → Agent: Access token
Step 5: Agent → Agent Gateway: tools/list (JSON-RPC)             ← FETCH TOOLS
Step 6: Agent Gateway → Ping Authorize: Authorization check (agent token)
Step 7: Ping Authorize → MCP: Get all tools                       ← NEW: Fetch from MCP
Step 8: MCP → Ping Authorize: All tools
Step 9: Ping Authorize → PingOne: Introspect agent token         ← POLICY EVAL
Step 10: PingOne → Ping Authorize: Token claims (sub, aud, scope)
Step 11: Ping Authorize → Agent Gateway: Permitted tool list (filtered by scope)
Step 12: Agent Gateway → Agent: List of available tools           ← RETURN TOOLS
```

**Note:** Updated diagram now shows Ping Authorize calling MCP to fetch all tools (steps 7–8), then filtering by agent's scopes based on introspection results.

---

## Required Changes

### 1. Agent CC Token Acquisition (Steps 3–4)

**File:** `banking_api_server/services/agentCCTokenService.js` (new)

**Purpose:** Obtain a client_credentials token for the agent from PingOne.

**Implementation:**
- Use `pingone_mcp_token_exchanger_client_id` + `pingone_mcp_token_exchanger_client_secret` from configStore
- Scope: `banking:mcp:invoke` (or similar)
- Call PingOne `/as/token` endpoint with `grant_type=client_credentials`
- Cache token in request/session with TTL
- Log token event to token chain

**Function signature:**
```javascript
async function getAgentCCToken(req, scopes = ['banking:mcp:invoke']) {
  // Returns: { access_token, expires_in, token_type, ...claims }
  // Logs: tokenEvent type='agent_cc_token_obtained'
}
```

---

### 2. Agent Gateway Tools/List Request (Steps 5–12)

**File:** `banking_api_server/services/agentGatewayClient.js` (new or extend existing)

**Purpose:** Request the list of available tools from Agent Gateway, with policy-gated filtering via MCP.

**Implementation:**
- Call Agent Gateway endpoint `tools/list` (JSON-RPC)
- Send agent CC token as Authorization header
- Agent Gateway will:
  - Call Ping Authorize with the token
  - Ping Authorize calls MCP to get all available tools
  - MCP returns full tool catalog
  - Ping Authorize introspects agent token with PingOne
  - PingOne returns token claims (sub, aud, scope)
  - Ping Authorize evaluates fine-grained policy and filters by agent's scopes
  - Returns permitted tool list to Gateway
- Parse response: extract tool definitions
- Log token events from each hop

**Function signature:**
```javascript
async function getAvailableTools(req, agentCCToken) {
  // Returns: { tools: [ { name, description, schema }, ... ], tokenEvents: [...] }
  // Makes JSON-RPC call to Agent Gateway
  // Gateway ensures Ping Authorize validates policy
}
```

---

### 3. Updated `/api/banking-agent/init` Endpoint

**File:** `banking_api_server/routes/bankingAgentRoutes.js` (modify)

**Current (lines 21–37):**
```javascript
router.post('/init', async (req, res) => {
  const { userId, accessToken } = req.agentContext || {};
  if (!userId || !accessToken) {
    return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
  }
  res.json({ 
    sessionId: req.session.id, 
    initialized: true,
    agentReady: true 
  });
});
```

**New (refactored):**
```javascript
router.post('/init', async (req, res) => {
  try {
    const { userId, accessToken } = req.agentContext || {};
    if (!userId || !accessToken) {
      return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
    }

    // Step 3–4: Obtain agent CC token
    const agentCCTokenService = require('../services/agentCCTokenService');
    const ccTokenResult = await agentCCTokenService.getAgentCCToken(req);
    if (!ccTokenResult?.access_token) {
      return res.status(503).json({
        error: 'agent_cc_token_failed',
        message: 'Failed to obtain agent credentials from PingOne.',
        agentConfigured: false
      });
    }
    req.recordTokenEvent('agent_cc_token_obtained', {
      scope: 'banking:mcp:invoke',
      expiresIn: ccTokenResult.expires_in
    });

    // Step 5–10: Request available tools from Agent Gateway
    const agentGatewayClient = require('../services/agentGatewayClient');
    const toolsResult = await agentGatewayClient.getAvailableTools(req, ccTokenResult.access_token);
    if (!toolsResult?.tools) {
      return res.status(503).json({
        error: 'tools_list_failed',
        message: 'Failed to fetch available tools from Agent Gateway.',
        agentConfigured: false
      });
    }
    
    // Merge token events from all hops
    const allTokenEvents = [
      ...(req.tokenEvents || []),
      ...(toolsResult.tokenEvents || [])
    ];

    // Return initialized agent with available tools
    res.json({
      sessionId: req.session.id,
      initialized: true,
      agentReady: true,
      agentConfigured: true,
      availableTools: toolsResult.tools,
      tokenEvents: allTokenEvents
    });
  } catch (error) {
    console.error('[banking-agent/init] error:', error.message);
    res.status(500).json({
      error: 'agent_init_failed',
      message: error.message,
      agentConfigured: false
    });
  }
});
```

---

## Mapping to i4ai Diagram

| Step | Actor | Action | File | Notes |
|------|-------|--------|------|-------|
| 1 | User | Submit prompt | (client-side) | Not in BFF scope |
| 2 | Chatbot | Hand off to Agent | (client-side) | Not in BFF scope |
| 3 | Agent | Request CC token | `agentCCTokenService.js` | `POST /as/token (client_credentials)` |
| 4 | PingOne | Return CC token | (external) | Token event logged |
| 5 | Agent | Request tools/list | `agentGatewayClient.js` | JSON-RPC to Agent Gateway |
| 6 | Agent Gateway | Check auth with PA | (external) | Handled by gateway |
| 7 | Ping Authorize | Get all tools | (external) | Calls MCP for full catalog |
| 8 | MCP | Return tools | (external) | Handled by MCP |
| 9 | Ping Authorize | Introspect token | (external) | Handled by PA |
| 10 | PingOne | Return claims | (external) | Token claims (sub, aud, scope) |
| 11 | Ping Authorize | Filter by scope | (external) | Fine-grained policy evaluation |
| 12 | Agent Gateway | Return tool list | `agentGatewayClient.js` | Permitted tools to Agent |

---

## Error Handling (Happy Path + 403)

### Happy Path
- ✓ User authenticated (checked in `agentSessionMiddleware`)
- ✓ Agent CC token obtained
- ✓ Tools list fetched from Agent Gateway
- ✓ Available tools returned to client

### 403 Deny (Agent tries to call tool without subject token)
- This occurs later in the flow (steps 14–17 in the diagram)
- **Not part of this phase** — handled in Phase 2 (RFC 8693 token exchange)
- Error paths in existing code are preserved

### Errors in `/init` (early failures)
- Agent not configured (missing `pingone_mcp_token_exchanger_client_id`)
- CC token request fails (PingOne unreachable)
- Agent Gateway unreachable
- Ping Authorize policy evaluation fails

---

## Files to Create / Modify

| File | Action | Status |
|------|--------|--------|
| `banking_api_server/services/agentCCTokenService.js` | **Create** | Pending |
| `banking_api_server/services/agentGatewayClient.js` | **Create** | Pending |
| `banking_api_server/routes/bankingAgentRoutes.js` | **Modify** | Pending |
| `banking_api_server/middleware/agentSessionMiddleware.js` | **No change** | ✓ (already valid) |

---

## Verification Steps

1. **CC Token Acquisition**
   - Set `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` + secret in .env
   - Call `POST /api/banking-agent/init` with valid session
   - Verify token event logged: `agent_cc_token_obtained`
   - Check Agent Gateway has valid token

2. **Tools/List Request**
   - Agent Gateway receives `tools/list` with agent CC token
   - Ping Authorize validates token and returns permitted tools
   - Response includes tool definitions (name, description, schema)

3. **Response Structure**
   - `sessionId`: matches request
   - `initialized: true`
   - `agentReady: true`
   - `agentConfigured: true` (new)
   - `availableTools`: array of tool objects (new)
   - `tokenEvents`: array with `agent_cc_token_obtained` event (new)

4. **No Regression**
   - Existing error paths preserved (agent not configured, session expired)
   - Other `/api/banking-agent/*` routes unaffected
   - `/api/banking-agent/message` route still works

---

## Success Criteria

- [ ] `agentCCTokenService.js` created with `getAgentCCToken()` function
- [ ] `agentGatewayClient.js` created with `getAvailableTools()` function
- [ ] `POST /api/banking-agent/init` updated to execute steps 3–10
- [ ] Token events logged for each hop (CC token + tools/list)
- [ ] Available tools returned in response
- [ ] `npm run build` succeeds in `banking_api_ui/`
- [ ] No regressions in other banking agent routes
- [ ] Error handling for missing agent config, unreachable gateway, etc.
