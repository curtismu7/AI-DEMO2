# Runtime, Hidden-Error & Performance Audit — demo_api_server + demo_api_ui

Findings from a category-parallel multi-agent audit (2026-08-23): 6 finder agents
(one per category × service) followed by an adversarial verify pass per category
(default to REJECTED unless the file/line and behavior could be confirmed
directly). All 27 candidate findings survived verification — 0 rejected.

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
| 4 | Runtime | `middleware/agentSessionMiddleware.js` | medium | OPEN |
| 5 | Runtime | `services/apiCallTrackerService.js` | medium | OPEN |
| 6 | Runtime | `services/transactionConsentChallenge.js` | medium | OPEN |
| 7 | Runtime | `demo_api_ui/.../AIAgent.js` (aguiAbort) | medium | OPEN |
| 8 | Runtime | `demo_api_ui/.../AIAgent.js` (refreshAfterTransaction) | medium | OPEN |
| 9 | Swallowed | `middleware/delegationGate.js` | high | OPEN |
| 10 | Swallowed | `demo_api_ui/.../AdminSideNav.jsx` (reset demo) | high | OPEN |
| 11 | Swallowed | `demo_api_ui/.../DelegationPage.js` | high | OPEN |
| 12 | Swallowed | `middleware/agentRestrictionsGate.js` | medium | OPEN |
| 13 | Swallowed | `routes/agentAuthorization.js` | medium | OPEN |
| 14 | Swallowed | `demo_api_ui/.../AdminSideNav.jsx` (vertical list) | medium | OPEN |
| 15 | Swallowed | `demo_api_ui/.../AdminSideNav.jsx` (switch vertical) | medium | OPEN |
| 16 | Swallowed | `demo_api_ui/.../CopilotAgent.jsx` | medium | OPEN |
| 17 | Swallowed | `demo_api_ui/.../CreateUserPanel.jsx` | medium | OPEN |
| 18 | Swallowed | `demo_api_ui/.../BulkDecisionPanel.jsx` | low | OPEN |
| 19 | Perf | `routes/agentRun.js` | high | OPEN |
| 20 | Perf | `demo_api_ui/vertical/VerticalProvider.jsx` | high | OPEN |
| 21 | Perf | `demo_api_ui/.../AIAgent.js` (O(N²) proof scan) | high | OPEN |
| 22 | Perf | `services/pingoneProvisionService.js` (grantScopes) | medium | OPEN |
| 23 | Perf | `services/pingoneProvisionService.js` (wipeEnvironment) | medium | OPEN |
| 24 | Perf | `demo_api_ui/.../AIAgent.js` (unbounded transcript) | medium | OPEN |
| 25 | Perf | `TokenChainTraceRail.jsx` / `TokenChainFilmstrip.jsx` | medium | OPEN |
| 26 | Perf | `routes/transactions.js` / `routes/accounts.js` | low | OPEN |
| 27 | Perf | `TraceStepCard.jsx` | low | OPEN |

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

### 4. `_refreshBlacklist` Map has no periodic sweep — OPEN

**File:** `demo_api_server/middleware/agentSessionMiddleware.js`, line 28

**Issue:** Module-level Map, only self-pruned per-key on lookup. Its own doc
comment says it mirrors `tokenRefresh.js`'s structure, which *does* have a
`setInterval` sweep — never carried over here.

**Trigger scenario:** Any session whose refresh token PingOne rejects gets an
entry; if the user never returns with that exact session id (the common case
after a forced re-auth), the entry sits forever.

**Fix (not yet applied):** Add the same `setInterval` sweep `tokenRefresh.js`
uses, `.unref()`'d.

### 5. `apiCalls`/`sessionTokens` Maps grow unbounded per session key — OPEN

**File:** `demo_api_server/services/apiCallTrackerService.js`, lines 23/27

**Issue:** Both keyed by `sessionId` with no TTL/eviction of stale *keys* —
only the array value under each key is capped. Clear functions only fire from
explicit admin/UI actions, never on session expiry or logout.

**Trigger scenario:** Every distinct session that ever triggers a tracked
call/token leaves a permanent Map entry, independent of the session's own LMDB
expiry.

**Fix (not yet applied):** Track last-write time per key; add a periodic sweep
mirroring the session store's own cleanup pattern.

### 6. HITL challenge mutated from independent in-memory copies — OPEN

