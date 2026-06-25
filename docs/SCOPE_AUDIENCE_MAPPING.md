# Scope-Audience Mapping Reference (RFC 8707)

> **Canonical audience values** are maintained in [`docs/PINGONE_CONFIG.md`](user-guide/PINGONE_CONFIG.md).
> This document provides conceptual context; `PINGONE_CONFIG.md` is the source of truth for actual audience strings and resource IDs.

## Overview

This document maps each OAuth scope to the audiences where it can be applied per RFC 8707 "OAuth 2.0 Resource Indicators" and RFC 8693 token exchange.

Scope-to-audience mapping is explicit and mandatory. All scopes for a token exchange must be valid for the target audience. Scopes cannot be escalated — only maintained or narrowed.

## Scope-Audience Mapping Table

### End-User Banking API (Standard 1-Exchange)
Audience: `enduser.ping.demo` (configurable via `PINGONE_AUDIENCE_ENDUSER`)  
Resource: Super Banking API  
Purpose: User access to banking operations (accounts, transactions)

| Scope | Purpose | Valid |
|-------|---------|-------|
| banking:read | Read accounts and transactions | ✅ Yes |
| banking:write | Create transactions (transfers, deposits, withdrawals) | ✅ Yes |
| banking:accounts:read | Specific account read access (narrowing) | ✅ Yes |
| banking:transactions:read | Specific transaction read access (narrowing) | ✅ Yes |
| banking:transactions:write | Specific transaction write access (narrowing) | ✅ Yes |
| banking:agent:invoke | Agent delegation (not valid for end-user directly) | ❌ No |
| banking:mcp:invoke | MCP authorization (not for end-user) | ❌ No |

### Agent Gateway (2-Exchange Step 1)
Audience: `agentgateway.ping.demo` (configurable via `PINGONE_RESOURCE_AGENT_GATEWAY_URI`)  
Resource: Super Banking Agent Gateway  
OAuth app: `PINGONE_AI_AGENT_CLIENT_ID` (worker/service account)  
Purpose: Initial actor token for agent delegation chain

| Scope | Purpose | Valid |
|-------|---------|-------|
| banking:agent:invoke | AI Agent authorization | ✅ Yes |
| ai_agent | AI Agent authorization (legacy) | ✅ Yes |
| banking:read | User data access (not valid for agent actor) | ❌ No |
| transfer:execute | Transfer permission (not for agent actor) | ❌ No |
| banking:mcp:invoke | MCP authorization (used later) | ❌ No |

### AI Agent Intermediate (2-Exchange Step 2)
Audience: `agentgateway.ping.demo` (configurable via `PINGONE_AUDIENCE_AI_AGENT` or `AI_AGENT_INTERMEDIATE_AUDIENCE`)  
Resource: Super Banking AI Agent Service  
OAuth resource server: Receives on-behalf-of delegation token  
Purpose: Intermediate token in delegation chain; subject = user, actor = agent

| Scope | Purpose | Valid |
|-------|---------|-------|
| banking:read | User account/transaction reading | ✅ Yes |
| banking:write | User data modification | ✅ Yes |
| banking:agent:invoke | Delegation scope (inherited from actor) | ✅ Yes |
| banking:accounts:read | Specific read access (narrowing) | ✅ Yes |
| banking:transactions:read | Transaction read access (narrowing) | ✅ Yes |
| banking:transactions:write | Transaction write access (narrowing) | ✅ Yes |
| transfer:execute | Transfer permission (narrowing) | ❌ No (would be escalation) |
| banking:mcp:invoke | MCP authorization (used in step 3) | ❌ No (used in next step) |

### MCP Gateway (2-Exchange Step 3)
Audience: `mcpgateway.ping.demo` (configurable via `PINGONE_RESOURCE_MCP_GATEWAY_URI`)  
Resource: Super Banking MCP Gateway  
OAuth app: MCP Gateway service  
Purpose: Actor token for final MCP resource server exchange

| Scope | Purpose | Valid |
|-------|---------|-------|
| banking:mcp:invoke | MCP authorization | ✅ Yes |
| mcp_resource_access | Resource access token | ✅ Yes |
| banking:ai:agent:read | AI agent read narrowing | ✅ Yes |
| banking:ai:agent:write | AI agent write narrowing | ✅ Yes |
| banking:read | User data access (not for MCP actor) | ❌ No |
| banking:write | User data modification (not for MCP actor) | ❌ No |

