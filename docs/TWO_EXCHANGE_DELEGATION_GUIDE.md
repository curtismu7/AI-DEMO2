# Two-Exchange Delegation Flow Guide

> **Note**: This guide describes the **optional** two-exchange delegation mode, activated when `_performTwoExchangeDelegation` is invoked. The **default production path** is a single BFF exchange. The two-exchange path is for specific delegation scenarios where a full RFC 8693 nested act chain is required.

## What is Two-Exchange Delegation?

Two-exchange delegation (RFC 8693 §2.3) allows an AI Agent to act on behalf of a user by executing a 4-step token exchange flow:

1. **AI Agent obtains actor credentials** (client credentials)
2. **First Exchange**: User token + AI Agent actor → intermediate token with `act.sub = AI_AGENT`
3. **MCP obtains actor credentials** (client credentials)
4. **Second Exchange**: Intermediate token + MCP actor → final token with nested act claims

The final token contains a **delegation chain** proving: "MCP acted on behalf of AI Agent which acted on behalf of User"

---

## Terminology

| Term | Definition | Example |
|------|-----------|---------|
| **Subject Token** | Original user access token | User's OAuth 2.0 access token |
| **Actor Token** | Credentials of entity acting on behalf | AI Agent's client credentials token |
| **Exchanged Token** | Token resulting from exchange | Token with `act.sub` claim |
| **act Claim** | Nested structure indicating delegation chain | `{act: {sub: "mcp-id", act: {sub: "agent-id"}}}` |
| **Audience (aud)** | Resource that token can be used for | `https://mcp-resource-server.example.com` |
| **Scope** | Permissions granted by token | `get_accounts:read transfer:execute` |
| **may_act** | User's authorization for AI Agent to act | `{sub: "ai-agent-client-id"}` |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Two-Exchange Delegation Flow                │
└─────────────────────────────────────────────────────────────────┘

STEP 1: AI Agent Actor Token Acquisition
├─ Input: PINGONE_AI_AGENT_CLIENT_ID + SECRET
├─ Method: OAuth 2.0 Client Credentials grant
├─ Output: agentActorToken (JWT with aud=agent_gateway)
└─ PingOne App: Super Banking AI Agent

STEP 2: First Exchange (User Token + Agent Actor → Agent Exchanged Token)
├─ Input:
│  ├─ subject_token = User access token (contains may_act.sub=AI_AGENT)
│  ├─ actor_token = agentActorToken from Step 1
│  └─ audience = AI_AGENT_INTERMEDIATE_AUDIENCE
├─ Validation: RFC 8693 may_act.sub must equal actor_token.sub
├─ Output: agentExchangedToken (JWT with act.sub=AI_AGENT_CLIENT_ID)
└─ RFC 8693 Section: §2.3 (Delegation)

STEP 3: MCP Actor Token Acquisition
├─ Input: AGENT_OAUTH_CLIENT_ID + SECRET
├─ Method: OAuth 2.0 Client Credentials grant
├─ Output: mcpActorToken (JWT with aud=mcp_gateway)
└─ PingOne App: MCP Token Exchanger

STEP 4: Second Exchange (Agent Token + MCP Actor → Final Token with Nested Act)
├─ Input:
│  ├─ subject_token = agentExchangedToken from Step 2
│  ├─ actor_token = mcpActorToken from Step 3
│  └─ audience = PINGONE_RESOURCE_TWO_EXCHANGE_URI
├─ Validation: act.sub (from Step 2 token) must equal actor_token.aud[0] (MCP)
├─ Output: finalToken (JWT with nested act structure)
│  └─ Contains: {act: {sub: "mcp-id", act: {sub: "agent-id"}}}
└─ RFC 8693 Section: §2.3 (Nested Delegation)