**File:** `demo_api_server/services/transactionConsentChallenge.js` — `confirmChallenge()` (372–526), `verifyOtp()` (672–729), `verifyMfa()` (741–822)

**Issue:** The challenge lives in `req.session.txConsentChallenges`, loaded
once per request with no per-session lock. Two concurrent requests for the
same challenge each work from an independent copy; last `session.save()` wins.

**Trigger scenario:** A double-clicked Confirm/Verify-OTP sends two concurrent
POSTs for the same `challengeId`. Both see `otpAttempts=0`, so the lockout
counter can be bypassed, and device-picker/OTP init can silently fire twice.

**Fix (not yet applied):** Serialize mutating access per `req.sessionID` with
an in-process async mutex wrapping the handler's call into these three
functions.

### 7. Unmount cleanup misses `aguiAbort()` — OPEN

**File:** `demo_api_ui/src/components/AIAgent.js`, unmount effect (8276–8283)

**Issue:** The unmount/route-change cleanup only aborts `sendAbortRef.current`
— never calls `aguiAbort()`, so `useAgentRun`'s AbortController-driven stream
keeps running post-unmount.

**Trigger scenario:** An AG-UI run is in flight when the user navigates away;
the stream keeps calling event closures over an unmounted instance's setState
functions.

**Fix (not yet applied):** Add `aguiAbort()` to the same cleanup effect's body
and dependency array.

### 8. `refreshAfterTransaction` has no response-order guard — OPEN

**File:** `demo_api_ui/src/components/AIAgent.js`, lines 8298–8367

**Issue:** Fires two fetches with no AbortController, request-id guard, or
cancelled flag — unlike a sibling effect in the same file (1996–2035) that
already implements that pattern.

**Trigger scenario:** The `banking-transaction-completed` event fires twice
quickly; if the first fetch resolves *after* the second, the older response
silently reverts the panel to stale data.

**Fix (not yet applied):** Guard with a shared request-id ref, mirroring the
existing sibling pattern in the same file.

### 9. `act` claim parse failure treated as "no delegation" — OPEN

**File:** `demo_api_server/middleware/delegationGate.js` — `_extractActClientId` (4–15), `delegationGate` (17–26)

**Issue:** Swallows ANY JSON.parse failure on the RFC 8693 `act` claim with a
bare `catch { return null; }`; `delegationGate` treats `null` as "non-delegated
— pass through," indistinguishable from "genuinely has no `act` claim."

**Trigger scenario:** A Bearer token on `/api/agent`, `/api/agent/run`, or
`/api/agent/langchain/run` whose payload fails JSON.parse/base64 decode. A
previously-revoked delegate agent whose token trips this parse path bypasses
the 403 `delegation_revoked` check entirely.

**Fix (not yet applied):** Return `{clientId, parseFailed}` instead of a bare
value; return 401 `invalid_token` when `parseFailed` is true instead of
falling through to `next()`.

### 10. "Reset Demo" logs the admin out even when the reset failed — OPEN

**File:** `demo_api_ui/src/components/AdminSideNav.jsx`, `handleResetConfirm` (1231–1246)

**Issue:** The reset POST's error is fully swallowed (`catch (_) {}`) with no
logging or toast, and the function proceeds unconditionally to clear
localStorage and log the admin out.

**Trigger scenario:** Click "Reset Demo" while the endpoint fails — the admin
is logged out believing the reset happened; it never did.

**Fix (not yet applied):** Check `response.ok`/catch the network error and
call `notifyError` before clearing localStorage + `performLogout()`.

### 11. Agent-authorization toggle gives no failure feedback — OPEN

**File:** `demo_api_ui/src/components/DelegationPage.js`, `AgentAuthorizationCard.handleToggle` (140–150)

**Issue:** Any `setAgentAuthorization` failure is caught with
`catch { setWorking(false); }` — no toast, no logging, no state revert.

**Trigger scenario:** Click "Authorize agent"/"Revoke agent access" while the
POST fails — button re-enables looking like nothing happened, while the
actual (security-relevant) authorization state is unchanged.

**Fix (not yet applied):** Surface via `notifyError` (file has no import
today, add one).

### 12. Agent-restrictions gate has one fail-open branch contradicting its own contract — OPEN

**File:** `demo_api_server/middleware/agentRestrictionsGate.js`, lines 123–142

