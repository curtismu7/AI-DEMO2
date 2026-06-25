# Agent Authorization & Delegation in the Token Chain (may_act) — Design

**Date:** 2026-06-09
**Status:** Approved (design) — pending spec review
**Scope:** demo_api_server (BFF), demo_api_ui, PingOne provisioning

## Summary

Give the user a first-class control over the RFC 8693 `may_act` claim: authorize or
de-authorize the **AI agent** to act on their behalf, enforce that authorization so a
revoked agent is actually blocked, and surface **family delegation** (user→user) as its
own lane in the token chain — without disturbing the agent's load-bearing `may_act`.

This is built in three layers (A → B → C), each independently shippable.

## Background — current state (verified)

- `may_act` on the user access token is a **PingOne custom JSON user attribute `mayAct`**,
  projected via the resource attribute `may_act = ${user.mayAct}`
  (`pingoneProvisionService.js:1757-1767, 1919-1965`). Its value is
  `{ sub: <AI_AGENT_CLIENT_ID> }` — i.e. it authorizes the **agent/BFF client** to act for
  the user (agent→user). PingOne's SpEL emits the `act` chain by matching
  `may_act.sub == actorToken.client_id`.
- The **live** RFC 8693 exchange (`agentMcpTokenService.js` → `oauthService.performTokenExchange*`)
  only **presence-gates** `may_act` via `ff_require_may_act` (default **OFF**,
  `agentMcpTokenService.js:869-895`); `describeMayAct` (210-249) is descriptive only.
  `delegationClaimsService.js` is a dormant (unwired) library.
- **Family delegation** (`delegationService.js`) is user→user, stored only in LMDB, with its
  own scope vocabulary (`view_accounts`…`create_transfer`). It **never touches `may_act`**.
- Reusable PingOne plumbing: `pingOneUserService.setMayActAttribute(userId, cfg)` (279-302),
  `updatePingOneUser` (331-347), `getMayActStatus` (422-440).

### Landmines (must respect)

1. **`#{...}` SpEL-literal bug** — resource attrs must use `${user.x}`, never a `#{'sub':...}`
   map literal, or PingOne emits the literal text.
2. **Schema attribute type must be JSON** (not STRING) or the object serializes as a quoted string.
3. **PATCH-shape mismatch** — `setMayActAttribute` PATCHes `/custom/mayAct` (JSON-Patch op array)
   while provisioning PATCHes a flat `{ mayAct }` body. These must be reconciled.
4. **`may_act.sub` is single-valued and load-bearing** — overwriting it with a family member
   would break the agent exchange. Family delegation must use a parallel claim.

## Goals / success criteria

1. A user can **authorize / revoke the AI agent** from the UI; the change is reflected in the
   token chain after a silent re-auth.
2. With enforcement ON, a **revoked** agent's next tool call fails cleanly with
   `403 may_act_required` and a clear UI message; re-granting restores it.
3. **Family delegation** grants/revokes appear in the token chain as a separate
   "Delegated access" lane, with the agent's `may_act` untouched.
4. No regression to the existing agent exchange for already-authorized users (demoUser/demoAdmin).

## Out of scope

- Multi-actor `may_act` (rejected — non-standard, risks the SpEL agent match).
- Wiring `delegationClaimsService` into the live exchange.
- Changing the family-delegation banking-scope semantics.

---

## Part A — Foundation: robustify agent `may_act`

No behavior change; removes the landmines before building on top.

- **Reconcile the PATCH shape.** Empirically test (against the live env, as we did for the
  worker-token fix) whether the JSON-schema `mayAct` attribute is written via flat
  `{ mayAct: {...} }` or JSON-Patch `/custom/mayAct`. Make `setMayActAttribute` and the
  provisioning write use the **same** confirmed shape. Add a unit test pinning it.
- **SpEL audit.** Confirm the Agent-Gateway `may_act` resource attr
  (`pingoneProvisionService.js:~2229-2256`) uses `${...}` form; fix if it uses a `#{...}` map
  literal.

**Done when:** `setMayActAttribute` round-trips (`getMayActStatus` reads back what was written)
against the live env; both gateway and Demo-API `may_act` resource attrs are `${...}` form.

---

## Part B — Agent authorization control + enforcement (core)

### Backend

New route module `routes/agentAuthorization.js`, mounted at `/api/agent-authorization`:

- `POST /grant` — writes the **current user's** `mayAct = { sub: AGENT_CLIENT_ID }` via the
  reconciled `setMayActAttribute`, then returns `{ ok, reauthRequired: true }`.
  `AGENT_CLIENT_ID` = `process.env.PINGONE_AI_AGENT_CLIENT_ID` (same source provisioning uses).
- `POST /revoke` — clears the user's `mayAct` (`setMayActAttribute(userId, null)` — already the
  established "delete" call, `users.js:281`). Returns `{ ok, reauthRequired: true }`.
- `GET /status` — returns `{ authorized: boolean, enforced: boolean }` from `getMayActStatus`
  + the `ff_require_may_act` flag, for the UI to render current state.