FINAL TOKEN DELIVERED TO
├─ MCP Server (audience = PINGONE_RESOURCE_TWO_EXCHANGE_URI)
└─ Contains proof: "MCP → AI Agent → User"
```

---

## The Four Exchange Steps (Detailed)

### Step 1: AI Agent Actor Token Acquisition

**Purpose**: Get client credentials token proving the AI Agent is authorized to act

**Configuration Required**:
```
PINGONE_AI_AGENT_CLIENT_ID          # Super Banking AI Agent client ID
PINGONE_AI_AGENT_CLIENT_SECRET      # Super Banking AI Agent client secret
PINGONE_RESOURCE_AGENT_GATEWAY_URI      # Resource indicator (audience) for Step 1
```

**PingOne Setup**:
- Create application: "Super Banking AI Agent"
- Grant type: Client Credentials
- Resource Indicators: `PINGONE_RESOURCE_AGENT_GATEWAY_URI`

**HTTP Request**:
```bash
POST /as/token HTTP/1.1
Host: auth.pingone.com
Content-Type: application/x-www-form-urlencoded

client_id=PINGONE_AI_AGENT_CLIENT_ID
&client_secret=PINGONE_AI_AGENT_CLIENT_SECRET
&grant_type=client_credentials
&audience=PINGONE_RESOURCE_AGENT_GATEWAY_URI
```

**Success Response**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Token Contents**:
```json
{
  "iss": "https://auth.pingone.com/...",
  "sub": "PINGONE_AI_AGENT_CLIENT_ID",
  "aud": "PINGONE_RESOURCE_AGENT_GATEWAY_URI",
  "client_id": "PINGONE_AI_AGENT_CLIENT_ID",
  "scope": "..."
}
```

**Error Conditions**:

| Error | Cause | Remedy |
|-------|-------|--------|
| `invalid_client` | AI Agent app not registered | Register in PingOne Admin → Applications |
| `invalid_scope` | Audience not configured for app | Add PINGONE_RESOURCE_AGENT_GATEWAY_URI to Resource Indicators |
| `unauthorized` | Invalid client credentials | Verify CLIENT_ID/SECRET match app settings |

---

### Step 2: First Exchange (User Token + Agent Actor → Intermediate Token)

**Purpose**: Prove user authorized AI Agent to act, get token with `act.sub = AI_AGENT_CLIENT_ID`

**Configuration Required**:
```
AI_AGENT_INTERMEDIATE_AUDIENCE  # Audience for Step 2 output token
```

**Precondition - RFC 8693 may_act**:
User's original token MUST contain: `may_act: {sub: "PINGONE_AI_AGENT_CLIENT_ID"}`

User can set this via `POST /api/mcp/exchange-mode` (controlled by `ExchangeModeContext.js` in the UI)

**HTTP Request**:
```bash
POST /as/token HTTP/1.1
Host: auth.pingone.com
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token={userAccessToken}
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&actor_token={agentActorToken}
&actor_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=AI_AGENT_INTERMEDIATE_AUDIENCE
```

**RFC 8693 Validation** (performed by PingOne):
1. Extract `may_act` from subject_token
2. Verify: `may_act.sub == actor_token.sub`
3. If not equal → return `unauthorized` error

**Success Response**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Token Contents**:
```json
{
  "sub": "user-id",
  "aud": "AI_AGENT_INTERMEDIATE_AUDIENCE",
  "act": {
    "sub": "PINGONE_AI_AGENT_CLIENT_ID"
  },
  "scope": "get_accounts:read transfer:execute"
}
```

**Error Conditions**:

| Error | Cause | Remedy |
|-------|-------|--------|
| `unauthorized` | may_act.sub ≠ AI_AGENT_CLIENT_ID | Set user's may_act via `POST /api/mcp/exchange-mode` |
| `invalid_grant` | User lacks may_act claim entirely | Add may_act attribute to user record |
| `invalid_request` | Wrong grant type or missing fields | See HTTP Request template above |

---

### Step 3: MCP Actor Token Acquisition

**Purpose**: Get client credentials token for MCP Exchanger to act

**Configuration Required**:
```
AGENT_OAUTH_CLIENT_ID               # MCP Token Exchanger client ID
AGENT_OAUTH_CLIENT_SECRET           # MCP Token Exchanger client secret
PINGONE_RESOURCE_MCP_GATEWAY_URI        # Resource indicator (audience) for Step 3
```

**PingOne Setup**:
- Create application: "MCP Token Exchanger"
- Grant type: Client Credentials
- Resource Indicators: `PINGONE_RESOURCE_MCP_GATEWAY_URI`

**HTTP Request**: (Same format as Step 1)
```bash
POST /as/token HTTP/1.1
Host: auth.pingone.com

