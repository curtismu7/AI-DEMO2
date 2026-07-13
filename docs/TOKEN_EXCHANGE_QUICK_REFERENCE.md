# Token Exchange: Quick Reference Guide

> 📚 **Part of the Token Exchange Learning Series**  
> **Deep Dive?** [Full architecture guide](TOKEN_EXCHANGE_ARCHITECTURE.md) • **Visual Learner?** [See diagrams](TOKEN_EXCHANGE_DIAGRAM.md) • **Onboarding?** [Use checklist](TOKEN_EXCHANGE_ONBOARDING.md)

## 30-Second Summary

**User tokens stay at the BFF. Agents get delegated tokens.**

```
User Token (at BFF)
    ↓ [RFC 8693 Exchange]
Delegated Token (to Agent)
    ↓ [Narrow Scope + act Claim]
Agent cannot bypass gateway
```

---

## The Flow (Visual)

```
┌─ BROWSER SIDE (Client) ──────────────────────────────────┐
│                                                           │
│  User Clicks "Get Accounts"                             │
│           ↓                                              │
│  fetch("/api/mcp/tool", { credentials: "include" })   │
│  (sends session cookie, NOT token in body)             │
│           ↓                                              │
│           ├→ Cookie contains: encrypted session          │
│           └→ Session contains: user token (server-side) │
│                                                           │
└───────────────────────────────────────────────────────────┘
                           ↓
┌─ BFF SIDE (Backend-for-Frontend) ────────────────────────┐
│                                                           │
│  Receive Request + Session Cookie                       │
│           ↓                                              │
│  Extract user token from session                        │
│  ✓ User token in safe location (server-side)           │
│           ↓                                              │
│  Perform RFC 8693 Token Exchange                        │
│  ┌─────────────────────────────────────────┐           │
│  │ PingOne OAuth Service                   │           │
│  │  Input: user_token + agent_client_creds │           │
│  │  Output: delegated_token (scoped)       │           │
│  └─────────────────────────────────────────┘           │
│           ↓                                              │
│  🔐 User token stays here                             │
│  📤 Delegated token goes forward                       │
│                                                           │
└───────────────────────────────────────────────────────────┘
                           ↓
┌─ MCP/GATEWAY SIDE ───────────────────────────────────────┐
│                                                           │
│  MCP Server receives delegated_token                    │
│  • Contains: sub=user, act=agent, scope=narrowed       │
│  • Cannot use it to access unrestricted APIs           │
│  • All calls go through gateway                        │
│           ↓                                              │
│  Gateway checks: Is agent allowed? Valid scope?        │
│  ✓ Yes → Execute tool                                  │
│  ✗ No → Deny + audit log                               │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

## Key Tokens Explained

### User's Original Token
```json
{
  "sub": "user-123",
  "aud": "https://api.banking",
  "scope": "read write email profile",
  "act": null
}
```
- **Who it's for:** The user
- **Where it lives:** BFF session (server-side only)
- **Who sees it:** Only the BFF
- **What it can do:** Full banking API access

### Delegated Token (What Agent Gets)
```json
{
  "sub": "user-123",
  "aud": "https://api.banking/mcp",
  "scope": "mcp:invoke read",
  "act": {
    "client_id": "agent-oauth-client-id"
  },
  "exp": 1689456789
}
```
- **Who it's for:** The user (via agent)
- **Where it lives:** In agent's request to MCP
- **Who sees it:** BFF, MCP, Gateway
- **What it can do:** Only MCP tools, narrow scope
- **Auditing:** `act` proves which agent is acting

---

## Code Locations

### Browser Side
📍 **File:** `demo_api_ui/src/services/demoAgentService.js`  
📍 **Line:** 280

```javascript
const response = await fetch("/api/mcp/tool", {
  method: "POST",
  credentials: "include",  // ← Send session cookie
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tool, params })
});
```

### BFF Handler
📍 **File:** `demo_api_server/server.js`  
📍 **Line:** 1678

```javascript
app.post('/api/mcp/tool', express.json(), requireSession, async (req, res) => {
  // Session contains user's token (server-side)
  // Perform RFC 8693 exchange
  // Send delegated token to MCP
});
```

### Token Exchange Logic
📍 **File:** `demo_api_server/services/agentMcpTokenService.js`  
📍 **Line:** 953-1354

```javascript
async function resolveMcpAccessTokenWithEvents(req, tool, opts = {}) {
  const userToken = getSessionBearerForMcp(req);  // Get from session
  // ... exchange logic ...
  return { token: delegatedToken, tokenEvents };  // Send delegated only
}
```

---

## Decision Tree: "Is This Secure?"

```
Question: Does the agent have access to the user's original token?

