# Plan — Receipt-aware PERMIT for agent HITL (gateway + mock authz + live PingAuthorize)

**Date:** 2026-05-29
**Status:** Plan only — no code written yet
**Author context:** Requested after comparing our HITL flow to the NotFlux-MCP demo.

---

## Problem

When an agent retries a HITL-gated MCP tool call after the human approves, the
authorization engine re-evaluates with **byte-identical inputs** and therefore
returns the same `INDETERMINATE` (HITL required) verdict. Nothing in the
decision input tells the policy "approval already happened." Today:

- **Gateway path** (`demo_mcp_gateway`) papers over this with a *gateway-side*
  receipt check (`verifyHitlReceipt`) and relies on the downstream policy to
  re-PERMIT identical inputs — which only works by luck/config and risks an
  infinite-challenge loop.
- **BFF / simulated path** (`demo_api_server`) has **no receipt concept at
  all**. `evaluateMcpFirstToolGate` returns `mcp_hitl_required` every time; the
  `_hitl_challenge_id` never reaches it. This is the path that runs in the
  **default demo** (`ff_authorize_simulated` defaults to `true`).

The NotFlux mental model the user wants: the agent sends HITL context back, the
**policy engine** grabs it and only PERMITs because it sees approval was done —
with the gateway still binding the receipt to the caller (anti-replay).

## Goal

Make the **authorization engine** the receipt-aware PERMIT authority by feeding
an `HitlApproved` decision parameter, in **all three engines that decide HITL**,
kept in strict parity. The gateway keeps `verifyHitlReceipt` as the anti-replay
binding gate. The BFF path gains a symmetric receipt verification (Option 1).

## Success criteria

1. First call (no receipt): `INDETERMINATE` → challenge created. **Unchanged.**
2. Retry with an approved, caller-bound receipt: engine receives
   `HitlApproved=true` → `PERMIT` → call forwards.
3. Retry with mismatched/expired/denied receipt: rejected **before** the policy
   call; `HitlApproved` never sent. Replay defense unchanged.
4. **Step-up is NOT dischargeable by a HITL receipt** — an approval ≠ MFA. If
   the winning gate is `STEP_UP`, the engine still returns step-up regardless of
   `HitlApproved`.
5. **Audience-mismatch DENY still wins first** — `HitlApproved=true` never
   overrides the step-skipping guard.
6. Simulated and live PingAuthorize produce **identical** verdicts for the same
   inputs (the parity invariant the code repeatedly asserts).
7. No infinite-challenge loop: `INDETERMINATE` while `HitlApproved===true` → a
   distinct DENY, never a fresh challenge.
8. `npm run build` clean in `demo_mcp_gateway`; targeted `npx jest` green in
   `demo_api_server`.

---

## Engines & call sites (verified by reading the code)

| Layer | File | HITL decision today | Change |
|---|---|---|---|
| Mock authz (default demo) | `demo_api_server/services/simulatedAuthorizeService.js` → `evaluateMcpFirstTool` | `INDETERMINATE` from amount/tool/acr | accept `hitlApproved` → PERMIT when only HITL_CONSENT gate fires |
| Live PingAuthorize | `demo_api_server/services/pingOneAuthorizeService.js` → `evaluateMcpToolDelegation` (L229) | `INDETERMINATE` from policy obligations | add `HitlApproved` param to decision POST |
| BFF gate (caller) | `demo_api_server/services/mcpToolAuthorizationService.js` → `evaluateMcpFirstToolGate` | passes engine verdict through as 428 | accept verified `hitlApproved`, thread into both engines, add anti-loop DENY |
| Pipeline (route entry) | `demo_api_server/services/mcpToolPipeline.js` (gate call L312; `createPendingDecision` L329) | calls the gate; no receipt; uses a UI-polled **pending decision**, not a challenge receipt | extract `_hitl_challenge_id` from tool params, verify, pass `hitlApproved`; reconcile pending-decision vs. receipt model |
| Gateway → live policy | `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts` (`buildAuthorizeParameters`) + `pingAuthorizeGuard.ts` (`guardToolCall`) + `index.ts` | `INDETERMINATE` from amount; gateway-side `verifyHitlReceipt` already exists | add `HitlApproved` param; set from `verification.ok`; anti-loop DENY |

Gateway local scope path (`toolScopes.ts`) has no HITL — no change.

---

## Receipt verification model — **Option 1 (symmetric), chosen**

Both paths verify the receipt the **same way** before asserting `HitlApproved`:

- **Gateway:** already does it — `getHitlChallengeStatus` + `verifyHitlReceipt`
  (binds receipt → user `sub`, agent `act.sub`, tool; checks approved+unexpired)
  in `index.ts`.
- **BFF/pipeline:** add a small HITL client call mirroring `verifyHitlReceipt`'s
  binding logic before setting `hitlApproved=true`. Reuses the same trust model
  so the two HITL surfaces don't diverge (the `hitl-consent` skill warns against
  divergence explicitly).

`HitlApproved` reaching any engine is therefore **always** a
gateway/BFF-verified, caller-bound assertion. The policy trusts that boolean; it
cannot (and need not) re-verify the receipt's provenance — only the
gateway/BFF can bind user/agent/tool.

---

## Changes

### 1. Mock authz — `simulatedAuthorizeService.js` `evaluateMcpFirstTool`
- Add `hitlApproved = false` to destructured params; surface in `parameters`
  (`...(hitlApproved ? { HitlApproved: true } : {})`).