client_id=AGENT_OAUTH_CLIENT_ID
&client_secret=AGENT_OAUTH_CLIENT_SECRET
&grant_type=client_credentials
&audience=PINGONE_RESOURCE_MCP_GATEWAY_URI
```

**Success Response**: Similar to Step 1

**Error Conditions**: Same as Step 1 (see table above)

---

### Step 4: Second Exchange (Intermediate + MCP Actor → Final Token with Nested Act)

**Purpose**: Get final token for MCP with full delegation chain (nested act structure)

**Configuration Required**:
```
PINGONE_RESOURCE_TWO_EXCHANGE_URI  # Final resource server audience
```

**HTTP Request**:
```bash
POST /as/token HTTP/1.1
Host: auth.pingone.com
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token={agentExchangedToken}
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&actor_token={mcpActorToken}
&actor_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=PINGONE_RESOURCE_TWO_EXCHANGE_URI
```

**RFC 8693 Validation** (performed by PingOne):
1. Extract `act.sub` from subject_token (from Step 2)
2. Verify: `act.sub == actor_token.aud[0]` (MCP client ID)
3. Create nested act structure
4. If validation fails → return `invalid_grant` error

**Success Response**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Token Contents** (Final Token with Nested Act):
```json
{
  "sub": "user-id",
  "aud": "PINGONE_RESOURCE_TWO_EXCHANGE_URI",
  "scope": "get_accounts:read transfer:execute",
  "act": {
    "sub": "mcp-client-id",
    "act": {
      "sub": "ai-agent-client-id"
    }
  }
}
```

**Error Conditions**:

| Error | Cause | Remedy |
|-------|-------|--------|
| `invalid_grant` | act.sub from Step 2 ≠ MCP client ID | Verify AGENT_OAUTH_CLIENT_ID matches MCP Token Exchanger |
| `invalid_grant` | Exchange #2 subject token invalid | Check Step 2 token is valid and not expired |
| `invalid_request` | Missing or malformed audience | Verify PINGONE_RESOURCE_TWO_EXCHANGE_URI is set |

---

## Understanding Nested Act Claims

### Single Exchange (User → Resource)

**Flow**: User token is exchanged for resource token

**Token Structure**:
```json
{
  "sub": "user-id",
  "aud": "resource-server",
  "scope": "get_accounts:read transfer:execute",
  "iat": 1712702400
}
```

**Interpretation**: User has permissions on resource-server

---

### Two-Exchange (User → AI Agent → MCP → Resource)

**Flow**: User token + AI Agent → intermediate token + MCP → final token with nested act

**Token Structure**:
```json
{
  "sub": "user-id",
  "aud": "mcp-resource-server",
  "scope": "get_accounts:read transfer:execute",
  "act": {
    "sub": "mcp-client-id",
    "act": {
      "sub": "ai-agent-client-id"
    }
  },
  "iat": 1712702400
}
```

> **Known limitation**: PingOne's SpEL evaluation may produce only single-level nesting (`act.sub` = mcp-client-id, without the inner `act`) due to a known PingOne constraint. The code in `agentMcpTokenService.js` documents this. Validate the actual token structure in your environment rather than assuming double-nesting.

**Reading the Act Chain** (inside-out):
1. **Innermost act.sub**: `"ai-agent-client-id"` — AI Agent initiated the action
2. **Middle act.sub**: `"mcp-client-id"` — MCP is acting for the AI Agent
3. **Outermost sub**: `"user-id"` — Original user being represented

**Chain Interpretation**: 
```
Resource Access Chain: User → AI Agent → MCP → Resource
Act Proof: MCP acted for AI Agent which acted for User
```

---

## Configuration Checklist

Before enabling two-exchange mode, verify all settings:

- [ ] **PingOne Admin**: Create "Super Banking AI Agent" app (Client Credentials)
- [ ] **PingOne Admin**: Create "MCP Token Exchanger" app (Client Credentials)
- [ ] **PingOne Admin**: Set Resource Indicators (audiences) for both apps
- [ ] **PingOne Admin**: Super Banking Resource Server has act expression for nested claims
- [ ] **Environment**: Set PINGONE_AI_AGENT_CLIENT_ID (from Super Banking AI Agent app)
- [ ] **Environment**: Set PINGONE_AI_AGENT_CLIENT_SECRET (from Super Banking AI Agent app)
- [ ] **Environment**: Set AGENT_OAUTH_CLIENT_ID (from MCP Token Exchanger app)
- [ ] **Environment**: Set AGENT_OAUTH_CLIENT_SECRET (from MCP Token Exchanger app)
- [ ] **Environment**: Set 4 audience variables:
  - [ ] `PINGONE_RESOURCE_AGENT_GATEWAY_URI`
  - [ ] `AI_AGENT_INTERMEDIATE_AUDIENCE`
  - [ ] `PINGONE_RESOURCE_MCP_GATEWAY_URI`
  - [ ] `PINGONE_RESOURCE_TWO_EXCHANGE_URI`
- [ ] **Admin UI**: Navigate to Configuration page and verify all fields populated
- [ ] **Test**: Toggle to 2-Exchange mode and verify agent operation succeeds
- [ ] **Verification**: Check token inspector shows nested act claims

---

## Troubleshooting Decision Tree

### Symptom: "Two-Exchange Not Configured"

```
Is "Enable Two-Exchange" toggle ON in Admin UI?
├─ NO → Turn it on and retry
└─ YES
    ├─ Check error message in browser console
    └─ Follow specific error remedy below