### MCP Resource Server (Final Token - Both Exchanges)
Audience: `mcpserver.ping.demo` (configurable via `PINGONE_RESOURCE_MCP_SERVER_URI`)  
Resource: Super Banking MCP Server  
Resource server: Accepts RFC 8693 token exchange; validates scopes per MCP tool requirements  
Purpose: Authorization for MCP tool execution; scopes identify which tools are callable

| Scope | Purpose | Valid |
|-------|---------|-------|
| get_accounts:read | List user accounts via tool | ✅ Yes |
| transfer:execute | Execute transfer tool | ✅ Yes |
| check:read | Execute check reading tool | ✅ Yes |
| banking:accounts:read | Specific account access (narrowed) | ✅ Yes |
| banking:transactions:read | Transaction read narrowing | ✅ Yes |
| banking:transactions:write | Transaction write narrowing | ✅ Yes |
| banking:ai:agent:read | AI agent read authority (narrowed) | ✅ Yes |
| banking:ai:agent:write | AI agent write authority (narrowed) | ✅ Yes |
| banking:read | Generic banking (will be narrowed) | ℹ️ Narrowed to specific scopes |
| banking:agent:invoke | Agent delegation (not for resource server) | ❌ No |

### 2-Exchange Final Resource (Alternative Path)
Audience: `mcpserver.ping.demo` (configurable via `PINGONE_RESOURCE_TWO_EXCHANGE_URI`)  
Resource: Super Banking Resource Server  
Purpose: Alternative final audience for 2-exchange; differs from MCP server for compliance/multi-resource scenarios

| Scope | Purpose | Valid |
|-------|---------|-------|
| get_accounts:read | List accounts | ✅ Yes |
| transfer:execute | Execute transfer | ✅ Yes |
| check:read | Execute check read | ✅ Yes |
| banking:accounts:read | Specific account narrowing | ✅ Yes |
| banking:transactions:read | Transaction read narrowing | ✅ Yes |
| banking:transactions:write | Transaction write narrowing | ✅ Yes |
| banking:ai:agent:read | AI agent authority (narrowed) | ✅ Yes |
| banking:ai:agent:write | AI agent authority (narrowed) | ✅ Yes |

## Validation Rules

1. **No Scope Escalation**: Scopes can only be maintained or narrowed, never escalated
2. **Audience-based Filtering**: Only scopes valid for the target audience are included in token exchange requests
3. **Explicit Allow List**: Only scopes in the allowlist for an audience are permitted
4. **No Hard-Coded Defaults**: Missing scopes result in explicit error, not silent fallback w/ generic scope
5. **Narrowing is Logged**: Events logged when scopes are narrowed during token exchange
6. **Validation at Every Step**: Each hop in the two-exchange flow validates scopes for the target audience

## Configuration

The scope-audience mapping is now configured dynamically in `banking_api_server/services/configStore.js`:

**Function**: `buildAllowedScopesByAudience()` — Builds the mapping from environment variables  
**Function**: `validateScopeAudience(scopes, audience)` — Validates and narrows scopes for target audience

**How it works:**
1. At validation time, `buildAllowedScopesByAudience()` reads resource URIs from configStore
2. Maps each URI to its allowed scopes
3. `validateScopeAudience()` filters user scopes to only those valid for the target audience
4. Returns narrowed scopes (e.g., removes `transfer:execute` when narrowing to `get_accounts:read` for MCP)

**Environment Variables** (read by configStore):
```bash
PINGONE_AUDIENCE_ENDUSER=enduser.ping.demo
PINGONE_AUDIENCE_AI_AGENT=agentgateway.ping.demo
PINGONE_RESOURCE_AGENT_GATEWAY_URI=agentgateway.ping.demo
PINGONE_RESOURCE_MCP_GATEWAY_URI=mcpgateway.ping.demo
PINGONE_RESOURCE_MCP_SERVER_URI=mcpserver.ping.demo
PINGONE_RESOURCE_TWO_EXCHANGE_URI=mcpserver.ping.demo
```

**Usage Example:**