- Tool-name HITL branch (~L264) and amount branch (~L332): when the winning gate
  is **only** `HITL_CONSENT` and `hitlApproved===true` → return **PERMIT**.
- Guards that must still win first / not be discharged:
  - audience-mismatch DENY (L227) — unchanged, runs first.
  - `mcpFlags.stepUpRequired` (L323) — return step-up even if `hitlApproved`.
  - deny-amount (L289) — unchanged.

### 2. Live — `pingOneAuthorizeService.evaluateMcpToolDelegation` (L229)
- Add `hitlApproved` param; include `...(hitlApproved ? { HitlApproved: true } : {})`
  in the `parameters` block sent to the MCP decision endpoint.
- No client-side verdict change — the **policy** uses `HitlApproved` to flip
  `INDETERMINATE → PERMIT`. (Trust Framework edit, below.)

### 3. BFF gate — `mcpToolAuthorizationService.evaluateMcpFirstToolGate`
- Accept `hitlApproved` (already verified by the pipeline; see #4).
- Pass into both `simulatedAuthorizeService.evaluateMcpFirstTool({...hitlApproved})`
  and `pingOneAuthorizeService.evaluateMcpToolDelegation({...hitlApproved})`.
- Anti-loop: if an engine returns `hitlRequired` while `hitlApproved===true`,
  return a distinct `block` (403, `error: 'mcp_hitl_receipt_rejected'`) instead
  of another 428 — never re-issue a challenge for an already-approved receipt.

### 4. Pipeline — `mcpToolPipeline.js`
- Extract `_hitl_challenge_id` from incoming tool params (strip before
  forwarding to MCP, same as the gateway does).
- If present: call the HITL service (`getHitlChallengeStatus`) + apply the
  shared binding check; set `hitlApproved = verified.ok`.
- Pass `hitlApproved` into `evaluateMcpFirstToolGate`.
- Needs a HITL client in `demo_api_server` (new small module mirroring
  `demo_mcp_gateway/src/hitlClient.ts`), or reuse if one already exists.

### 5. Gateway — `PingOneAuthorizeClient.ts` / `pingAuthorizeGuard.ts` / `index.ts`
- `buildAuthorizeParameters`: add 7th param `hitlApproved?: boolean`; always
  emit `HitlApproved: hitlApproved ? 'true' : 'false'`.
- `guardToolCall` + `PingOneAuthorizeClient.evaluate`: add `hitlApproved` param,
  thread into `buildAuthorizeParameters`.
- `index.ts`: `const hitlApproved = Boolean(hitlChallengeId) && verification.ok;`
  → pass to `guardToolCall`. Anti-loop: `INDETERMINATE` + `hitlApproved` →
  distinct DENY, not a new challenge.
- **HTTP transport parity:** find the `PingOneAuthorizeClient.evaluate` call site
  for the HTTP MCP path and thread `hitlApproved` there too, or HTTP retries
  loop. **Must-do.**

### 6. Trust Framework (PingOne Authorize console — not repo code)
- Add attribute `HitlApproved` sourced from decision `parameters`.
- Rule: `amount >= threshold AND HitlApproved == "false" → INDETERMINATE`;
  `amount >= threshold AND HitlApproved == "true" → PERMIT`.
- Step-up rule unchanged (receipt does not satisfy MFA).
- **Inert without this** — ship the code's anti-loop DENY so a missing policy
  edit fails clean instead of looping.

---

## Tests

- **Simulated** (`simulatedAuthorizeService` MCP tests):
  - `>= confirm, hitlApproved=false → INDETERMINATE(hitl)`
  - `>= confirm, hitlApproved=true → PERMIT`
  - `>= stepup, hitlApproved=true → still step-up`
  - audience-mismatch + `hitlApproved=true → still DENY`
- **BFF gate** (`mcpToolAuthorizationService`): receipt threads to PERMIT;
  no receipt → 428; `hitlApproved=true` + engine still HITL → 403 receipt-rejected.
- **Pipeline**: `_hitl_challenge_id` present + approved+bound → gate sees
  `hitlApproved=true`; mismatched receipt → not set (assert HITL service binding
  check rejects).
- **Gateway**: existing tests green + `HitlApproved` param asserted present;
  approved retry → PERMIT+forward; mismatched receipt → rejected before policy.
- Run: `npx jest` (simulated + gate + pipeline) in `demo_api_server`;
  `npm run build` in `demo_mcp_gateway`.

---

## Risks / invariants

1. **Parity**: `HitlApproved` semantics identical in simulated and live
   (consent-dischargeable; step-up NOT; audience-mismatch wins first). Shared
   test asserting both engines agree.
2. **HTTP gateway parity**: wire the HTTP `evaluate` call site or HTTP retries loop.
3. **Two-gate ordering**: `verifyHitlReceipt` / binding check ALWAYS before the
   policy call. Never send `HitlApproved=true` for a receipt that failed binding.
4. **Anti-loop DENY ships with code** even though the TF policy edit is external.
5. **Fail-closed posture** unchanged on the gateway; BFF respects existing
   `ff_authorize_fail_open`.
6. **REGRESSION_PLAN**: this touches authorize gate + HITL — add a §4 bug/feature
   log entry and re-run the critical suite per `hitl-consent` / `regression-guard`.

## Scope estimate
~5 files `demo_api_server` (simulated, pingOne, gate, pipeline, new hitl client) +
3 files `demo_mcp_gateway` + tests. ~1 day code; TF console policy edit is the
gating external dependency — do it in a test env first.
