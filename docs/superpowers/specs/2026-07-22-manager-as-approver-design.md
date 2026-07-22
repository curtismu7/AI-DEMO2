# Manager-as-Approver (Plan A) — Design

**Date:** 2026-07-22
**Status:** Design approved by user. Next: `writing-plans` → `subagent-driven-development`.
**Builds on:** [2026-07-21-delegation-demo-scenarios-design.md](2026-07-21-delegation-demo-scenarios-design.md) (stage 4) and its follow-up handoff, [2026-07-22-delegation-work-handoff.md](../plans/2026-07-22-delegation-work-handoff.md).

## Purpose

Stage 4 of the delegation demo arc ("workforce — grant, then approve") today only has the grant half live. This design makes the approval half real: a manager, from their own logged-in session, approves an employee's high-value expense — a genuinely different principal from the one whose action is being approved. Every other approval-shaped gate in this codebase (HITL consent, step-up, CIBA) is self-approval — the acting user approves their own action, just via a different channel. This is the first true second-principal approval.

## Locked decisions (already made, not open for re-litigation)

1. **Fidelity — demo-representation.** The manager approves from a real second browser session (their own login, their own session cookie) — not a same-browser fiction. No live PingOne CIBA platform dependency; the existing *simulated* CIBA engine is extended, not replaced.
2. **Personas — purpose-built pair.** Two new workforce demo users: a manager and an employee, not a reuse of `demoAdmin`/`demoUser`/`demoDelegate`.
3. **Storage — reuse the delegation record.** No new store. The pending-approval state lives as a `pendingApproval` sub-object on the existing delegation LMDB record (`demo_api_server/services/delegationService.js`), one pending approval at a time (matches how CIBA already replaces a prior pending request on re-initiate — no queue).
4. **Manager UI — inline panel on `/delegation`.** No new route. The manager already sees the delegations they granted on `/delegation`; a row with a pending approval gets an inline Approve/Deny action.
5. **The manager's action is a plain authenticated REST call, not CIBA.** CIBA/backchannel is what notifies *and polls* the employee's device — the manager isn't being pushed to, they're proactively viewing a page they already own and clicking a button. Only the employee side keeps the existing CIBA UI/polling; what satisfies that poll changes.

## Confirmed during this design pass (not assumed)

Read `useCaseDemoBehaviors.js:29` (`resolveActiveUseCaseId`) — a chip's tool call only resolves to a given `useCaseId` if the chip itself carries `useCaseId` in its manifest definition (or the session previously stashed one via the Use-Case Launcher). Grepping every vertical manifest for `ciba-out-of-band-approval` found **exactly one chip in the entire repo**: banking's `bk-ciba` (`config/verticals/banking/manifest.json:129`):
```json
{ "id": "bk-ciba", "label": "CIBA out-of-band", "message": "transfer $600 from checking to savings with CIBA approval", "mode": "both", "challenge": "both", "hitlTrigger": true, "tool": "create_transfer", "useCaseId": "ciba-out-of-band-approval", "group": "advanced" }
```
Workforce's existing `$600` chips (`sec_mfa_otp`, `sec_mfa_fido`, `sec_hitl` at `config/verticals/workforce/manifest.json:138-140`) all declare `useCaseId` values other than `ciba-out-of-band-approval` (step-up/consent, not CIBA). **Workforce has no CIBA-triggering chip today — this design adds one**, following `bk-ciba`'s exact shape.

## Architecture

### Data model — one new field on the existing delegation record

`demo_api_server/services/delegationService.js`'s LMDB record gains:
```js
pendingApproval: {
  authReqId, amount, tool, bindingMessage,
  status: 'pending' | 'approved' | 'denied',
  requestedAt, resolvedAt,
} | null
```
Written and cleared entirely through `delegationService` — no other module reads/writes LMDB directly, matching the existing pattern (`grantDelegation`, `revokeDelegation`, etc. are the only writers today).

### Employee side (mostly reused, one new linking step)

1. Employee clicks the new workforce CIBA chip → `submit_expense` at $600 → `mcpToolAuthorizationService` resolves `declaresCiba` (unchanged) → 428 `step_up_method: 'ciba'` (unchanged) → `AIAgent.js`'s existing CIBA UI opens (unchanged) → `POST /api/auth/ciba/initiate` (unchanged endpoint, **new internal branch**).
2. **New:** inside `/initiate`, after computing `loginHint` as today, look up the employee's active delegation-as-delegate (a new `delegationService.findActiveByDelegate(userId)` — mirrors the existing `findActiveByActorAndGrantor` read pattern in `delegationGate.js`). If found and it has `create_transfer` scope, this becomes a manager-approval flow: tag the session's `cibaRequests[authReqId]` with `delegationId`, and call `delegationService.requestApproval(delegationId, { authReqId, amount, tool, bindingMessage })` to write `pendingApproval` onto the record, instead of relying purely on `cibaSimulatedService`'s timer.
3. Employee keeps polling `GET /api/auth/ciba/poll/:authReqId` exactly as today. **New:** when `pending.delegationId` is set, the poll checks `delegationService.getApprovalStatus(delegationId)` instead of `cibaSimulatedService.isSimulatedApproved(pending)`. On `'approved'`: identical finalization as today (`stepUpVerified`, `hitlVerified`, `trackTokenEvent`), plus `additionalData.approvedBy: <managerUserId>` so the Token Chain panel shows who approved, not just who acted. On `'denied'`: same 403 shape as today.
4. If no active manager delegation is found in step 2, the flow falls through to today's plain simulated-timer behavior unchanged — this design only activates for a workforce employee with a real manager delegation, it does not change CIBA behavior for banking or any other existing use.

