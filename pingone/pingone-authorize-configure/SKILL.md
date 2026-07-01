---
name: pingone-authorize-configure
description: Configure the cloud PingOne Authorize policy for AI-Demo. Use when setting up or updating the Super Banking authorization policies, attributes, conditions, or rules in the cloud PingOne Authorize environment.
---

# PingOne Authorize Configuration Skill

Covers all configuration of the cloud PingOne Authorize (P1AZ) trust framework for AI-Demo. The authoritative snapshot is at `snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json`.

---

## Environment & Credentials

Read all three values from `demo_api_server/.env` — do NOT hardcode them here.
```
ENV_ID:        read PINGONE_ENVIRONMENT_ID from demo_api_server/.env
WORKER_ID:     read PINGONE_WORKER_CLIENT_ID from demo_api_server/.env
WORKER_SECRET: read PINGONE_WORKER_CLIENT_SECRET from demo_api_server/.env
AUTH_URL:      https://auth.pingone.com/${ENV_ID}/as/token
API_BASE:      https://api.pingone.com/v1/environments/${ENV_ID}
```

> **Never commit these literals into the skill; they live in `.env`.** If the previously-committed `WORKER_SECRET` was a live credential, rotate it in the PingOne admin console.

Get a token:
```bash
curl -sf -X POST "https://auth.pingone.com/${ENV_ID}/as/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "${WORKER_ID}:${WORKER_SECRET}" \
  -d "grant_type=client_credentials"
```

---

## Known Policy IDs (synthetic, preserved on import)

| Object | ID | Name |
|--------|-----|------|
| PolicySet | `56789012-0003-4321-abcd-000000000003` | Super Banking Policies |
| Policy | `56789012-0001-4321-abcd-000000000001` | Super Banking Transaction Authorization |
| Policy | `56789012-0002-4321-abcd-000000000002` | Super Banking MCP Delegation Authorization |

