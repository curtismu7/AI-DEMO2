# MCP Annotations → P1AZ + Elicitation Design

**Date:** 2026-08-14  
**Status:** Approved for implementation  
**Scope:** `demo_mcp_gateway`, `demo_authz_server`, `demo_api_server`, `demo_api_ui`

---

## Problem

The gateway enforces tool-level authorization via P1AZ but passes no annotation context — P1AZ cannot distinguish a destructive write from a safe read. Destructive tool confirmations today go through CIBA (async push), which is heavyweight for lower-stakes "are you sure?" moments. The MCP spec (2026-07-28) defines `readOnly`, `destructive`, and `idempotent` tool annotations and an `InputRequiredResult` elicitation primitive for inline user consent.

---

## What we're building

Two linked capabilities:

1. **Annotations → P1AZ:** Wire `readOnly`/`destructive`/`idempotent` flags into every `McpToolCall` P1AZ decision context so policy can author annotation-aware rules.
2. **Elicitation:** New obligation class (`ELICITATION`) that P1AZ can issue on destructive calls. Gateway returns a structured inline consent request (-32003). BFF pauses the agent loop, shows a confirmation modal, and re-sends the tool call with proof of user confirmation. HITL/CIBA stays as the path for high-stakes approvals (manager sign-off, audit trail required).

---

## Option A — Scope-topology inference + session-bound elicitation (this design)

Annotations derived from `scope-topology.json` (read-scope-only → `readOnly`, write-scope → `destructive`). No startup dependency on mcp-server. Elicitation confirmation tracked per `MCP-Session-Id` in gateway in-memory state.

