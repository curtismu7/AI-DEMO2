# Guided Demo Track — Plan D: UC16/UC2 Gauntlet Honesty + Completion Takeaways

Status: executed 2026-08-03 (investigation + fixes in one pass; this doc is the record).

## What the spec thought was broken vs. what was

The spec's "Known gaps" (written 2026-08-03 morning) committed Plan D to fixing the UC16
impersonation false pass and UC2 A2A 502s. Both were ALREADY fixed on main before the spec
was written (UC16: #1075/#1077; UC2: #1029–#1034 + cd3e1e0a). Live evidence gathered this pass:

- **UC16 / gauntlet:** `tests/real/shared/attack-sims-live.test.js` → 10/10, every sim a
  security-tier denial. Demo-track run ledger after the run (read from the live BFF's LMDB):
  gauntlet **6/6 blocked** — `impersonation-no-act 403:missing_act`,
  `insufficient-scope 403:insufficient_scope`, `wrong-aud 401:invalid_aud`,
  `cross-owner-account 403:resource_owner_mismatch`, `tampered-intent-token 401:invalid_signature`,
  `introspection-down 403:gateway_policy_denied`. The observation hooks also stamped
  `delegated-access:red` (replayed-token) and `a2a-delegation:red` (rogue-actor).
- **UC2:** the "green path broken" symptom today is NOT a 502 — it is `ff_a2a_delegation`
  sitting at its default OFF. **Trap:** `tests/real/shared/a2a-delegation-live.test.js` soft-skips
  every vertical with a `console.warn` and reports 11/11 PASSED when the flag is off — a green
  run of that suite proves nothing. Check its output for
  `[a2a-live] ff_a2a_delegation is off` before believing it.

## Fixes shipped in this branch

1. **Track step pick arms required flags** (`AIAgent.js handleTrackStepPick`): calls
   `ensureRequiredDemoFlags(requiredFlagsForUseCase({ useCaseId: step.stepId, primaryTool: <first green tool> }))`
   — the same contract as `handleDemoStepSelect` and the use-case launcher. Picking the A2A
   step now arms `ff_a2a_delegation` + `ff_mcp_gateway_pinggateway`; every tool step arms the
   gateway runtime flag. (Track stepIds intentionally align with `requiredDemoFlags`' A2A slugs:
   `a2a-delegation` matches `A2A_USE_CASE_IDS`.)
2. **Auto takeaway + "Next: Step N+1"** (Plan C deferral): `DemoTrackAgentControl` watches the
   picked step across its 5s poll and fires `onStepComplete` once per (run, step) when both
   slots fill (gauntlet: all six tiles blocked). `AIAgent` posts the `STEP N PROVED` /
   `✓` / `✕` / `SAY THIS` lines into the chat and shows a `Next: Step N+1 — <title>` chip that
   posts the next active step and re-enters the pick flow.

## Still open after Plan D

- Step 8 red path: the observation MECHANISM is live-verified (wildcard slot stamped
  `PERMIT via get_account_balance` with the step active, 2026-08-03) and the red/wildcard
  matching is unit-covered — but a REAL out-of-scope admin DENY needs a non-privileged
  session (`demoDelegate` is outside `AI_Demo_Privileged`; no delegate credentials are
  provisioned in `.env`, so the group-gate DENY on `sensitive_customer_identity` cannot be
  driven headlessly). Provision delegate creds, or accept that any failed tool call while
  step 8 is active fills the red slot (Plan A wildcard semantics).
- ~~Green-slot matcher for step 2 banking-only~~ fixed in this branch: match list now carries
  all 11 a2aDelegated specialist tools from scope-topology.
- PERMIT slots carry `decisionId: null` (Plan A simplification); mini token-chain strips.
- Full UC2 green live proof requires a signed-in browser run (headless e2e login helper
  currently loops on the PingOne signon page with its own env creds; server-side
  `loginViaBff` with `demo_api_server/.env` creds works — see session helper).