**Issue:** The file's own header comment says the gate must fail closed when
restriction level can't be determined; the MCP→BFF userId-resolution fallback
swallows a JWT decode failure and then unconditionally calls `next()` — the
only one of 4 similar branches in this file that skips `failoverPermits()`/503.

**Trigger scenario:** An agent-originated request with no session user and an
undecodable Bearer token, with `ff_agent_restrictions` on — skips the
tier-restriction check entirely.

**Fix (not yet applied):** Route through the same `failoverPermits()`/503
pattern used elsewhere in this file.

### 13. Unbounded revoke-retry loop with no attempt cap — OPEN

**File:** `demo_api_server/routes/agentAuthorization.js`, `DELETE /hard` (94–121), `DELETE /` (123–140)

**Issue:** Cleanup loops re-query for the still-active record after each
revoke attempt, with every failure swallowed, no attempt cap, no backoff. On
`/hard`, even the first revoke's failure is swallowed as non-fatal and the
handler still returns `{ ok: true }`.

**Trigger scenario:** A persistent LMDB write failure — the record's status
never flips, so the re-query returns the same record forever; the loop spins.

**Fix (not yet applied):** Bound with `maxAttempts`; check the actual return
value of the revoke call.

### 14. Vertical-picker load failure indistinguishable from an empty list — OPEN

**File:** `demo_api_ui/src/components/AdminSideNav.jsx`, lines 375–392

**Issue:** `.catch(() => {})` silently leaves `verticals` at `[]` on failure.

**Trigger scenario:** Expand the vertical-picker while the GET fails — empty
picker, zero signal anything went wrong.

**Fix (not yet applied):** Log or toast on failure.

### 15. Switch-vertical failure gives no feedback — OPEN

**File:** `demo_api_ui/src/components/AdminSideNav.jsx`, `handleSwitchVertical` (394–414)

**Issue:** POST failure caught with only state cleanup — no toast, no log.

**Trigger scenario:** Click a vertical while the POST fails — spinner clears,
looks like nothing happened.

**Fix (not yet applied):** Add `console.error`/`notifyError` in the catch.

### 16. Copilot config-load failure looks like "not configured" — OPEN

**File:** `demo_api_ui/src/components/CopilotAgent.jsx`, lines 32–37

**Issue:** `.catch(() => setCfg({}))` collapses any load failure into the same
empty object used for "not configured."

**Trigger scenario:** Open Copilot Studio chat while the config GET fails —
shows the permanent "not configured" message even if fully configured
server-side.

**Fix (not yet applied):** Add a `cfgError` state; reuse the component's
existing `error`/`friendly(e)` helper.

### 17. Delegate search failure looks like zero matches — OPEN

**File:** `demo_api_ui/src/components/CreateUserPanel.jsx`, `searchDelegate` (84–90)

**Issue:** `catch { setDelegateResults([]); }` swallows any search error.

**Trigger scenario:** Search fails — dropdown shows no results, identical to
a real no-match.

**Fix (not yet applied):** Surface via `notifyError` or a field-level message.

### 18. Policy-endpoint load failure not surfaced despite existing error state — OPEN

**File:** `demo_api_ui/src/components/BulkDecisionPanel.jsx`, lines 88–105

**Issue:** A load failure is caught with only a code comment — no error state
set, despite the component already having an `err`/`setErr` state used
elsewhere.

**Trigger scenario:** Open Bulk Decision panel while the GET fails — reads
"No decision endpoints found," identical to a tenant with no policy.

**Fix (not yet applied):** Set the existing `err` state in the catch.

### 19. `GET /runs` re-scans the entire unbounded trace store on every poll — OPEN

**File:** `demo_api_server/routes/agentRun.js` — `GET /runs` (847–856) → `_summarizeRun` (783–803); `entry.events` push (128)

**Issue:** Iterates every entry in `_traceStore` (capped at 500 by evicting
only the single oldest entry per insert — never pruned to a target size) and
calls `_summarizeRun()` per entry, which does a full scan of `entry.events` —
itself uncapped.

**Trigger scenario:** The history view polls `GET /api/agent/run/runs` while
up to 500 runs sit in the store, some with hundreds of events — every poll
re-scans everything synchronously.

**Fix (not yet applied):** Track status/threadId incrementally per event;
add `limit`/`offset` to `GET /runs`.

### 20. Vertical context hands every consumer a new object identity every render — OPEN

**File:** `demo_api_ui/src/vertical/VerticalProvider.jsx`, line 140

