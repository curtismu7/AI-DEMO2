# P1AZ as Resource Server + AgentRestrictions

**Date:** 2026-05-20
**Status:** Approved

---

## 1. Problem Statement

The demo currently consults PingOne Authorize (P1AZ) at the BFF tool-call layer and at the MCP Gateway — but not at the banking API routes themselves. This misses the key story from the NotFlux-MCP architecture: P1AZ as the control plane for the resource server, making a decision on every data request the agent triggers.

Additionally, there is no mechanism for per-user agent capability control that can change mid-session without a token re-issue or logout.

---

## 2. Goals

- Add P1AZ as an enforcement point at the BFF `/api/*` banking routes — the resource server layer
- Introduce `agentRestrictions` as a PingOne custom user attribute (enum: `read` | `write` | `none`) that P1AZ reads live at evaluation time
- Demonstrate mid-session capability change: admin flips the attribute in PingOne, the agent hits a DENY on its next write call within ~5 seconds
- Trigger the existing HITL flow on DENY (reuse `/api/mcp/decision/:taskId`)
- Gate everything behind `ff_agent_restrictions` (default: false)
- Provision the attribute during bootstrap regardless of flag state

---

## 3. Approach

New Express middleware `agentRestrictionsGate.js` on BFF banking routes. Detects agent-originated calls via `X-Agent-Sub` header (set by MCP Server's BankingAPIClient). Fetches the user's `agentRestrictions` attribute from PingOne (5s TTL cache), maps the route to a capability tier (read/write), calls P1AZ, and triggers HITL on DENY.

Existing token chain is unchanged. No new token exchanges. No new PingOne apps.

---

## 4. Feature Flag

```
ff_agent_restrictions   default: false   public: true
```

Added to `demo_api_server/services/configStore.js` alongside existing flags (`ff_trat_mode`, etc.).

- `false` (default): middleware is a no-op (`next()` immediately), zero behaviour change
- `true`: full AgentRestrictions check runs on every agent-originated banking API call

Config UI helper text: _"Requires agentRestrictions custom attribute on PingOne users. Provisioned automatically during bootstrap."_

---

## 5. AgentRestrictions Attribute

| Property | Value |
|---|---|
| Attribute name | `agentRestrictions` |
| Type | String (enum) |
| Values | `write` (default) · `read` · `none` |
| Location | PingOne user schema (custom attribute) |
| Default | `write` — full access, no behaviour change |

**Capability tiers:**
- `write` — agent may call any tool (read and write routes)
- `read` — agent may only call read-tier routes; write-tier routes are denied
- `none` — agent is fully blocked from all banking API calls

---

## 6. Middleware Design

**File:** `demo_api_server/middleware/agentRestrictionsGate.js`

**Wiring:** `app.use('/api', agentRestrictionsGate)` in `demo_api_server/server.js`, before the `authenticateToken` mounts. The middleware self-exits immediately (via `next()`) for any call that lacks `X-Agent-Sub`, so non-agent traffic is unaffected. Mortgage (`/api/mortgage`) is a separate service and never reaches this middleware. Admin routes are bypassed naturally — agent tools do not call `/api/admin/*`.

**Agent call detection:** Presence of `X-Agent-Sub` header. If absent → direct user call → `next()` immediately (no check).

**Capability tier resolution — derived from `scope-topology.json` (SSOT):**

The middleware resolves the required tier from the tool name passed in `X-MCP-Tool`, using the existing scope manifest:

1. Look up the tool's required scopes in `scope-topology.json` (already loaded by the BFF via the existing scope reference table)
2. Check the `riskLevel` of each required scope: `high` or `critical` → **write** tier; `low` or `medium` → **read** tier
3. If any required scope is write-tier, the call is write-tier

No hardcoded route map — the tier stays in sync automatically as tools and scopes evolve. If `X-MCP-Tool` is absent or unrecognised, defaults to `read` (fail open for unknown tools — agent restrictions only block known write operations).

**Execution flow (when `ff_agent_restrictions=true` and `X-Agent-Sub` present):**

```
1. Extract userId from req.session, agentSub from X-Agent-Sub, toolName from X-MCP-Tool
2. Fetch user's agentRestrictions from PingOne (in-memory cache, TTL 5s per userId)
3. Map requested route → required tier (read/write)
4. Evaluate locally:
     agentRestrictions === 'none'                         → DENY
     agentRestrictions === 'read' && requiredTier === 'write' → DENY
     otherwise                                            → PERMIT (skip P1AZ, next())
5. On local DENY → call P1AZ:
     subject: userId
     environment: { agentRestrictions, requiredTier, agentSub, tool, ff_agent_restrictions: true }
6. P1AZ PERMIT → next()
   P1AZ DENY   → createPendingDecision() → return 428 { code: 'agent_restrictions_hitl', taskId }
```

**Attribute cache:** In-memory Map, key: `userId`, TTL: 5s. Short enough that a mid-session PingOne attribute change takes effect within one tool call cycle.

---

## 7. BankingAPIClient Changes

**File:** `demo_mcp_server/src/tools/BankingAPIClient.ts`

Two new outbound headers added to every BFF call:

| Header | Value | Source |
|---|---|---|
| `X-Agent-Sub` | `act.sub` from MCP token | `BankingToolProvider.ts` passes token claims to client |
| `X-MCP-Tool` | tool name | Available at call time in `BankingToolProvider.executeTool()` |

Both headers are only set when the client is invoked from the MCP Server tool path (not direct BFF-internal calls).

---

## 8. PingOne Bootstrap Provisioning

**File:** `demo_api_server/scripts/bootstrapPingOne.js`

New step after user creation (idempotent — safe to re-run):

1. `PATCH /environments/{envId}/schemas/{schemaId}` — add `agentRestrictions` string attribute to user schema. If already exists, skip silently.
2. `PATCH /environments/{envId}/users/{userId}` — set `agentRestrictions: "write"` on each demo user.

**Bootstrap log output:**
```
[Bootstrap] agentRestrictions attribute → created (or already exists)
[Bootstrap] agentRestrictions: user1 → write ✅
[Bootstrap] agentRestrictions: user2 → write ✅
```

Uses existing `pingOneManagementService.js` helpers (same API client already used for user provisioning).

---

## 9. P1AZ Policy Shape

**Authorize call payload:**

```json
{
  "subject": "<userId>",
  "environment": {
    "agentRestrictions": "read",
    "requiredTier": "write",
    "agentSub": "<act.sub>",
    "tool": "<toolName>",
    "ff_agent_restrictions": "true"
  }
}
```

**Policy rule (to configure in PingOne Console):**

```
DENY if agentRestrictions == "none"
DENY if agentRestrictions == "read" AND requiredTier == "write"
PERMIT otherwise
```

**Simulated path:** When `PINGONE_AUTHORIZE_SIMULATION=true`, the existing simulated authorize service gets the same logic added — demo works without a live P1AZ policy configured.

---

## 10. Admin Panel

New control in the existing admin user management section:

- Per-user `agentRestrictions` dropdown (`write` / `read` / `none`)
- On change: `PATCH /api/admin/users/:userId/agent-restrictions` → BFF calls PingOne Management API to update the attribute
- New BFF route: `demo_api_server/routes/adminUsers.js` (or equivalent admin routes file)
- The 5s attribute cache means the agent feels the change on its very next tool call — the demo moment

---

## 11. UI Education Panel

New panel in the education drawer, shown when `ff_agent_restrictions=true`. Follows the same pattern as the TraT and PingOne Gateway panels.

**Content:**
- **Headline:** "P1AZ as Resource Server Control Plane"
- Token chain diagram annotated with the new P1AZ enforcement point (at banking API, not just gateway)
- `agentRestrictions` explainer: custom PingOne attribute, read live at evaluation time (not from token), changes propagate within 5s with no token re-issue
- Mid-session change walkthrough: admin flips attribute → next agent write call hits DENY → HITL dialog → user approves → P1AZ re-evaluated with confirmation
- Link to admin panel user management section

---

## 12. Files Touched

| File | Change |
|---|---|
| `demo_api_server/middleware/agentRestrictionsGate.js` | New — core middleware |
| `demo_api_server/services/configStore.js` | Add `ff_agent_restrictions` flag |
| `demo_api_server/server.js` | Wire `app.use('/api', agentRestrictionsGate)` before `authenticateToken` mounts |
| `demo_api_server/routes/adminManagement.js` | Add `PATCH /api/admin/users/:userId/agent-restrictions` |
| `demo_api_server/scripts/bootstrapPingOne.js` | Provision attribute + default values |
| `demo_mcp_server/src/tools/BankingAPIClient.ts` | Add `X-Agent-Sub` + `X-MCP-Tool` headers |
| `demo_mcp_server/src/tools/BankingToolProvider.ts` | Pass `act.sub` + tool name to BankingAPIClient |
| `demo_api_ui/src/` | Admin dropdown + education panel |

---

## 13. Non-Goals

- No new token exchanges or PingOne app types
- No SPIFFE agent identity (existing PingOne client ID used as `act.sub`)
- No AG-UI in-chat HITL widgets (existing polling modal reused)
- No change to the MCP Gateway or MCP Server P1AZ gates