The SPA, on a `reauthRequired` response, calls the **silent re-auth** (`requestSilentReauth`
→ `/api/auth/reauth`, from PR #101) so the new token reflects the change.

### Enforcement

- Expose `ff_require_may_act` as a UI toggle (Feature Flags + the authorization card),
  **default ON**. (Behavior change — see Risks.)
- The gate already exists (`agentMcpTokenService.js:869-895`): when ON and `may_act` absent,
  throw `code='may_act_required'`, `httpStatus=403`. Ensure the agent UI path surfaces this as
  a clean, actionable state ("The agent isn't authorized to act on your behalf — re-authorize")
  rather than a generic error. (Verify where the agent tool-call error is rendered and map the
  403 there.)

### UI

An **"AI Agent Authorization"** card on the Family Delegation page (`DelegationPage.js`):
- Status badge: Authorized / Revoked (from `GET /status`).
- Primary action: Authorize / Revoke the agent.
- "Enforce" switch bound to `ff_require_may_act`.
- After grant/revoke, the silent re-auth runs and the token-chain `may_act` chip updates.

**Done when:** toggling authorization writes/clears `mayAct`, the token chain reflects it after
re-auth, and with enforcement ON a revoked agent's tool call returns 403 with the clean UI state.

---

## Part C — Family delegation → token chain (parallel claim)

Keep `may_act = agent` (untouched). Add a **separate** claim for delegated humans.

### PingOne provisioning (mirrors the `mayAct` pattern)

- New custom JSON user-schema attribute `delegatedTo` — a JSON array of delegate `sub` strings
  (e.g. `["<delegate-user-id>", ...]`), kept in sync with the active LMDB delegation records.
- New resource attribute `delegated_to = ${user.delegatedTo}` on the Demo API (enduser)
  resource — `${...}` form only.
- Added to the provision/setup step; requires running it against the live env + redeploy.

### Backend

- `delegationService.grantDelegation` — after the LMDB write, append the delegate's sub to the
  **grantor's** `delegatedTo` PingOne attribute (read-modify-write). `revokeDelegation` removes it.
- These are best-effort with respect to PingOne (consistent with the existing email
  fire-and-forget) but must not corrupt `delegatedTo` on concurrent grants (read-modify-write
  guarded; or recompute from the active LMDB records as the source of truth on each change).
- Grant/revoke responses signal `reauthRequired` so the SPA silently re-auths.

### UI

- Token-chain panel renders `delegated_to` as its own "Delegated access" lane, distinct from the
  agent's `may_act` lane.

**Done when:** granting a family delegation adds the delegate to `delegated_to` in the
re-issued token and shows in the chain; revoking removes it; the agent's `may_act` is unchanged.

---

## Data flow (Part B grant)

```
UI "Authorize agent"
  → POST /api/agent-authorization/grant
    → pingOneUserService.setMayActAttribute(userId, { sub: AGENT_CLIENT_ID })   // PATCH PingOne user
    → { ok, reauthRequired: true }
  → requestSilentReauth()  → /api/auth/reauth → silent SSO → new token carries may_act
  → token chain shows "✅ may_act valid"; agent tool calls pass the ff_require_may_act gate
```

## Error handling

- PingOne PATCH failure on grant/revoke → 502 with an honest message; UI shows "couldn't update
  authorization, try again" (no silent success).
- Enforcement 403 (`may_act_required`) → agent UI renders the actionable "re-authorize" state.
- Re-auth failure → existing session-reauth banner path.

## Testing

- **Part A:** unit test pinning the reconciled `setMayActAttribute` PATCH shape; live round-trip
  check (write → `getMayActStatus`).
- **Part B:** unit tests for grant (writes agent sub), revoke (clears), `GET /status`; gate test
  that `ff_require_may_act` ON + absent may_act → 403 `may_act_required` (already covered in
  `agentMcpTokenService` tests — extend if needed). E2E (live, like the MFA test): authorize →
  token chain shows may_act; revoke → agent tool call 403; re-grant → works.
- **Part C:** unit tests for `delegatedTo` append/remove on grant/revoke; live check that the
  re-issued token carries `delegated_to`.

## Risks / dependencies

1. **`ff_require_may_act` default ON** is a live behavior change: every demo user's token must
   carry `may_act` or agent actions 403. Verify provisioning sets `mayAct` for **all** demo
   users, not just demoUser/demoAdmin, before flipping the default.
2. **PingOne provisioning changes** (Part C `delegatedTo` schema attr + resource mapping) must be
   applied to the live env via the setup/provision step, then redeployed.
3. **Depends on PR #101** (`/api/auth/reauth` + `requestSilentReauth`) for the silent re-auth. If
   #101 hasn't merged, fold a minimal reauth into this work.
4. PingOne writes verified against the live env (per the worker-token precedent), not assumed.

## Phasing

A → B → C in order. A and B together deliver the headline demo (authorize/revoke the agent,
enforced). C is additive and can land as a follow-up if needed.
