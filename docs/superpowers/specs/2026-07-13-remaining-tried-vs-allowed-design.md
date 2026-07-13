# Tried vs. Allowed — Remaining 4 Attacks — Design

Date: 2026-07-13

## Problem

Following the wrong-audience fix, 4 more "real" attack-demo chips in the Security Showcase
still don't show both what was tried and what is actually allowed, sourced from real data:
wrong-scope, confused-deputy, HITL-replay, cross-vertical-deny.

## Fixes

### 1. Wrong scope (`test_wrong_scope`, `AIAgent.js:2965-3026`) — UI only

`callMcpTool` (`demo_api_ui/src/services/demoAgentService.js:436-451`) already throws an Error
with `requiredScopes`/`availableScopes`/`missingScopes` all attached, matching
`mcpToolPipeline.js:785-791`'s real response body 1:1. The UI currently reads only
`missingScopes`. Add `requiredScopes`/`availableScopes` to the outcome message: "Tried: token
scopes=[availableScopes]" / "Allowed (required): scopes=[requiredScopes]". No backend change.

### 2. Confused deputy (`atk_confused_deputy`, `AIAgent.js:6866-6903`) — small backend addition

The mock authz server's `deny()` (`demo_authz_server/routes/decision.js:741-744`) only ever
returns `{decision, reason, decision_id, policy_version}` — no "correct actor" field, and in this
repo's live default deployment (real cloud PingOne Authorize, `ff_authorize_simulated=false`)
that mock isn't even in the call path. Editing it would not help the demo most people see.

Instead: `demo_api_server/services/mcpToolPipeline.js`'s `gateway_policy_denied` block
(lines 877-883) already runs in a file that requires `configStore` — add
`allowedActor: configStore.getEffective('pingone_ai_agent_client_id') || null` to that block's
body, but ONLY when `req.body?._testActClientId` was present on the request (the same signal
`mcpToolPipeline.js:599` already reads to know this is a confused-deputy test) — this avoids
attaching irrelevant "allowed actor" context to ordinary gateway denials. This is a real,
BFF-known config value (the actual allowlisted AI Agent actor client id), independent of which
engine (mock or real cloud PingOne Authorize) produced the underlying deny — it doesn't require
reading PingOne's cloud policy at all.

UI: show `data.allowedActor` (when present) alongside the already-shown rogue actor id.

### 3. HITL replay (`atk_hitl_replay`, `AIAgent.js:6954-7011`) — small backend addition

`demo_api_server/services/mcpToolAuthorizationService.js`'s `evaluateMcpFirstToolGate` already
computes the exact right message (`verification.message`, e.g. "HITL challenge belongs to a
different tool") at lines 220-233, inside a `try` block — but that `const verification` is
block-scoped and discarded after a `console.warn` on line 232; it never reaches the 428 response
built later in the same function (lines 404-420, inside the nested closure `mapLivePingOneResult`,
confirmed to have closure access to the enclosing function's variables — the same way the existing
`hitlApproved` variable, declared as `let` at line 216, already survives into that closure).

Fix: hoist a second `let hitlRejectionMessage = null;` alongside `let hitlApproved = false;`
(line 216), set it to `verification.message` inside the `if (!hitlApproved)` branch (line 230-234,
alongside the existing `console.warn`), and include it in the 428 body (lines 404-420) as
`...(hitlRejectionMessage ? { receiptRejectionReason: hitlRejectionMessage } : {})`.

UI: read `rb.receiptRejectionReason` (when present) and show the specific real reason instead of
only inferring "re-challenged" generically from `rb.error || rb.gatewayErrorCode`.

### 4. Cross-vertical deny (`showcase === "authz_deny"`, `AIAgent.js:6832-6865`) — UI only

The `AllowedVertical` value returned by the `McpToolsList` discovery path
(`demo_authz_server/routes/decision.js:324`) is purely advisory — it echoes back whatever
`Vertical` the caller sent, it isn't an independent enforcement check, and it comes from a
*different* API call than the one this chip makes (`McpToolCall`). It carries no information the
client doesn't already have.

What the client DOES already have, real and live: `toolPermissions` (`AIAgent.js:1298-1302`,
a `useMemo` derived from `availableTools` state, itself populated by
`POST /api/demo-agent/tools` — the real, Authorize-filtered tool list for the active vertical,
already fetched and kept in sync whenever vertical/login/write-toggle changes). Use
`Object.keys(toolPermissions)` (or filter to `permitted !== false` entries) to show "Tools
allowed in your current vertical: [...]" alongside the denied tool that was tried. No backend
change, no new API call — reuses already-fetched real state.

## Testing

- Task 1 (wrong-scope): extend UI test coverage for the `test_wrong_scope` outcome message.
- Task 2 (confused-deputy): backend test in `demo_api_server/src/__tests__/mcpToolPipeline.characterization.test.js` (follow its `makeDeps()`/`makeCtx()` DI pattern) asserting `allowedActor` appears only when `testActClientId` was set; UI test for the new field in the message.
- Task 3 (HITL-replay): backend test in `demo_api_server/src/__tests__/mcpToolAuthorizationService.test.js` (follow its `jest.mock()` pattern, mock `hitlServiceClient.verifyHitlReceipt` to return `{ok:false, message:'HITL challenge belongs to a different tool'}`) asserting `receiptRejectionReason` appears in the 428 body; UI test for the new field.
- Task 4 (cross-vertical-deny): UI test asserting the outcome message includes the current `toolPermissions` keys.

## Out of scope

- Prompt/indirect injection (confirmed in the earlier audit: not a value-mismatch case).
- Any change to `decision.js` (the mock authz server) — not in the live default call path.
- Any change to real PingOne Authorize's cloud policy configuration (out of repo scope).