Decision endpoints (look up via API — IDs change per environment):
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "${API_BASE}/decisionEndpoints"
```
DEV endpoint ID: `f6752166-f78b-44db-a064-ead8f6a83142` (may be stale — cannot be verified from code, it depends on live cloud state). After any re-import, re-fetch it via `GET ${API_BASE}/decisionEndpoints` against the correct environment and update this value.

---

## Preferred Approach: Snapshot Import

The snapshot is the most reliable way to configure P1AZ. The cloud API condition POST does not support `COMPARISON` type inline (returns UNEXPECTED_ERROR); snapshot import handles the full condition DSL.

**File:** `snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json`

**To import:**
1. PingOne Authorize console → your environment
2. Snapshots → Import → upload the file
3. Complete the post-import manual steps below

---

## Snapshot Format Reference

```json
[
  {"@class":"DataStreamHeader","kind":"SnapshotHeader","version":2},
  {"type":"SnapshotPackageFile$PackageHeader",...},

  // Attributes and ConditionDefinitions go BEFORE the separator
  {"objectType":"AttributeDefinition","id":"12345678-...","type":"ATTRIBUTE",
   "name":"ToolName","valueType":"STRING","defaultValue":"none",
   "resolvers":[{"attributeResolverType":"request","condition":{"empty":{}}}]},

  {"objectType":"ConditionDefinition","id":"23456789-...","type":"CONDITION",
   "name":"RequiresHitlConsent",
   "condition":{"and":{"conditions":[
     {"comparison":{"left":{"attribute":{"id":"ATTR_ID"}},"op":"Equals","right":{"constant":{"value":"create_transfer"}}}},
     {"comparison":{"left":{"attribute":{"id":"ATTR_ID"}},"op":"NotEquals","right":{"constant":{"value":true}}}}
   ]}}},

  {"type":"SnapshotPackageFile$PackageSeparator"},

  // Statements, Rules, Policies go AFTER the separator
  {"id":"34567890-...","type":"Statement","code":"HITL","appliesTo":"PERMIT",
   "payload":"{\"hitlRequired\":true}"},

  {"id":"45678901-...","type":"Rule",
   "statements":["34567890-..."],
   "effectSettings":{"type":"unconditionalPermit"},
   "condition":{"and":{"conditions":[{"reference":{"id":"23456789-..."}}]}}},

  {"id":"56789012-...","type":"Policy",
   "combiningAlgorithm":{"algorithm":"DenyOverrides"},
   "children":[{"id":"45678901-...","type":"Rule"}],
   "condition":{"and":{"conditions":[{"reference":{"id":"23456789-..."}}]}}}
]
```

### Condition DSL (snapshot format — no `type` field on operators)
- `{"and":{"conditions":[...]}}` — all must be true
- `{"or":{"conditions":[...]}}` — any must be true
- `{"not":{"condition":{...}}}` — negate
- `{"reference":{"id":"23456789-..."}}` — reference another named condition
- `{"comparison":{"left":{...},"op":"Equals|NotEquals|GreaterThan|LessThan","right":{...}}}` — comparison
  - Left/right: `{"attribute":{"id":"ATTR_ID"}}` or `{"constant":{"value":"..."}}` (use JSON boolean `true`/`false` for booleans)
- `{"empty":{}}` — always true

### effectSettings types
- `{"type":"unconditionalPermit"}` — PERMIT when rule condition is true
- `{"type":"conditionalDenyElsePermit","condition":{...}}` — DENY if inner condition true, PERMIT otherwise

---

## Known Attribute IDs (synthetic, preserved on import)

| ID | Name | Type | Default |
|----|------|------|---------|
| `12345678-0001-4321-abcd-000000000001` | Amount | NUMBER | null |
| `12345678-0002-4321-abcd-000000000002` | TransactionType | STRING | null |
| `12345678-0003-4321-abcd-000000000003` | UserId | STRING | "none" |
| `12345678-0004-4321-abcd-000000000004` | Acr | STRING | "none" |
| `12345678-0007-4321-abcd-000000000007` | DecisionContext | STRING | "none" |
| `12345678-0008-4321-abcd-000000000008` | ToolName | STRING | "none" |
| `12345678-0009-4321-abcd-000000000009` | TokenAudience | STRING | "none" |
| `12345678-0010-4321-abcd-000000000010` | ActClientId | STRING | "none" |
| `12345678-0012-4321-abcd-000000000012` | McpResourceUri | STRING | "none" |
| `12345678-0013-4321-abcd-000000000013` | HitlApproved | BOOLEAN | false |

Known condition IDs:
- `23456789-0005-...` = RequiresStepUp
- `23456789-0006-...` = HasValidUserId
- `23456789-0007-...` = HasValidMcpAudience
- `23456789-0008-...` = IsMcpFirstToolRequest
- `23456789-0009-...` = HasValidActorChain
- `23456789-0010-...` = RequiresHitlConsent (HitlApproved feature)

---

## Post-Import Manual Steps (Required Every Time)

These cannot be encoded in the snapshot:

### 1. Update HasValidActorChain condition
`HasValidActorChain` (id `23456789-0009-...`) currently only checks `ActClientId != "none"`. After import, add a clause: `ActClientId == "<actual BFF client ID>"`.

BFF actor client ID is from `demo_api_server/.env` → look for `PINGONE_AI_AGENT_ACTOR_CLIENT_ID` (the BFF actor client whose `act.client_id` becomes `ActClientId`).

### 2. Wire decision endpoint to policy set
The decision endpoint must point to the `Super Banking Policies` policy set (`56789012-0003-...`):
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "${API_BASE}/decisionEndpoints/f6752166-f78b-44db-a064-ead8f6a83142"
# Check policySet.id — if wrong, PATCH to update
```

---

## Direct API Approach (Limited Use)

**What works via API:**
- GET any policy/attribute/condition
- PUT a full policy body (fetch → modify → PUT; never use ID-only child references)
- POST authorizationConditions with `REFERENCE`, `NOT`, or `EMPTY` type

**What does NOT work via API:**
- `authorizationConditions` POST with `COMPARISON` type → UNEXPECTED_ERROR
- Inline comparison conditions in policy PUT body
- Complex multi-clause conditions created via API

For anything beyond simple reference conditions: edit the snapshot file and re-import.

---

## How BFF/Gateway Use This

- **BFF live mode** (`ff_authorize_simulated=false`): `pingOneAuthorizeService.js` → POSTs to decision endpoint
- **BFF simulated mode** (default): `simulatedAuthorizeService.js` — never calls cloud P1AZ
- **Gateway**: calls local `demo_authz_server` (localhost:9001), NOT cloud P1AZ

**BFF decision parameters sent:**
```json
{
  "parameters": {
    "DecisionContext": "McpFirstTool",
    "ToolName": "create_transfer",
    "UserId": "<sub>",
    "TokenAudience": "<aud>",
    "ActClientId": "<act.client_id>",
    "McpResourceUri": "<expected aud>",
    "HitlApproved": true   // boolean, only on verified retry
  }
}
```

**Statement code → BFF obligation** (`authorizeObligations.js`):
- `HITL` or `HUMAN_APPROVAL` → `hitlRequired: true` → HTTP 428
- `step-up-required` → `stepUpRequired: true` → HTTP 428
- `mcp-authorization-denied` / `mcp-invalid-*` → 403