├─ YES (agent got user token directly)
│  └─ INSECURE ❌
│     • Agent can call any API
│     • Can bypass gateway
│     • No audit trail
│
└─ NO (agent got delegated token only)
   └─ SECURE ✅
      • Agent limited by scope
      • Gateway enforces policy
      • Act claim proves identity
      • Token is short-lived

Current Implementation: NO ✅
```

---

## Checklist: Token Exchange Verification

- [ ] BFF performs RFC 8693 exchange
- [ ] User token stored in server-side session
- [ ] Delegated token sent to MCP (not user token)
- [ ] Delegated token has act claim (agent identity)
- [ ] Delegated token has narrowed scope
- [ ] Delegated token has short expiry (< 10 min)
- [ ] Gateway validates delegated token
- [ ] Audit logs include `act.client_id`
- [ ] User token never appears in logs
- [ ] User token never sent to agent/browser

**AI-DEMO2 Status:** ✅ All checks passing

---

## Common Configurations

### ✅ Default (Production)
```
ff_skip_token_exchange = false
pingone_mcp_token_exchanger_client_id = [set]
pingone_mcp_token_exchanger_client_secret = [set]
```
→ Full RFC 8693 on-behalf-of exchange  
→ **Recommended for production**

### ⚠️ Bypass Mode (Demo Only)
```
ff_skip_token_exchange = true
```
→ User token forwarded directly  
→ **Do NOT use in production**

### 📊 Check Current Mode
```bash
curl -s http://localhost:3001/api/admin/config | grep ff_skip_token_exchange
# If unset or false → RFC 8693 is ON ✅
```

---

## Troubleshooting

### 🔴 Problem: "Agent has too much access"
**Root cause:** ff_skip_token_exchange is TRUE  
**Fix:** Set to FALSE (or leave unset)

### 🔴 Problem: "User token appears in agent logs"
**Root cause:** Token being forwarded instead of exchanged  
**Check:** `grep "Authorization.*Bearer" agent.log | wc -l`  
**Fix:** Verify token exchange is configured

### 🔴 Problem: "No audit trail of agent actions"
**Root cause:** Missing `act` claim  
**Check:** Look at delegated token's `act` field  
**Fix:** Ensure `pingone_mcp_token_exchanger_client_id` is set

### 🔴 Problem: "Gateway rejects delegated token"
**Root cause:** Scope mismatch or missing `mcp:invoke`  
**Check:** Verify `scope: "mcp:invoke read"` is in token  
**Fix:** Check token exchange scope resolution (lines 1235-1255)

---

## Three-Layer Security

### Layer 1: Session Cookies
```
Browser → BFF: Cookie (HTTP-only, encrypted)
         ↓
    User token is server-side only
```

### Layer 2: Token Exchange (RFC 8693)
```
BFF → PingOne: user_token + agent_credentials
            ↓
        Delegated token (scoped)
```

### Layer 3: Gateway Authorization
```
MCP → Gateway: Authorization: Bearer delegated_token
            ↓
        Check policies + scope + act claim
            ↓
        Permit or Deny
```

**If ANY layer fails, agent cannot act.** ✅

---

## What Agent CANNOT Do

- ❌ Access user's full permissions
- ❌ Call APIs outside MCP scope
- ❌ Bypass the authorization gateway
- ❌ Use token beyond expiry time (5 min)
- ❌ Use delegated token for different user
- ❌ Hide its identity (act claim is required)

---

## What Agent CAN Do

- ✅ Call MCP tools within scope
- ✅ Access only data user authorized
- ✅ Perform actions that match delegated token's scope
- ✅ Fail gracefully if denied by gateway
- ✅ Be audited (all actions linked to act.client_id)

---

## Key Files to Know

| Purpose | File | Key Function |
|---------|------|--------------|
| Browser-side call | `demoAgentService.js:280` | `callMcpTool()` |
| BFF handler | `server.js:1678` | POST `/api/mcp/tool` |
| Token exchange | `agentMcpTokenService.js:953` | `resolveMcpAccessTokenWithEvents()` |
| Session access | `mcpWebSocketClient.js` | `getSessionBearerForMcp()` |
| Gateway check | `mcpToolAuthorizationService.js` | `evaluateMcpFirstToolGate()` |
| Audit logging | `exchangeAuditStore.js` | `writeExchangeEvent()` |

---

## Remember

> **The user's token never leaves the BFF.  
> The agent only gets what it needs.  
> Everything is auditable.**

This is how you do credential delegation securely.