```

### Symptom: Exchange #1 Fails (may_act.sub missing)

```
User is in "2-Exchange Mode"?
├─ NO → Set exchange mode via `POST /api/mcp/exchange-mode` (ExchangeModeContext.js)
└─ YES
    └─ Wait 30 seconds (token refresh time) and retry
```

### Symptom: Exchange #2 Fails (act.sub mismatch)

```
AGENT_OAUTH_CLIENT_ID = MCP Token Exchanger app client ID?
├─ NO → Update AGENT_OAUTH_CLIENT_ID and restart
└─ YES
    └─ Check PINGONE_RESOURCE_MCP_GATEWAY_URI matches app's Resource Indicator
```

### Symptom: Invalid Client Error (Any Step)

```
Exchange step requesting customer.com/?
├─ Step 1 → Check PINGONE_AI_AGENT_CLIENT_ID exists in PingOne Admin
├─ Step 3 → Check AGENT_OAUTH_CLIENT_ID exists in PingOne Admin
└─ All steps → Verify CLIENT_SECRET is current (no rotation issues)
```

---

## References

- **RFC 8693**: OAuth 2.0 Token Exchange — https://tools.ietf.org/html/rfc8693
- **RFC 8693 §2.1**: Token Exchange Basics
- **RFC 8693 §2.3**: Delegation (nested act)
- **RFC 8693 §3**: Access Token Attributes
- **RFC 8693 §5.2**: Error Responses

See also:
- [ENV_VARS.md](user-guide/ENV_VARS.md) — Environment variables and validation
- [SECURITY_ANALYSIS.md](SECURITY_ANALYSIS.md) — Threat model and mitigations
- [RFC8693_COMPLIANCE_REPORT.md](RFC8693_COMPLIANCE_REPORT.md) — Compliance evidence
