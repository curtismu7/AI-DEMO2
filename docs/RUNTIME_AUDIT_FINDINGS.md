# Runtime, Hidden-Error & Performance Audit — demo_api_server + demo_api_ui

Findings from a category-parallel multi-agent audit (2026-08-23): 6 finder agents
(one per category × service) followed by an adversarial verify pass per category
(default to REJECTED unless the file/line and behavior could be confirmed
directly). All 27 candidate findings survived verification — 0 rejected.

**Round 2 (2026-08-23, same day, after round 1 fully fixed and merged in
PR #2278):** re-ran the identical 6-finder-agent + per-category adversarial
verify design against the post-fix codebase. Finders were told which files
round 1 had already touched and to report only genuinely new, distinct
issues there. 12 of 12 candidate findings (#28–#39) survived verification —
0 rejected.

**Round 3 (2026-08-23, same day, after round 2 fully fixed and merged in
PR #2294):** same design again, against the post-round-2 codebase, told
about all 39 files touched by rounds 1–2. 17 of 17 candidate findings
(#40–#56) survived verification — 0 rejected.

**Round 4 (2026-08-23, same day, after round 3 fully fixed and merged in
PR #2297):** same 6-finder-agent + adversarial-verify-per-candidate design,
run as a Workflow against the post-round-3 codebase, told about all 52
files touched by rounds 1–3. 10 of 10 candidate findings (#57–#66)
survived verification — 0 rejected. Unlike prior rounds, round 4 fixes each
get their own PR (fix → PR → merge in batches of 3) instead of one PR per
fully-fixed round.

**Working rule:** when a finding is fixed, flip its Status to `FIXED` with the
PR number (or commit) and evidence **in the same commit as the fix**, and add a
Changelog line. A status column that lags the code is the same false-green
failure `docs/UI_FINDINGS.md` warns about.

## Status key

`OPEN` · `IN PROGRESS` · `FIXED` (needs PR/commit + evidence) · `WONTFIX` (needs reason) · `INVALID`

## Summary

| # | Category | File | Severity | Status |
|---|---|---|---|---|
| 1 | Runtime | `services/killSwitchService.js` | critical | FIXED |
| 2 | Runtime | `services/mcpWebSocketClient.js` | high | FIXED |
| 3 | Runtime | `demo_api_ui/.../AIAgent.js` (CIBA pollers) | high | FIXED |
| 4 | Runtime | `middleware/agentSessionMiddleware.js` | medium | FIXED |
| 5 | Runtime | `services/apiCallTrackerService.js` | medium | FIXED |
| 6 | Runtime | `services/transactionConsentChallenge.js` | medium | FIXED |
| 7 | Runtime | `demo_api_ui/.../AIAgent.js` (aguiAbort) | medium | FIXED |
| 8 | Runtime | `demo_api_ui/.../AIAgent.js` (refreshAfterTransaction) | medium | FIXED |
| 9 | Swallowed | `middleware/delegationGate.js` | high | FIXED |
| 10 | Swallowed | `demo_api_ui/.../AdminSideNav.jsx` (reset demo) | high | FIXED |
| 11 | Swallowed | `demo_api_ui/.../DelegationPage.js` | high | FIXED |
| 12 | Swallowed | `middleware/agentRestrictionsGate.js` | medium | FIXED |
| 13 | Swallowed | `routes/agentAuthorization.js` | medium | FIXED |
| 14 | Swallowed | `demo_api_ui/.../AdminSideNav.jsx` (vertical list) | medium | FIXED |
| 15 | Swallowed | `demo_api_ui/.../AdminSideNav.jsx` (switch vertical) | medium | FIXED |
| 16 | Swallowed | `demo_api_ui/.../CopilotAgent.jsx` | medium | FIXED |
| 17 | Swallowed | `demo_api_ui/.../CreateUserPanel.jsx` | medium | FIXED |
| 18 | Swallowed | `demo_api_ui/.../BulkDecisionPanel.jsx` | low | FIXED |
| 19 | Perf | `routes/agentRun.js` | high | FIXED |
| 20 | Perf | `demo_api_ui/vertical/VerticalProvider.jsx` | high | FIXED |
| 21 | Perf | `demo_api_ui/.../AIAgent.js` (O(N²) proof scan) | high | FIXED |
| 22 | Perf | `services/pingoneProvisionService.js` (grantScopes) | medium | FIXED |
| 23 | Perf | `services/pingoneProvisionService.js` (wipeEnvironment) | medium | FIXED |
| 24 | Perf | `demo_api_ui/.../AIAgent.js` (unbounded transcript) | medium | FIXED |
| 25 | Perf | `TokenChainTraceRail.jsx` / `TokenChainFilmstrip.jsx` | medium | FIXED |
| 26 | Perf | `routes/transactions.js` / `routes/accounts.js` | low | FIXED |
| 27 | Perf | `TraceStepCard.jsx` | low | FIXED |
| 28 | Runtime | `services/pingOneGroupMembershipService.js` | high | FIXED |
| 29 | Runtime | `demo_api_ui/.../hooks/useDraggablePanel.js` | high | FIXED |
| 30 | Runtime | `demo_api_ui/.../bankingRestartNotificationService.js` | medium | FIXED |
| 31 | Runtime | `demo_api_ui/.../services/sessionResolver.js` | low | FIXED |
| 32 | Swallowed | `routes/adminConfig.js` (generate-keypair) | high | FIXED |
| 33 | Swallowed | `demo_api_ui/.../hooks/useElicitation.js` | medium | FIXED |
| 34 | Swallowed | `demo_api_ui/.../DemoSetupPanel.js` (reset demo) | low | FIXED |
| 35 | Perf | `services/auditLogService.js` | medium | FIXED |
| 36 | Perf | `services/demoTrackService.js` | medium | FIXED |
| 37 | Perf | `services/traceProjector.js` | low | FIXED |
| 38 | Perf | `demo_api_ui/.../context/ActivityNarrativeContext.js` | medium | FIXED |
| 39 | Perf | `demo_api_ui/.../ScopeAuditPage.js` | medium | FIXED |
| 40 | Runtime | `services/cibaTransactionReceipt.js` | medium | FIXED |
| 41 | Runtime | `services/hitlCredit.js` | medium | FIXED |
| 42 | Runtime | `services/http2McpBridge.js` | low | FIXED |
| 43 | Runtime | `routes/privilegeMcpClient.js` | low | FIXED |
| 44 | Runtime | `demo_api_ui/.../services/spinnerActivityService.js` | medium | FIXED |
| 45 | Runtime | `demo_api_ui/.../services/cachedStatusService.js` | low | FIXED |
| 46 | Swallowed | `routes/mcpGatewayConfig.js` | medium | FIXED |
| 47 | Swallowed | `routes/agentConsentRoute.js` | high | FIXED |
| 48 | Swallowed | `services/groupPolicy.js` | low | FIXED |
| 49 | Swallowed | `demo_api_ui/.../components/Users.js` | medium | FIXED |
| 50 | Swallowed | `demo_api_ui/.../components/ActivityLogs.js` | medium | FIXED |
| 51 | Swallowed | `demo_api_ui/.../components/ThemeZonePanel.js` | high | FIXED |
| 52 | Swallowed | `demo_api_ui/.../pages/ResourceServerJourneyPage.jsx` | medium | FIXED |
| 53 | Perf | `middleware/activityLogger.js` | medium | FIXED |
| 54 | Perf | `services/tokenValidationService.js` | low | FIXED |
| 55 | Perf | `services/agentScopes.js` | low | FIXED |
| 56 | Perf | `demo_api_ui/.../components/UserDashboard.js` | medium | FIXED |
| 57 | Runtime | `services/pingOneAuthorizeService.js` | medium | FIXED |
| 58 | Runtime | `services/lighthouseService.js` | low | FIXED |
| 59 | Runtime | `demo_api_ui/.../pages/PrivilegeMcpClientPage.jsx` | medium | FIXED |
| 60 | Runtime | `demo_api_ui/.../components/AgentGatewayLogPanel.jsx` | low | FIXED |
| 61 | Runtime | `demo_api_ui/.../components/NewRelicDashboard.jsx` | low | FIXED |
| 62 | Swallowed | `routes/enterpriseIdp.js` | medium | FIXED |
| 63 | Swallowed | `demo_api_ui/.../services/agentAccessConsent.js` | high | FIXED |
| 64 | Swallowed | `demo_api_ui/.../services/logout.js` | medium | FIXED |
| 65 | Perf | `services/configStore.js` | medium | FIXED |
| 66 | Perf | `demo_api_ui/.../pages/UseCaseLauncherPage.js` | medium | FIXED |

---

## Findings

### 1. `killAgent()` used shared function-object state for a per-call value — race disables the wrong user — FIXED

**File:** `demo_api_server/services/killSwitchService.js`, `killAgent()` (was lines 520–566)

**Issue:** Stashed the per-call `userId` on the shared, module-singleton function
object (`killAgent._userId = userId || null`) instead of using the `userId`
parameter already in local scope, then read it back after an `await`.

**Trigger scenario:** Two concurrent `killAgent('full', ...)` calls for
different users interleave across the `await revokeAllTokens(...)` yield.
Call B's write clobbers Call A's value before Call A reads it — Call A
disables **user B's** PingOne account, and Call B's own later read finds the
field already nulled and silently skips disabling its own target.

**Fix:** Deleted every read/write of `killAgent._userId`; the function already
had the correct per-invocation value in the `userId` parameter the whole time,
so no new variable was needed — just stop routing through the shared one.

**Evidence:** `cd demo_api_server && CI=true npx jest src/__tests__/killSwitchService.test.js tests/killSwitchKeyAlignment.integration.test.js tests/adminKillSwitchRoute.derivedKey.test.js tests/killSwitchUnrevoke.test.js tests/mcpToolPipeline.killSwitch.test.js tests/killSwitchAutoReset.test.js --forceExit --maxWorkers=4` — 6 suites / 34 tests passed.

### 2. Outer WS timeout races a 60s human-response window — FIXED

**File:** `demo_api_server/services/mcpWebSocketClient.js` — outer timeout (310–313) vs. elicitation/create (427–489), sampling/createMessage (495–525), roots/list (530–533)

**Issue:** The 15s outer timeout guarding the tools/list|tools/call round trip
is never cleared when a server-initiated request arrives mid-flight, even
though elicitation alone waits up to 60s for a human.

**Trigger scenario:** A tool call triggers elicitation and a human takes >15s
to answer. The outer timer fires, calls `ws.terminate()`, rejects the outer
promise — but the elicitation promise is still pending. When the human answers
(a live, reachable route — `POST /api/mcp/elicit/response`, server.js:2452–2458),
the resolved handler sends on an already-terminated socket.

**Fix:** the outer timeout is now a re-armable `let` (via an `armTimeout()`
helper). Both the elicitation/create and sampling/createMessage branches
`clearTimeout(timeout)` before awaiting their (potentially long) response and
`timeout = armTimeout()` once the reply is sent back over the wire, so the 15s
budget only ever covers the actual tools/list|tools/call round trip.
`roots/list` responds synchronously with no `await` in between, so it has no
race window and needed no change.

**Evidence:** new test `mcpWebSocketClient.elicitation.test.js` — "does not
terminate the socket while a human elicitation response is still pending past
the 15s round-trip budget" — confirmed to fail against the pre-fix file
(`Error: MCP call timed out` thrown at the old unconditional `setTimeout`
callback when advancing fake timers 20s past the elicitation dispatch) and
pass against the fix. Full suite: `cd demo_api_server && CI=true npx jest src/__tests__/mcpWebSocketClient.elicitation.test.js tests/mcpWebSocketClient.progress.test.js tests/mcpWebSocketClient.gatewayWsUrl.test.js src/__tests__/mcpWebSocketClient.samplingRoots.test.js src/__tests__/mcpWebSocketClient.closeHandling.test.js tests/agentTool.elicitation.test.js tests/mcpToolRegistry.elicitation.test.js src/__tests__/mcpGatewayClient.elicitationRequired.test.js src/__tests__/mcpToolPipeline.elicitation.test.js src/__tests__/elicitation.integration.test.js --forceExit --maxWorkers=4` — 10 suites / 23 tests passed.

### 3. CIBA poll timers never cleared on unmount — FIXED

**File:** `demo_api_ui/src/components/AIAgent.js` — `pollCibaStepUp` (was 8578–8636), `pollCibaThenResumeNl` (was 8954–9038)

**Issue:** Both implement a self-rescheduling `setTimeout` chain; `cibaPollersRef`
stores only the poll callback (for storage-event wake-up), never the timer id —
no unmount cleanup clears any pending timer.

**Trigger scenario:** User triggers a CIBA step-up, then closes the agent panel
before the server returns a terminal status. The recursive timer keeps firing
against a dead closure — including a delayed re-fire (`isRefire:true`) the user
never asked for after navigating away.

**Fix:** Added `cibaPollTimeoutsRef` (a `Map<authReqId, timeoutId>`, mirroring
`cibaPollersRef`'s keying) and `cibaUnmountedRef`. Every `setTimeout(poll, ...)`
call site in both functions now records its id in the map; every terminal
branch deletes its entry; and the existing `storage`-listener effect's cleanup
(already the natural once-per-mount home, since it already runs on unmount)
now also sets `cibaUnmountedRef.current = true` and clears every pending timer
in the map. Both `poll()` closures check `settled || cibaUnmountedRef.current`
at every point they'd otherwise act on a resolved fetch, so a fetch already
in flight at unmount time is also a no-op on return instead of calling
`addMessage`/`runAction` against a dead instance.

**Evidence:** new test in `AIAgent.cibaStepUp.test.js` — "clears the pending
poll timer on unmount instead of continuing to poll a dead instance" — starts
a CIBA flow, unmounts, advances fake timers 60s, and asserts
`/api/auth/ciba/poll/` is never called. Confirmed to fail against the pre-fix
file (`expected true to be false` — the poll endpoint WAS called post-unmount)
and pass against the fix. Full suite: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.cibaStepUp.test.js src/pages/__tests__/CibaApprovalPage.test.js src/pages/__tests__/CibaApprovalPage.test.jsx src/components/__tests__/CibaStepUpFlowPanel.test.jsx` — 4 files / 32 tests passed; `npm run build` exit 0.

### 4. `_refreshBlacklist` Map has no periodic sweep — FIXED

**File:** `demo_api_server/middleware/agentSessionMiddleware.js`, line 28

**Issue:** Module-level Map, only self-pruned per-key on lookup. Its own doc
comment says it mirrors `tokenRefresh.js`'s structure, which *does* have a
`setInterval` sweep — never carried over here.

**Trigger scenario:** Any session whose refresh token PingOne rejects gets an
entry; if the user never returns with that exact session id (the common case
after a forced re-auth), the entry sits forever.

**Fix:** Added the identical `setInterval` sweep `tokenRefresh.js` already
uses (same 5-minute interval, same deletion loop, `.unref()`'d).

**Evidence:** neither this file nor `tokenRefresh.js` exports its private
blacklist Map for inspection (matching this codebase's existing convention —
no test-only export was added to preserve it), so verified directly: a probe
script patched `global.setInterval` around `require(...)` and confirmed the
module registers a 300000ms (5 min) interval with `.unref()` called, and the
sweep's exact deletion logic (copied verbatim) correctly removes only expired
entries from a scratch Map. Existing suite: `cd demo_api_server && CI=true npx jest src/__tests__/agentSessionMiddleware.test.js --forceExit` — 9/9 passed, no regression.

### 5. `apiCalls`/`sessionTokens` Maps grow unbounded per session key — FIXED

**File:** `demo_api_server/services/apiCallTrackerService.js`, lines 23/27

**Issue:** Both keyed by `sessionId` with no TTL/eviction of stale *keys* —
only the array value under each key is capped. Clear functions only fire from
explicit admin/UI actions, never on session expiry or logout.

**Trigger scenario:** Every distinct session that ever triggers a tracked
call/token leaves a permanent Map entry, independent of the session's own LMDB
expiry.

**Fix:** Added a `lastActivity` Map (touched on every `pushCall`/`trackToken`
write, skipping the shared `GLOBAL_SESSION_ID` ring buffer) and
`sweepStaleTrackerSessions()`, run on an hourly `setInterval` (`.unref()`'d)
using the same 24h TTL / hourly cadence as `services/lmdb/sessionStore.js`'s
own cleanup — this tracking data's lifetime is now tied to the session data
it shadows instead of the process lifetime.

**Evidence:** this file already had a `_resetForTests` test-only export
(established convention), so added `_setLastActivityForTests` and
`_hasTrackedDataForTests` alongside it and exported `sweepStaleTrackerSessions`
directly. 3 new tests confirmed to fail against the pre-fix file
(`sweepStaleTrackerSessions`/`_setLastActivityForTests` undefined) and pass
against the fix, including one proving `GLOBAL_SESSION_ID` is never swept.
`cd demo_api_server && CI=true npx jest src/__tests__/apiCallTrackerService.test.js tests/apiCallTrackerTokenIsolation.regression.test.js --forceExit` — 2 suites / 9 tests passed.

### 6. HITL challenge mutated from independent in-memory copies — FIXED

**File:** `demo_api_server/services/transactionConsentChallenge.js` — `confirmChallenge()` (was 372–526), `verifyOtp()` (was 672–729), `verifyMfa()` (was 741–822)

**Issue:** The challenge lives in `req.session.txConsentChallenges`, loaded
once per request with no per-session lock. Two concurrent requests for the
same challenge each work from an independent copy; last `session.save()` wins.

**Trigger scenario:** A double-clicked Confirm/Verify-OTP sends two concurrent
POSTs for the same `challengeId`. Both see `otpAttempts=0`, so the lockout
counter can be bypassed, and device-picker/OTP init can silently fire twice.

**Fix:** A queue-and-reload mutex (like the audit's original sketch) would
need to re-deserialize `req.session` mid-request to see the other request's
persisted result — a much larger, riskier change to a §1-protected path for
one bug. Instead: a simple in-process `Set` (`_challengeBusy`) keyed by
`challengeId`. Each of the three functions was split into a thin locked
wrapper (`confirmChallenge`/`verifyOtp`/`verifyMfa`) plus its original body
renamed to a private `_*Impl`; the wrapper rejects a second concurrent call
for the same `challengeId` with `409 challenge_busy` instead of letting it
race. `verifyOtp` was synchronous with no internal `await`; it's now `async`
(its one call site in `routes/transactions.js` updated to `await`) so the
lock can wrap it uniformly with the other two. `confirmChallengeViaDaVinci`'s
existing fallback call to `confirmChallenge` is unaffected — it isn't itself
locked, so it correctly acquires the lock fresh.

**Evidence:** 2 new tests in `transactionConsentChallenge.test.js` — two
concurrent `verifyOtp` calls for one challenge: exactly one gets `409
challenge_busy`, the other actually evaluates, and `otpAttempts` ends at `1`
(not silently `0` twice). Confirmed to fail against the pre-fix file (`busy`
array length 0 — both calls raced through) and pass against the fix. A second
test confirms a later, non-overlapping call still succeeds normally (lock
isn't stuck). One pre-existing test updated for the new `async` signature
(`await`ed a call that used to be synchronous). Full scope run given this is
a REGRESSION_PLAN §1 path: `cd demo_api_server && CI=true npx jest src/__tests__/transactionConsentChallenge.test.js tests/services/transactionConsentChallengeDavinci.test.js tests/routes/transactionsConfirmDavinci.test.js src/__tests__/transactions.crud.test.js src/__tests__/transactions.authorization.test.js src/__tests__/resourceServer.transactions.regression.test.js tests/hitlBypass.regression.test.js src/__tests__/hitlRoute.integration.test.js src/__tests__/hitlRoute.regression.test.js --forceExit --maxWorkers=4` — 9 suites / 96 tests passed.

### 7. Unmount cleanup misses `aguiAbort()` — FIXED

**File:** `demo_api_ui/src/components/AIAgent.js`, unmount effect (was 8276–8283)

**Issue:** The unmount/route-change cleanup only aborts `sendAbortRef.current`
— never calls `aguiAbort()`, so `useAgentRun`'s AbortController-driven stream
keeps running post-unmount.

**Trigger scenario:** An AG-UI run is in flight when the user navigates away;
the stream keeps calling event closures over an unmounted instance's setState
functions.

**Fix:** Added `aguiAbort()` (stable, empty-deps identity from `useAgentRun`,
confirmed safe to add to the effect's dep array with no behavior change) to
this effect's cleanup body. Note a *separate*, pre-existing effect (empty
deps, fires once on true unmount only) already called `aguiAbort()` — this
fix's actual incremental value is the case that effect can never catch: the
route CHANGING while the same `AIAgent` instance stays mounted, which only
this `[location.pathname]`-keyed effect's cleanup fires for.

**Evidence:** new test `AIAgent.unmountAbort.test.jsx` — asserts `aguiAbort`
is called **twice** on unmount (once from the pre-existing always-fires
effect, once from this fix); confirmed to fail against the pre-fix file
(`called 1 times`, not 2) and pass against the fix. Full UI suite: `cd demo_api_ui && npm run build` exit 0; scoped vitest run (`AIAgent.unmountAbort`, `AIAgent.cibaStepUp`, `AIAgent.pendingClaim`) 3 files / 12 tests passed.

### 8. `refreshAfterTransaction` has no response-order guard — FIXED

**File:** `demo_api_ui/src/components/AIAgent.js`, lines 8298–8367

**Issue:** Fires two fetches with no AbortController, request-id guard, or
cancelled flag — unlike a sibling effect in the same file (1996–2035) that
already implements that pattern.

**Trigger scenario:** The `banking-transaction-completed` event fires twice
quickly; if the first fetch resolves *after* the second, the older response
silently reverts the panel to stale data.

**Fix:** Added `refreshRequestIdRef` (incremented at the top of
`refreshAfterTransaction` on every dispatch); both fetch chains now check
`if (requestId !== refreshRequestIdRef.current) return;` before their
`setState` calls, mirroring the sibling `cancelled`-flag pattern in the same
file.

**Evidence:** no dedicated new render test — reliably observing this race
through the DOM needs the accounts result panel already open (heavy chip-click
setup disproportionate to a mechanical, already-precedented one-ref guard).
Verified instead via the full existing suite (no regression) and code-pattern
parity with the sibling guard at lines 1996–2035. `cd demo_api_ui && npx vitest run` — 406/406 files, 3391 tests passed; `npm run build` exit 0.

### 9. `act` claim parse failure treated as "no delegation" — FIXED

**File:** `demo_api_server/middleware/delegationGate.js` — `_extractActClientId` (4–15), `delegationGate` (17–26)

**Issue:** Swallows ANY JSON.parse failure on the RFC 8693 `act` claim with a
bare `catch { return null; }`; `delegationGate` treats `null` as "non-delegated
— pass through," indistinguishable from "genuinely has no `act` claim."

**Trigger scenario:** A Bearer token on `/api/agent`, `/api/agent/run`, or
`/api/agent/langchain/run` whose payload fails JSON.parse/base64 decode. A
previously-revoked delegate agent whose token trips this parse path bypasses
the 403 `delegation_revoked` check entirely.

**Fix:** `_extractActClientId` now returns `{clientId, parseFailed}`;
`delegationGate` returns 401 `invalid_token` when `parseFailed` is true
instead of falling through to `next()`. A token with no dot segments (not
JWT-shaped at all) still correctly passes through as non-delegated — only a
JWT-shaped token (2+ dot segments) that fails to decode now fails closed.

**Evidence:** new test — a JWT-shaped-but-undecodable token — confirmed to
fail against the pre-fix file (`next()` was called, exactly the bug) and pass
against the fix. `cd demo_api_server && CI=true npx jest tests/delegationGate.unit.test.js --forceExit` — 5/5 passed.

### 10. "Reset Demo" logs the admin out even when the reset failed — FIXED

**File:** `demo_api_ui/src/components/AdminSideNav.jsx`, `handleResetConfirm` (was 1231–1246)

**Issue:** The reset POST's error is fully swallowed (`catch (_) {}`) with no
logging or toast, and the function proceeds unconditionally to clear
localStorage and log the admin out.

**Trigger scenario:** Click "Reset Demo" while the endpoint fails — the admin
is logged out believing the reset happened; it never did.

**Fix:** Now checks `res.ok` (a fetch resolving on a non-2xx status was
previously indistinguishable from success) in addition to catching a network
error; either failure logs via `console.error` (this file's own convention)
and calls `notifyError` (the project-wide toast convention), then returns
**before** clearing localStorage or calling `performLogout()`. Success path
unchanged.

**Evidence:** 3 new tests (network error / non-ok status / success) —
confirmed 2 of 3 fail against the pre-fix file (`notifyError` never called,
since it didn't exist yet) and all 3 pass against the fix. `cd demo_api_ui && npx vitest run src/components/__tests__/AdminSideNav.resetDemo.test.jsx src/components/__tests__/adminSideNav.test.jsx src/components/__tests__/AdminSideNav.telemetry.test.jsx` — 3 files / 24 tests passed; `npm run build` exit 0.

### 11. Agent-authorization toggle gives no failure feedback — FIXED

**File:** `demo_api_ui/src/components/DelegationPage.js`, `AgentAuthorizationCard.handleToggle` (was 140–150)

**Issue:** Any `setAgentAuthorization` failure is caught with
`catch { setWorking(false); }` — no toast, no logging, no state revert.

**Trigger scenario:** Click "Authorize agent"/"Revoke agent access" while the
POST fails — button re-enables looking like nothing happened, while the
actual (security-relevant) authorization state is unchanged.

**Fix:** Added `notifyError(err.message || ...)` (file had no import — added
one) in the catch. Also fixed an adjacent bug in the same function found
while making this change: `setWorking(false)` was only ever called in the
catch branch, so a *successful* toggle left the button stuck on "Updating…"
forever; moved it to a `finally`. Also now updates the local `status` on
success (previously never reflected the new authorized/revoked state without
a full page reload).

**Evidence:** 2 new tests (failure surfaces + re-enables; success clears
working + updates badge) — both confirmed to fail against the pre-fix file
and pass against the fix. `cd demo_api_ui && npx vitest run src/components/__tests__/DelegationPage.agentAuthToggle.test.js src/components/__tests__/DelegationPage.approval.test.js` — 2 files / 4 tests passed; `npm run build` exit 0.

### 12. Agent-restrictions gate has one fail-open branch contradicting its own contract — FIXED

**File:** `demo_api_server/middleware/agentRestrictionsGate.js`, lines 123–142

**Issue:** The file's own header comment says the gate must fail closed when
restriction level can't be determined; the MCP→BFF userId-resolution fallback
swallows a JWT decode failure and then unconditionally calls `next()` — the
only one of 4 similar branches in this file that skips `failoverPermits()`/503.

**Trigger scenario:** An agent-originated request with no session user and an
undecodable Bearer token, with `ff_agent_restrictions` on — skips the
tier-restriction check entirely.

**Fix:** The `!userId` branch now routes through the exact same
`failoverPermits()`/503 pattern used by the other 3 "can't determine"
branches in this file (worker token missing, PingOne non-2xx, unexpected
exception).

**Evidence:** 2 new tests (fails closed by default; fails open when
`AGENT_RESTRICTIONS_FAILOVER=permit`) mirroring the file's existing
fails-CLOSED/fails-OPEN pair pattern for the other branches. The
fails-closed test confirmed to fail against the pre-fix file (`next()` was
called unconditionally) and pass against the fix. `cd demo_api_server && CI=true npx jest tests/agentRestrictionsGate.test.js --forceExit` — 11/11 passed.

### 13. Unbounded revoke-retry loop with no attempt cap — FIXED

**File:** `demo_api_server/routes/agentAuthorization.js`, `DELETE /hard` (94–121), `DELETE /` (123–140)

**Issue:** Cleanup loops re-query for the still-active record after each
revoke attempt, with every failure swallowed, no attempt cap, no backoff. On
`/hard`, even the first revoke's failure is swallowed as non-fatal and the
handler still returns `{ ok: true }`.

**Trigger scenario:** A persistent LMDB write failure — the record's status
never flips, so the re-query returns the same record forever; the loop spins.

**Fix:** Added a shared `MAX_REVOKE_ATTEMPTS = 10` bound to both cleanup
loops. `DELETE /` now returns `502 revoke_incomplete` if the cap is hit and a
record is still active (matching its own existing convention of a hard error
on the first-attempt failure). `DELETE /hard` keeps its aggressive
always-attempt-everything behavior (token revocation + session clear still
run regardless — that is the point of the "hard" kill switch) but its
response now reports `ok: !next` and a `warning` instead of unconditionally
claiming `ok: true` when a record demonstrably remained active.

**Evidence:** 2 new tests (a delegation record mocked to never clear) —
running them against the **pre-fix** file didn't just fail an assertion, it
crashed the Node test process with a JavaScript heap **out-of-memory** error
— a more severe confirmation than a hang would have been. Both pass cleanly
(<1s) against the fix, asserting exactly `MAX_REVOKE_ATTEMPTS + 1` (11)
`revokeDelegation` calls before giving up. `cd demo_api_server && CI=true npx jest tests/agentAuthorizationRevoke.unit.test.js src/__tests__/agentAuthorization.route.test.js --forceExit --maxWorkers=4` — 2 suites / 15 tests passed.

### 14. Vertical-picker load failure indistinguishable from an empty list — FIXED

**File:** `demo_api_ui/src/components/AdminSideNav.jsx`, lines 375–392

**Issue:** `.catch(() => {})` silently leaves `verticals` at `[]` on failure.

**Trigger scenario:** Expand the vertical-picker while the GET fails — empty
picker, zero signal anything went wrong.

**Fix:** `.catch((err) => console.error("[Sidebar] Vertical list load failed:", err.message))`, matching this file's own convention.

### 15. Switch-vertical failure gives no feedback — FIXED

**File:** `demo_api_ui/src/components/AdminSideNav.jsx`, `handleSwitchVertical` (394–414)

**Issue:** POST failure caught with only state cleanup — no toast, no log.

**Trigger scenario:** Click a vertical while the POST fails — spinner clears,
looks like nothing happened.

**Fix:** Added `console.error("[Sidebar] Switch vertical failed:", err.message)` in the catch, matching this file's own convention.

**Evidence (both #14 and #15):** 2 new tests — both confirmed to fail against
the pre-fix file and pass against the fix. `cd demo_api_ui && npx vitest run src/components/__tests__/AdminSideNav.verticalFailures.test.jsx src/components/__tests__/AdminSideNav.resetDemo.test.jsx src/components/__tests__/adminSideNav.test.jsx src/components/__tests__/AdminSideNav.telemetry.test.jsx` — 4 files / 26 tests passed; `npm run build` exit 0.

### 16. Copilot config-load failure looks like "not configured" — FIXED

**File:** `demo_api_ui/src/components/CopilotAgent.jsx`, lines 32–37

**Issue:** `.catch(() => setCfg({}))` collapses any load failure into the same
empty object used for "not configured."

**Trigger scenario:** Open Copilot Studio chat while the config GET fails —
shows the permanent "not configured" message even if fully configured
server-side.

**Fix:** Added a `cfgError` state, set from the existing `friendly(e)`
helper; a new render branch (checked before the `!configured` check) shows a
retryable error message with a Retry button instead of the permanent
"not configured" screen. Extracted the load call into a `loadConfig`
callback shared by the initial effect and the Retry button.

**Evidence:** 3 new tests (load failure shows retry, not "not configured";
retry succeeds and reaches the real surface; a genuinely empty config still
shows "not configured") — the first two confirmed to fail against the
pre-fix file and pass against the fix. `cd demo_api_ui && npx vitest run src/components/__tests__/CopilotAgent.configError.test.jsx` — 3/3 passed; `npm run build` exit 0.

### 17. Delegate search failure looks like zero matches — FIXED

**File:** `demo_api_ui/src/components/CreateUserPanel.jsx`, `searchDelegate` (84–90)

**Issue:** `catch { setDelegateResults([]); }` swallows any search error.

**Trigger scenario:** Search fails — dropdown shows no results, identical to
a real no-match.

**Fix:** Reused the existing `fieldErrors.delegateUser` slot (already
rendered under the input, already used by `validate()` for "Select a
delegate target") — the catch now sets `'Search failed. Try again.'` there,
and a successful search clears it.

**Evidence:** 3 new tests (failure shows the message; a later success clears
it; a genuine zero-match never shows it) — the first two confirmed to fail
against the pre-fix file and pass against the fix. `cd demo_api_ui && npx vitest run src/components/__tests__/CreateUserPanel.delegateSearch.test.jsx` — 3/3 passed; `npm run build` exit 0.

### 18. Policy-endpoint load failure not surfaced despite existing error state — FIXED

**File:** `demo_api_ui/src/components/BulkDecisionPanel.jsx`, lines 88–105

**Issue:** A load failure is caught with only a code comment — no error state
set, despite the component already having an `err`/`setErr` state used
elsewhere.

**Trigger scenario:** Open Bulk Decision panel while the GET fails — reads
"No decision endpoints found," identical to a tenant with no policy.

**Fix:** Set the existing `err` state in the catch (message from the API
response, falling back to `e.message`) — reuses the render slot already
wired up for the run-decision path.

**Evidence:** new test confirmed to fail against the pre-fix file and pass
against the fix. `cd demo_api_ui && npx vitest run src/components/__tests__/BulkDecisionPanel.test.jsx` — 6/6 passed; `npm run build` exit 0.

### 19. `GET /runs` re-scans the entire unbounded trace store on every poll — FIXED

**File:** `demo_api_server/routes/agentRun.js` — `GET /runs` (was 847–856) → `_summarizeRun` (was 783–803); `entry.events` push (128)

**Issue:** Iterates every entry in `_traceStore` (capped at 500 by evicting
only the single oldest entry per insert — never pruned to a target size) and
calls `_summarizeRun()` per entry, which does a full scan of `entry.events` —
itself uncapped.

**Trigger scenario:** The history view polls `GET /api/agent/run/runs` while
up to 500 runs sit in the store, some with hundreds of events — every poll
re-scans everything synchronously.

**Fix:** `_recordTraceEvents` now maintains `entry.status`/`entry.threadId`
incrementally as each event arrives (the exact same transition logic
`_summarizeRun` used to run in a loop), so `_summarizeRun` is an O(1) field
read for any entry created the normal way. `_summarizeRun` falls back to the
original full scan only when `entry.status` is `undefined` — i.e. an entry
that didn't go through `_recordTraceEvents` at all (a real gap this caught:
an existing test seeds `_traceStore` directly with a bare `{events, ...}`
object, bypassing the incremental bookkeeping — the fallback keeps that
correct without losing the fast path for real runs). `GET /runs` gained
optional `limit`/`offset` query params (defaulting to the full list — no
behavior change for existing callers that don't pass them), plus a `total`
field.

**Evidence:** new pagination test confirmed to fail against the pre-fix file
and pass against the fix. Fixing the fast path also caught and fixed a real
regression it introduced against `agentRun.archiveRunToReportStore.test.js`
(which relies on directly-seeded entries) before it was committed — that
test now passes via the `undefined`-triggered fallback. `cd demo_api_server && CI=true npx jest tests/agentRun.framework-routing.test.js tests/agentRunHeuristicsProvider.test.js tests/agentRun.recoveredToolsList.test.js tests/agentRun.runsList.test.js tests/agentRunStore.test.js tests/agentRunRegistry.test.js tests/agentRunHitlSuspend.test.js tests/agentRun.intentTokenMint.regression.test.js tests/agentRun.publicCatalog.regression.test.js tests/routes/agentRun.archiveRunToReportStore.test.js src/__tests__/agentRun.verticalTools.test.js --forceExit --maxWorkers=4` — 11 suites / 55 tests passed.

### 20. Vertical context hands every consumer a new object identity every render — FIXED

**File:** `demo_api_ui/src/vertical/VerticalProvider.jsx`, line 140

**Issue:** `<VerticalContext.Provider value={{ ...state, refetch: doFetch }}>`
— a fresh object literal every render, unmemoized.

**Trigger scenario:** Any unrelated ancestor re-render force-rerenders every
context consumer app-wide (TopNav, AdminSideNav, UserDashboard, etc.).

**Fix:** `const value = useMemo(() => ({ ...state, refetch: doFetch }), [state, doFetch]);`, passed to the Provider. `doFetch` already had a stable
empty-deps `useCallback` identity.

**Note found while verifying:** `useVertical()` (the hook nearly every
consumer actually calls, not the raw context) reshapes the context value into
a **new object on every call**, regardless of the Provider's own
memoization — so this fix alone does not stop `useVertical()` consumers from
re-rendering on an unrelated parent re-render. That is a separate, larger
change (memoizing `useVertical()`'s own return value) outside this finding's
scope; noted here rather than silently expanding the fix.

**Evidence:** new test reads the **raw** context value directly (not through
`useVertical()`, for the reason above) and asserts `Object.is` identity
across an unrelated ancestor re-render — confirmed to fail against the
pre-fix file and pass against the fix. `cd demo_api_ui && npx vitest run` — 411/411 files, 3406 tests passed; `npm run build` exit 0.

### 21. O(N²) proof-strip scan on every message-list render — FIXED

**File:** `demo_api_ui/src/components/AIAgent.js`, lines 11239–11255

**Issue:** `filteredMsgs.slice(msgIdx+1).some(...)` inline in the render-body
`.map` per row — O(N) per row, O(N²) total, unmemoized.

**Trigger scenario:** Long conversations + frequent streaming re-renders (14
`setMessages` call sites) repeat the O(N²) work per keystroke/stream tick.

**Fix:** Added `lastProofBubbleIdByRunId` — a `useMemo`'d `Map<proofRunId,
messageId>` built once per `messages` change (a single O(N) pass, "last one
wins" by iteration order) — near the component's other `useMemo`s. The
render loop's per-row check became a single `Map.get` comparison against
`msg.id`, replacing the `slice().some()` scan. Semantics are unchanged by
construction (identical "last assistant bubble for this run" rule), just
O(1) instead of O(N) per row.

**Evidence:** this is a pure algorithmic optimization preserving identical
output, so a fail-before/pass-after test isn't meaningful here (behavior is
unchanged, not fixed). Verified via the full existing suite instead — no
existing assertion about proof-strip visibility broke. `cd demo_api_ui && npx vitest run` — 411/411 files, 3406 tests passed; `npm run build` exit 0.

### 22. N+1 scope-fetch loop in PingOne grant provisioning — FIXED

**File:** `demo_api_server/services/pingoneProvisionService.js`, `grantScopesToApplication` (was 1359–1434)

**Issue:** One sequential `GET /resources/{id}/scopes` per existing grant, not
deduped by resource id. A preceding dead loop (1403–1411) is unused.

**Trigger scenario:** Full PingOne bootstrap for a vertical with many
apps/resources re-fetches the same resource's scopes redundantly.

**Fix:** Deleted the dead loop entirely (it had an empty body and its `Set`
was never read). Replaced the per-grant fetch with: collect distinct other
`resource.id` values from `existingGrants`, fetch each ONCE via
`Promise.all`, then resolve every grant's scope ids against its own
resource's map.

**Evidence:** new test — two grants against the same other resource — asserts
exactly one `GET /resources/{id}/scopes` call for it (was two before the
fix). Confirmed to fail against the pre-fix file (`Received length: 2`) and
pass against the fix. Full test file plus 8 adjacent PingOne-provisioning
suites run for extra safety given this touches live-provisioning code: `cd demo_api_server && CI=true npx jest src/__tests__/pingoneProvisionService.regression.test.js src/__tests__/scopeTopology.regression.test.js src/__tests__/pingOneGroupProvisionService.test.js src/__tests__/mcpPingOneAdminAuth.test.js src/__tests__/setupWizard.route.test.js tests/provisioningNameMapCompleteness.test.js tests/pingoneObjectResolution.test.js tests/pingoneResourceIds.test.js tests/startupConfigGuard.mcpGatewayAud.test.js --forceExit --maxWorkers=4` — 9 suites / 96 tests passed.

### 23. `wipeEnvironment` deletes everything fully sequentially — FIXED

**File:** `demo_api_server/services/pingoneProvisionService.js`, `wipeEnvironment` (was 3665–3838)

**Issue:** 5 categories of objects each deleted with a fully sequential
`await` per item, no batching or bounded concurrency.

**Trigger scenario:** Reset-environment wizard on an environment with many
accumulated demo objects — dozens of fully serial round trips.

**User confirmed the tradeoff before this was applied:** unlike the other
perf findings, this is a rare, deliberate, destructive live-PingOne-mutating
admin operation, not a hot path — and its `step()` callback streams *ordered*
progress to the reset-wizard UI, so concurrency reorders those messages by
completion time instead of list order. Asked directly; the answer was
bounded concurrency (~5), accepting reordered step messages.

**Fix:** Added `_mapLimit(items, limit, fn)` — a small hand-rolled
worker-pool helper (no new dependency) — and converted all 5 delete loops
(apps, resources, groups, attrs, the per-username user search + its inner
delete) to use it at a concurrency cap of 5, matching the audit's own
caution about PingOne Management API rate limits.

**Evidence:** this function had **zero** prior test coverage. Added 3 tests:
ownership-filter + summary counts stay correct under concurrency; a failed
delete doesn't abort the rest of its category; and a dedicated test for
`_mapLimit` itself (23 items, cap 5) proving it drains every item and
preserves result order — the thing most likely to have an off-by-one bug in
a hand-rolled worker pool. The first two are behavior-preserving (pass on
both pre- and post-fix code, confirmed); the third only passes post-fix
(`_mapLimit` didn't exist before). `cd demo_api_server && CI=true npx jest src/__tests__/pingoneProvisionService.wipeEnvironment.test.js src/__tests__/pingoneProvisionService.regression.test.js --forceExit --maxWorkers=4` — 2 suites / 15 tests passed.

### 24. Chat transcript renders unbounded with no windowing — FIXED

**File:** `demo_api_ui/src/components/AIAgent.js`, lines 11198–11239

**Issue:** Full message history renders via a single unbounded `.map()` —
every heavy bubble subcomponent stays mounted for the life of the
conversation.

**Trigger scenario:** Long-running demo sessions grow DOM node count and
render cost unboundedly.

**Fix:** Extracted the recent-N windowing into a pure helper,
`demo_api_ui/src/utils/transcriptWindow.js` (`windowTranscript(filteredMsgs,
cap, showAll)`), and wired it into `AIAgent.js`: the transcript's existing
role filter is now a memoized `transcriptFilteredMsgs`, capped by default to
the most recent 150 (`TRANSCRIPT_RECENT_CAP`) via `windowTranscript`, with a
`transcriptShowAll` state flag. A "Show N earlier messages" button
(`.ba-show-earlier-btn`, themed off the existing `--ba-*` tokens) renders
above the list whenever messages are hidden and reveals the rest on click.
The `.map()` callback body is unchanged — confirmed neither `msgIdx` nor its
`filteredMsgs` array parameter are referenced inside it, so slicing the
rendered subset is safe; `lastProofBubbleIdByRunId` (finding #21) is keyed
off the full `messages` array by `msg.id`, independent of what's currently
sliced into view.

**Evidence:** `windowTranscript` is pure and directly unit-tested in
`demo_api_ui/src/utils/transcriptWindow.test.js` — over-cap slices to the
last `cap` items, under-cap returns everything unsliced, and `showAll: true`
bypasses the cap regardless of size. `npm --prefix demo_api_ui run test:unit`
— 412 files / 3409 tests passed, 24 skipped (no regressions). `npm --prefix
demo_api_ui run build` — exit 0.

### 25. Token-chain steps rebuilt on every unrelated local-state change — FIXED

**File:** `demo_api_ui/src/components/TokenChainTraceRail.jsx` (352–357), `TokenChainFilmstrip.jsx` (144)

**Issue:** `buildLiveTokenChainSteps(...)` runs directly in the render body,
unmemoized, alongside 6+ unrelated `useState` hooks (zoom, tabs, tray,
selection).

**Trigger scenario:** Toggling zoom or a tab — unrelated to trace data —
triggers a full steps rebuild, handing children brand-new objects every time.

**Fix:** `TokenChainTraceRail.jsx` — wrapped `classicSteps` (the
`mcpRouteOnly` filter) and `steps` (`buildLiveTokenChainSteps`) each in their
own `useMemo`, keyed on the inputs they actually read (`snap.steps`,
`mcpRouteOnly`, `viewMode`, `classicSteps`, `trace`). `TokenChainFilmstrip.jsx`
— `classicSteps` there is already a bare reference (`snap.steps`, no
computation), so only `steps` needed a `useMemo`, keyed the same way.

**Evidence:** Behavior-preserving by construction (same inputs, same
computed output, only the re-run condition changed) — verified via the
existing `TokenChainTraceRail.test.jsx` (16 tests),
`TokenChainTraceRail.runStoryKeys.test.jsx`, and `TokenChainFilmstrip.test.jsx`
suites plus the full UI suite (412 files / 3409 tests, no regressions), rather
than a new render-count test — spying on `buildLiveTokenChainSteps` across an
in-module call site isn't observable through the module's own export binding.
`npm --prefix demo_api_ui run build` — exit 0.

### 26. Admin list-all endpoints have no pagination — FIXED

**File:** `demo_api_server/routes/transactions.js` (76–100), `routes/accounts.js` (72–97)

**Issue:** Return every record with no limit/offset before enrichment and
serialization.

**Trigger scenario:** `GET /api/transactions`/`/api/accounts` after
`runtimeData.json` accumulates a large record count.

**Fix:** Added optional `limit`/`offset` query params to both routes,
mirroring the pattern already used by finding #19's `GET /runs`: compute
`total` before slicing, slice to `[offset, offset + limit)` **before** the
per-record owner-enrichment map (the actual cost this finding calls out),
and default to the full unsliced list — `total` included either way — when
neither query param is present, so no existing caller's response shape
changes.

**Evidence:** Extended existing route-test files with 2 new tests each
(`accounts.route.test.js`, `transactions.crud.test.js`): default call returns
every record plus a `total` field; `?limit=1&offset=1` returns exactly the
expected sliced record. `cd demo_api_server && CI=true npx jest
src/__tests__/accounts.route.test.js src/__tests__/transactions.crud.test.js
--forceExit --maxWorkers=4` — 2 suites / 42 tests passed. A subsequent full
`CI=true npx jest --forceExit --maxWorkers=4` run had 1 unrelated failure
(`ciba.test.js`'s "returns 401 without authentication" — a pre-existing
worker-contention flake per `verify-ai-demo2`'s Quick Reference; passed
61/61 re-run in isolation).

### 27. `claimDiffs` computed twice per render, component not memoized — FIXED

**File:** `demo_api_ui/src/components/TraceStepCard.jsx`, lines 404–423

**Issue:** `claimDiffs(before, after)` (JSON.parse + diff) called twice with
identical args inline in JSX every render; component isn't wrapped in
`React.memo`.

**Trigger scenario:** Any parent re-render re-renders every visible card,
redundantly re-parsing/re-diffing the same JSON twice each.

**Fix:** Hoisted the shared computation into `beforeAfterChangedClaims`, a
`useMemo` keyed on `d.beforeAfter?.before?.text` /
`d.beforeAfter?.after?.text`, and passed that single value to both
`HighlightedText` call sites instead of two identical inline `claimDiffs(...)`
calls. Wrapped the default export in `React.memo` (`export default
React.memo(TraceStepCard)`), unchanged prop contract.

**Evidence:** Behavior-preserving by construction — `TraceStepCard.teaching.test.jsx`
already asserts the rendered `claim-diff--before`/`claim-diff--after` markup
for a `beforeAfter` block with changed claims, and passed unchanged. Ran
`TraceStepCard.*`, `FocusModeChainRenders`, `FlowSurfacesIdJag`, and
`LiveUseCaseWorkbenchPage` suites (7 files / 62 tests) plus the full UI suite
(412 files / 3409 tests) — no regressions. No new test: `claimDiffs` is an
unexported module-private helper, not spy-observable across its own
in-module call sites (same reasoning as finding #25). `npm --prefix
demo_api_ui run build` — exit 0.

---

## Round 2 findings (2026-08-23)

### 28. Group-membership cache can be repopulated with stale data after invalidation — FIXED

**File:** `demo_api_server/services/pingOneGroupMembershipService.js`, line 109

**Issue:** A slow in-flight group-membership lookup started before an admin's
group toggle can finish *after* the toggle's cache reset and repopulate the
60s cache with stale (pre-toggle) data, silently undoing the invalidation.

**Trigger scenario:** Concurrent (a) `listUserGroupNamesForVertical`
cache-miss awaiting `GET /users/{id}/memberOfGroups` (lines 67–72), and (b)
`setUserGroupMembership`'s write + `_resetCache()` (line 210). If (b)
completes while (a)'s GET is still in flight, (a) resolves with pre-toggle
membership and calls `_setCached(...)` at line 109, repopulating the
just-cleared cache for up to `CACHE_TTL_MS` (60s) with stale data.

**Fix:** Added a module-level `_cacheGeneration` counter, bumped in
`_resetCache()`. `listUserGroupNamesForVertical` captures the generation
before starting the fetch and only calls `_setCached` if the generation is
still unchanged when the fetch resolves — the in-flight caller still gets
its fetched answer either way, it just isn't written back into a cache that
was invalidated out from under it.

**Evidence:** New test in `pingOneGroupMembershipService.test.js` simulates
the race with a deferred `makeRequest` mock: starts a slow fetch, calls
`_resetCache()` while it's still pending, resolves it, then asserts a
subsequent call hits the API again (2 total calls) instead of serving the
stale cached value. Proven to fail against the pre-fix file (`toEqual`
mismatch — the stale value was cached and served) and pass against the fix.
`cd demo_api_server && CI=true npx jest
src/__tests__/pingOneGroupMembershipService.test.js --forceExit
--maxWorkers=4` — 9/9 passed.

### 29. Draggable panel drag never cleans up if the component unmounts mid-drag — FIXED

**File:** `demo_api_ui/src/hooks/useDraggablePanel.js`, line 90

**Issue:** `handleDragStart`'s pointermove/pointerup/pointercancel listeners
and the `document.body.style.userSelect = 'none'` it sets are only cleaned
up by the drag's own `onUp` handler; the unmount cleanup effect (lines
74–85) only tears down `activeResizeHandlersRef` (the resize path), never an
in-flight drag.

**Trigger scenario:** Start dragging a `DraggableModal` titlebar (pointerdown
→ `handleDragStart` sets `userSelect='none'` at line 117, attaches listeners
to target at lines 118–120), then unmount the component (e.g. `onClose`
fires) before releasing the pointer → `onUp` never runs → `document.body.style.userSelect`
stays `'none'` for the rest of the session.

**Fix:** Added an `activeDragHandlersRef` alongside the existing
`activeResizeHandlersRef`, storing `{ target, onMove, onUp }` when a drag
starts and clearing it on the drag's own `onUp` (mirrors the resize path's
existing pattern). The unmount cleanup effect now also tears down an
in-flight drag: removes the three listeners from `target` and resets
`document.body.style.userSelect = ''`.

**Evidence:** New test in `useDraggablePanel.test.js` starts a drag via
`handleDragStart` with a synthetic pointerdown, unmounts without firing
pointerup, and asserts `document.body.style.userSelect` resets to `''` and
`removeEventListener` was called for `pointermove`/`pointerup`/`pointercancel`.
Proven to fail against the pre-fix file (`userSelect` stayed `'none'`) and
pass against the fix. `npm --prefix demo_api_ui run test:unit --
useDraggablePanel` — 4/4 passed.

### 30. Concurrent manual + automatic health-check retries race on shared state — FIXED

**File:** `demo_api_ui/src/services/bankingRestartNotificationService.js`, line 168

**Issue:** `manualRetry()` unconditionally starts a new `retryHealthCheck()`
chain without checking whether one is already in flight, so a user click
while a check from `handle504Error`'s chain is still awaiting
`checkServerHealth()` runs two concurrent `retryHealthCheck()` invocations
that both mutate the shared `globalRestartState` with no lock.

**Trigger scenario:** A 504/network error triggers `handle504Error` →
`retryHealthCheck()` (line 161), mid-await on `checkServerHealth()` (up to
5s, line 133). Before it resolves, the user clicks "Retry Now" →
`manualRetry()` (line 168) clears the not-yet-scheduled `retryTimeoutId`
(still null) and calls `retryHealthCheck()` again → two concurrent calls
each call `incrementAttempt()` and, on failure, each independently overwrite
`globalRestartState.retryTimeoutId` via their own `setTimeout`.

**Fix:** Added a module-level `_inFlightHealthCheck` promise. `retryHealthCheck`
now checks it first — if a check is already in flight, it returns that same
promise instead of starting a new one; otherwise it wraps its existing body
in an IIFE, stores the resulting promise, and clears it in a `finally` once
settled. `manualRetry`'s unchanged call to `retryHealthCheck()` now
transparently joins an in-flight automatic check instead of racing it.

**Evidence:** New test in `bankingRestartNotificationService.test.js` mocks
a controllable `fetch`, calls `handle504Error` (starts the automatic chain,
fetch already in flight), then calls `manualRetry()` while that fetch is
still pending, and asserts only one `fetch` call total. Proven to fail
against the pre-fix file (2 concurrent fetches) and pass against the fix.
`npm --prefix demo_api_ui run test:unit -- bankingRestartNotificationService`
— 1/1 passed; full UI suite (413 files / 3411 tests) — no regressions.

### 31. `resolveSessionUser`'s race-timeout guard leaks a dangling timer on every normal call — FIXED

**File:** `demo_api_ui/src/services/sessionResolver.js`, line 13

**Issue:** `resolveSessionUser()` creates a 10-second `setTimeout` for its
race-based timeout guard but never clears it once the `Promise.allSettled`
branch wins the race (the normal, fast-path case), so every call leaves a
dangling timer running for up to 10s.

**Trigger scenario:** Any normal (non-hung) call to `resolveSessionUser()`
(called from `Accounts.js`, `Transactions.js`, `Users.js`, `Dashboard.js`,
`SessionTokenContext.js`) resolves via `Promise.allSettled` well under 10s,
but the `setTimeout` scheduled at line 14 is never captured in a variable or
cleared, so it keeps running regardless.

**Fix:** Captured the `setTimeout` id in a `let timeoutId` and added
`clearTimeout(timeoutId)` in a `finally` block, so the guard timer is always
cleared regardless of which branch of the race settled or whether the
function threw.

**Evidence:** New test in `sessionResolver.test.js` uses fake timers, calls
`resolveSessionUser()` with a mocked `getCachedJson` (fast, non-hung path),
and asserts `vi.getTimerCount() === 0` after it resolves. Proven to fail
against the pre-fix file (1 dangling timer) and pass against the fix. `npm
--prefix demo_api_ui run test:unit -- sessionResolver` — 1/1 passed.

### 32. Generated management private key is silently dropped, never persisted — FIXED

**File:** `demo_api_server/routes/adminConfig.js`, line 295

**Issue:** `POST /api/admin/config/generate-keypair` calls the async
`configStore.setConfig()` without awaiting it, and the key it writes
(`pingone_mgmt_private_key`) is not registered in `configStore.js`'s
`FIELD_DEFS`, so `setConfig`'s unknown-key guard silently drops it — the
private key is never persisted, yet the route unconditionally responds
`ok:true`.

**Trigger scenario:** Admin clicks "Generate keypair" for `private_key_jwt`
management-auth in the Config UI, registers the returned public key in
PingOne as instructed, then later triggers a Management API call using
`private_key_jwt` auth method — which fails with "no private key
configured" because it was never actually saved.

**Fix:** Registered `pingone_mgmt_private_key` in `FIELD_DEFS` and
`SECRET_KEYS` in `services/configStore.js` (mirroring the existing
`pingone_client_jwt_private_key` entry). In `adminConfig.js:295`, added
`await` on `configStore.setConfig(...)` so a persistence failure now flows
into the route's existing top-level try/catch → 500 response, instead of
surfacing as an unhandled promise rejection while the route already
responded `ok:true`.

**Note:** while investigating, found `pingone_mgmt_client_id`,
`pingone_mgmt_client_secret`, and `pingone_mgmt_token_auth_method` have the
same FIELD_DEFS gap (referenced in `SECRET_KEYS`/env-alias tables but absent
from `FIELD_DEFS`), but they appear to be set only via `.env` today, never
via `setConfig` — left as-is since fixing them isn't part of this finding;
logged in `TECH_DEBT.md`.

**Evidence:** New `configStore.mgmtPrivateKeySave.test.js` proves the
FIELD_DEFS fix — `setConfig({ pingone_mgmt_private_key })` then
`getEffective('pingone_mgmt_private_key')` round-trips the value (was `''`
pre-fix). New `adminConfig.generateKeypair.test.js` proves the `await` fix —
a rejected `setConfig` now yields a 500 `ok:false` response instead of 200
`ok:true` (and pre-fix, the rejection surfaced as an actual unhandled
promise rejection error in the test run). Both proven to fail against the
pre-fix files and pass against the fix. `cd demo_api_server && CI=true npx
jest src/__tests__/configStore.mgmtPrivateKeySave.test.js
src/__tests__/adminConfig.generateKeypair.test.js --forceExit
--maxWorkers=4` — 2 suites / 3 tests passed. Full server suite run
separately since this touches `configStore.js` (shared config store).

### 33. MCP elicitation submission failures are silently swallowed — FIXED

**File:** `demo_api_ui/src/hooks/useElicitation.js`, line 59

**Issue:** `submitElicitation`'s catch block logs the error to console and
re-enables the submit button, but never exposes any error state to the
caller, so the user gets no indication their submission failed.

**Trigger scenario:** The MCP elicitation dialog (form or URL mode) is open
and the POST to `/api/mcp/elicit/response` fails (network error or 4xx/5xx).
`submitElicitation` catches the error, logs it, and resolves normally
without re-throwing or setting any error state, so the dialog's own
try/finally (in `ElicitationDialog.jsx`) only resets `isSubmitting` — the
button flips back to "Submit"/"Decline"/"Cancel"/"Open in Browser" with zero
visible feedback that the submission failed.

**Fix:** Added an `error` state to `useElicitation.js`, set on catch (cleared
on a new elicitation request, on submit start, and on `cancel()`), and
exposed it from the hook. `AIAgent.js` passes it through as `ElicitationDialog`'s
new `error` prop, rendered as a visible `.elicit-modal__submit-error` banner
(solid high-contrast red, not muted hint text) in both form and URL mode,
right above the footer buttons.

**Evidence:** New `useElicitation.test.js` proves the hook sets `error` and
keeps the dialog open (`elicitation` stays non-null) when the POST rejects,
and clears it on a subsequent success. New tests in
`ElicitationDialog.test.jsx` prove the banner renders when `error` is set (both
modes) and renders nothing when it isn't. Proven to fail against the pre-fix
files (4/9 failing) and pass against the fix (9/9). `npm --prefix demo_api_ui
run test:unit` — 415 files / 3417 tests passed, no regressions. `npm
--prefix demo_api_ui run build` — exit 0.

### 34. Failed demo reset is indistinguishable from a successful one — FIXED

**File:** `demo_api_ui/src/components/DemoSetupPanel.js`, line 89

**Issue:** `handleResetDemo` swallows the failure of the server-side
reset-demo POST and unconditionally clears local storage and logs the user
out, so a failed reset is indistinguishable from a successful one.

**Trigger scenario:** Admin clicks "Reset demo" and confirms; if `POST
/api/admin/reset-demo` fails (500, network error, expired session), the
empty `catch (_) {}` on line 89 discards the error, then lines 90–92 still
clear local token-chain/traffic-store caches and call `performLogout()` as
if the reset succeeded — the admin is signed out believing server state
(agent history, token chain events, MCP audit logs) was cleared when it was
not.

**Fix:** The `catch` on `axios.post('/api/admin/reset-demo')` now calls the
already-imported `notifyError(...)` and returns early — local storage is no
longer cleared and `performLogout()` is no longer called when the reset
actually failed.

**Evidence:** New `DemoSetupPanel.resetDemo.test.jsx` proves both paths: a
rejected POST surfaces `notifyError` and leaves `performLogout`
uncalled/local storage intact; a successful POST still clears local storage
and calls `performLogout` as before. Proven to fail against the pre-fix file
(failure path silently cleared + logged out) and pass against the fix. `npm
--prefix demo_api_ui run test:unit -- DemoSetupPanel.resetDemo` — 2/2
passed; full UI suite (416 files / 3419 tests) — no regressions. `npm
--prefix demo_api_ui run build` — exit 0.

**This closes the Swallowed-Errors category — findings #9–18 and #32–34 are
all FIXED.**

### 35. Kill-switch/rate-limit audit log grows unbounded — its own pruning function is dead code — FIXED

**File:** `demo_api_server/services/auditLogService.js`, line 15

**Issue:** The in-memory `auditLogs` object (one array per agentId of
kill-switch/rate-limit audit events) grows without any automatic cap.
`pruneOldLogs(retentionDays)` is defined and exported (lines 238–259,
exported at 267) but has zero callers anywhere in the codebase.

**Trigger scenario:** `recordKillEvent` (line 26), `recordKillFailure` (line
82), and `recordRateLimitViolation` (line 112) all push onto
`auditLogs[agentId]` with no size/age limit at push time, and nothing ever
calls `pruneOldLogs` to trim it.

**Fix:** Added a module-level `setInterval(() => { pruneOldLogs(); },
PRUNE_INTERVAL_MS).unref()` (1 hour cadence), mirroring
`mcpGatewayRateLimit.js`'s `_evictionInterval` pattern — `pruneOldLogs`
itself already existed and needed no changes, it just had no caller.

**Evidence:** New `auditLogService.pruning.test.js` uses fake timers, records
an event, advances time 91 days (past the 90-day retention window) with no
manual `pruneOldLogs()` call, and asserts the event is gone — proving the
module's own interval fired the prune, not a direct call. Proven to fail
against the pre-fix file (event still present after 91 days) and pass
against the fix. `cd demo_api_server && CI=true npx jest
src/__tests__/auditLogService.pruning.test.js --forceExit --maxWorkers=4` —
1/1 passed.

### 36. Demo-track session buckets are never evicted — FIXED

**File:** `demo_api_server/services/demoTrackService.js`, line 60

**Issue:** Module-level `_runs` and `_histories` Maps (lines 60–61) are
keyed by `req.sessionID` and never evicted — a new bucket is created per
distinct session via `_ensureRun`/`_hydrate` and nothing ever deletes an old
bucket.

**Trigger scenario:** Each new session (new cookie post login/logout, new
incognito window, session regeneration) creates a fresh bucket via
`_bucketKey` → `_ensureRun`/`_hydrate`. Per-bucket history array is capped at
`HISTORY_CAP=20` (line 40), but there is no cap or TTL on the number of
buckets themselves.

**Fix:** Added a `_lastAccessed` Map touched inside `_hydrate` (the single
common entry point every public function goes through), plus a
`BUCKET_TTL_MS` (24h — this is a short presenter-walkthrough tool) and a
periodic unref'd `setInterval` sweep that drops any bucket idle past the
TTL from `_runs`/`_histories`/`_lastAccessed`.

**Evidence:** New `demoTrackService.bucketEviction.test.js` uses fake
timers: creates two session buckets, advances 25h with no further access,
and asserts the bucket count (via a new `_bucketCountForTests()` test-only
export) drops to 0 — proving the module's own interval evicted them, not a
manual call. A second test proves a bucket touched again before its TTL
elapses survives. Proven to fail against the pre-fix file (`_bucketCountForTests`
didn't exist) and pass against the fix. `cd demo_api_server && CI=true npx
jest tests/demoTrackService.bucketEviction.test.js tests/demoTrackService.test.js
tests/demoTrackRoute.test.js tests/demoTrack.config.test.js
tests/demoTrackHooks.test.js tests/mcpToolAuditStore.demoTrackSessionScoping.test.js
--forceExit --maxWorkers=4` — 6 suites / 29 tests passed.

### 37. Trace projector re-scans the full span array once per matching span — FIXED

**File:** `demo_api_server/services/traceProjector.js`, line 177

**Issue:** `projectServiceCards` filters `traceData.spans` for the target
service(s), and for each span that matches the service it re-scans the
entire `traceData.spans` array again via `.some()` (lines 182–184) to check
whether that service has any server-kind span — this happens once per
matching span rather than once per `traceData`.

**Trigger scenario:** This function is called 3 times per `project()`
invocation (`projectAuthorization`, `projectBackendApi`,
`projectHitlApproval`), so cost scales quadratically in trace span count for
a trace containing many spans on authz-server/mcp-server/mcp-resource-server/hitl-service.

**Fix:** Precomputed a `serverKindServices` `Set` in a single pass over
`spans` before the `.filter()`, then the filter callback does an O(1)
`Set.has()` lookup instead of re-running `.some()` over the full array per
candidate span.

**Evidence:** Behavior-preserving by construction (same inputs, same
computed output — only the re-scan is eliminated). Only `project` is
exported from this module (`projectServiceCards` is internal), so verified
via the existing `traceProjector.test.js` suite, which directly exercises
`projectAuthorization`/`projectBackendApi`/`projectHitlApproval` (all
callers of `projectServiceCards`) including a live 77-span fixture. `cd
demo_api_server && CI=true npx jest tests/services/traceProjector.test.js
--forceExit --maxWorkers=4` — 12/12 passed, no regressions.

### 38. Activity narrative panel's request history grows unbounded and re-maps on every turn — FIXED

**File:** `demo_api_ui/src/context/ActivityNarrativeContext.js`, line 23

**Issue:** The `requests` array behind the "What's happening" activity panel
grows without any cap for the life of the session, and `startRequest`
re-maps every prior request (spreading each into a new object just to flip
`collapsed: true`) on every single call.

**Trigger scenario:** Send many prompts in one session without a
user/vertical/theme change (which is what triggers `reset()` per
`AIAgent.js`). Each call to `startRequest` does `[...prev.map((r) => ({
...r, collapsed: true })), next]` — no length cap, no slice — so `requests`
grows by one entry per turn indefinitely, and the per-turn cost of building
the new array grows linearly with total turns so far. `useActivityLog.js`
already has a deliberate cap pattern (`MAX_EVENTS = 200`) that this context
does not apply.

**Fix:** Added `MAX_REQUESTS = 50` (mirrors `useActivityLog.js`'s
`MAX_EVENTS` pattern). `startRequest` now slices the mapped/collapsed
history down to the most recent `MAX_REQUESTS - 1` entries before appending
`next`, capping both total array size and per-turn remap cost once the cap
is reached.

**Evidence:** New test starts 55 requests and asserts exactly 50 survive,
oldest-first dropped (`requests[0]` is `turn 5`, not `turn 0`). Proven to
fail against the pre-fix file (55 items, no cap) and pass against the fix.
`npm --prefix demo_api_ui run test:unit -- ActivityNarrativeContext
ActivityNarrativePanel` — 8/8 passed; full UI suite (416 files / 3420 tests)
— no regressions. `npm --prefix demo_api_ui run build` — exit 0.

### 39. "Fix All" scope-audit actions reload the full audit after every single fix instead of once — FIXED

**File:** `demo_api_ui/src/components/ScopeAuditPage.js`, line 73

**Issue:** "Fix All Missing Required" / "Fix All Missing"
(`handleFixAll`/`handleFixEverything`) re-fetches and rebuilds the entire
PingOne resource+scope audit after each individual scope creation instead of
once after the batch, turning one intended batch operation into N sequential
full-audit reloads.

**Trigger scenario:** Click "Add All Missing Required" on a resource card or
"Fix All Missing" in the toolbar. Both loop and `await handleAddScope(...)`
per scope; `handleAddScope` unconditionally does `await loadResources()`
after every POST, and `loadResources` itself issues 1+N requests (one GET
for all resources, one per resource for its scopes). Fixing K missing
scopes issues K POSTs each followed by a full 1+N-request re-audit, instead
of a single reload after the batch.

**Fix:** `handleAddScope` now accepts `{ refresh = true }`, defaulting to the
prior behavior for the single "Add" button. `handleFixAll` and
`handleFixEverything` pass `{ refresh: false }` from their loop bodies and
call `loadResources()` once after the loop completes instead of once per
scope.

**Evidence:** New `ScopeAuditPage.fixAll.test.jsx` mocks a resource with 2
missing required scopes, clicks "Fix All Missing", and asserts exactly 2
POSTs (both scopes) followed by exactly 1 additional GET to
`/api/admin/scope-audit/resources` (not 2). Proven to fail against the
pre-fix file (3 total GETs — one per scope plus the initial) and pass
against the fix (2 total). `npm --prefix demo_api_ui run test:unit --
ScopeAuditPage.fixAll` — 1/1 passed; full UI suite (417 files / 3421 tests)
— no regressions. `npm --prefix demo_api_ui run build` — exit 0.

**This closes the Performance category and the entire round-2 audit — all
39 findings across both rounds are now FIXED.**

---

## Round 3 findings (2026-08-23)

### 40. CIBA transaction receipts never evicted if never consumed — FIXED

**File:** `demo_api_server/services/cibaTransactionReceipt.js`, line 16

**Issue:** The `receipts` Map backing `record()`/`consume()` has no periodic
TTL sweep or size cap — the only removal path is `consume()` deleting its
own key. An expiry timestamp is stored but nothing ever checks it
proactively; it's only checked reactively inside `consume()` at the moment a
matching key happens to be looked up again.

**Trigger scenario:** `routes/ciba.js` calls `record(userId, tool, amount)`
on every out-of-band CIBA approval. `consume()` is only called from
`routes/transactions.js` on the MCP/agent bearer-token path with the exact
same key. Any approval whose bearer-token retry never happens with that
identical key (abandoned retry, mismatched amount, or the transfer instead
going through the session-based `hitlCredit.js` path) leaves its entry in
the Map permanently.

**Fix:** Added a `_sweepExpired()` function and a periodic unref'd
`setInterval` (fires every `TTL_MS`, 5 minutes) that deletes any receipt
whose stored expiry has passed, mirroring the pattern already used in
`http2McpBridge.js`'s `cleanupInterval`.

**Evidence:** New `cibaTransactionReceipt.sweep.test.js` uses fake timers:
records a receipt, advances 6 minutes with no `consume()` call at all, and
asserts the receipt count (via a new `_receiptCountForTests()` test-only
export) drops to 0 — proving the module's own interval evicted it, not a
manual call. A second test confirms normal single-use `consume()` behavior
is unchanged. Proven to fail against the pre-fix file
(`_receiptCountForTests` didn't exist) and pass against the fix. `cd
demo_api_server && CI=true npx jest
src/__tests__/cibaTransactionReceipt.sweep.test.js
src/__tests__/ciba.test.js
src/__tests__/mcpToolAuthorization.hitlAmountBind.test.js --forceExit
--maxWorkers=4` — 3 suites / 65 tests passed.

### 41. HITL credit check-then-act race across an awaited policy call — FIXED

**File:** `demo_api_server/services/hitlCredit.js`, line 33

**Issue:** `isFresh()` only reads session HITL state; `consume()` is a
separate call the caller must invoke afterward. A real awaited network call
to the authorization policy engine happens between the `isFresh()` read and
the `consume()` write, so the check-then-act is not atomic.

**Trigger scenario:** `routes/transactions.js` calls `isFresh()` (no
consume), then `await transactionAuthorizationService.evaluateTransactionPolicy(...)`,
then `consume()` only after that resolves. Two concurrent `POST
/api/transactions` requests on the same session immediately after one CIBA
approval can both pass the `isFresh()` check before either reaches
`consume()`, so both get authorized off a single one-time approval.

**Fix:** `express-session` gives each concurrent request its own
independently-loaded session snapshot (saved back separately at response
time), so an in-session-object flag can't serialize two truly concurrent
requests — a plain `consumeIfFresh(session)` synchronous helper would still
race if it only touched the session object. Instead added a real
cross-request lock: `hitlCredit.js` gained `claim()`/`release()` backed by a
process-local `Map` keyed by session id (same reason `cibaTransactionReceipt.js`
keeps its own state out of the session object). `claim()` atomically checks
`isFresh()` and that no other concurrent request currently holds the
session's claim; a claim self-expires after `CLAIM_TTL_MS` (3s — comfortably
longer than any single awaited call in this path) so a caller that
determines the credit wasn't needed and can't call `release()` on every
return path doesn't wedge the credit for more than a few seconds. User
confirmed this approach (a real lock, not a narrower single-file patch or
leaving it open) after being shown the tradeoffs.
  - `routes/transactions.js`: `isFresh()` → `claim()`; releases immediately
    via `release()` in the branch where the claim turned out unneeded
    (`authz.hitlConsentDischarged` false), since this function's full
    control flow is visible and every exit path can be tracked.
  - `services/mcpToolAuthorizationService.js`: `isFresh()` → `claim()` at
    its one call site; relies on the TTL self-expiry rather than an
    explicit `release()`, since this function has three mutually-exclusive
    `hitlRequired` gates spread across many return paths and instrumenting
    all of them risked introducing a new bug for a narrower payoff than the
    3-second self-heal already provides.

**Evidence:** New `hitlCredit.claim`/`release` tests in `hitlCredit.test.js`
prove: two independent session *objects* sharing the same `id` (simulating
two concurrent requests, each with its own deserialized snapshot) can't both
claim; `release()` frees it immediately for the next request; `consume()`
also frees it; an unreleased claim self-expires after `CLAIM_TTL_MS`; a
session with no `id` falls back to unlocked `isFresh()` semantics. Proven to
fail against the pre-fix file (5/5 new tests — `claim`/`release` didn't
exist) and pass against the fix (14/14). `cd demo_api_server && CI=true npx
jest src/__tests__/hitlCredit.test.js src/__tests__/ciba.test.js
src/__tests__/cibaService.test.js
src/__tests__/mcpToolAuthorization.hitlAmountBind.test.js
tests/services/transactionAuthorizationService.rfc9470.test.js
src/__tests__/cibaTransactionReceipt.sweep.test.js --forceExit
--maxWorkers=4` — 6 suites / 120 tests passed. Full server suite run
separately since this touches a shared session-security primitive used by
both the REST and MCP authorization paths.

### 42. HTTP/2 connection pool cap silently bypassed under sustained concurrent load — FIXED

**File:** `demo_api_server/services/http2McpBridge.js`, line 52

**Issue:** `createHttp2Session()`'s pool-cap enforcement calls
`evictOldest()`, which is a no-op whenever every pooled entry currently has
`pendingStreams > 0` — yet the unconditional `pool.set(key, ...)` still runs
afterward regardless of whether eviction succeeded.

**Trigger scenario:** With `MAX_POOL_SIZE = 5` and 5 distinct pool keys all
mid-flight (`pendingStreams > 0` on each), a 6th distinct key triggers
`evictOldest()` finding nothing evictable, then still gets added, growing
the pool past its configured cap.

**Fix:** `evictOldest()` now selects the least-recently-used entry
regardless of `pendingStreams`, and calls `session.close()` on it — Node's
own graceful HTTP/2 shutdown, which stops accepting new streams but lets
any in-flight ones finish naturally, so no in-progress request is ever
aborted by this change.

**Evidence:** New test in `http2McpBridge.test.js` fills the pool to
`MAX_POOL_SIZE` (5), marks every entry's `pendingStreams = 1` (the exact
condition that made eviction a no-op), then requests a 6th distinct session
and asserts the pool stays at 5. Proven to fail against the pre-fix file
(grew to 6) and pass against the fix. `cd demo_api_server && CI=true npx
jest src/__tests__/http2McpBridge.test.js --forceExit --maxWorkers=4` —
14/14 passed.

### 43. Unbounded pagination loops against an operator-configured MCP upstream — FIXED

**File:** `demo_api_server/routes/privilegeMcpClient.js`, line 607

**Issue:** `listAllMcpPages()` and `discoverPolicyTools()` both page through
an upstream MCP server via a `do { ... } while (cursor)` loop with no
iteration cap and no repeated-cursor detection.

**Trigger scenario:** The MCP endpoint is operator-configured via
`PRIVILEGE_AGENTLESS_MCPGW_URL`/`PRIVILEGE_AGENT_MCPGW_URL` with no allowlist
restricting it to a fixed trusted host. A pagination bug on the configured
upstream (repeating a cursor, or always emitting a fresh `nextCursor`) hangs
the request indefinitely.

**Fix:** Added `MAX_MCP_PAGES = 100` and a `seenCursors` `Set` to both loops
— either an excessive page count or a repeated cursor now breaks with a
logged warning instead of looping forever.

**Evidence:** New `privilegeMcpClient.pagination.test.js` (via a new
`listAllMcpPages` entry in the file's existing `__test` hook export) proves
three cases: an upstream that emits a fresh cursor forever stops at exactly
100 pages; one that repeats a cursor stops after 2 calls; one that
terminates normally is unaffected. While proving the fail-before case, the
pre-fix loop didn't just hang — it actually **crashed the Node process**
(stack/heap exhaustion, `SIGABRT`) under test, a stronger confirmation of
the bug's severity than the "hangs indefinitely" description suggested.
`cd demo_api_server && CI=true npx jest
tests/routes/privilegeMcpClient.pagination.test.js --forceExit
--maxWorkers=4` — 3/3 passed; full `privilegeMcpClient` test directory (14
suites / 50 tests) — no regressions.

### 44. Stopped-then-restarted activity poller can apply a stale response to the new session — FIXED

**File:** `demo_api_ui/src/services/spinnerActivityService.js`, line 127

**Issue:** `poll()` checks the module-level `_stopped` flag only once,
synchronously, before its `await` — it never re-checks after the await
resumes. A poll started under one session that is stopped and quickly
restarted before the response arrives still applies its stale response's
side effects to the new session's state.

**Trigger scenario:** A poll is in flight; `stop()` fires, then `start()`
fires again quickly (resetting `_events`/`_clientEventId`/`_sinceTimestamp`).
When the original poll's response arrives, it already passed the top-of-function
`_stopped` check (back when it was still false), so it proceeds
unconditionally, corrupting the new session's event feed and polling
cursor with data belonging to the ended session.

**Fix:** Added a `_generation` counter bumped in `start()`/`stop()`.
`poll()` captures it before its await and re-checks it in both the success
and catch paths after the await resumes, returning early (discarding the
response) if the generation changed.

**Evidence:** New test mocks `axios`, defers the first poll's response,
calls `start()` → `stop()` → `start()` while it's still pending, then
resolves the stale response with a distinguishable event and asserts it
never lands in `getEvents()`. Proven to fail against the pre-fix file (the
stale event landed) and pass against the fix. `npm --prefix demo_api_ui run
test:unit -- spinnerActivityService` — 1/1 passed; full UI suite (418 files
/ 3422 tests) — no regressions. `npm --prefix demo_api_ui run build` —
exit 0.

### 45. Cached-status fetch can be clobbered by an older, slower overlapping request — FIXED

**File:** `demo_api_ui/src/services/cachedStatusService.js`, line 51

**Issue:** The fetch's resolve handler unconditionally overwrites
`cache[cacheKey]` with no check that the entry it's writing to is still the
one this fetch was launched for. Two overlapping requests for the same URL
that resolve out of order let an older, slower response clobber a newer,
already-cached fresher response.

**Trigger scenario:** Call A is slow (12s) and its cache TTL (10s) elapses
before it resolves, so call B fires fresh and resolves quickly, caching
fresher data. When A finally resolves, its handler still runs unconditionally
and overwrites the cache with stale data and a new expiry.

**Fix:** The `.then`/`.catch` handlers now close over their own `promise`
(the same `const` they're chained from) and only write to or delete
`cache[cacheKey]` when `cache[cacheKey]?.promise === promise` — i.e. only
when this fetch's own cache entry hasn't already been replaced by a newer
one.

**Evidence:** New test uses fake timers: starts a slow call A, advances past
its TTL, starts a fast call B (caches fresh data), resolves A's slow
response afterward, then asserts a third call still serves B's fresh data
(not A's stale overwrite) with no extra fetch. Proven to fail against the
pre-fix file (stale data won) and pass against the fix. `npm --prefix
demo_api_ui run test:unit -- cachedStatusService` — 1/1 passed; full UI
suite (419 files / 3423 tests) — no regressions. `npm --prefix demo_api_ui
run build` — exit 0.

### 46. MCP gateway config persist failure still reports success — FIXED

**File:** `demo_api_server/routes/mcpGatewayConfig.js`, line 483

**Issue:** `POST /api/admin/mcp-gateway/config` swallows a
`configStore.setRaw` persist failure (both the persist-only branch and the
gateway-push branch) and still responds `ok:true` (`persistedOnly:true` in
the persist-only case), telling the admin UI the config was saved when the
LMDB persist actually threw.

**Trigger scenario:** POST with persist-only fields, or a mix that also
includes gateway fields, while `configStore.setRaw(toStore)` rejects — the
catch only `console.warn`s, and the response is built unconditionally
afterward reporting success either way.

**Fix:** Both persist branches (persist-only and gateway-push-then-persist)
now return `502 { ok:false, error, detail }` when `configStore.setRaw`
rejects, instead of falling through to the unconditional `ok:true` response.

**Evidence:** New tests added to `demo_api_server/tests/mcpGatewayConfig.test.js`
(`finding #46: persist-only path reports ok:false when setRaw rejects` and
`finding #46: gateway-push path reports ok:false when setRaw rejects after a
successful push`) proven to fail (`Expected: 502, Received: 200`) against the
pre-fix file and pass against the fix. Full file green:
`CI=true ./node_modules/.bin/jest tests/mcpGatewayConfig.test.js --forceExit --maxWorkers=4`
→ 16 passed.

### 47. Agent-consent route has no error handling — a Redis failure hangs the request forever — FIXED

**File:** `demo_api_server/routes/agentConsentRoute.js`, line 22

**Issue:** `POST /api/agent/consent/:runId` has no try/catch around its
awaited `agentRunStore` calls, so a rejected promise (Redis-backed
`RedisStore`) leaves the request hanging forever instead of returning an
error response.

**Trigger scenario:** With `RedisStore` in use, if its `_init()` failed at
startup (or Redis errors later), `agentRunStore.getRunState(runId)` rejects.
`express-async-errors` is listed in `package.json` but never `require`d
anywhere, and there's no try/catch in this handler, so Express 4 doesn't
forward the rejection to `res` — it becomes a process-level
`unhandledRejection` and the HTTP response is never sent. Same exposure at
`publishConsent` and `deleteRunState`.

**Fix:** Wrapped the whole handler body in try/catch; a rejection from any
`agentRunStore` call now returns `503 { error, detail }` instead of leaving
the request hanging.

**Evidence:** New test added to `demo_api_server/tests/agentConsentRoute.test.js`
(`finding #47: returns an error response instead of hanging when the store
rejects`) proven to fail — it actually timed out at 30s against the pre-fix
file, matching the "hangs forever" description — and pass against the fix.
Full file green:
`CI=true ./node_modules/.bin/jest tests/agentConsentRoute.test.js --forceExit --maxWorkers=4`
→ 6 passed.

### 48. Group-policy manifest error is indistinguishable from "no groups configured" — FIXED

**File:** `demo_api_server/services/groupPolicy.js`, line 49

**Issue:** `_getVerticalManifest`'s catch block collapses a genuine
manifest-resolution error to the same `null` returned when a vertical
simply has no groups block; `requiredGroupForTool` then treats a
thrown-error vertical as unrestricted for any non-banking vertical.

**Trigger scenario:** `ff_authorize_group_policy` enabled,
`verticalManifest.resolver.resolve(verticalId)` throws for a non-banking
vertical instead of returning normally — no PingOne group is ever required
for that vertical's restricted tools, silently permitting tools meant to be
group-restricted.

**Fix:** `_getVerticalManifest`/`_groupsConfig` now return a distinct
`MANIFEST_RESOLUTION_ERROR` sentinel (a `Symbol`) instead of `null` when
resolution throws. `requiredGroupForTool` checks for that sentinel: for
banking it still falls back to the legacy `config/group-policy.json` data
(unchanged behavior), but for every other vertical — which has no legacy
fallback — it now fails closed, returning a group name no user actually
holds, so the tool is treated as restricted-and-denied rather than
unrestricted.

**Evidence:** New tests added to `demo_api_server/src/__tests__/groupPolicy.test.js`
(`finding #48: fails closed (non-null) for a non-banking vertical when
manifest resolution throws` and a companion test confirming banking's legacy
fallback still works) proven to fail (`Received: null`) against the pre-fix
file and pass against the fix. Full file green:
`CI=true ./node_modules/.bin/jest src/__tests__/groupPolicy.test.js --forceExit --maxWorkers=4`
→ 18 passed. Also re-ran known callers'
tests (`tests/sensitiveToolsGated.test.js`, `tests/a2aAdminVerticals.test.js`)
since this is an authz-adjacent file: 96 passed.

### 49. Agent-restrictions save failure gives the admin zero feedback — FIXED

**File:** `demo_api_ui/src/components/Users.js`, line 115

**Issue:** `updateAgentRestrictions`'s catch block only `console.error`s the
PATCH failure, giving the admin no visible feedback that the
agent-restriction change did not save.

**Trigger scenario:** Admin changes the agent-restrictions dropdown; the
PATCH fails (403/network/500). The catch does nothing but log; the spinner
still clears in `finally`, so the UI silently reverts with no toast.

**Fix:** Added `notifyError('Failed to update agent restrictions')` to the
catch block.

**Evidence:** New test
`demo_api_ui/src/components/__tests__/Users.agentRestrictions.test.jsx`
(`finding #49: notifies the admin when updateAgentRestrictions PATCH
fails`) proven to fail (timeout waiting for `notifyError` to be called)
against the pre-fix file and pass against the fix.

### 50. Activity-log export/clear failures give zero on-screen feedback — FIXED

**File:** `demo_api_ui/src/components/ActivityLogs.js`, line 124

**Issue:** `exportLogs()` and `clearOldLogs()` catch their request failures
with only `console.error`, giving no on-screen indication that the CSV
export or log purge failed.

**Trigger scenario:** Admin clicks Export and the GET fails — no file
downloads, no toast, looks like a no-op. Or admin confirms the clear-logs
dialog and the DELETE fails — nothing is cleared but the dialog closing
implies success.

**Fix:** Added `notifyError(...)` to both `exportLogs`'s and
`clearOldLogs`'s catch blocks.

**Evidence:** New tests in
`demo_api_ui/src/components/__tests__/ActivityLogs.errorFeedback.test.jsx`
(`finding #50: notifies the admin when exportLogs fails` and `finding #50:
notifies the admin when clearOldLogs fails`) proven to fail against the
pre-fix file and pass against the fix.

### 51. Theme-zone save reports success even when the server rejects it — FIXED

**File:** `demo_api_ui/src/components/ThemeZonePanel.js`, line 33

**Issue:** `persist()` never checks `response.ok`, so a failed PUT/DELETE
(403/500) resolves the promise just like a 200 — `refetch()` runs and the
caller's catch never fires, so a failed save is never rolled back or
reported.

**Trigger scenario:** Admin's PUT/DELETE to `/api/admin/vertical-themes/:id`
403s or 500s. `persist`'s `fetch(...).then(() => refetch())` resolves on any
HTTP response body, so the "applied"/"reset" toast fires and the optimistic
override is kept as if saved — even though nothing persisted server-side.

**Fix:** `persist` now checks `response.ok` and throws when the server
rejects, so `applyPalette`/`resetZone`'s `await persist(...)` throws before
reaching the `setToast(...)` success line — the false success toast no
longer fires. The existing `catch { /* keep optimistic */ }` (a pre-existing,
deliberate choice for network errors) now applies uniformly to HTTP-error
responses too.

**Evidence:** New test
`demo_api_ui/src/components/__tests__/ThemeZonePanel.persistFailure.test.jsx`
(`finding #51: does not show a success toast when the server rejects the
save`) proven to fail (toast rendered with "SaaS Blue applied to Header
gradient") against the pre-fix file and pass against the fix.

### 52. Resource-server journey page swallows every fetch error, not just 401s — FIXED

**File:** `demo_api_ui/src/pages/ResourceServerJourneyPage.jsx`, line 258

**Issue:** The `on401` catch handler swallows every rejection, not just
401s — it returns `null` unconditionally, so a 500 or network failure is
silently absorbed and the page renders as an empty/loading state instead of
showing any error.

**Trigger scenario:** The summary-inflow or vertical-record fetch fails
with a 500 or network error. `on401` only branches on `e.response?.status
=== 401`, but returns `null` on every branch regardless, so `Promise.all`
resolves normally and the page shows its normal empty-data layout with no
error message.

**Fix:** `on401` now re-throws any non-401 error instead of returning
`null` unconditionally. A new `.catch()` on the `Promise.all(...)` sets a
new `fetchError` state (distinct from `needsSignIn`), rendered as a generic
error message (`.rsj-fetch-error` in `ResourceServerJourneyPage.css`).

**Evidence:** New test in
`demo_api_ui/src/pages/__tests__/ResourceServerJourneyPage.test.jsx`
(`finding #52: non-401 fetch failures › shows a generic error, not the
empty/loading layout, on a 500`) proven to fail against the pre-fix file
and pass against the fix. Full file green (10 passed).

### 53. Response-body capture computed on every request, then discarded — FIXED

**File:** `demo_api_server/middleware/activityLogger.js`, line 105

**Issue:** The response-body capture block does `JSON.stringify`/`JSON.parse`
work on every successful response body under 10KB, builds `responseBody`,
but the value is never used — `logEntry.responseBody` is hardcoded to
`null` a few lines later with an explicit "disabled — may contain PII"
comment.

**Trigger scenario:** Any response with status < 400 flowing through the
globally-mounted `logActivity` middleware with a body under 10,000 chars
triggers the stringify/parse/redaction work, whose result is discarded.

**Fix:** Deleted the dead computation block entirely — its result was never
read (`logEntry.responseBody` is hardcoded `null` a few lines later).

**Evidence:** Pure dead-code removal with zero externally observable
behavior change, so there is no fail-before/pass-after test to write (the
output was already hardcoded `null` before and after). Verified by running
the existing suite unchanged and confirming it still passes:
`CI=true ./node_modules/.bin/jest tests/middleware/activityLogger.ledgerHop.test.js src/__tests__/middleware/activityLogger.test.js --forceExit --maxWorkers=4`
— 2 suites / 7 tests passed. `activityLogger` is globally-mounted shared
middleware, so also ran the full server suite:
`CI=true ./node_modules/.bin/jest --forceExit --maxWorkers=4` — 851/853
suites, 10096 tests passed.

### 54. JWK-to-PEM conversion re-derived on every token validation despite a 10-minute JWKS cache — FIXED

**File:** `demo_api_server/services/tokenValidationService.js`, line 146

**Issue:** `validateToken()` calls `jwkToPem(jwk)` on every invocation even
though the underlying JWK is cached for 10 minutes — the PEM conversion
itself is never cached or memoized by kid.

**Trigger scenario:** Any JWT-mode request validated within the same
10-minute cache window re-derives the PEM for the same key on every call.

**Fix:** Each JWKS cache entry now carries a `pemByKid` Map, populated
lazily by a new `getPemForJwk(jwksUri, jwk)` helper — the first
`validateToken()` call for a given key computes and caches its PEM; every
subsequent call within the same 10-minute JWKS cache window reads the
cached PEM instead of re-running `crypto.createPublicKey`/`.export()`.

**Evidence:** New test `tests/services/tokenValidationService.pemCache.test.js`
(`derives the PEM once, then reuses it across repeat validateToken calls
for the same kid`) spies on `crypto.createPublicKey` and proves it's called
once (not twice) across two `validateToken()` calls for the same token;
fails against the pre-fix file (`Received: 2`) and passes against the fix.
`tokenValidationService` is auth-adjacent, so also ran its full sibling
suite plus known callers:
`CI=true ./node_modules/.bin/jest tests/services/tokenValidationService.pemCache.test.js tests/services/tokenValidationService.allowHttp.test.js tests/services/tokenValidationService.algConfusion.test.js tests/mcpResourceServerAudience.regression.test.js tests/idJagJwksTrust.test.js tests/verticalToolAudience.regression.test.js src/__tests__/a2aProtocolCards.test.js src/__tests__/agentMcpTokenService.test.js --forceExit --maxWorkers=4`
— 8 suites / 127 tests passed.

### 55. Per-tool scope resolution re-checks the manifest file's mtime once per tool — FIXED

**File:** `demo_api_server/services/agentScopes.js`, line 71

**Issue:** `resolveAgentScopes()` calls `scopeTopology.toolScopes(name)`
once per tool name inside a for-loop; each call goes through `load()`,
which does a synchronous `fs.statSync()` for staleness-checking on every
call — so N tools means N blocking stat syscalls where a single manifest
load would suffice.

**Trigger scenario:** Any call to `resolveAgentScopes` for a vertical with
multiple tools causes one `fs.statSync` call per unique tool name in the
loop.

**Fix:** `resolveAgentScopes` now calls the already-exported
`scopeTopology._manifest()` once before the loop and reads
`manifest.tools[name].requiredScopes` directly instead of calling
`toolScopes(name)` per tool. Root-caused one level further than the finding
text: `isWriteIsh(scope)` — called once per scope inside the very same
loop — also called `scopeTopology.scopeMeta(scope)`, i.e. `load()`, i.e.
another `fs.statSync()` per scope. Gave `isWriteIsh` an optional second
`manifest` param (defaults to the existing `scopeTopology.scopeMeta()` path
for its other, non-hot-loop callers) so the loop can pass the preloaded
manifest and eliminate every redundant stat, not just the `toolScopes` ones.

**Evidence:** New test `finding #55: loads the scope-topology manifest once
per call, not once per tool` in `src/__tests__/agentScopes.test.js` spies on
`fs.statSync` around one `resolveAgentScopes('banking', true)` call — fails
against the pre-fix file (91 stat calls) and passes against the fix (≤1).
Full file green (11 passed). Also re-ran `scopeTopology`'s own suite and
every other `resolveAgentScopes`/`isWriteIsh` caller:
`CI=true ./node_modules/.bin/jest src/__tests__/agentScopes.test.js src/__tests__/scopeTopology.regression.test.js tests/a2aDelegatedScopeIsolation.test.js tests/airlinesVertical.test.js src/__tests__/agentToolsResolver.test.js src/__tests__/agentToolsResolver.degraded.test.js --forceExit --maxWorkers=4`
— 6 suites / 116 tests passed.

### 56. Recent-transactions feed re-sorted and re-grouped on every render — FIXED

**File:** `demo_api_ui/src/components/UserDashboard.js`, line 2517

**Issue:** The recent-transactions feed (sort + Today/Yesterday/date-bucket
grouping) is recomputed from the full `transactions` array on every render
via an inline IIFE, not memoized with `useMemo`, despite depending only on
`transactions`. Identical unmemoized pattern duplicated in
`UserDashboardPing2026.js`.

**Trigger scenario:** Any state update in this large component (e.g. typing
in the transfer amount field) re-renders the whole component, re-executing
the sort+group derivation on every keystroke even though `transactions`
didn't change.

**Fix:** Pulled the sort+group derivation out of the inline render IIFE and
into a `useMemo` keyed on `[transactions]` (placed alongside the file's
other memos, `totalBalance`/`totalDebt`), in both `UserDashboard.js` and
`UserDashboardPing2026.js`. `UserDashboard.js` is byte-for-byte frozen by a
sha256 canary in `UserDashboardPing2026.test.js` (test #8) — re-baselined
in the same commit with a dated comment explaining why.

**Evidence:** New test `finding #56: does not re-sort/re-group recent
transactions on an unrelated re-render` in `UserDashboard.test.js` spies on
`Array.prototype.sort`, types into the (unrelated) transfer-amount field,
and asserts no sort call — fails against the pre-fix file (`Received: 1`)
and passes against the fix. Full UI suite green: `npm run test:unit` → 422
files / 3429 tests (includes the re-baselined canary and all
`UserDashboardPing2026` suites, 29 tests). Build gate green: `npm run
build` → exit 0.

---

## Round 4 findings (2026-08-23)

### 57. Worker-token single-flight cache ignores credential identity, letting a credential rotation hand a caller a token minted with stale creds — FIXED

**File:** `demo_api_server/services/pingOneAuthorizeService.js`, line 252

**Issue:** `getWorkerToken()` correctly gates its *cache read* on
`_workerTokenCache.credKey === credKey`, but the single-flight branch right
after it (`if (_workerTokenInflight) return _workerTokenInflight;`) had no
credKey comparison at all. The in-flight IIFE closes over the `creds`/
`credKey` captured from whichever call originally started it, and on
resolution unconditionally overwrote `_workerTokenCache` with that original
(possibly now-stale) credKey — poisoning the cache for later callers too.

**Trigger scenario:** An admin rotates the PingOne Authorize worker
credentials (`authorize_worker_client_id`/`secret`, or the
`PINGONE_WORKER_CLIENT_ID`/`SECRET` env aliases) via `/config` while a
`getWorkerToken()` call is already in flight for the OLD credentials (cache
cold — e.g. right after a config reload). A second `evaluate()` call
arriving in that window computes the NEW credKey, finds `_workerTokenInflight`
truthy, and awaits that same promise — receiving a token minted against the
OLD worker app/environment, which it then presents to the PingOne Authorize
decision endpoint, causing spurious 401s or a decision evaluated under the
wrong worker identity. Nothing invalidates the in-flight guard on credential
rotation — the only reset path (`_resetAuthorizeRuntimeState()`) is an
explicit test-only hook, never called from any config-update route.

**Fix:** Added a `_workerTokenInflightKey` variable, set alongside
`_workerTokenInflight` when a request starts and cleared in the same
`finally`. The single-flight branch now only reuses the in-flight promise
when `_workerTokenInflightKey === credKey`; otherwise it falls through and
starts a new `_requestWorkerToken(creds)` call (running concurrently with
the stale one), so a caller after a credential rotation always gets a
token minted with its own resolved creds. `_resetAuthorizeRuntimeState()`
(the test-reset hook) also resets the new variable.

**Evidence:** New test
`demo_api_server/tests/pingOneAuthorizeService.workerTokenRace.test.js`
(`a caller with rotated credentials does not receive a token minted for
the old credentials`) mocks `configStore`/`fetch` with a deferred-resolve
pattern to start one request, rotate credentials mid-flight, and start a
second — proven to fail against the pre-fix file (`Expected length: 2,
Received length: 1` — the second caller reused the stale in-flight
promise) and pass against the fix. This is authz-adjacent shared code, so
also ran the existing `pingOneAuthorizeWorkerTokenCache.test.js` (5
passed) and the full server suite:
`cd demo_api_server && CI=true ./node_modules/.bin/jest --forceExit --maxWorkers=4`
— 852/854 suites, 10095/10219 tests passed (the 2 failures —
`runtime-settings-api.test.js`, `intentBindingDemo.test.js` — are the
documented full-suite-parallel-load flake; both passed 100% re-run in
isolation).

### 58. Lighthouse "single audit in progress" guard is released before the timed-out audit's Chrome process actually finishes tearing down — FIXED

**File:** `demo_api_server/services/lighthouseService.js`, line 82

**Issue:** `runLighthouseAudit()` races the real audit promise against a
60s timeout promise. On timeout, the timeout callback fired `chrome.kill()`
fire-and-forget (not awaited) and immediately rejected — settling
`Promise.race` right away — while the real Chrome process/lighthouse run
kept executing in the background; nothing checked a `timedOut` flag to
abort it early, and if `chrome` was never assigned by the 60s mark (still
inside `chromeLauncher.launch()`), no kill was even attempted. The route
treated the outer race's settlement as its sole "is an audit running"
signal, clearing `isRunning = false` as soon as the timeout rejection won —
while the original Chrome/lighthouse process was still alive.

**Trigger scenario:** `POST /api/admin/lighthouse/run` runs long enough to
hit `AUDIT_TIMEOUT_MS` (slow page load, or a cold-machine Chrome install
still pending at 60s). An admin (or an automated retry) immediately POSTs
`/run` again; the guard was open, so a second Chrome+lighthouse instance
launched concurrently with the still-terminating first one, defeating the
single-flight guard and doubling resource usage.

**Fix:** Moved the single-flight lock into `lighthouseService.js` itself.
`runLighthouseAudit()` now throws `LIGHTHOUSE_BUSY` synchronously (before
any `await`) if `_isRunning` is already true, and `_isRunning` is only
cleared inside the real audit work's own `finally` block — after `await
chrome.kill()` — not when the outer `Promise.race` settles. Restructured
the chrome-launch try/catch to live inside that same outer try/finally so
`_isRunning` clears on every exit path (success, lighthouse() throwing, or
launch() throwing). The route no longer sets/clears `isRunning` itself —
it only reads it for a fast 429 pre-check, and now also catches
`LIGHTHOUSE_BUSY` as a defense-in-depth 429 for the race window between
that pre-check and the call. This also automatically closes the gap for
`lighthouseScheduler.js`'s cron-triggered call, which had zero guarding of
its own — it's now protected by the same service-level lock.

**Evidence:** New test
`demo_api_server/tests/lighthouseService.auditGuardRace.test.js` (`isRunning
stays true (and a retry is rejected) until real Chrome teardown finishes
after a timeout`) uses fake timers plus deferred `chrome-launcher`/
`lighthouse` mocks to fire the 60s timeout while the real work is still
pending, then asserts `isRunning` is still `true` and a concurrent call
rejects `LIGHTHOUSE_BUSY` — proven to fail against the pre-fix file
(`Expected: true, Received: false`) and pass against the fix. Existing
`lighthouseRoute.regression.test.js` (11 tests, unchanged) still passes —
the route-level 429/503/504/200 contract is preserved.

### 59. Sidebar/terminal drag listeners leak on document if mouseup fires outside the page — FIXED

**File:** `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx`, line 172

**Issue:** `startSidebarDrag`/`startTerminalDrag` each attached
document-level `mousemove`/`mouseup` listeners on `mousedown`, with the
only removal path inside the `mouseup` handler itself. No `useEffect`
cleanup, pointer capture, or `window blur`/`mouseleave` fallback existed
for the case where the button is released outside the document.

**Trigger scenario:** User drags the sidebar/terminal resize handle toward
the viewport edge and releases the mouse over the OS taskbar, another
window, or an iframe — `mouseup` never reaches `document`, the listeners
are never removed, and every subsequent mouse move anywhere on the page
keeps forcibly resizing the sidebar/terminal using the stale
`startX`/`startW` captured at drag start, until the user happens to
mouseup over the document again.

**Fix:** Switched both handlers from mouse events to pointer events with
`setPointerCapture(e.pointerId)` on drag start (wrapped in try/catch for
environments without Pointer Capture support) — this keeps
`pointermove`/`pointerup` delivered to the handle element even after the
cursor leaves the document, closing the leak at its root. Also added a
`dragCleanupRef` + unmount effect (mirroring `useDividerDrag`'s pattern) so
an unmount mid-drag (route change with the button held) removes the
listeners too, as a second, independent safety net.

**Evidence:** New test
`demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.dragCleanup.test.jsx`
(`engages pointer capture and removes document listeners on unmount
mid-drag`) proven to fail against the pre-fix file (`setPointerCapture`
never called — the old code used plain mouse events) and pass against the
fix. All 6 sibling test files for this page (17 tests total) still pass.

### 60. Stale-response race: overlapping log fetches can overwrite newer results with older ones — FIXED

**File:** `demo_api_ui/src/components/AgentGatewayLogPanel.jsx`, line 44

**Issue:** `fetchLogs`/`fetchDecisions`, wired through `refresh()` and both
an initial-load effect and a 4s autoRefresh interval (plus the filter
input's Enter key calling `fetchLogs()` directly), had no request
sequencing (no requestId guard, no `AbortController`). Multiple in-flight
calls to `/api/admin/agent-gateway/logs` could resolve out of order.

**Trigger scenario:** User changes the filter input and presses Enter
while a previous `fetchLogs()` (triggered by the prior filter, or by the
4s autoRefresh tick against a slow docker-log tail read) is still in
flight. If the older request's response arrived after the newer one,
`setLogs`/`setLogError` from the stale request overwrote the fresh state,
silently showing log lines that don't match the currently-selected
filter/tail.

**Fix:** Added a monotonically incrementing ref for each fetcher
(`logsReqIdRef`, `decisionsReqIdRef`), captured at the start of each call
and checked before every `setState` call (success and error/finally
paths) — a response only applies if it's still the most recently issued
request for that fetcher.

**Evidence:** New test
`demo_api_ui/src/components/__tests__/AgentGatewayLogPanel.staleResponse.test.jsx`
(`an older filter request does not overwrite a newer one that resolved
first`) uses deferred promises to resolve a newer request before an older
one — proven to fail against the pre-fix file (rendered "OLD line"
instead of "NEW line") and pass against the fix.

### 61. Stale-response race: rapid time-window changes can render data for the wrong window — FIXED

**File:** `demo_api_ui/src/components/NewRelicDashboard.jsx`, line 70

**Issue:** `load()` depended on `[win, search]` and was called on mount and
every 30s via `setInterval`, with no request sequencing or cancellation
when `win`/`search` changed mid-flight. The window-selector buttons were
never disabled while a request was loading, so nothing stopped a user from
firing a second request before the first resolved.

**Trigger scenario:** Admin clicks through the window selector quickly
(e.g. default 1h then 24h). The 24h request queries a larger range and can
resolve after a request issued right after it; if it did, its response
overwrote `data`, so the stage strip, sparkline, category stats, and event
stream all rendered the wrong window's data while the window control
itself showed the newly-selected one.

**Fix:** Added a monotonically incrementing `reqIdRef`, captured at the
start of `load()` and checked before `setData`/`setState` in both the
success and error paths — same pattern as finding #60
(`AgentGatewayLogPanel.jsx`) and finding #45 (`cachedStatusService.js`).

**Evidence:** New test in
`demo_api_ui/src/components/__tests__/NewRelicDashboard.test.jsx`
(`finding #61: an older, slower window request does not overwrite a newer
one that resolved first`) uses deferred promises to resolve a 24h-window
request before the initial 1h one — proven to fail against the pre-fix
file (rendered stale `13` instead of `999`) and pass against the fix. Full
file green (20 tests, including all 19 pre-existing).

### 62. ID-JAG token-mint route has zero error handling — an internal throw hangs the request (or crashes the process) — FIXED

**File:** `demo_api_server/routes/enterpriseIdp.js`, line 40

**Issue:** `router.post('/token', ...)` was an async handler with NO
try/catch anywhere in its body — unlike the rest of the codebase's
established convention. It awaits a policy check then synchronously calls
`jwt.sign(..., enterpriseIdpKey.getPrivateKeyPem(), ...)`. Express 4 does
not catch rejected promises from async route handlers, and
`express-async-errors` is listed in `package.json` but never `require()`'d
anywhere, so no global safety net existed.

**Trigger scenario:** A signed-in user POSTs a well-formed RFC 8693
token-exchange request to `/api/enterprise-idp/token`.
`enterpriseIdpKey.getPrivateKeyPem()` lazily builds/signs the key on first
call from `process.env.ENTERPRISE_IDP_SIGNING_KEY_PEM` — if that env var
is malformed/truncated (a realistic copy/paste misconfiguration; there is
no startup validation anywhere), `crypto.createPrivateKey` throws
synchronously inside the async handler. The promise rejection was
unhandled: the requester got no response at all, and in dev/test (no
`CRASH_GUARD=1`) the whole BFF process hard-exits, taking down every other
in-flight request.

**Fix:** Wrapped the handler body in try/catch, matching the pattern used
by every sibling route: on catch, log and return
`res.status(500).json({ error: 'server_error', error_description: err.message })`.

**Evidence:** New test in
`demo_api_server/src/__tests__/enterpriseIdpRoutes.test.js` (`finding #62:
an internal throw (e.g. malformed signing key) returns a 500, not a hang`)
mocks `enterpriseIdpKey.getPrivateKeyPem` to throw — proven to fail against
the pre-fix file (the request genuinely hung, hitting jest's 30s test
timeout, exactly matching the "hangs the request" description) and pass
against the fix. Full file green (8 tests) plus the 3 sibling
`enterpriseIdp*` test files (17 tests) unaffected.

### 63. Consent-decline block fails open when localStorage read throws — FIXED

**File:** `demo_api_ui/src/services/agentAccessConsent.js`, line 5

**Issue:** `isAgentBlockedByConsentDecline()` — the actual gate `AIAgent.js`
checks at 6 call sites before letting the AI agent keep acting after a
user declines a high-value transaction — wrapped its `localStorage.getItem`
in a try/catch that swallowed any exception and returned `false`: the same
value returned for a legitimate "never declined" state.
`setAgentBlockedByConsentDecline` had the identical fail-silent pattern on
the write side.

**Trigger scenario:** In a browsing context where `localStorage` access
throws (storage disabled by enterprise/browser policy, a hardened privacy
extension, or a partitioned/sandboxed iframe — some raise `SecurityError`
on `getItem`, not just `setItem`), a user who declines a high-value
transaction has the decline silently fail to persist — and independent of
that, any later `getItem` failure alone made the check return `false`, so
the agent was treated as never having been blocked and kept acting despite
the explicit decline.

**Fix:** An in-memory module-level flag (`_memoryBlocked`) is now the
source of truth — `isAgentBlockedByConsentDecline()` reads only that,
never `localStorage` directly, so a storage failure occurring *after*
module init can no longer flip the answer. `localStorage` is used only as
best-effort persistence for surviving reloads. If the *initial* read
itself throws (storage inaccessible from the start), the module now fails
CLOSED — `_memoryBlocked` defaults to `true` — instead of `false`.

**Evidence:** New test
`demo_api_ui/src/services/__tests__/agentAccessConsent.failClosed.test.js`
(`finding #63: reports blocked=true when the initial localStorage read
throws`) proven to fail against the pre-fix file (`Received: false`) and
pass against the fix. Uses `vi.stubGlobal` to replace `localStorage`
outright rather than spying on `Storage.prototype` — where the Storage
methods live differs between Node 22 (CI) and Node 26 (local), so a
prototype spy silently misses on one of the two runtimes (see
`useCustomChips.test.js` for the same established pattern). Also verifies
a later storage failure does not flip an already-established
`blocked=false` back to blocked.

### 64. Logout button treats a failed session-clear the same as a successful one — FIXED

**File:** `demo_api_ui/src/services/logout.js`, line 21

**Issue:** `performLogout()` — wired directly to the "Log out"/"Sign Out"
button — calls `fetch('/api/auth/logout')` to have the BFF clear the
session cookie, then navigates to the returned `logoutUrl`. Its `.catch()`
swallowed any fetch failure and navigated to `/` exactly as it would on
success, with no indication the server-side session was never cleared.

**Trigger scenario:** A transient network failure (or an aborted fetch,
e.g. a backgrounded tab during navigation) causes the fetch to
`/api/auth/logout` to reject before reaching the server. The catch
swallowed it and redirected to `/`, which renders as a logged-out landing
page, but the BFF session cookie was never cleared — the user (or the next
person on a shared/public machine) could still be treated as authenticated
by any request that reuses the still-valid cookie.

**Fix:** The catch handler now calls `notifyError('Logout failed — please
try again.')` and does **not** navigate away. Deliberately does not fall
back to a direct `window.location.href = '/api/auth/logout'` navigation —
this file's own top comment documents that a direct navigation loses the
`Set-Cookie` clear behind the CRA dev proxy's 302→PingOne redirect, which
is exactly why `fetch()` is used here in the first place; falling back to
it on failure would silently reintroduce that already-fixed bug. Staying
on the current page (still genuinely signed in, matching reality) and
surfacing the error is the safer minimal fix.

**Evidence:** New test
`demo_api_ui/src/services/__tests__/logout.failureFeedback.test.js`
(`finding #64: notifies the user and does not navigate away when the
logout fetch fails`) proven to fail against the pre-fix file (`notifyError`
never called) and pass against the fix. A second test confirms the success
path (`logoutUrl` navigation) is unchanged. Also ran the 5 test files that
exercise `performLogout` callers (`AdminSideNav`/`DemoSetupPanel`
sign-out): 28 tests, unaffected.

### 65. ConfigStore.getEffective() rebuilds a ~230-entry alias map from scratch on every call — FIXED

**File:** `demo_api_server/services/configStore.js`, line 1074

**Issue:** `getEffective(key)` declared a ~360-line, ~230-key
`envFallbackMap` object literal inside the method body — allocated fresh
on every single invocation, even though the map is 100% static and never
depends on the `key` argument (only indexed afterward).

**Trigger scenario:** This is a hot path, not an edge case:
`middleware/auth.js`'s `requireScopes` gate calls `getEffective` twice per
scope-checked request; `mcpGatewayClient.js`'s `getMcpGatewayHttpUrl()` —
documented as "the single chokepoint every tool-call path uses" — calls it
2-4 times per invocation; `demoStepPrerequisites.js`'s
`checkChipPrerequisites` calls it once per required flag in a loop. ~204
call sites project-wide mean a single request can trigger dozens of full
rebuilds of this literal.

**Fix:** Hoisted the object literal out of the method body to module scope
as `const ENV_FALLBACK_MAP = { ... };`, declared once before the
`ConfigStore` class (matching the file's existing `FIELD_DEFS` pattern),
and updated the lookup site to reference it directly. No behavior change —
the map never varied per-call.

**Evidence:** New test
`demo_api_server/src/__tests__/configStore.envFallbackMapHoisted.test.js`
proves via static source-text inspection (same technique as
`NewRelicDashboard.test.js`'s CSS dark-mode-ground checks) that
`ENV_FALLBACK_MAP` is declared once, before the class, and no longer
inside `getEffective()`'s own body — proven to fail against the pre-fix
file (the module-scope declaration doesn't exist yet) and pass against the
fix. Ran the existing functional regression suite
(`configStore.get.envFallback.test.js`, `configStore.envReconcile.test.js`)
— 21 passed, confirming no output changed. `configStore.js` is core shared
infrastructure, so also ran the full server suite: 850/856 suites passed
(the 4 failures — `anthropic.lmstudio.live.test.js`,
`attackSimulator.test.js`, `rfc9728-integration-verification.test.js`,
`rfc9728-integration.test.js` — are pre-existing/environmental: confirmed
by re-running them against the unmodified pre-fix file, which fails
identically).

### 66. UseCaseLauncherPage rebuilds every track/authorize/agent-gateway list on every render — FIXED

**File:** `demo_api_ui/src/pages/UseCaseLauncherPage.js`, line 925

**Issue:** `happyPathAll`/`happyPathIds`/`happyPath`, `authorizeIds`/
`authorizeAll`/`authorizeVisible`, `grouped`, `demoTrackItemsForStrip`,
`demoAll`/`demoVisible`, and `agentGatewayIds`/`agentGatewayAll`/
`agentGatewayVisible` — 13 derived values covering the full cross-vertical
use-case catalog — were plain `const` assignments in the render body: every
one re-filtered/re-mapped/rebuilt Sets from scratch on every render,
regardless of what triggered it (a feature-flag toggle, an attack-sim
result, opening an education panel — none of which change `useCases` or
the search `query`).

**Trigger scenario:** This page is the primary `/use-cases` catalog view;
every keystroke in the search box, every flag toggle, and every
attack-sim/chip-run result re-renders it, and each render re-scanned the
full catalog across all 13 derivations — the exact "same table rebuilt
every render" pattern already fixed elsewhere this round (finding #65).

**Fix:** Wrapped all 13 derivations in `useMemo`. The `*All`/id-Set
derivations depend only on `[useCases]` (or `[]` for the static
capability-ledger lookups); the query-filtered lists depend on their
`*All` plus `[query]` — so an unrelated re-render (e.g. a flag toggle)
now reuses the previous computation instead of rebuilding it.

**Evidence:** New test
`demo_api_ui/src/pages/__tests__/UseCaseLauncherPage.memoization.test.jsx`
(`does not recompute authorize/agent-gateway id sets on an unrelated
re-render`) spies on the capability-ledger lookups
(`allPingOneAuthorizeUCIds`/`allAgentGatewayUCIds`) and triggers a
flag-toggle re-render (the same interaction as the existing T6d test) —
proven to fail against the pre-fix file (call count increased) and pass
against the fix (call count unchanged). Full existing regression suite for
this page green: `UseCaseLauncherPage.test.js` (37 tests) and
`UseCaseLauncherPage.loginPrompt.test.jsx` (3 tests) unaffected. UI build
gate green.

---

## Changelog

- 2026-08-23 — #66 FIXED: `UseCaseLauncherPage.js`'s 13 track/authorize/
  agent-gateway/demo derivations (`happyPath*`, `authorize*`, `grouped`,
  `demoTrackItemsForStrip`, `demo*`, `agentGateway*`) are now `useMemo`-
  wrapped instead of being plain `const` assignments re-scanning the full
  use-case catalog on every render — including renders unrelated to
  `useCases`/`query`, like a feature-flag toggle. New test spying on the
  capability-ledger lookups proven to fail against the pre-fix file (call
  count increased on an unrelated re-render) and pass against the fix; full
  existing regression suite (40 tests across 2 files) and UI build gate
  green.
- 2026-08-23 — #65 FIXED: `configStore.js`'s `ENV_FALLBACK_MAP` (~230
  entries) is now declared once at module scope instead of being
  re-allocated inside `getEffective()` on every call — a hot path called
  ~204 times project-wide, some inside loops. New source-inspection test
  proven to fail against the pre-fix file and pass against the fix;
  functional regression suite green (21 tests, output unchanged); full
  server suite green (850/856 suites — 4 pre-existing/environmental
  failures confirmed unrelated).
- 2026-08-23 — #64 FIXED: `logout.js`'s `performLogout()` catch now calls
  `notifyError(...)` and stays put instead of navigating to `/` on a fetch
  failure — closing the window where a failed session-clear looked
  identical to a successful logout while the BFF session cookie was still
  valid. Deliberately does not fall back to a direct-navigation retry, to
  avoid reintroducing the cookie-clearing bug this file's own `fetch()`
  approach was written to avoid. New test proven to fail against the
  pre-fix file and pass against the fix; 5 caller test files (28 tests)
  unaffected.
- 2026-08-23 — #63 FIXED (high severity): `agentAccessConsent.js`'s
  `isAgentBlockedByConsentDecline()` now reads an in-memory flag as its
  source of truth instead of `localStorage` directly, and fails CLOSED
  (`blocked=true`) instead of open (`false`) when the initial storage read
  itself throws — closing the window where a hardened-privacy/enterprise
  browsing context could make the AI banking agent silently keep acting
  after a user explicitly declined a high-value transaction. New test
  proven to fail against the pre-fix file and pass against the fix.
- 2026-08-23 — #62 FIXED: `enterpriseIdp.js`'s `POST /token` handler is now
  wrapped in try/catch, returning `500 { error: 'server_error' }` instead
  of hanging forever (or hard-crashing the process in dev/test) when an
  internal call throws — e.g. a malformed `ENTERPRISE_IDP_SIGNING_KEY_PEM`.
  New test proven to fail against the pre-fix file (hit jest's 30s test
  timeout — the request genuinely hung) and pass against the fix; full
  file green (8 tests) plus 3 sibling `enterpriseIdp*` files (17 tests)
  unaffected.
- 2026-08-23 — #61 FIXED: `NewRelicDashboard.jsx`'s `load()` gained a
  monotonic `reqIdRef`, checked before `setData`/`setState`, closing the
  window where a rapid window-selector change (e.g. 1h then 24h) could
  have the slower, older request resolve after the newer one and render
  the wrong window's data. Same pattern as finding #60. New test proven to
  fail against the pre-fix file and pass against the fix; full file green
  (20 tests).
- 2026-08-23 — #60 FIXED: `AgentGatewayLogPanel.jsx`'s `fetchLogs`/
  `fetchDecisions` gained monotonic request-id refs, checked before every
  `setState`, closing the window where an older, slower overlapping fetch
  (a previous filter, or a stale autoRefresh tick) could overwrite a newer
  response. New test proven to fail against the pre-fix file and pass
  against the fix.
- 2026-08-23 — #59 FIXED: `PrivilegeMcpClientPage.jsx`'s sidebar/terminal
  resize handles switched from mouse events to pointer events with
  `setPointerCapture`, so `pointermove`/`pointerup` keep being delivered
  even after the cursor leaves the document — closing the leak where a
  mouseup outside the page left the drag listeners (and forced resizing)
  attached forever. Also added an unmount-safety-net cleanup. New test
  proven to fail against the pre-fix file and pass against the fix; all 6
  sibling test files for this page (17 tests) unaffected.
- 2026-08-23 — #58 FIXED: `lighthouseService.js`'s single-flight
  `_isRunning` guard is now managed entirely inside the service and only
  clears after the real Chrome teardown (`await chrome.kill()`) completes,
  not when the outer 60s timeout race settles — closing the window where
  an immediate retry after a timeout could launch a second concurrent
  Chrome instance. The route no longer sets/clears `isRunning` itself,
  only reads it for a fast pre-check. New test proven to fail against the
  pre-fix file and pass against the fix; existing route regression suite
  (11 tests) unaffected.
- 2026-08-23 — #57 FIXED: `pingOneAuthorizeService.js`'s worker-token
  single-flight guard now tracks the credKey it was started for
  (`_workerTokenInflightKey`) and only reuses the in-flight promise for a
  matching credKey, closing the window where a credential rotation
  mid-flight could hand a caller a token minted with stale creds. New test
  proven to fail against the pre-fix file and pass against the fix; full
  server suite green (852/854 suites, 10095 tests; 2 known flakes passed
  in isolation).
- 2026-08-23 — #53, #54, #55, #56 FIXED (performance, round 3 complete —
  all of #40–56 now FIXED): `activityLogger.js`'s dead response-body
  capture block (computed, never read) deleted outright. `tokenValidationService.js`
  now caches the derived PEM per `(jwksUri, kid)` alongside the existing
  10-minute JWKS cache instead of re-deriving it from the JWK on every
  `validateToken()` call. `agentScopes.js`'s `resolveAgentScopes` now loads
  the scope-topology manifest once per call instead of once per tool (and,
  going one level past the finding's own description, once per scope too
  via `isWriteIsh`) — cut a 91-`fs.statSync`-call resolution down to ≤1.
  `UserDashboard.js`/`UserDashboardPing2026.js`'s recent-transactions
  sort+group derivation is now `useMemo`-keyed on `[transactions]` instead
  of recomputing on every unrelated re-render; `UserDashboard.js`'s sha256
  canary re-baselined in the same commit. New tests for #54/#55/#56 proven
  to fail against each pre-fix file and pass against the fix (#53 has no
  externally observable behavior to test — verified via the unchanged
  existing suite instead). Full server suite green (851/853 suites, 10096
  tests) since this batch touches shared middleware and auth-adjacent
  services. Full UI suite green (422 files / 3429 tests) plus `npm run
  build` green.
- 2026-08-23 — #49, #50, #51, #52 FIXED (UI-side swallowed errors):
  `Users.js`'s `updateAgentRestrictions` and `ActivityLogs.js`'s
  `exportLogs`/`clearOldLogs` catch blocks now call `notifyError(...)`
  instead of only `console.error`; `ThemeZonePanel.js`'s `persist()` now
  checks `response.ok` and throws on failure so a rejected save no longer
  shows a false "applied"/"reset" success toast; `ResourceServerJourneyPage.jsx`'s
  `on401` now re-throws non-401 errors, and a new `fetchError` state
  (distinct from `needsSignIn`) renders a generic error message on a
  genuine fetch failure instead of the normal empty-data layout. New tests
  for all four proven to fail against each pre-fix file and pass against
  the fix. Full UI suite green: 422 files / 3428 tests, plus `npm run
  build` (the gate) green.
- 2026-08-23 — #46, #47, #48 FIXED (server-side swallowed errors):
  `mcpGatewayConfig.js`'s POST /config now returns `502 { ok:false }` instead
  of `ok:true` when `configStore.setRaw` rejects, on both the persist-only
  and gateway-push-then-persist branches; `agentConsentRoute.js`'s consent
  handler is now wrapped in try/catch and returns `503` instead of hanging
  forever on a Redis-store rejection; `groupPolicy.js` now distinguishes a
  thrown manifest-resolution error from a legitimate "no groups configured"
  null, and `requiredGroupForTool` fails closed for non-banking verticals
  when resolution throws (banking keeps its legacy-config fallback,
  unchanged). New tests for all three proven to fail against the pre-fix
  files and pass against the fixes; each touched suite green, plus
  `groupPolicy`'s known authz-adjacent callers re-run green (96 passed).
- 2026-08-23 — #45 FIXED: `cachedStatusService.js`'s fetch handlers now
  self-reference their own `promise` and only write/delete the cache entry
  when it's still the current one, closing the window where an older,
  slower overlapping request could clobber a fresher cached response. New
  test proven to fail against the pre-fix file and pass against the fix;
  full UI suite green (419 files / 3423 tests). **This closes the Runtime
  category for round 3 (#40–45 all FIXED).**
- 2026-08-23 — #44 FIXED: `spinnerActivityService.js` gained a `_generation`
  counter bumped in `start()`/`stop()`, checked in `poll()` after its await
  in both success and error paths, discarding a stale response from an
  ended/replaced session. New test proven to fail against the pre-fix file
  and pass against the fix; full UI suite green (418 files / 3422 tests).
- 2026-08-23 — #43 FIXED: `privilegeMcpClient.js`'s `listAllMcpPages`/
  `discoverPolicyTools` gained a `MAX_MCP_PAGES` cap and repeated-cursor
  detection. New test proven to fail against the pre-fix file — which
  actually crashed the process (SIGABRT) rather than just hanging — and pass
  against the fix; 50 tests passed across the full `privilegeMcpClient` test
  directory.
- 2026-08-23 — #42 FIXED: `http2McpBridge.js`'s `evictOldest()` now selects
  the LRU entry regardless of `pendingStreams` and calls Node's graceful
  `session.close()` (drains in-flight streams, doesn't abort them), closing
  the gap where the pool cap was silently bypassed when every entry was
  mid-flight. New test proven to fail against the pre-fix file (pool grew to
  6) and pass against the fix; 14/14 tests passed.
- 2026-08-23 — #41 FIXED: `hitlCredit.js` gained `claim()`/`release()` — a
  cross-request lock (process-local Map keyed by session id, TTL 3s) closing
  the race between the `isFresh()` read and the `consume()` write across an
  awaited policy call. User confirmed the lock-based approach over a
  narrower single-file patch or leaving it open. Wired into
  `routes/transactions.js` (with explicit `release()`) and
  `mcpToolAuthorizationService.js` (relies on TTL self-expiry, given its
  three mutually-exclusive gates spread across many return paths). New
  tests proven to fail against the pre-fix file (5/5) and pass against the
  fix (14/14); 120 tests passed across affected suites.
- 2026-08-23 — #40 FIXED: `cibaTransactionReceipt.js` gained a periodic
  unref'd `setInterval` sweep (mirrors `http2McpBridge.js`'s
  `cleanupInterval`) that evicts expired, never-consumed receipts. New test
  proven to fail against the pre-fix file and pass against the fix; 65
  tests passed across affected suites.
- 2026-08-23 — Round 3 audit run: re-ran the same 6-finder + per-category
  adversarial-verify design against the post-round-2 codebase (after PR
  #2294 merged all 12 round-2 fixes). 17/17 candidate findings survived
  verification, added as #40–#56, all OPEN — none fixed yet.
- 2026-08-23 — #39 FIXED: `ScopeAuditPage.js`'s `handleAddScope` gained an
  optional `{ refresh: false }` so `handleFixAll`/`handleFixEverything` skip
  the per-scope reload and reload once after the batch instead. New test
  proven to fail against the pre-fix file (3 GETs for 2 scopes) and pass
  against the fix (2 GETs); full UI suite green (417 files / 3421 tests).
  **This closes the Performance category and the entire round-2 audit — all
  39 findings across both rounds are now FIXED.**
- 2026-08-23 — #38 FIXED: `ActivityNarrativeContext.js` caps `requests` at
  `MAX_REQUESTS = 50` (mirrors `useActivityLog.js`'s `MAX_EVENTS` pattern),
  bounding both array growth and per-turn remap cost. New test proven to
  fail against the pre-fix file (55 items, uncapped) and pass against the
  fix; full UI suite green (416 files / 3420 tests).
- 2026-08-23 — #37 FIXED: `traceProjector.js`'s `projectServiceCards`
  precomputes a `serverKindServices` Set once instead of re-scanning the
  full span array per candidate span. Behavior-preserving; verified via the
  existing `traceProjector.test.js` suite (12/12, including a live 77-span
  fixture) since only `project` is exported from this module.
- 2026-08-23 — #36 FIXED: `demoTrackService.js` now tracks a `_lastAccessed`
  time per session bucket (touched in `_hydrate`, the shared entry point) and
  sweeps buckets idle past a 24h TTL via a periodic unref'd `setInterval`.
  New test (fake timers, advance 25h, no manual sweep call) proven to fail
  against the pre-fix file and pass against the fix; existing demo-track
  suites (6 files / 29 tests) unaffected.
- 2026-08-23 — #35 FIXED: `auditLogService.js` now calls its own
  `pruneOldLogs()` on a periodic unref'd `setInterval` (1h), matching the
  `_evictionInterval` pattern in `mcpGatewayRateLimit.js`. New test (fake
  timers, advance 91 days, no manual prune call) proven to fail against the
  pre-fix file and pass against the fix.
- 2026-08-23 — #34 FIXED: `DemoSetupPanel.js`'s reset-demo empty catch now
  calls `notifyError` and returns early on a failed POST instead of
  proceeding to clear local storage and log the admin out as if it
  succeeded. New tests proven to fail against the pre-fix file and pass
  against the fix; full UI suite green (416 files / 3419 tests). **Closes
  the Swallowed-Errors category (#9–18, #32–34 all FIXED).**
- 2026-08-23 — #33 FIXED: `useElicitation.js` now exposes an `error` state,
  set on a failed submit and surfaced by `ElicitationDialog.jsx` as a visible
  banner instead of silently resetting to idle. New hook + dialog tests
  proven to fail against the pre-fix files (4/9) and pass against the fix
  (9/9); full UI suite green (415 files / 3417 tests).
- 2026-08-23 — #32 FIXED: `pingone_mgmt_private_key` registered in
  `configStore.js`'s `FIELD_DEFS`/`SECRET_KEYS`/`envReconcile.js`
  classification; `adminConfig.js`'s generate-keypair route now `await`s
  `setConfig(...)` so a persistence failure yields a real 500 instead of a
  false `ok:true`. Found (but left out of scope, logged in `TECH_DEBT.md`)
  that `pingone_mgmt_client_id`/`_client_secret`/`_token_auth_method` have
  the same FIELD_DEFS gap. New tests proven to fail against the pre-fix
  files and pass against the fix; full server suite green.
- 2026-08-23 — #31 FIXED: `sessionResolver.js`'s `resolveSessionUser` now
  captures its 10s race-timeout guard's `setTimeout` id and clears it in a
  `finally` block, so a normal (non-hung) call no longer leaves a dangling
  timer running. New test (fake timers, `vi.getTimerCount()`) proven to fail
  against the pre-fix file and pass against the fix.
- 2026-08-23 — #30 FIXED: `bankingRestartNotificationService.js` gained an
  `_inFlightHealthCheck` promise so `manualRetry()` joins an already-running
  automatic `retryHealthCheck()` instead of racing it with a second
  concurrent health check. New test proven to fail against the pre-fix file
  (2 concurrent fetches) and pass against the fix; full UI suite green (413
  files / 3411 tests).
- 2026-08-23 — #29 FIXED: `useDraggablePanel.js` gained an
  `activeDragHandlersRef` (mirroring the existing resize-path ref); the
  unmount cleanup effect now also tears down an in-flight drag's listeners
  and resets `userSelect`. New test proven to fail against the pre-fix file
  and pass against the fix; 4/4 tests passed.
- 2026-08-23 — #28 FIXED: `pingOneGroupMembershipService.js` gained a
  `_cacheGeneration` counter bumped by `_resetCache()`; a fetch in flight
  when a reset happens now skips repopulating the cache with its stale
  result. New test proven to fail against the pre-fix file and pass against
  the fix; 9/9 tests passed.
- 2026-08-23 — Round 2 audit run: re-ran the same 6-finder + per-category
  adversarial-verify design against the post-round-1 codebase (after PR
  #2278 merged all 27 round-1 fixes). 12/12 candidate findings survived
  verification, added as #28–#39, all OPEN — none fixed yet.
- 2026-08-23 — #27 FIXED: `TraceStepCard.jsx` hoisted its twice-called,
  identical-args `claimDiffs(...)` into one `useMemo`'d
  `beforeAfterChangedClaims` and wrapped the default export in `React.memo`.
  Behavior-preserving; `TraceStepCard.teaching.test.jsx`'s existing
  claim-diff-markup assertions plus the full UI suite (412 files / 3409
  tests) confirm no regression. **All 27 findings are now FIXED — audit
  closed.**
- 2026-08-23 — #26 FIXED: `transactions.js` and `accounts.js`'s admin
  list-all routes now accept optional `limit`/`offset` query params (mirrors
  #19's `GET /runs` pattern), slicing before the owner-enrichment map and
  adding a `total` field; default (no params) behavior is unchanged. 2 new
  tests per route file, 42 tests passed scoped.
- 2026-08-23 — #25 FIXED: `TokenChainTraceRail.jsx` and `TokenChainFilmstrip.jsx`
  now `useMemo` their `classicSteps`/`steps` derivation instead of recomputing
  `buildLiveTokenChainSteps` on every render (zoom/tab/tray toggles included).
  Behavior-preserving; verified via existing component suites + full UI suite
  (412 files / 3409 tests), no new test (in-module call sites aren't
  spy-observable via the export binding).
- 2026-08-23 — #24 FIXED: `AIAgent.js`'s chat transcript now caps its default
  render to the most recent 150 messages via a new pure helper
  (`utils/transcriptWindow.js`, `windowTranscript`), with a "Show N earlier
  messages" button to reveal the rest — user confirmed implementing the cap +
  button (recommended option) over a WONTFIX. New direct unit test on the
  pure helper (over-cap slice, under-cap passthrough, `showAll` bypass); full
  suite (412 files / 3409 tests) and `npm run build` both green.
- 2026-08-23 — #23 FIXED: `wipeEnvironment`'s 5 delete loops now run at
  bounded concurrency (5) via a new `_mapLimit` helper — user explicitly
  confirmed accepting reordered step messages for this destructive,
  live-mutating, low-frequency operation before applying. Added 3 tests
  (first coverage this function ever had); the `_mapLimit`-specific one only
  passes post-fix, the other two are behavior-preserving on both.
- 2026-08-23 — #22 FIXED: `pingoneProvisionService.js`'s `grantScopesToApplication`
  deleted a dead loop and deduped its cross-resource scope fetch by
  `resource.id` via `Promise.all`. New test proven to fail against the
  pre-fix file (2 redundant fetches) and pass against the fix (1).
- 2026-08-23 — #21 FIXED: `AIAgent.js`'s per-row proof-strip check is now an
  O(1) `Map.get` (precomputed `useMemo`) instead of an O(N) `slice().some()`
  scan per assistant row. Behavior-preserving by construction; verified via
  full suite (411 files / 3406 tests) rather than a new test.
- 2026-08-23 — #20 FIXED: `VerticalProvider.jsx`'s context value is now
  `useMemo`'d. New test proven to fail against the pre-fix file and pass
  against the fix (reading the raw context, not `useVertical()`, which has
  its own separate new-object-per-call issue — logged in `TECH_DEBT.md`
  rather than folded into this fix). Full UI suite (411 files / 3406 tests)
  run given the Provider's app-wide reach.
- 2026-08-23 — #19 FIXED: `agentRun.js`'s `_summarizeRun` is now O(1) per run
  (incremental status/threadId tracking in `_recordTraceEvents`, with a
  correctness fallback for entries not created that way); `GET /runs` gained
  optional `limit`/`offset`. **Category 3 (Performance) started** — first of
  9 findings fixed. Fixing this also caught and fixed a real regression it
  introduced against an existing directly-seeded-entry test before commit.
- 2026-08-23 — #18 FIXED: `BulkDecisionPanel.jsx` now sets its existing `err`
  state on a policy-endpoint load failure instead of leaving a code comment
  as the only trace. New test proven to fail against the pre-fix file and
  pass against the fix. **Category 2 (Swallowed & Hidden Errors) is now
  fully closed — #9–#18 all fixed.**
- 2026-08-23 — #17 FIXED: `CreateUserPanel.jsx`'s `searchDelegate` now
  surfaces a failure via the existing `fieldErrors.delegateUser` slot instead
  of rendering an empty dropdown identical to a zero-match search. 3 new
  tests, 2 proven to fail against the pre-fix file and pass against the fix.
- 2026-08-23 — #16 FIXED: `CopilotAgent.jsx` now distinguishes a config-load
  failure (retryable error) from a genuinely empty/unconfigured config
  (permanent notice), reusing the existing `friendly(e)` helper. 3 new
  tests, 2 proven to fail against the pre-fix file and pass against the fix.
- 2026-08-23 — #14 and #15 FIXED: `AdminSideNav.jsx`'s vertical-list load and
  switch-vertical POST now both `console.error` on failure, matching this
  file's own convention. 2 new tests proven to fail against the pre-fix file
  and pass against the fix.
- 2026-08-23 — #13 FIXED: `agentAuthorization.js`'s two cleanup while-loops
  now cap at `MAX_REVOKE_ATTEMPTS = 10`; `/hard`'s response now honestly
  reports `ok: false` + a warning instead of always `ok: true`. New tests:
  running them against the pre-fix file crashed the Node process with an
  OOM (not just a hang) — a more severe proof than expected.
- 2026-08-23 — #12 FIXED: `agentRestrictionsGate.js`'s `!userId` branch now
  routes through the same `failoverPermits()`/503 pattern as the other 3
  "can't determine" branches, instead of unconditionally calling `next()`.
  New fails-closed test proven to fail against the pre-fix file and pass
  against the fix.
- 2026-08-23 — #11 FIXED: `DelegationPage.js`'s `AgentAuthorizationCard` now
  surfaces `setAgentAuthorization` failures via `notifyError` and moved
  `setWorking(false)` to a `finally` (it was previously stuck-on on a
  *successful* toggle — an adjacent bug found while fixing this). 2 new tests
  proven to fail against the pre-fix file and pass against the fix.
- 2026-08-23 — #10 FIXED: `AdminSideNav.jsx`'s "Reset Demo" now checks
  `res.ok` and catches network errors, logging + toasting via `notifyError`
  and returning before `performLogout()` on failure. 3 new tests, 2 proven to
  fail against the pre-fix file and pass against the fix.
- 2026-08-23 — #9 FIXED: `delegationGate.js` now fails closed (401) on a
  JWT-shaped Bearer token whose payload can't be decoded, instead of silently
  treating the parse failure as "non-delegated — pass through". New test
  proven to fail against the pre-fix file and pass against the fix.
- 2026-08-23 — #8 FIXED: `AIAgent.js`'s `refreshAfterTransaction` now guards
  both fetch chains with a shared `refreshRequestIdRef`, mirroring the
  existing sibling `cancelled`-flag pattern in the same file. Verified via
  full suite + build gate rather than a new render test (see doc for why).
- 2026-08-23 — #7 FIXED: `AIAgent.js`'s `[location.pathname]`-keyed unmount/
  route-change cleanup now also calls `aguiAbort()`, closing the gap a
  separate pre-existing (unmount-only) effect could never cover: the route
  changing while the same instance stays mounted. New test proven to fail
  against the pre-fix file and pass against the fix.
- 2026-08-23 — #6 FIXED: `transactionConsentChallenge.js`'s `confirmChallenge`/
  `verifyOtp`/`verifyMfa` now serialize concurrent calls per `challengeId` via
  an in-process `_challengeBusy` Set (409 `challenge_busy` on overlap) rather
  than a full session-reload mutex, to keep the change small in a
  REGRESSION_PLAN §1 path. `verifyOtp` is now `async` (its one call site
  updated). 2 new tests proven to fail against the pre-fix file and pass
  against the fix; 9 suites / 96 tests green across the HITL-adjacent surface.
- 2026-08-23 — #5 FIXED: `apiCallTrackerService.js`'s `apiCalls`/`sessionTokens`
  Maps now get an hourly sweep tied to `sessionStore.js`'s own 24h TTL, keyed
  by a new `lastActivity` Map (never touched for `GLOBAL_SESSION_ID`). 3 new
  tests proven to fail against the pre-fix file and pass against the fix.
- 2026-08-23 — #4 FIXED: `agentSessionMiddleware.js`'s `_refreshBlacklist`
  Map now has the same periodic sweep `tokenRefresh.js` already uses (its own
  doc comment already claimed this mirroring, but the sweep itself was never
  copied over). Verified via a probe script since neither file exports its
  private Map for testing.
- 2026-08-23 — #3 FIXED: `AIAgent.js`'s two CIBA poll functions now track
  their pending `setTimeout` ids and clear them (plus mark themselves
  unmounted) in the existing storage-listener effect's unmount cleanup. New
  regression test proven to fail against the pre-fix file and pass against
  the fix.
- 2026-08-23 — #2 FIXED: `mcpWebSocketClient.js`'s outer 15s call-timeout is
  now cleared and re-armed around the elicitation/create and
  sampling/createMessage server-initiated-request branches, so it no longer
  races the up-to-60s human-response wait. New regression test proven to fail
  against the pre-fix file and pass against the fix.
- 2026-08-23 — #1 FIXED: `killAgent`'s shared `killAgent._userId` function-object
  state removed; the function's own `userId` parameter was already
  per-invocation and correct. Verified: 6 killSwitch-related jest suites / 34
  tests pass.
- 2026-08-23 — initial pass, 27 findings from a category-parallel multi-agent
  audit (6 finders + 3 adversarial verifiers), all confirmed, all OPEN.
