# P1AZ "Policy Not Found" Handling — Design

**Date:** 2026-07-11
**Status:** Approved (pending user spec review)

## Problem

When the demo code is updated (new tool, new action, new `DecisionContext`) but the
PingOne Authorize (P1AZ) environment is not updated to match, the authorization gate
fails in a way that is indistinguishable from a P1AZ outage. The user sees
"authorization service temporarily unavailable" (or a silent simulated fallback), and
the operator gets no hint that the real cause is a missing policy.

Desired behavior: show the user **"Policy not found, please contact administrator."**
in the chat and return control to the agent — without changing any existing P1AZ
PERMIT/DENY/obligation semantics.

## Detection — two signals, both in `demo_api_server/services/pingOneAuthorizeService.js`

### Primary: `NOT_APPLICABLE` decision (HTTP 200)

The likely "forgot to update P1AZ" case: the decision endpoint exists, the engine
evaluates successfully, but **no policy in the tree matches the request attributes**
(e.g. a new tool name no policy has a condition for). With the demo snapshot's
`DenyOverrides` combining algorithm, P1AZ returns `decision: "NOT_APPLICABLE"`.

- `_normalizeDecision()` (currently collapses anything non-PERMIT/DENY to DENY) gets
  **one new branch**: if the raw effect is literally `not_applicable`
  (case-insensitive), return a new normalized value `'NOT_APPLICABLE'`.
- Any **other** unknown or empty effect still collapses to DENY (or INDETERMINATE
  with obligation) exactly as today. Fail-closed semantics change only for the one
  explicit value.

### Secondary: HTTP 404 from the decision call

The configured `authorize_decision_endpoint_id` / `authorize_policy_id` /
`authorize_mcp_decision_endpoint_id` points at an ID that was never created in the
P1AZ environment.

- `_postDecisionEndpoint()` and `_evaluateViaPdp()`: when `response.status === 404`,
  throw the error tagged with `err.code = 'policy_not_found'` and `err.status = 404`.
- All other statuses (5xx, network errors) throw exactly as today.

## Gate behavior

Applies to **both** BFF gates:
`demo_api_server/services/transactionAuthorizationService.js` (transaction gate) and
`demo_api_server/services/mcpToolAuthorizationService.js` (MCP first-tool gate).

### NOT_APPLICABLE (success response — failover does NOT apply)

The engine worked; this is not an outage. In **every** failover mode:

- Block the action.
- Return `{ error: 'policy_not_found', error_description: 'Policy not found, please contact administrator.' }`.

### 404 (engine error — failover mode is respected, per user decision)

- `failover = deny` → block with the same `policy_not_found` body instead of the
  generic `authorization_service_unavailable`.
- `failover = fallback_simulated` or `permit` → demo continues exactly as today
  (simulated engine / fail-open), but the existing `authorizeFallback` signal is
  enriched with a `policy_not_found` reason so the operator-facing fallback modal
  reports the real cause instead of implying an outage. No blocking chat error in
  these modes — the fallback deliberately keeps the demo alive.

## UI

- `demo_api_ui/src/services/demoAgentService.js`: map the `policy_not_found` error
  body to a thrown error with `.code = 'policy_not_found'`, following the existing
  `mcp_authorization_denied` pattern.
- `demo_api_ui/src/components/AIAgent.js`: one new branch in the error-code ladder
  (beside `mcp_authorization_denied`) rendering the chat message
  **"Policy not found, please contact administrator."** and ending the action —
  the ladder's existing pattern already returns control to the agent.

## Invariants (the "do not break P1AZ" contract)

- PERMIT, DENY, INDETERMINATE, obligations / step-up / HITL classification: untouched.
- Unknown/empty decision effects other than literal `NOT_APPLICABLE`: still DENY.
- Non-404 error handling and failover for genuine outages: untouched.
- MCP gateway path (`demo_mcp_gateway/`) and mock authz server
  (`demo_authz_server/`): untouched — they target the local mock, not the cloud API.
- Accepted trade-off: a flow that intentionally relies on "no matching policy →
  quiet deny" would now surface "Policy not found" instead of "Access Denied".

## Testing / success criteria

- Unit tests in `demo_api_server`:
  - `_normalizeDecision` maps literal `NOT_APPLICABLE` to `'NOT_APPLICABLE'`; other
    unknown effects still map to DENY.
  - 404 from the decision call throws with `err.code = 'policy_not_found'`; 5xx does not.
  - Both gate services: NOT_APPLICABLE → blocked with `policy_not_found` body in all
    failover modes; 404 → `policy_not_found` body in deny mode, fallback signal
    enriched in `fallback_simulated` mode. Mirror existing
    `authorizeNotConfiguredFailClosed` / failover test patterns.
- Existing P1AZ test suites stay green.
- UI build gate passes (per REGRESSION_PLAN).
