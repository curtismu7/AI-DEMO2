# PingOne Admin group gate — route through PingOne Authorize (P1AZ)

**Date:** 2026-08-10
**Status:** Design, approved in brainstorming. Not yet planned or implemented.
**Scope:** `services/pingOneAdminAccessService.js#checkAccess` only. No route, UI, or flag-default changes.

## Problem

`services/pingOneAdminAccessService.js#checkAccess` gates the entire `pingone-admin`
vertical. Today it decides access itself, in JS:

```js
allowed: groups.includes(requiredGroup)
```

This is a live PingOne directory read at decision time — real and demoable (add/remove
the group, next request changes with no new token, no re-login) — but it is **not** a
PingOne Authorize decision. `docs/superpowers/specs/2026-08-10-admin-demo-stories-design.md`
names this gap explicitly and defers fixing it: *"Routing the gate through PingOne
Authorize is a separate, larger piece of work; it is listed under Deferred, not smuggled
in here."* This spec is that deferred work.

## Why not just flip `ff_authorize_group_policy`

The obvious move — turn on the existing group-policy flag and let banking's machinery
cover admin too — is a trap already documented in this codebase.
`services/useCaseDemoBehaviors.js` (UC9 group-entitlement chip) states it plainly:

> The flag is process-wide: flipping it for a demo changes behaviour for anyone else
> using the app, survives a crashed or abandoned run, and can be turned OFF mid-run by
> the 400-on-UserGroups self-heal in `mcpToolAuthorizationService` — which also silently
> disables every banking tier ceiling.

UC9 solves this by calling the group-aware evaluator directly, per-request, with the
flag left off. This design follows that same precedent instead of the flag.

## What already exists (reused, not built)

- **The policy rule.** `pingOneAuthorizeService.js:708-823`, "Scenario 1": when the
  caller supplies `RequiredGroup` + `InRequiredGroup` (a pre-resolved boolean — the
  snapshot DSL has no array-contains), the deployed live policy already has a rule
  *"RequiredGroup present AND InRequiredGroup == false → Deny — Not In Required Group"*
  (`docs/planning/OPERATOR-vertical-group-policy.md:11-12,31-32`). Other verticals
  (UC21, UC9) already exercise this rule against the real decision endpoint.
- **The decision endpoint.** `authorize_mcp_decision_endpoint_id` is already configured
  live (`1f9e9c71-9e84-47dd-8f91-54197564930c`), `ff_authorize_real=true`. No new
  PingOne-side provisioning.
- **The evaluator.** `pingOneAuthorizeService.evaluateMcpToolDelegation(opts)` —
  `POST /v1/environments/{envId}/decisionEndpoints/{endpointId}`, returns
  `{ decision: 'PERMIT'|'DENY'|'INDETERMINATE', decisionId, raw, ... }`. Unconditional:
  it forwards whatever `RequiredGroup`/`InRequiredGroup` the caller passes, regardless of
  `ff_authorize_group_policy` — that flag only gates whether *banking's own*
  `mcpToolAuthorizationService` bothers computing and passing those fields. Calling
  `evaluateMcpToolDelegation` directly sidesteps the flag (and its self-heal footgun)
  entirely.

## Design

**Architecture.** `checkAccess` keeps its live PingOne directory lookup — someone still
has to resolve group membership to a scalar boolean before P1AZ can evaluate it; this is
a normal PIP (policy information point) role, not a shortcut around P1AZ. What changes is
the *decision*: instead of `groups.includes(requiredGroup)` in JS, `checkAccess` calls
`evaluateMcpToolDelegation` and trusts its `decision`.

Call shape (everything else omitted — the function treats `null` as "unknown, don't gate
on it," per its own "C1 rule 3"):

```js
evaluateMcpToolDelegation({
  userId: pingOneUserId,
  toolName: 'pingone_admin_access',   // sentinel — this gates the whole vertical, not one tool
  verticalId: 'pingone-admin',
  requiredGroup,                       // unchanged: groupPolicy.groupNameForCategory(...)
  inRequiredGroup,                     // unchanged boolean, now an INPUT not the decision
  userRole,
});
```

**Data flow.**
1. Resolve `requiredGroup` — unchanged (`groupPolicy.groupNameForCategory('pingone-admin', 'privileged')`).
2. Resolve live `groups` — unchanged (`membershipService.listUserGroupNamesForVertical`).
3. Compute `inRequiredGroup = groups.includes(requiredGroup)` — same boolean as today.
4. Call `evaluateMcpToolDelegation(...)` — real PingOne Authorize decision.
5. Map `decision` to the existing return contract (`{ allowed, error, status, requiredGroup }`):
   - `PERMIT` → `{ allowed: true, status: 200 }`
   - `DENY` → `{ allowed: false, error: 'pingone_admin_group_required', status: 403 }`
   - `INDETERMINATE` → same as `DENY` (fail-closed — matches this codebase's existing
     precedent elsewhere of collapsing INDETERMINATE to DENY rather than fail-open)
   - thrown / transport error → `{ allowed: false, error: 'pingone_admin_group_lookup_unavailable', status: 503 }`
     (identical to today's "can't verify membership" case)

**No changes outside `checkAccess`.** `routes/adminAgentRoutes.js#requirePingOneAdminGroup`
(call sites at lines 49 and 120 — the only two call sites repo-wide) reads
`{ allowed, error, status, requiredGroup }` and is untouched; the contract is preserved
exactly.

## Error handling

- PingOne Authorize unreachable / decision endpoint misconfigured → `evaluateMcpToolDelegation`
  throws → caught, mapped to the existing `503 pingone_admin_group_lookup_unavailable`
  path. No new failure mode introduced.
- `INDETERMINATE` (e.g. the deployed policy doesn't recognize `pingone_admin_access` as
  a `ToolName` and has no default rule) fails closed as `DENY`, not silently PERMIT.

## Testing

- Unit: mock `pingOneAuthorizeService.evaluateMcpToolDelegation` in `checkAccess` tests
  for `PERMIT` / `DENY` / `INDETERMINATE` / thrown-error branches.
- Live verify (required before calling this done, per this repo's revert-to-RED
  convention): remove the signed-in admin from the required group → confirm a real `403`
  sourced from the actual decision endpoint (check server logs for the `[BFF→P1AZ]`
  request/response lines already logged by `_postDecisionEndpoint`); add the group back
  → confirm `200`/allowed again. This is the only way to know the deployed policy's group
  rule actually fires for this vertical's attribute values — it is not assumed here.

## Open risk (not blocking, verified during implementation)

The deployed policy's group rule is documented as tool-agnostic ("RequiredGroup present
AND InRequiredGroup == false → Deny," no mention of `ToolName` gating it), but this spec
has not read the live policy JSON directly to confirm `ToolName: 'pingone_admin_access'`
— a value the policy has never seen before — doesn't hit an unrelated rule or fall through
to `INDETERMINATE` for an unexpected reason. The live-verify step above is what confirms
or refutes this; if it surfaces a problem, the fix is scoped to picking a different
`toolName`/attribute value, not to this design's architecture.

## Deferred (explicitly out of scope)

- Routing pingone-admin's actual MCP tool calls (`call_pingone_tool`,
  `list_pingone_tools`) through `demo_mcp_gateway`'s own P1AZ call. That gateway's
  request builder currently sends no group attributes at all — building that is a
  separate, larger piece of work, and this spec's reuse of `evaluateMcpToolDelegation`
  directly makes it unnecessary for the group-gate use case.
- Turning `ff_authorize_group_policy` on globally. Deliberately avoided (see above).