### Manager side (new, small)

1. `GET /api/delegation` (already used by `/delegation` to list what the current user granted) — **new:** include `pendingApproval` in each record returned (the existing `toRecord()` serializer gains one field).
2. Two new endpoints in `routes/delegation.js`, following the exact ownership-check pattern `revoke` already uses (caller must be `record.delegator_user_id`):
   - `POST /api/delegation/:id/approve`
   - `POST /api/delegation/:id/deny`
   Both call into `delegationService.resolveApproval(delegationId, managerUserId, decision)`, which verifies ownership, then sets `pendingApproval.status` + `resolvedAt`.
3. `DelegationPage.js` — when rendering the delegations list (already scoped to "what I granted"), a row whose `pendingApproval?.status === 'pending'` renders an inline banner + Approve/Deny buttons, calling the two new endpoints.

### Provisioning

Two new workforce demo users, following `services/pingoneProvisionService.js`'s existing "Step 14.5" pattern (which already creates `demoDelegate`): a manager and an employee, added to `config/verticals/workforce/manifest.json`'s `demoUsers` block. At demo-setup time (or as a one-time provisioning step), the manager grants the employee `create_transfer` via the existing, unmodified `/delegation` grant flow — this is the same grant mechanism stage 1 (family) already uses, just with workforce personas.

### New workforce chip

A `wf-ciba`-equivalent chip in `config/verticals/workforce/manifest.json`, same shape as `bk-ciba`, workforce-flavored:
```json
{ "id": "wf-ciba", "label": "🔑 Submit expense (manager approval)", "message": "submit a $600 expense with manager approval", "mode": "both", "challenge": "both", "hitlTrigger": true, "tool": "submit_expense", "useCaseId": "ciba-out-of-band-approval", "group": "advanced" }
```
(Exact label/message wording is a copy detail for the plan, not a design fork.)

## Data flow (happy path)

1. Manager grants employee `create_transfer` via `/delegation` (existing, unchanged).
2. Employee clicks the new CIBA chip → 428 → CIBA UI opens → `/initiate` finds the active manager delegation → writes `pendingApproval` on the delegation record → employee sees "waiting for approval."
3. Manager (own session) opens `/delegation`, sees the pending row, clicks Approve → `POST .../approve` → `delegationService.resolveApproval` sets `status:'approved'`.
4. Employee's next `/poll` sees `'approved'` → finalizes step-up/HITL exactly as today → transfer proceeds → Token Chain shows `approvedBy: manager`.

## Error handling

- **No active manager delegation found** at initiate time → fall through to existing simulated-timer behavior (documented above) — this design must not break CIBA for any flow that isn't workforce-manager-approval.
- **Manager denies** → `pendingApproval.status:'denied'`, employee's poll returns the existing 403 `access_denied` shape, unchanged from today's deny path.
- **Non-owner calls approve/deny** → 403, same ownership-check shape `revoke` already returns for a non-owner.
- **Expiry** → the existing `pending.expiresAt` / `Date.now() > pending.expiresAt` check in `/poll` already deletes the session-side record on timeout; the delegation record's stale `pendingApproval` should be cleared too (a small addition — clear it when `/poll` detects expiry, or when a new `requestApproval` overwrites it, whichever the plan finds simpler).

## Testing

- `delegationService`: `requestApproval`, `resolveApproval` (approve + deny + non-owner-rejected), `findActiveByDelegate`.
- `routes/delegation.js`: `POST /:id/approve`, `POST /:id/deny` — ownership enforcement, state transitions.
- `routes/ciba.js`: `/initiate` branches correctly when a manager delegation exists vs. doesn't (falls through unchanged); `/poll` reads delegation-record status when `delegationId` is tagged.
- `DelegationPage.js`: renders the Approve/Deny row only when `pendingApproval?.status === 'pending'`, calls the right endpoint.
- Manual/live verification: full happy path across two real browser sessions (manager + employee), since this is exactly the kind of cross-session behavior that a unit test cannot fully prove.
- Regression: existing CIBA tests (banking `bk-ciba` flow, any vertical without a manager delegation) must be unaffected — assert the fallthrough path explicitly.

## Out of scope

- Any change to real PingOne CIBA (`cibaService.js`, the real `bc-authorize` branch) — this design is entirely inside the simulated engine.
- A queue of multiple concurrent pending approvals per delegation.
- A dedicated `/approvals` page or notification/banner UI (considered and explicitly not chosen — see the locked decisions above).
- Changing `delegationGate.js` or `delegationAuditLogger.js`'s existing enforcement/logging — this design adds a field and endpoints alongside them, does not touch their logic.

## Self-review

- **Placeholder scan:** none — every component names its exact file, and the one new chip's exact JSON is given.
- **Internal consistency:** the "manager action is plain REST, not CIBA" decision (point 5) is carried through consistently in the architecture and data-flow sections — no step accidentally routes the manager through backchannel auth.
- **Scope:** single coherent feature, one plan. Not decomposed further — the pieces (data model, employee-side hook, manager-side endpoints + UI, provisioning, chip) are tightly coupled and ship together.
- **Ambiguity check:** the only soft point (expiry cleanup of `pendingApproval`) is flagged explicitly as an implementation detail for the plan to pin down, not left silently ambiguous.
