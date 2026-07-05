# /mcp/apikey Endpoint — P1AZ Authorization Integration

## Overview

The `/mcp/apikey` endpoint provides API-key-authenticated access to MCP tools, with **per-tool authorization** enforced by **PingOne Authorize (P1AZ)** decisions.

**Routing:** `POST /mcp/apikey` → PingGateway (`00-mcp-apikey.json`) → MCP server

## Authorization Flow

```
POST /mcp/apikey
  ↓
1. apikey-dispatch.groovy: Validate X-API-Key header
  ↓
2. API key → lookup user/service identity
  ↓
3. Create synthetic bearer token (signed JWT) for introspection
  ↓
4. PingGateway RsFilterTokenResolver: Introspect token
  ↓
5. Per-tool scope check: Enforce X-MCP-Tool scope requirement
  ↓
6. P1AZ decision point (if configured): Additional per-tool policy gating
  ↓
7. Forward to MCP server with validated scopes/authorization
```

## 9 MCP Tools — P1AZ Gating

The following 9 tools must be gated by P1AZ **consent** or **step-up** challenges:

### Consent Tools (HITL required)
- `create_transfer` — high-value fund transfer
- `get_sensitive_account_details` — sensitive personal data (requires explicit consent)
- `book_appointment` — create banking appointment

### Step-Up Tools (MFA required)
- `create_deposit` — deposit funds
- `create_withdrawal` — withdraw funds
- `release_*` — release holds/blocks (any tool matching `release_*`)
- `sensitive_*` — sensitive operations (any tool matching `sensitive_*`)

### Tool-Name Gating

These tools declare a `challengeType` in `scope-topology.json`:

```json
"tools": {
  "create_transfer": {
    "requiredScopes": ["write", "transfer"],
    "challengeType": "consent"
  },
  "create_deposit": {
    "requiredScopes": ["write"],
    "challengeType": "step_up"
  }
}
```

The `challengeType` field tells P1AZ to:
- **`consent`** → HITL (428 response, user approval required)
- **`step_up`** → Step-up MFA (if ACR insufficient for the amount)

## Configuration

### 1. API Key Store

Set `VALID_API_KEYS` in PingGateway environment:

```bash
export VALID_API_KEYS="sk-demo-key-001,sk-demo-key-002,sk-prod-key-003"
```

Each comma-separated key is valid for the entire /mcp/apikey endpoint.

### 2. API Key → User/Service Mapping

In production, map each API key to a PingOne user or service account:

**Option A: Hardcoded (demo)**
```groovy
// In apikey-dispatch.groovy
def keyToUserMap = [
  'sk-demo-key-001': 'demo-user-1@example.com',
  'sk-demo-key-002': 'service-account-2',
]
def userId = keyToUserMap[apiKey]
```

**Option B: External lookup (production)**
```groovy
def userId = externalApiKeyService.lookupUser(apiKey)
if (!userId) {
  // invalid or expired key
  return Response.status(403).build()
}
```

### 3. Bearer Token Generation

After validating the API key, create a signed JWT that:
- **subject** (`sub`) → the mapped user ID
- **audience** (`aud`) → the MCP Gateway resource URI (`mcpgateway.ping.demo`)
- **scopes** (`scope`) → the tool's required scopes (from scope-topology.json)
- **signed** by → the API-key service's private key (or BFF key for demo)

Example (Node.js):
```javascript
const jwt = require('jsonwebtoken');
const token = jwt.sign({
  sub: userId,
  aud: 'mcpgateway.ping.demo',
  scope: 'read write mcp:invoke',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
}, apiKeyServicePrivateKey);
```

Then replace the `X-API-Key` header with the `Authorization: Bearer <token>`:

```groovy
request.headers.put('Authorization', 'Bearer ' + signedToken)
request.headers.remove(apiKeyHeader)
```

### 4. Per-Tool Scope Enforcement

