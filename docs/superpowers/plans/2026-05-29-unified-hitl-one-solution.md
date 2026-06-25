# Plan — One HITL solution across all services

**Date:** 2026-05-29
**Status:** Plan only — no code yet (supersedes the BFF-gate slice of
`2026-05-29-hitl-receipt-aware-permit.md`, which assumed a native pending-decision receipt).
**Directive:** "all services do HITL the same. 1 solution."
**Decisions (user):** canonical store = **`demo_hitl_service` (port 3009)**; **plan first**.

---

## Why this supersedes the earlier slice

The repo has **three** HITL receipt models today:

1. **Gateway agent path** → `demo_hitl_service` (3009) challenge + `verifyHitlReceipt`
   (`demo_mcp_gateway/src/hitlClient.ts`). Binds **user + agent + tool**, checks
   approved + not-expired. Strongest anti-replay.
2. **BFF agent gate** → in-process `createPendingDecision` store
   (`demo_api_server/routes/mcpDecisionPolling.js`). Binds **userSub only**;
   no agent/tool binding. Polled by the agent UI.
3. **Direct-UI transactions** → `transactionConsentChallenge.js` (OTP + snapshot
   equality, session-scoped). Different purpose (human at the keyboard, not an agent).

The receipt-aware-PERMIT work added `hitlApproved` to both authz engines but no
caller passes it (code-review finding #1) and `verifyHitlReceipt` doesn't exist in
the BFF (finding #2). Wiring the BFF gate to model #2 would entrench the divergence
the directive forbids. So: **collapse the agent paths onto model #1.**

## Goal

`demo_hitl_service` (3009) is the single source of truth for **agent-initiated** HITL
challenges and receipts. Both the gateway and the BFF create challenges there and
verify receipts there via one shared `verifyHitlReceipt` contract. `hitlApproved` is
set true ONLY after that verification. Direct-UI (#3) is explicitly **out of scope**
for unification now (different actor model) but documented as a deliberate exception.

## Success criteria

1. One challenge store (3009), one receipt-verification contract used by gateway **and** BFF.
2. BFF gate: on a HITL retry carrying a challenge id, the pipeline verifies the receipt
   against 3009 (approved + not-expired + bound to this user/agent/tool) and only then
   passes `hitlApproved=true` into both authz engines.
3. Missing/invalid/expired/denied receipt on retry → **re-challenge (428)**, never a
   silent PERMIT (user's "re-challenge" decision). A *forged* id that fails binding is
   logged and also re-challenged (not 403, per that decision).
4. No second receipt model added; `createPendingDecision` is either retired or made a
   thin adapter over 3009 (see Open Q1).
5. Parity: sim and live authz engines both receive the verified `hitlApproved` identically.
6. Anti-replay preserved: a receipt for {userA, agentA, toolA} cannot authorize
   {userB / agentB / toolB} — enforced by the shared `verifyHitlReceipt` binding.
7. Tests green in isolation; `demo_hitl_service` unit tests still pass.

---

## Canonical contract (already exists in 3009 — reuse, don't reinvent)

`demo_hitl_service/src/store/challengeStore.js`:
- `create({ tool, userId, agentId, context })` → `{ id, status:'pending', createdAt, expiresAt:+5min, ... }`
- `get(id)` → lazily flips pending→expired past `expiresAt`
- `resolve(id, 'approved'|'denied')` → guards non-pending (409)
- REST: `POST /challenges`, `GET /challenges/:id`, `POST /challenges/:id/respond`,
  `GET /challenges` (`demo_hitl_service/src/routes/challenges.js`).

Reference verifier to port: `demo_mcp_gateway/src/hitlClient.ts::verifyHitlReceipt`
(status==='approved'; not past expiry; `userId`/`agentId`/`tool` match expected when present).

---

## Changes

### A. Shared BFF HITL client — NEW `demo_api_server/services/hitlServiceClient.js`
- `createChallenge({ tool, userId, agentId, context })` → POST 3009 `/challenges`.
- `getChallengeStatus(id)` → GET 3009 `/challenges/:id`.
- `verifyHitlReceipt(status, expectedUserId, expectedAgentId, expectedTool, now)` —
  JS port of the gateway's TS function, identical semantics (the single contract).
- Config: `HITL_SERVICE_URL` (default `http://localhost:3009`), 5s timeout, correlation-id header.
- Fail-closed: a 3009 outage on a *verify* → treat as not-verified → re-challenge (428),
  never PERMIT.

### B. BFF gate — `mcpToolAuthorizationService.evaluateMcpFirstToolGate`
- Add `hitlApproved` to the opts it accepts (already-verified by the pipeline; see C).
- Thread it into BOTH `simulatedAuthorizeService.evaluateMcpFirstTool({...hitlApproved})`
  and `pingOneAuthorizeService.evaluateMcpToolDelegation({...hitlApproved})`.
- Anti-loop is NOT needed as a separate DENY here because the chosen behavior is
  re-challenge: if the engine still returns hitlRequired while `hitlApproved` was
  true, that can only mean a non-consent gate (step-up) — already handled. Keep a
  one-line log if `hitlApproved===true` yet result is still hitl, to catch policy drift.

### C. Pipeline — `mcpToolPipeline.js`
- Replace the `createPendingDecision` block with the 3009 flow:
  - **First call** (gate returns `mcp_hitl_required`): call
    `hitlServiceClient.createChallenge({ tool, userId: userSub, agentId: <act.sub from token>, context })`
    and return the `challengeId` to the agent (same shape the gateway returns:
    `{ hitl:true, challengeId, expiresAt, instructions }`).
  - **Retry** (agent re-calls with the challenge id — define the carrier: a reserved
    tool-arg like `_hitl_challenge_id`, mirroring the gateway): before the gate,
    `getChallengeStatus` + `verifyHitlReceipt(status, userSub, actSub, tool)`. If ok →
    `hitlApproved=true` into the gate. If not ok → leave false → gate re-challenges (428).
- Strip `_hitl_challenge_id` from tool args before forwarding downstream (mirror gateway).

### D. Retire / adapt the native store — `routes/mcpDecisionPolling.js` (Open Q1)
- Option D1 (preferred for "1 solution"): make `createPendingDecision`/`getDecision`/
  approve/deny **thin adapters** over 3009 so the existing agent-UI polling endpoints
  keep working but there's one backing store. Keeps the UI contract; removes the second store.
- Option D2: leave it for non-agent uses if any exist (audit first). Risk: two stores persist
  → violates the directive. Prefer D1 unless audit finds a hard dependency.

### E. run.sh / config
- Ensure `demo_hitl_service` (3009) is in `SVC_LIST` and started before BFF gate use;
  add `HITL_SERVICE_URL` to `demo_api_server/.env.example`. (Verify current run.sh —
  shell was unresponsive at plan time; confirm during execution.)

### F. Direct-UI (#3) — explicitly out of scope, documented
- `transactionConsentChallenge` stays as-is (human-at-keyboard OTP + snapshot). Add a
  one-paragraph note in the `hitl-consent` skill that #3 is a deliberate exception to the
  "one solution" rule because the actor and verification (OTP, amount snapshot) differ.

---

## Open questions (resolve during execution)
1. **D1 vs D2** — does anything besides the agent gate use `createPendingDecision`? Audit
   `grep createPendingDecision|getDecision` (found: only `mcpToolPipeline.js` + the route
   itself at plan time). If truly only the gate, D1 (adapter) is clean.
2. **Retry carrier on the BFF path** — confirm the agent UI/loop can echo a
   `_hitl_challenge_id` tool-arg on retry (the gateway already does this for its path).
   If the BFF agent loop can't, define an alternate carrier (session-scoped last-challenge).
3. **agentId source** — the BFF must derive `act.sub` from the MCP token to bind the
   challenge to the agent (parity with the gateway). Confirm it's available where the
   pipeline creates the challenge (it decodes the token for the gate already).

## Verification
- `demo_hitl_service` unit tests still green.
- New `hitlServiceClient` unit tests: createChallenge POST shape; verifyHitlReceipt
  matrix (approved/expired/denied/wrong-user/wrong-agent/wrong-tool) — port the gateway's
  test cases for an identical contract.
- BFF gate/pipeline: first-call→challenge; approved+bound retry→PERMIT; missing/invalid→428.
- Run each suite in isolation (`--runTestsByPath`) — multi-file runs cross-pollute in this repo.

## Risk
- **Trust boundary:** `hitlApproved` must NEVER be set from a client-supplied flag — only
  from a 3009-verified, caller-bound receipt. This is the finding-#2 bypass; the shared
  `verifyHitlReceipt` is the only place allowed to authorize it.
- **New cross-service dependency:** the BFF now needs 3009 reachable for agent HITL. Fail-closed
  (re-challenge on outage) keeps it safe but means 3009 down = no agent writes over threshold.