```javascript
const configStore = require('../services/configStore');

// Validate user scopes for end-user banking API
const result = configStore.validateScopeAudience(
  ['banking:read', 'banking:write', 'transfer:execute'],  // User's token scopes
  'enduser.ping.demo'                   // Target audience
);

// Returns: { valid: true, scopes: ['banking:read', 'banking:write', 'transfer:execute'], narrowed: false }
// (all three scopes are valid for this audience)

// Validate same scopes for MCP server (narrower audience)
const mcpResult = configStore.validateScopeAudience(
  ['banking:read', 'banking:write', 'transfer:execute'],
  'mcpserver.ping.demo'
);

// Returns: { valid: true, scopes: ['transfer:execute'], narrowed: true }
// (only transfer:execute is valid; banking:read/write are narrowed to specific tools)
```

## Examples

### Example 1: Correct Narrowing (1-Exchange to MCP)
```
User logs in → Gets token with scopes: [banking:read, banking:write, transfer:execute]
Agent calls: "Show my accounts" 
Target: mcpserver.ping.demo
Allowed for MCP: [get_accounts:read, transfer:execute, check:read]
Result Scopes: [transfer:execute] (banking:read/write narrowed to tool-specific)
Narrowed: true ✅
```

### Example 2: Valid 2-Exchange (Agent Gateway → AI Agent)
```
Agent app gets credential token with scopes: [banking:agent:invoke, ai_agent]
Exchange to: agentgateway.ping.demo
Allowed for AI Agent: [banking:read, banking:write, banking:agent:invoke]
Result Scopes: [banking:agent:invoke] (delegation maintained)
Narrowed: true ✅
```

### Example 3: Valid with No Narrowing (End-User Direct)
```
User token has: [banking:read, banking:write]
Target: enduser.ping.demo
Allowed for Banking API: [banking:read, banking:write, ...]
Result Scopes: [banking:read, banking:write] (all valid)
Narrowed: false ✅
```

### Example 4: Scope Escalation Detected ❌
```
User token has: [banking:read]  (no write permission)
Target: mcpserver.ping.demo
Attempts to call: create_transfer tool (requires transfer:execute)
Problem: User only has banking:read, cannot be escalated to transfer:execute
Result: ❌ SCOPE_MISMATCH Error
Message: "User scopes [banking:read] do not match allowed scopes for mcpserver.ping.demo"
```

### Example 5: Invalid Scope ❌
```
User token somehow has: [invalid:scope]
Target: agentgateway.ping.demo
Allowed for Agent Gateway: [banking:agent:invoke, ai_agent]
Result: ❌ SCOPE_MISMATCH Error
Message: "User scopes [invalid:scope] do not match allowed scopes for agentgateway.ping.demo [banking:agent:invoke, ai_agent]"
```

### Example 6: Unknown Audience (Graceful Degrade)
```
Target: https://unknown-resource.com
Not in ALLOWED_SCOPES_BY_AUDIENCE mapping
Result: { valid: true, scopes: [...all original...], narrowed: false, note: 'Unknown audience...' }
⚠️ Behavior: Allows requests but logs a warning
```