**Issue:** `<VerticalContext.Provider value={{ ...state, refetch: doFetch }}>`
— a fresh object literal every render, unmemoized.

**Trigger scenario:** Any unrelated ancestor re-render force-rerenders every
context consumer app-wide (TopNav, AdminSideNav, UserDashboard, etc.).

**Fix (not yet applied):** `useMemo` the provider value.

### 21. O(N²) proof-strip scan on every message-list render — OPEN

**File:** `demo_api_ui/src/components/AIAgent.js`, lines 11239–11255

**Issue:** `filteredMsgs.slice(msgIdx+1).some(...)` inline in the render-body
`.map` per row — O(N) per row, O(N²) total, unmemoized.

**Trigger scenario:** Long conversations + frequent streaming re-renders (14
`setMessages` call sites) repeat the O(N²) work per keystroke/stream tick.

**Fix (not yet applied):** Precompute a `proofRunId → index` Map via
`useMemo`.

### 22. N+1 scope-fetch loop in PingOne grant provisioning — OPEN

**File:** `demo_api_server/services/pingoneProvisionService.js`, `grantScopesToApplication` (1359–1434)

**Issue:** One sequential `GET /resources/{id}/scopes` per existing grant, not
deduped by resource id. A preceding dead loop (1403–1411) is unused.

**Trigger scenario:** Full PingOne bootstrap for a vertical with many
apps/resources re-fetches the same resource's scopes redundantly.

**Fix (not yet applied):** Delete the dead loop; dedupe by `resource.id`,
`Promise.all` across unique ids.

### 23. `wipeEnvironment` deletes everything fully sequentially — OPEN

**File:** `demo_api_server/services/pingoneProvisionService.js`, `wipeEnvironment` (3665–3838)

**Issue:** 5 categories of objects each deleted with a fully sequential
`await` per item, no batching or bounded concurrency.

**Trigger scenario:** Reset-environment wizard on an environment with many
accumulated demo objects — dozens of fully serial round trips.

**Fix (not yet applied):** Bounded concurrency (e.g. 5) per category —
`makeRequest` has no rate-limit/retry handling of its own, so keep it modest.

### 24. Chat transcript renders unbounded with no windowing — OPEN

**File:** `demo_api_ui/src/components/AIAgent.js`, lines 11198–11239

**Issue:** Full message history renders via a single unbounded `.map()` —
every heavy bubble subcomponent stays mounted for the life of the
conversation.

**Trigger scenario:** Long-running demo sessions grow DOM node count and
render cost unboundedly.

**Fix (not yet applied):** Cap to the most recent N messages with a "show
earlier" affordance.

### 25. Token-chain steps rebuilt on every unrelated local-state change — OPEN

**File:** `demo_api_ui/src/components/TokenChainTraceRail.jsx` (352–357), `TokenChainFilmstrip.jsx` (144)

**Issue:** `buildLiveTokenChainSteps(...)` runs directly in the render body,
unmemoized, alongside 6+ unrelated `useState` hooks (zoom, tabs, tray,
selection).

**Trigger scenario:** Toggling zoom or a tab — unrelated to trace data —
triggers a full steps rebuild, handing children brand-new objects every time.

**Fix (not yet applied):** `useMemo` the steps derivation in both files.

### 26. Admin list-all endpoints have no pagination — OPEN

**File:** `demo_api_server/routes/transactions.js` (76–100), `routes/accounts.js` (72–97)

**Issue:** Return every record with no limit/offset before enrichment and
serialization.

**Trigger scenario:** `GET /api/transactions`/`/api/accounts` after
`runtimeData.json` accumulates a large record count.

**Fix (not yet applied):** Add `limit`/`offset` query params, slice before
enrichment, in both files.

### 27. `claimDiffs` computed twice per render, component not memoized — OPEN

**File:** `demo_api_ui/src/components/TraceStepCard.jsx`, lines 404–423

**Issue:** `claimDiffs(before, after)` (JSON.parse + diff) called twice with
identical args inline in JSX every render; component isn't wrapped in
`React.memo`.

**Trigger scenario:** Any parent re-render re-renders every visible card,
redundantly re-parsing/re-diffing the same JSON twice each.

**Fix (not yet applied):** Compute once via `useMemo`; wrap export in
`React.memo` (benefit capped until #25 lands).

---

## Changelog

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