See [Option B](#option-b-future) and [Option C](#option-c-future) for future paths.

---

## Architecture

```
tools/call
    │
    ▼
Gateway: buildAuthorizeParameters
    + ToolReadOnly, ToolDestructive, ToolIdempotent   ← NEW (from scope-topology)
    │
    ▼
P1AZ policy evaluation
    │
    ├── PERMIT ──────────────────────────────► proxy to mcp-server
    │
    ├── ELICITATION obligation ───────────────► -32003 + elicitation_id (NEW)
    │                                            Gateway stores pending record
    │                                            BFF pauses agent loop
    │                                            UI shows ElicitationModal
    │                                            User: Yes → POST /elicitation/:id/confirm
    │                                            BFF re-sends tool call +
    │                                              _elicitation_confirmed: true
    │                                              _elicitation_id: <uuid>
    │                                            Gateway: validate + ElicitationConfirmed:"true"
    │                                            P1AZ re-evaluates → PERMIT
    │                                            ► proxy to mcp-server
    │                                            User: No → POST /elicitation/:id/deny
    │                                            BFF injects tool failure, resumes loop
    │
    └── HITL/STEP_UP obligation ─────────────► existing -32002 path (unchanged)
```

---

## Section 1: Annotations → P1AZ

### Data source

`demo_mcp_server/src/scope-topology.json` (or generated `docs/scope-topology.md` equivalent) already maps every tool name to its required scopes. Derive annotations:

```
readOnly    = tool's requiredScopes contains only "read" (no "write")
destructive = tool's requiredScopes contains "write"
idempotent  = same as readOnly (reads safe to retry; writes not)
```

### Gateway changes — `pingAuthorizeGuard.ts`

New helper `getToolAnnotations(toolName: string): ToolAnnotations` reads the scope-topology at startup (one-time load, no network call) and returns `{ readOnly, destructive, idempotent }`.

Add to `buildAuthorizeParameters`:

```typescript
const ann = getToolAnnotations(toolName);
parameters.ToolReadOnly    = ann.readOnly    ? "true" : "false";
parameters.ToolDestructive = ann.destructive ? "true" : "false";
parameters.ToolIdempotent  = ann.idempotent  ? "true" : "false";
```

Also add per-candidate-tool annotation map to `guardToolsList` so policy can filter the visible list (e.g. hide destructive tools for read-only sessions):

```typescript
parameters.CandidateToolAnnotations = JSON.stringify(
  candidateTools.map(name => ({ name, ...getToolAnnotations(name) }))
);
```

### P1AZ policy changes

**`demo_authz_server/` (p1az-mock):** Add two new rules for destructive tools:

```
IF DecisionContext == "McpToolCall"
   AND ToolDestructive == "true"
   AND ElicitationConfirmed != "true"
THEN DENY + obligation ELICITATION
     advice.prompt = "Confirm {ToolName}?"

IF DecisionContext == "McpToolCall"
   AND ToolDestructive == "true"
   AND ElicitationConfirmed == "true"
THEN PERMIT   // confirmation received, clear obligation
```

**Real P1AZ:** Same logic added via existing policy import flow. The `ElicitationConfirmed` parameter is new — existing policies that don't reference it are unaffected.

### Files touched

| File | Change |
|---|---|
| `demo_mcp_gateway/src/auth/pingAuthorizeGuard.ts` | `getToolAnnotations()` + 3 new fields in `buildAuthorizeParameters` + per-tool annotations in `guardToolsList` |
| `demo_mcp_gateway/src/utils/toolAnnotations.ts` | New helper (load scope-topology, return annotation map) |
| `demo_authz_server/` | New ELICITATION obligation rules |
| Real P1AZ policy | Same rules via policy update |

---

## Section 2: Elicitation flow

### New obligation class — `authorizeObligations.ts`

Add `elicitation` to the obligation type union. Keyword match: `ELICITATION` (case-insensitive, separators stripped). New field on `ObligationResult`:

```typescript
type ObligationType = 'stepUp' | 'consent' | 'hitl' | 'elicitation';  // elicitation NEW

interface ElicitationObligation extends ObligationResult {
  type: 'elicitation';
  prompt: string;   // from P1AZ advice
}
```

### Gateway — elicitation store + handler (`index.ts`)

```typescript
interface PendingElicitation {
  elicitation_id: string;
  toolName: string;
  sessionId: string;        // MCP-Session-Id
  prompt: string;
  expiresAt: number;        // Date.now() + 120_000
}

const pendingElicitations = new Map<string, PendingElicitation>();
```

**On ELICITATION obligation:**

```typescript
const id = crypto.randomUUID();
pendingElicitations.set(id, {
  elicitation_id: id,
  toolName,
  sessionId: req.headers['mcp-session-id'],
  prompt: obligation.prompt ?? `Confirm ${toolName}?`,
  expiresAt: Date.now() + 120_000,
});
return jsonRpcError(req.id, -32003, 'elicitation_required', {
  elicitation_id: id,
  prompt: obligation.prompt,
  tool_name: toolName,
  expires_in: 120,
});
```

**On re-call with `_elicitation_confirmed: true`:**

```typescript
const record = pendingElicitations.get(args._elicitation_id);
if (!record
  || record.toolName !== toolName
  || record.sessionId !== req.headers['mcp-session-id']
  || record.expiresAt < Date.now()
) {
  return jsonRpcError(req.id, -32003, 'elicitation_required', { reason: 'invalid_or_expired' });
}
pendingElicitations.delete(args._elicitation_id);
// add ElicitationConfirmed: "true" to P1AZ context, then proceed
```

Cleanup: sweep expired records on a 60s interval (simple `setInterval`).

### BFF — agent loop pause/resume (`demo_api_server/routes/agent.js`)

On gateway response with `error.code === -32003`:

1. Store `{ elicitation_id, prompt, tool_name }` on the express session under `req.session.pendingElicitation`
2. Pause the LLM loop: the loop iteration resolves a `Promise` stored on the session (`req.session.elicitationResolve`). The loop `await`s this promise before calling the LLM again. Confirm/deny routes call `resolve(confirmed: boolean)` to unblock it.
3. Emit SSE event:
   ```json
   { "type": "elicitation_required", "elicitation_id": "...", "prompt": "...", "tool_name": "..." }
   ```

New routes (mounted alongside existing agent routes):

```
POST /api/agent/elicitation/:id/confirm
POST /api/agent/elicitation/:id/deny
```

`confirm`: validates `req.session.pendingElicitation.elicitation_id === req.params.id`, re-issues the paused tool call with `_elicitation_confirmed: true` + `_elicitation_id`, clears session state, resumes loop.

`deny`: clears session state, injects a synthetic tool-call failure into the agent context (`{ error: "User declined confirmation" }`), resumes loop so the LLM can respond gracefully.

### UI — `ElicitationModal` (`demo_api_ui/src/components/ElicitationModal.jsx`)

New component wrapping `DraggableModal`. Renders when the agent view receives `elicitation_required` SSE event.

Props: `{ prompt, toolName, elicitationId, onConfirm, onDeny }`

```jsx
<DraggableModal title="Confirm Action" isOpen={!!pending} onClose={handleDeny}>
  <p>{pending?.prompt}</p>
  <div className="elicitation-actions">
    <button onClick={handleConfirm}>Confirm</button>
    <button onClick={handleDeny}>Cancel</button>
  </div>
</DraggableModal>
```

`handleConfirm` → `POST /api/agent/elicitation/:id/confirm`  
`handleDeny` → `POST /api/agent/elicitation/:id/deny`

Both dismiss the modal and unblock the SSE stream.

Agent view (locate exact component before implementing — search for SSE event consumption in `demo_api_ui/src/` near the chat/agent panel) subscribes to the SSE stream and sets `pendingElicitation` state when `type === 'elicitation_required'`.

### Files touched

| File | Change |
|---|---|
| `demo_mcp_gateway/src/auth/authorizeObligations.ts` | Add `elicitation` type + keyword match |
| `demo_mcp_gateway/src/index.ts` | Elicitation store + -32003 handler + re-call validation + expiry sweep |
| `demo_api_server/routes/agent.js` | Detect -32003, pause loop, emit SSE, add confirm/deny routes |
| `demo_api_ui/src/components/ElicitationModal.jsx` | New component |
| `demo_api_ui/src/components/AgentView.jsx` (or equivalent) | Wire SSE event → modal state |

---

## Testing

| Test | Location | What to assert |
|---|---|---|
| `getToolAnnotations` returns correct flags | gateway unit | `create_withdrawal` → `destructive: true`; `get_my_accounts` → `readOnly: true` |
| P1AZ context includes annotation fields | gateway unit (mock P1AZ) | `ToolDestructive` present in captured request |
| ELICITATION obligation → -32003 error | gateway integration | Correct error code + elicitation_id in data |
| Re-call with valid elicitation_id → PERMIT path | gateway integration | `ElicitationConfirmed: "true"` in P1AZ context; elicitation record deleted |
| Re-call with expired/wrong session → -32003 again | gateway unit | Reject without forwarding |
| BFF pauses loop on -32003 | agent route test | SSE emits `elicitation_required`; no further LLM call until confirm |
| Confirm → resumes with correct args | agent route test | `_elicitation_confirmed: true` + `_elicitation_id` forwarded to gateway |
| Deny → synthetic failure injected | agent route test | Loop resumes; LLM receives tool error |
| UI: confirm button calls confirm route | vitest | `POST /api/agent/elicitation/:id/confirm` fired |
| HITL path unchanged | gateway regression | -32002 path still works; `_hitl_challenge_id` retry unaffected |

---

## What does NOT change

- HITL/CIBA flow for high-stakes approvals — completely unchanged
- Step-up (-32002) path — unchanged
- mcp-server — no changes; it has no role in elicitation
- Existing P1AZ rules — unaffected (new `ToolDestructive` / `ElicitationConfirmed` params are additive; policies that don't reference them ignore them)

---

## Option B — Future: live annotation cache (tools/list on startup) {#option-b-future}

**What changes vs Option A:**

Gateway calls `tools/list` on mcp-server at startup and caches the full annotation map `{ name → { readOnly, destructive, idempotent, openWorld } }`. Uses actual tool metadata (not scope-topology inference). Re-fetches on mcp-server reconnect.

**Why not now:** Adds a hard startup dependency — gateway won't initialize if mcp-server is down. Operationally fragile for Docker/K8s restarts. The scope-topology inference in Option A is accurate for all current tools; Option B only becomes necessary if a tool's annotation diverges from its required scopes.

**When to revisit:** When we add tools whose annotations don't follow the read=readOnly / write=destructive pattern, or when we expose openWorld tools that need the extra flag in P1AZ.

**Additional changes over Option A:**
- `demo_mcp_gateway/src/utils/toolAnnotations.ts` — replace static load with `ToolAnnotationCache` class that fetches on startup and refreshes on 404
- Health check must gate on annotation cache being populated

---

## Option C — Future: spec-native InputRequiredResult format {#option-c-future}

**What changes vs Option A:**

Instead of JSON-RPC error -32003, the gateway returns a `tools/call` result with `_meta["io.modelcontextprotocol.inputRequired"]`:

```json
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "content": [],
    "isError": false,
    "_meta": {
      "io.modelcontextprotocol.inputRequired": {
        "request": { "type": "approval", "prompt": "Confirm withdrawal?" },
        "resumptionToken": "<uuid>"
      }
    }
  }
}
```

BFF detects the `inputRequired` meta key in tool results (not an error code). Re-call adds the resumption token in `_meta` of the new request.

**Why not now:** BFF currently parses tool call results looking for errors first. Elicitation as a success result requires a new parsing path. The -32003 error code is consistent with -32002 (HITL) and easier to reason about in the agent loop. The spec format is also still evolving (2026-07-28 spec).

**When to revisit:** When targeting full MCP spec compliance for external client compatibility, or when onboarding a third-party MCP client that speaks elicitation natively.

---

## Remaining MCP gaps — implement later

From the full MCP spec gap analysis (2026-08-14):

| # | Gap | Value | Effort | Notes |
|---|---|---|---|---|
| 3 | **Resources for account/transaction data** | Med | Arch | Expose accounts/transactions as `resources/list` + `resources/read` + subscriptions. P1AZ gates `resources/read` same as `tools/call`. Demonstrates read vs write authz separation natively. |
| 4 | **Sampling (server→client LLM requests)** | Med | Med | `mcp-server` sends `sampling/createMessage` to BFF (the MCP client) for mid-tool-call LLM reasoning (fraud scoring, risk assessment). BFF routes to LLM proxy. No UI changes needed. |
| 5 | **Parameter-level P1AZ authz** | Med | Bounded | Pass sanitized tool args snapshot (recipient account, memo, etc.) to P1AZ context. Enables rules like "deny transfers to foreign IBANs without elevated scope." Sensitive param handling needs care. |
| 6 | **Protocol version bump to 2026-07-28** | Low | Small | Update advertised `protocolVersion` in gateway + mcp-server initialize response. Handle new `UnsupportedProtocolVersionError` (-32022) from clients sending a newer version. |
| 7 | **SSRF hardening on gateway proxy** | Security | Bounded | Before any outbound tool-backend call, block RFC 1918 + link-local IP ranges. Affects `demo_mcp_gateway/src/backends/`. One blocklist function; validate resolved IP if hostname. |
| — | **Prompts** | Low | Arch | Pre-built banking workflow templates via `prompts/list` + `prompts/get`. Our chip system covers this story already. |
| — | **Roots** | Skip | — | Filesystem anchors; not relevant for banking. |
| — | **Completion** | Skip | — | Autocomplete suggestions; not applicable. |