### Example 7: Empty Scope List ❌
```
User token has no scopes: []
Target: enduser.ping.demo
Result: ❌ SCOPE_ERROR
Message: "No scopes provided for audience enduser.ping.demo"
```
```

### Example 2: Maintaining Scopes
```
Step: MCP Gateway → MCP Resource Server
Current Scopes: [get_accounts:read]
Target Audience: https://resource.example.com/mcp
Allowed for Audience: [get_accounts:read, transfer:execute, check:read]
Exchange Scopes: [get_accounts:read]
Result: ✅ Success (no narrowing needed)
```

### Example 3: Invalid Scope
```
Step: User → Agent Gateway
User Token Scopes: [invalid:scope]
Target Audience: https://agent-gateway.example.com
Allowed for Audience: [banking:agent:invoke, ai_agent]
Exchange Scopes: None (0 matches)
Result: ❌ SCOPE_MISMATCH Error
Message: "User scopes [invalid:scope] do not match allowed scopes for https://agent-gateway.example.com [banking:agent:invoke, ai_agent]"
```

### Example 4: Unknown Audience
```
Target Audience: https://unknown.example.com
Allowed Audiences: [https://agent-gateway.example.com, ...]
Result: ❌ AUDIENCE_ERROR
Message: "Unknown audience https://unknown.example.com. Allowed audiences: [list...]"
```

### Example 5: Empty Scope List
```
User Token Scopes: [] (no scopes)
Target Audience: https://ai-agent-gateway.example.com
Result: ❌ SCOPE_ERROR
Message: "No scopes provided for audience https://ai-agent-gateway.example.com"
```

## Design Rationale

### Why Explicit Mapping?

Previous implementation used a 3-level fallback mechanism:
1. Try tool-specific scopes
2. Fall back to generic `banking:*` scopes
3. Fall back to tool candidate scopes

This was complex and hidden the actual scope validation logic. The fallback approach made it hard to:
- Understand which scopes would be requested
- Debug scope mismatch errors
- Ensure RFC 8693 compliance
- Validate scope constraints per audience

**Explicit mapping** replaces this with clear, documented rules.

### Why per-Audience?

RFC 8707 resource indicators allow servers to define which scopes apply to which resources. Different audiences often have different scope requirements:
- Agent Gateway expects delegation scopes (`banking:agent:invoke`)
- MCP Resource Server expects tool-specific scopes (`get_accounts:read`)

Audience-based filtering ensures:
- Scope validation matches resource requirements
- Token exchange policies are honored
- Scope narrowing is intentional (not accidental)

## Implementation: validateScopeAudience()

Located in `configStore.js`:

```javascript
/**
 * @param {string[]} scopes - OAuth scopes to validate
 * @param {string} audience - Target audience URI
 * @returns {object} { valid, scopes: narrowedScopes[], narrowed: boolean }
 * @throws {Error} if validation fails
 */
function validateScopeAudience(scopes, audience) {
  // 1. Check scopes list not empty
  if (!scopes || scopes.length === 0) {
    throw new Error(`SCOPE_ERROR: No scopes provided for audience ${audience}`);
  }

  // 2. Check audience is known
  const allowedForAudience = ALLOWED_SCOPES_BY_AUDIENCE[audience];
  if (!allowedForAudience) {
    throw new Error(
      `AUDIENCE_ERROR: Unknown audience ${audience}. ` +
      `Allowed audiences: ${Object.keys(ALLOWED_SCOPES_BY_AUDIENCE).join(', ')}`
    );
  }

  // 3. Filter scopes to those valid for this audience
  const validScopes = scopes.filter(s => 
    ALLOWED_SCOPES_BY_AUDIENCE[audience].includes(s)
  );

  // 4. Check at least one scope matched
  if (validScopes.length === 0) {
    throw new Error(
      `SCOPE_MISMATCH: User scopes [${scopes.join(', ')}] ` +
      `do not match allowed scopes for ${audience} ` +
      `[${ALLOWED_SCOPES_BY_AUDIENCE[audience].join(', ')}]`
    );
  }

  return {
    valid: true,
    scopes: validScopes,
    narrowed: validScopes.length < scopes.length,
  };
}
```

## Usage

### In agentMcpTokenService.js

```javascript
try {
  const scopeValidation = configStore.validateScopeAudience(
    Array.from(userTokenScopes),
    audienceFactory // https://ai-agent-gateway.example.com
  );
  
  const effectiveToolScopes = scopeValidation.scopes;
  
  if (scopeValidation.narrowed) {
    // Log narrowing event
    writeExchangeEvent({
      type: 'scope-narrowing',
      message: `Scopes narrowed from [...] to [...]`,
      originalScopes: userTokenScopes,
      narrowedScopes: effectiveToolScopes,
    });
  }
} catch (error) {
  // Handle validation failure
  throw new Error(`Scope validation failed: ${error.message}`);
}
```

## References

- **RFC 8693**: OAuth 2.0 Token Exchange — https://tools.ietf.org/html/rfc8693
  - Section 2.1: Implicit Token Flows
  - Section 2.2: Defining Resource Indicators
- **RFC 8707**: OAuth 2.0 Resource Indicators — https://tools.ietf.org/html/rfc8707
  - Section 2: Using Resource Indicators in Requests
  - Section 3: Interactions with Token Scope
- **Phase 56-04**: Scope & Audience Explicit Mapping
- **ENV_VARS.md**: Environment variable setup
- **configStore.js**: Implementation reference