PingGateway's `RsFilterTokenResolver` enforces per-tool scopes by:
1. Introspecting the bearer token (via `PINGONE_INTROSPECTION_ENDPOINT`)
2. Extracting the `scope` claim
3. Comparing against the tool's `requiredScopes` in scope-topology.json
4. Returning **403 Forbidden** if scopes are insufficient

**Example:** If the token has `scope: 'read'` and the tool requires `['write', 'transfer']`, PingGateway returns 403.

### 5. P1AZ Decision Point

When `PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID` is set, PingGateway can invoke P1AZ **after** token validation to make per-tool authorization decisions (e.g., amount-based consent, group membership).

To enable:
```bash
export PINGONE_AUTHORIZE_ENABLED=true
export PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID=<endpoint-id>
export PINGONE_AUTHORIZE_WORKER_CLIENT_ID=<client-id>
export PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET=<secret>
```

Then add a `P1AZDecisionFilter` to the `00-mcp-apikey.json` route **before** the MCP server handler:

```json
{
  "name": "P1AZDecisionGate",
  "type": "ScriptableFilter",
  "config": {
    "type": "application/x-groovy",
    "file": "scripts/groovy/p1az-decision.groovy"
  }
}
```

The `p1az-decision.groovy` filter:
- Extracts the `X-MCP-Tool` header (tool name)
- Looks up `challengeType` from scope-topology.json
- Invokes P1AZ with the tool's challenge type
- Returns 428 (HITL) or 403 (DENY) on policy rejection

## Testing

### 1. Valid API Key, Permitted Tool

```bash
curl -X POST https://api.ping.demo:3036/mcp/apikey \
  -H "X-API-Key: sk-demo-key-001" \
  -H "X-MCP-Tool: get_my_accounts" \
  -H "Content-Type: application/json" \
  -d '{"params": {}}'

# Expected: 200 OK + tool result
```

### 2. Invalid API Key

```bash
curl -X POST https://api.ping.demo:3036/mcp/apikey \
  -H "X-API-Key: invalid-key" \
  -H "X-MCP-Tool: get_my_accounts" \
  -d '{}'

# Expected: 403 Forbidden + { code: 'forbidden', message: 'Invalid API key' }
```

### 3. Consent Tool (expects 428 HITL)

```bash
curl -X POST https://api.ping.demo:3036/mcp/apikey \
  -H "X-API-Key: sk-demo-key-001" \
  -H "X-MCP-Tool: create_transfer" \
  -H "Content-Type: application/json" \
  -d '{"params": {"amount": 500, "to": "user-2"}}'

# Expected: 428 Precondition Required + { code: 'hitl_required', taskId: '...' }
```

### 4. Step-Up Tool (amount-based ACR check)

```bash
curl -X POST https://api.ping.demo:3036/mcp/apikey \
  -H "X-API-Key: sk-demo-key-001" \
  -H "X-MCP-Tool: create_withdrawal" \
  -H "Content-Type: application/json" \
  -d '{"params": {"amount": 3000}}'

# Expected (if amount > $2000 and ACR < 2):
#   428 Precondition Required + { code: 'stepup_required', ... }
```

## Migration Path

### Phase 1: API Key Validation Only
- Implement `apikey-dispatch.groovy` validation (current)
- Forward to MCP server with API-key-mapped user context
- PingGateway introspection + scope gating enforces per-tool access

### Phase 2: Bearer Token Generation
- Map API keys to PingOne users/service accounts
- Generate signed JWTs on each request
- Introspection validates signature + claims

### Phase 3: P1AZ Integration
- Wire `p1az-decision.groovy` filter
- Invoke P1AZ on consent/step-up tools
- Return 428/403 on policy denial

## References

- **scope-topology.json** — tool policies, scopes, challenge types
- **p1az-decision.groovy** — existing P1AZ decision filter (model)
- **RFC 8693** — token exchange flow (user subject → API-key context)
