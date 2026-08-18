# Tech Debt

Known gaps and architectural smells found while fixing something else —
correct enough to ship, not worth blocking the fix that found them. Not a bug
log (`REGRESSION_PLAN.md` §4 is that); this is "should fix properly later."

Reverse-chronological, newest first. Each entry: what's wrong, why it wasn't
fixed now, what the real fix looks like. Every entry heading carries a status
checkbox — `[x]` = paid off (has a RESOLVED/FIXED block), `[ ]` = still open
(PARTLY RESOLVED stays unchecked). Tick the box in the same commit that adds
the resolution block.

An entry that has since been paid off keeps its original text and gains a
**RESOLVED** block naming the branch, what the issue actually turned out to be
(not always what the entry guessed), and what the fix was. Entries are not
deleted on resolution — the wrong guess is often the more useful half of the
record.

### [ ] 2026-08-18 — customer-dashboard banking column is the one dashboard pane without a resize handle

**Where:** `demo_api_ui/src/components/UserDashboard.css` `.ud-body--dashboard-split3`
(first grid track, `minmax(240px, 260px)`), rendered by `UserDashboard.js` /
`UserDashboardPing2026.js` when agent placement is "middle",
`ff_show_agent_in_middle` is ON, and Focus mode is OFF.

**What's wrong:** the agent and token-rail columns drag-resize; the banking
column does not. The resizable-columns rollout (PRs #2086/#2091, phase 3
branch) deliberately skipped it twice: the 3-column-with-banking state never
rendered during verification (live stack was first in `--no-banking`, then in
Focus mode, where the banking column is not mounted at all), and the grid's
own comment ("Token rail | Banking | Agent") does not match DOM child order
(agent, banking, token rail) — so the track-to-column mapping could not be
confirmed without mutating live demo state (feature flags / focus mode) that
the presenter owns. jsdom cannot verify grid geometry either.

**Real fix:** in a session where mutating demo state is acceptable (or on a
throwaway stack), turn Focus mode off with placement "middle" + banking ON,
confirm which grid track the banking column actually occupies, then add a
third handle following the file's own drag pattern (`onAgentWidthResizeMouseDown`
shape + `--ud-banking-col-width` var) in BOTH dashboard variants, and
re-baseline the UserDashboard sha256 canary in `UserDashboardPing2026.test.js`.

### 2026-08-18 — deploy-live reports success while a core service stays down, and keeps skipping it forever

**Where:** `scripts/deploy-live.sh` — `filter_running()` (~line 205) and the
`running_containers` list it is built from (line 197).

**What's wrong:** the script only restarts services whose container is already
running:

```sh
running_containers="$(docker ps --format '{{.Names}}' ...)"     # excludes `created`
...
else
  note "$svc changed but its container is not running — skipped ..."
```

`note()` appends to `NOTES`. It does not set a failure flag, so the run prints
`[deploy-live] done — live stack serves <sha>` and **exits 0**.

The failure is self-sustaining, which is what makes it worse than a one-off miss:
a container that is not running is skipped, being skipped means it is never
started, and so it is not running for the next deploy either. Every subsequent
run repeats the note and exits 0. Nothing escalates.

**Observed 2026-08-18:** after a deploy of `a86e96f24fc1` that exited 0 and
printed its success line, `ai-demo-ping-gateway` sat in state `created` — never
started, no logs, exit code 0, container created inside that deploy's window.
`ping-gateway` has **no compose profile**; it is a core service selected at
runtime by `ff_mcp_gateway_pinggateway`, which `MCP_GATEWAY_RUNTIME_FLAGS`
requires ON for **any** MCP tool chip. So the stack was serving without its IG
gateway while every signal said the deploy succeeded. Recovered with
`./run-docker.sh restart ping-gateway`.

Caught only because the containers were enumerated by hand afterwards
(`docker ps -a --filter label=com.docker.compose.project=ai-demo` and grep out
the healthy ones). Nothing in the deploy path would have surfaced it.

**Not claimed:** that `deploy-live.sh` *created* the stuck container. Compose
recreates during a run and something in that sequence left it un-started; the
cause is unproven. The defect recorded here is the reporting and the permanent
skip, both of which are in this script and are true regardless of what stopped
the container.

**Why not fixed now:** deciding what a non-running service should DO is a
judgement call this entry should not make silently. Starting it is not obviously
right — some services are deliberately down (profiled, `k8-build`, an operator
mid-debug), and `deploy-live` restarting them would be its own surprise.

**Real fix:** separate "deliberately absent" from "should be up and isn't".
Minimum: after the restarts, assert that every container in the compose project
is `running` (and `healthy` where a healthcheck exists), and exit non-zero
naming the ones that are not — the same shape as the `PIPESTATUS`/`-o pipefail`
discipline already required of scripts under `scripts/`. Better: have
`filter_running` distinguish a service that is *absent by design* from one in
`created`/`exited`, and escalate the second from a note to a failure.

**Related:** the `| tail` masking entry below — same class. A command's exit
status describing something other than the thing you care about, with the real
state visible only if you look for it deliberately.

### 2026-08-18 — `ff_a2a_delegation` should not exist as a switch at all

**Where:** `demo_api_server/services/configStore.js` (registry),
`services/a2aDelegationService.js` (`isA2aEnabled`), and its five runtime gates.

**What's wrong:** A2A delegation is not an optional behaviour. The tools flagged
`a2aDelegated` in `scope-topology.json` are reachable **only** through a two-hop
chain — Authorize's `DenyA2aDelegationRequired` denies `ActChainDepth < 2` for
exactly those tools. With the flag off, those tools cannot succeed by any path;
the demo does not degrade, it breaks, and it breaks as an Authorize DENY that
looks nothing like a missing flag. There is no demo that the OFF state tells.

Half-fixed today (PR pending as of this entry): the registry default moved
`'false'` → `'true'`, and the tile now arms the flag from the served
`a2aDelegated` field rather than a hand-kept list of use-case ids. That closes
the accident. It does not remove the ability to turn a required subsystem off.

**Why not fixed now:** removing a flag is not a one-line deletion, and the parts
that would break are not all obvious. Measured, excluding tests and docs:

| Surface | Count | What removal means |
|---|---|---|
| `isA2aEnabled()` call sites | 5 | `routes/agentTool.js`, `services/a2aProtocolServer.js:102`, `services/demoAgentLangGraphService.js` (×2), `services/a2aDelegationService.js:265`. Each becomes unconditional — but `a2aProtocolServer` currently returns a specific 403 (`A2A protocol endpoints require ff_a2a_delegation`) that some caller may depend on |
| configStore registry | 1 | delete the entry. **A persisted `'false'` in a live LMDB outlives the registry change** — needs a migration or an explicit cleanup step, or the environment stays off with no switch left to turn it back on |
| admin listing | 1 | `routes/featureFlags.js:309` — the flag's card, description and any UI that renders it |
| catalog `maturity: 'flag:ff_a2a_delegation'` | 2 | UC2 and UC2.6 change maturity. What they become (`works`?) is a product call, and it changes how they render and whether they are armed |
| arming mirrors | 2 | `services/demoStepPrerequisites.js` + `demo_api_ui/src/utils/requiredDemoFlags.js` — the A2A branch goes away entirely, including the `a2aDelegated` check added today |
| step-verification fixtures | 30 | `data/step-verification/<vertical>/UC2{,.5,.6}.chip.unit-prereq.json`, 10 verticals × 3 — each records the flag as a prerequisite; they are generated, so regenerate rather than hand-edit |
| UI copy referencing the flag by name | 8 files | `AIAgent.js`, `DelegationPage.js`, `DelegationChainValuePage.jsx`, `demoScript.js`, `DemoTourContext.js`, `demoUseCaseSteps.js`, `education/A2ADelegationPanel.js`, plus the tour hint |
| tests asserting the gate | ~12 files | including `demoStepPrerequisites.test.js`, `requiredDemoFlags.parity.test.js` (a parity test across the two mirrors), and three `*.real.spec.js` live specs that arm it |

The live E2E specs are the sharp edge: they arm the flag before running, so they
fail on an unknown flag id rather than on the behaviour under test.

**Real fix:** one PR, in this order — (1) make the five gates unconditional and
delete `isA2aEnabled`; (2) drop the registry entry **with** a startup cleanup that
removes a persisted value, so no environment is left off; (3) retire the two
`maturity: flag:` markers; (4) regenerate the 30 fixtures; (5) strip the arming
branches and their parity test; (6) sweep UI copy and live specs. Verify by
running the three A2A use cases (UC2, UC2.5, UC2.6) plus UC37 on the real stack
with no flag anywhere, and by confirming the group-policy decision board's
delegated rows reach PERMIT — that path has never been exercised with A2A on
(see the decision-board entry above).

**Do not** delete the registry entry alone. `getEffective` falls back to the
default only when nothing is persisted; an environment that already stored
`'false'` keeps it, and with the switch gone there is no way to unset it.

### [ ] 2026-08-18 — Bug-hunt round 2: customer-dashboard UI + backend data plane (10 findings)

A second audit scoped to the signed-in customer dashboard and the customer
data-plane routes/services surfaced 10 fresh defects not already in this file.
None were fixed in the same pass — they are correctness/consistency gaps found
while auditing, logged for a deliberate round. Backend first, then UI.

### [x] 2026-08-18 — `saveMessage` reads the sequence from the wrong key segment, so same-millisecond writes collide and drop messages

**FIXED 2026-08-18 (PR #2036, merged + deployed).** The seq is now read from the
final key segment (`parts[parts.length - 1]`) instead of the out-of-range `[4]` —
minimal, and robust even if `userId`/`vertical` ever contain a `:`. Key format and
chronological ordering unchanged. Regression test
`tests/services/conversationStoreConcurrentWrites.test.js` freezes `Date.now` to
force same-ms writes (a real-clock loop can't reproduce it — each `putSync` fsyncs
~6ms apart, which is the nondeterminism that hid the bug); verified pre-fix the
`[4]` code loses 7 of 9 messages in a burst. Noted follow-up: the intra-ms seq is
not zero-padded, so an 11+-message single-ms burst would sort lexicographically —
unreachable given the fsync spacing, left per minimum-code. Original entry follows.

**Where:** `demo_api_server/services/lmdb/conversationStore.lmdb.js` — `saveMessage`
(the seq-dedup read of `key.split(':')[4]`).

**What's wrong:** the LMDB key is `${userId}:${vertical}:${15digitTs}:${seq}`, so the
sequence is segment index **`[3]`**, but `saveMessage` reads `key.split(':')[4]`
(one past the end). Because the timestamp is `Date.now()`, several messages written
in the same millisecond share the `${ts}` portion, and the mis-indexed seq read
fails to disambiguate them, so same-millisecond writes collide and overwrite each
other. The count of distinct persisted messages then depends on machine speed —
this is exactly what made the round-2 prune test read 500 locally but 469 on the
faster CI runner, and it is a genuine data-loss-under-load bug in its own right, not
just a test artefact.

**Why not fixed now:** found while making the round-2 summary-scan test deterministic
(the test was fixed with a mocked clock; the underlying write-path bug was left
untouched as out of scope for that PR). It is a write-path change in a §1-adjacent
store and deserves its own fix + a concurrency test.

**Real fix:** read the seq from segment `[3]` (or key by a monotonic counter rather
than wall-clock ms), and add a test that writes N messages in a tight loop without a
mocked clock and asserts all N persist.

### [x] 2026-08-18 — Conversation summaries share the message key-prefix, so history replays a summary as the newest turn

**FIXED 2026-08-18 (PR #2022, merged + deployed).** All four message scans now
apply an `_isMessage()` value-shape guard (real messages have string `.role` +
`.content`; summaries don't), and `getHistory` collects `limit` *real* messages
rather than capping at the DB level — so a `_summary:` entry can no longer surface
as the newest turn or evict real ones, and prune no longer mis-orders summaries.
Regression test `tests/services/conversationStoreSummaryScan.test.js` (made
deterministic with a mocked clock). Original entry follows.

**Where:** `demo_api_server/services/lmdb/conversationStore.lmdb.js` — `getHistory`
(~180-190), `getThreadSize` (~225-232), `_pruneThreadIfNeeded` (~144-160),
`isSummarizationNeeded` (~324-329); summary written at ~278.

**What's wrong:** messages are keyed `${userId}:${vertical}:${15digitTs}:${seq}`,
summaries `${userId}:${vertical}:_summary:${id}`. Every thread scan ranges over
`[prefix, prefix+￿]`, and `_` (0x5F) sorts AFTER the digits (0x30-0x39), so a
`_summary:` key falls inside the range and sorts last. `getHistory` scans in
reverse, so once any summary exists it is returned as the most-recent "message"
and replayed into the LLM as a fake turn (a summary object has `.summary`, no
`.role`/`.content`). The same in-range inclusion inflates `getThreadSize` and the
returned `threadSize`, skews `isSummarizationNeeded`'s turn/token math, and —
because a summary object has no `.timestamp` (only `createdAt`), so
`value.timestamp||0` is 0 — makes prune delete summaries FIRST when a thread
exceeds 500. Repro: `POST /api/conversations/:u/:v/summarize?range=0-5` then
`GET .../history` returns the summary object at the tail as the latest turn.

**Why not fixed now:** found while auditing; touches the LMDB key scheme and the
range bounds of four methods at once — a scoped correctness fix with its own test
surface, not a drive-by.

**Real fix:** give summaries a key space the message scans cannot reach — a
separate sub-prefix scanned only by the summary reader, or an end bound that stops
before `_` — and give a summary object a `timestamp` so prune orders it correctly.

### [x] 2026-08-18 — `createTransaction` overwrites any caller-supplied `createdAt`/`status`, collapsing seeded transaction history

**FIXED 2026-08-18 (PR #2022, merged + deployed).** Now
`createdAt: transactionData.createdAt ?? new Date()` and
`status: transactionData.status ?? 'completed'`, with `id` always generated — a
caller-supplied value is preserved, defaults still apply when absent. Regression
test `tests/createTransactionPreservesCallerFields.test.js`. Original entry follows.

**Where:** `demo_api_server/data/store.js:391` —
`const transaction = { id, ...transactionData, createdAt: new Date(), status: 'completed' };`

**What's wrong:** the trailing `createdAt`/`status` clobber whatever the spread
carried. `provisionDemoAccounts` (`routes/accounts.js:134-147`, via
`POST /api/accounts/reset-demo`) authors 11 sample transactions with deliberate
2024-02/2024-03 dates; all are discarded and every row stamped with the current
time (and they carry no `date` field), so reset-demo history collapses to one
identical timestamp instead of a historical spread. The same clobber makes
`restoreTransactionsFromSnapshot` (`routes/transactions.js:44`) and
`verticalAccountSnapshots.restoreVertical` (`services/verticalAccountSnapshots.js:125-127`)
lose every restored transaction's original `createdAt`/`status` on cold-start or
vertical switch-back.

**Why not fixed now:** cosmetic-looking but it silently corrupts demo data; the
fix must decide per-caller whether a supplied `createdAt`/`status` should win, so
it is a small contract decision, not a one-liner.

**Real fix:** only default `createdAt`/`status` when the caller did not supply them
(`createdAt: transactionData.createdAt ?? new Date()`, same for `status`).

### [x] 2026-08-18 — GET conversation history `limit` is unsanitised, so the 100-message cap is silently defeated

**FIXED 2026-08-18 (PR #2022, merged + deployed).** `limit` is coerced to a finite
number (fallback to the default) then clamped to `[1,100]` before `getHistory`, so
`?limit=abc` (NaN) and `?limit=-1` can no longer defeat the cap. Regression test
`tests/routes/conversationsHistoryLimitClamp.test.js`. Original entry follows.

**Where:** `demo_api_server/routes/conversations.js:56,62`.

**What's wrong:** `const limit = parseInt(req.query.limit || DEFAULT_HISTORY_LIMIT, 10)`
then `getHistory(userId, vertical, Math.min(limit, 100))`. A non-numeric
`?limit=abc` yields `NaN`, and `Math.min(NaN, 100)` is `NaN`, passed straight to
`db.getRange({ limit: NaN })` — the 100-message cap no longer applies and the full
thread (up to the 500 ceiling) is returned and replayed. Negative values
(`?limit=-1`) also pass unclamped. Repro: `GET /api/conversations/me/banking/history?limit=x`
dumps the entire thread.

**Why not fixed now:** found while auditing; trivial but wants a test for the
NaN/negative cases alongside the fix.

**Real fix:** coerce and clamp — `Math.min(Math.max(1, Number.isFinite(n) ? n : DEFAULT), 100)`
before calling `getHistory`.

### [x] 2026-08-18 — `GET /api/accounts/my` serves hardcoded banking identifiers for every vertical

**FIXED 2026-08-18 (PR #2022, merged + deployed).** SWIFT/IBAN/branch/masked-account
defaults are emitted only for the banking vertical; other verticals surface those
fields only when the account genuinely carries them. Banking output byte-identical.
Regression test `tests/routes/accountsMyBankingFields.test.js`. Original entry follows.

**Where:** `demo_api_server/routes/accounts.js:232-234`.

**What's wrong:** `swiftCode: account.swiftCode || 'CHASUS33'`,
`branchName: account.branchName || 'Super Banking Main Branch'`, and the
`iban`/masked-`accountNumber` fallbacks apply unconditionally. Non-banking seed
accounts (healthcare, retail, workforce) have no `swiftCode`/`branchName`, so a
healthcare or retail account card is served with SWIFT `CHASUS33` and branch
"Super Banking Main Branch." Repro: switch a session to healthcare, load accounts —
the card carries banking-only identifiers.

**Why not fixed now:** found while auditing; the fix needs a per-vertical decision
about which of these fields are even meaningful outside banking.

**Real fix:** only emit banking-shaped fields when the vertical is banking (or when
the account actually carries them), rather than defaulting them in for all.

### [x] 2026-08-18 — `investment` portfolio/balance ignore the `:accountId` path param and 200 with the default portfolio

**FIXED 2026-08-18 (PR #2022, merged + deployed).** `/portfolio` and `/balance` now
validate ownership — an `ownsAccount` check accepts `profile.portfolioId` or any
`data.portfolios[].id`, and a genuinely foreign/unknown id returns 404. The
caller's real/default account is unchanged. Regression test
`tests/routes/investmentAccountOwnership.test.js`. (The first fix keyed only on
`profile.portfolioId` and 404'd the caller's own sub-portfolio ids — caught by CI
against the pre-existing `investment.route.test.js`, then corrected.) Original
entry follows.

**Where:** `demo_api_server/routes/investment.js:16-29,54-66`.

**What's wrong:** `/accounts/:accountId/portfolio` and `/accounts/:accountId/balance`
call `store.get(req.user.id)` and return the user's single portfolio while echoing
`accountId: req.params.accountId` back in the body. Nothing checks the requested
account exists or belongs to the caller; any `accountId` yields a 200 labelled with
that id but populated from the one portfolio. Benign only because the seed gives one
portfolio per user — it mislabels the response and would return the wrong record the
moment a second account exists.

**Why not fixed now:** no visible symptom with today's single-portfolio seed; found
while auditing input validation.

**Real fix:** look the account up by `:accountId`, scoped to the caller, and 404 when
it does not exist or is not theirs.

### [x] 2026-08-18 — Customer dashboard fires the agent-resume event on the Email-OTP path even with no agent involved

**FIXED 2026-08-18 (PR #2031, merged + deployed).** `handleVerifyOtp` now guards the
resume on `if (agentTriggeredStepUp)`, matching the TOTP/push/CIBA/FIDO2 siblings —
a manual OTP verify no longer toasts "resuming agent request…" nor dispatches
`cibaStepUpApproved`. Fixed in both `UserDashboard.js` and `UserDashboardPing2026.js`.
Regression covered by `UserDashboardPing2026.stepUpLifecycle.test.js`. Original
entry follows.

**Where:** `demo_api_ui/src/components/UserDashboard.js:1044-1048` (`handleVerifyOtp`);
mirrored in `UserDashboardPing2026.js`.

**What's wrong:** `handleVerifyOtp` unconditionally runs `setAgentTriggeredStepUp(false)`,
toasts "Identity verified — resuming agent request…", and dispatches
`cibaStepUpApproved` — with no `if (agentTriggeredStepUp)` guard, unlike the TOTP
(~980), push-poll (~1107) and CIBA-poll (~1176) success paths which all guard on
the flag. Repro: signed-in customer starts a manual transfer ≥ $250, hits the 428
step-up, picks "Verify via Email", enters a valid OTP → sees "resuming agent
request…" with no agent involved, and `cibaStepUpApproved` broadcasts to
`AIAgent.js:2287`, which re-fires `pendingStepUpActionRef.current` if any stale
pending agent action exists.

**Why not fixed now:** REGRESSION_PLAN §1 step-up/consent surface; found while
auditing, needs the same guarded pattern its siblings use plus a test.

**Real fix:** guard the resume broadcast on `agentTriggeredStepUp`, matching the
TOTP/push/CIBA success paths.

### [x] 2026-08-18 — Agent CIBA auto-initiate timers survive Dismiss and unmount, firing a back-channel auth after the user cancelled

**FIXED 2026-08-18 (PR #2031, merged + deployed).** `cancelAutoInitiate` (which
clears the t1/t2/t3 timers) is now called from `dismissStepUp`, the toast `onClose`,
and the `agentStepUpRequested` effect cleanup — not only the Cancel button — so a
real CIBA back-channel auth can no longer fire after Dismiss or navigation mid-
countdown. Fixed in both dashboard files. Regression test asserts unmount clears
with a positive control (fires=1 mounted vs 0 unmounted). Original entry follows.

**Where:** `demo_api_ui/src/components/UserDashboard.js:1231-1238`
(`autoInitiateTimerRef` t1/t2/t3), cleared only by `cancelAutoInitiate` (~1149,
wired solely to the Cancel button); mirrored in `UserDashboardPing2026.js:1346-1348`.

**What's wrong:** neither `dismissStepUp` (~1132-1138), the toast `onClose`/
`onToastClosed` (~1268), nor the effect cleanup (~1257, which only removes the
listener) clears the timers. Repro: agent requests a CIBA step-up → 3s countdown
→ user clicks Dismiss (or navigates off `/dashboard`) within those 3s. `stepUpRequired`
goes false and the toast closes, but `t3` still fires ~3s later, calling
`handleCibaStepUp()` → a real CIBA back-channel auth is POSTed and the 5s poll
starts with no visible UI, after the user explicitly dismissed. On unmount it also
`setAgentCountdown`/`setCibaStatus` after teardown.

**Why not fixed now:** §1 step-up surface; found while auditing, needs the timers
cleared from every teardown path plus a test.

**Real fix:** clear `autoInitiateTimerRef` in `dismissStepUp`, the toast close
handler, and the effect cleanup — not just in the Cancel button handler.

### [x] 2026-08-18 — `agentTriggeredStepUp` is never reset on step-up FAILURE paths, leaking stale state into the next manual step-up

**FIXED 2026-08-18 (PR #2031, merged + deployed).** `agentTriggeredStepUp` is now
reset on the three terminal failure/expiry paths (push timeout/failed, TOTP
`challenge_expired`, OTP `challenge_expired`) in both dashboard files. The
CIBA-poll error path was deliberately left untouched — it shows a Retry that must
resume the same agent attempt, so resetting there would break the legitimate agent
CIBA retry; only genuinely terminal paths reset. Note: `pendingStepUpActionRef`
does not exist in either file, so only the flag is reset (the round-2 entry's
mention of a paired ref was a guess). Original entry follows.

**Where:** `demo_api_ui/src/components/UserDashboard.js` — push
`PUSH_CONFIRMATION_TIMED_OUT`/`FAILED` (~1111-1119), TOTP `challenge_expired`
(~995-1002), OTP `challenge_expired` (~1060-1066).

**What's wrong:** all three failure/expiry paths leave `agentTriggeredStepUp === true`.
Repro: an agent-triggered step-up times out or expires; later the user starts a
manual transfer step-up. Because the stale flag is still true, the success path
renders "resuming agent request…" and (push/CIBA/TOTP) dispatches `cibaStepUpApproved`
for an action the user performed by hand — stale state leaking across attempts.
Compounds the two findings above.

**Why not fixed now:** §1 step-up surface; found while auditing, part of the same
flag-lifecycle cleanup as the two above.

**Real fix:** reset `agentTriggeredStepUp` (and any paired pending-action ref) on
every step-up failure/expiry/cancel path, not only on success.

### [x] 2026-08-18 — `DashboardQuickNav` stack-height count is off by one for customers and overrides the correct CSS default

**FIXED 2026-08-18 (PR #2028, merged + deployed) — but the premise was partly
wrong.** The JS override (`count = 6 + …`, hardcoded `* 44`) turned out to be
**inert**: its only consumer is the `.App--has-quick-nav` rule (`App.css:140-142`),
and that class (plus `.App--has-nav-dash`) is **never applied to any DOM element**
(grep-confirmed). So the off-by-one wrote a variable nothing read. The fix removed
the dead `useEffect` entirely, making the already-correct, breakpoint-aware CSS
default `calc(7 * var(--stack-fab-height))` the single source of truth; a test locks
the non-admin count at 7.

**FOLLOW-UP RESOLVED 2026-08-18 (investigation + PR #2037, merged + deployed).** The
"overlap" was moot: `DashboardQuickNav` was **never mounted** (imported only by its
own tests), so no rail rendered and no overlap could occur — the described "overlaps
the 7th button" geometry was impossible in the running app. Per the requester's
decision the rail was then WIRED UP (#2037): mounted for signed-in non-admins on the
gated routes, with `App--has-quick-nav` applied on exactly that condition so the
pre-designed `App.css` geometry engages. `App--has-nav-dash` was deliberately not
added — it gates a different, unmounted single-FAB nav concept, not this rail.
Geometry verified live on the deployed CSS: with the class applied,
`--stack-fab-top-demo` resolves to `calc(156px + 7×44px)` = 464px, i.e. the demo FAB
is pushed flush below the 156–464px rail — no overlap. The pixel-level signed-in
visual could not be automated (customer sign-in on this host is passkey-based, not
headless-drivable) — a human glance on `/dashboard` as a customer is the only
remaining confirmation. Original entry follows.

**REVERSED 2026-08-18.** The human glance happened once #2037 was first served
(the `ui` container recreate for #2038 was the first deploy to render the rail):
it overlays the left of the dashboard and the user asked for it to be removed.
PR #2037 was reverted — `DashboardQuickNav` is back to existing-but-unmounted, which
is the accepted end state, not debt. Do not re-mount without an explicit request.

**Where:** `demo_api_ui/src/components/DashboardQuickNav.js:21-26`; interacts with
`App.css:138,140-142,668`.

**What's wrong:** `count = 6 + (isAdmin ? 2 : 0)`, but a non-admin renders 7 buttons
(Home, Dashboard, Agent, Settings, Learning Log, API, Logs). The effect writes
`--quick-nav-stack-height = 6 * 44 = 264px` onto `.App`, overriding the correct CSS
default `calc(7 * var(--stack-fab-height))` (App.css:138). So `--stack-fab-top-demo`
(derived at App.css:140-142) is 44px too high and the demo FAB stack overlaps the
last quick-nav button. It also hardcodes `44` while the CSS var drops to `42px` at a
breakpoint (App.css:668), so at that width the override is wrong on both count and
unit.

**Why not fixed now:** cosmetic overlap; found while auditing. The real fix is to
stop recomputing in JS a value CSS already knows.

**Real fix:** count the buttons actually rendered (or let the CSS default stand and
remove the JS override), and read the fab height from the CSS var rather than the
hardcoded `44`.

### [x] 2026-08-18 — Run-story bullets keyed by a 48-char text prefix collide and drop a row

**FIXED 2026-08-18 (PR #2028, merged + deployed).** `key={b.slice(0, 48)}` changed to
`key={i}` (the index the map callback already provides), so two bullets sharing a
48-char prefix no longer collide. Regression test drives two colliding bullets
through the real component. Original entry follows.

**Where:** `demo_api_ui/src/components/TokenChainTraceRail.jsx:527` —
`<li key={b.slice(0, 48)}>`.

**What's wrong:** two run-story bullets that share their first 48 characters produce
the same React key, so one is dropped from render (React de-dupes siblings by key).
Long bullets with a common prefix (e.g. two "Exchanged token for backend …" lines
differing only in a trailing id) are exactly this shape.

**Why not fixed now:** low-impact rendering glitch; found while auditing.

**Real fix:** key by index (or a stable bullet id) rather than a text-prefix slice.

**Honourable mentions (not counted):** `demo_api_server/data/store.js` `applyTransfer`
deletes the per-account `_transferLocks` entry unconditionally in `finally`, breaking
mutual exclusion — but the critical section is fully synchronous so the event loop
already serialises it and no overdraft results (redundant lock, buggy delete, no
fund-correctness failure). And `demo_api_ui/.../UserDashboard.js:1494-1522`
(`applyDemoTransaction`) is effectively dead (all callers early-return on `if (!user)`
while `isDemoMode` is only true when `!user`), but it hides an unguarded
money-creation path (`to` credited full, `from` clamps at `Math.max(0, …)`) worth
removing before it is ever wired live.

### [ ] 2026-08-18 — `deploy-live.sh` warns about its unreliable fallback only when the checkout did not move

**Where:** `scripts/deploy-live.sh:42-58` — the `STAMP_BOOTSTRAP` path, and the
`OLD = NEW` branch at `:62-77` that owns the warning.

**What's wrong:** the script already solves the hard half of this. `.git/deploy-live.last`
records **what the containers last had deployed** rather than what the checkout
was a moment ago, precisely because the 15-minute launchd sync usually advances
the checkout first (#2000, and its comment says so). When that stamp is missing —
first run on a clone, or it names a commit the repo no longer has after a
force-push — it falls back to `OLD=PRE`, the checkout's pre-sync HEAD.

The fallback is documented and reasonable. What is not is that the script says so
in only one of the two ways it can be wrong:

- `OLD == NEW` (checkout did not move): prints "no deploy stamp yet and the
  checkout did not move this run … Cannot tell whether the containers are
  current", and tells you to pass an explicit range. Correct and loud.
- `OLD != NEW` (the sync moved the checkout this run): **silently** deploys
  `PRE..NEW` — and `PRE` is exactly the signal the script's own comment calls
  unreliable. Anything the containers were behind by before this run is skipped,
  and the final line still reads `live stack serves <NEW>`.

**Measured 2026-08-18.** Containers were running `df0bd3904`. The stamp did not
exist yet — the code that writes it shipped in `73b4977ff` (#2000), i.e. inside
the very range that had not been deployed. The no-arg dry run offered:

```
[deploy-live] 53449195ef1a -> 73b4977ff040 (6 files)
[deploy-live] DRY RUN — would run: ./run-docker.sh restart ping-gateway
```

The true range from what was actually running was 12 files and also required
`ui`:

```
[deploy-live] df0bd3904b46 -> 73b4977ff040 (12 files)
[deploy-live] DRY RUN — would run: ./run-docker.sh restart ui ping-gateway
```

So the UI would have been left stale while the run reported success — the exact
failure this script was written to end, reached through its one unguarded path.

**Why not fixed now:** found while deploying, not while working on the script,
and the window is genuinely narrow — the bootstrap is one-time per clone, and the
run that hits it also writes the stamp, so every later no-arg run is correct.
That narrowness is also why it will be met by whoever is least equipped to
recognise it: someone on a fresh clone, deploying for the first time.

**Real fix:** make the two branches say the same thing. In the bootstrap path,
emit the existing "cannot tell whether the containers are current — pass an
explicit range" warning whenever the stamp was missing, not only when
`OLD == NEW`; deploying `PRE..NEW` as a best effort is fine, claiming it is
complete is not. Better still, derive the running SHA from the containers
themselves (the checkout is bind-mounted, so a marker file or a
`docker exec … git rev-parse` equivalent would make the stamp advisory rather
than load-bearing) — then no bootstrap case exists at all.

Related: `project-deploy-live-explicit-range-skips-sync` in memory records the
opposite hazard (explicit range does NOT sync). Both are the same shape: the
script cannot observe the thing it reports on, so it reports on what it can see.

### [ ] 2026-08-18 — Multi-service bug-hunt audit (findings deferred here; scripts/agents/UI fixes went out as separate PRs)

A five-service audit (BFF, UI, MCP gateway/proxy/resource, Python/Node agents,
scripts/gateway) surfaced ~27 fresh defects not already in this file. The
low-risk ones — script/infra, Python agent retry/timeout, and standalone UI —
were fixed in grouped PRs. The entries below are the ones left deferred because
they sit on REGRESSION_PLAN §1 protected surfaces (transactions, OAuth callback,
token caches, MCP gateway auth, LLM proxy) and each needs its own reviewed pass.
Two are **security-relevant** and flagged as such — decide on those first.

### [x] 2026-08-18 — SECURITY: a capitalised `type` skips the entire transaction authorization/HITL/step-up/scope layer

**FIXED 2026-08-18 (PR #2007, pending merge).** `type` is normalised
(`String(type||'').toLowerCase().trim()`) immediately after destructure, so every
gate sees the canonical form. Regression test proves `"Transfer"` / `"  transfer  "`
/ `"WithDrawal"` take the identical step-up/HITL/authz path; logged in
REGRESSION_PLAN §4. No blanket type rejection added (deposit legitimately returns
`type_not_in_scope` when `ff_authorize_deposits` is off). Original entry follows.

**Where:** `demo_api_server/routes/transactions.js:419` (`type` destructured raw
from `req.body`, never normalised), gated against exact-lowercase lists in
`services/transactionAuthorizationService.js:149-161` (`AUTHORIZE_TYPES`) and
`routes/transactions.js:557` (`writeOperations`).

**What's wrong:** `POST /api/transactions` with `{"type":"Transfer","amount":9000,...}`
(capital T, above the HITL/step-up threshold) makes `evaluateTransactionPolicy`
return `{ran:false, reason:'type_not_in_scope'}`, so PingOne DENY, HITL consent
and RFC 9470 step-up are all skipped; the write-scope check is skipped too.
Execution falls through to `dataStore.applyTransfer(...)` (~755, which ignores
`type`) and the funds move with no policy decision, no consent, no step-up
recorded. The hard `max_transaction_amount` gate (~480) still fires because it
does not read `type`, but every type-driven control is bypassed. This is the
highest-severity finding of the audit.

**Why not fixed now:** it is on a §1 protected transfer-consent path and the user
scoped this round to safe, non-§1 fixes — a control-bypass fix on that surface
must be done deliberately with the regression pass, not folded into a batch.

**Real fix:** normalise `type` (`String(type||'').toLowerCase().trim()`) once at
the top of the handler before any gate reads it, and add a test that
`{"type":"Transfer"}` and `{"type":"transfer"}` take identical authorization
paths. Consider rejecting unknown `type` values outright rather than treating
"not in scope" as "no controls apply".

**RESOLVED 2026-08-18 by PR #2007** (`fix(security): normalize transaction type
before authorization gates`) — verified, not assumed.

`demo_api_server/routes/transactions.js:430` now reads
`type = String(type || '').toLowerCase().trim();` before any gate, with the
re-read at `:450` normalised the same way. The commit message states the same
failure this entry did: `"Transfer"` returned `type_not_in_scope` and skipped
PingOne-Authorize DENY, HITL consent, step-up and write-scope while
`applyTransfer` still moved funds.

### [x] 2026-08-18 — SECURITY: MCP gateway rate-limit bucket is keyed on an unverified `sub`, so a forged token starves a victim

**FIXED 2026-08-18 (PR #2008, pending merge).** The `check()` moved to AFTER token
validation on both transports (WS after `validateInboundToken`; HTTP after
introspection+policy), keyed on the verified subject — so forged/inactive tokens
are rejected `401` before the limiter runs and can only exhaust the attacker's own
bucket. Regression test proves 10 forged `sub=<victim>` requests are each `401`,
never `429`, and the real victim keeps its full allowance. Original entry follows.

**Where:** `demo_mcp_gateway/src/index.ts:508-533` (WS path) and
`demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts:275-288` (HTTP path).

**What's wrong:** the UC18 limiter runs *before* `validateInboundToken`/
introspection and derives its key `${sub}:${tool}` from a raw base64 decode of
the bearer payload. The in-code comment claims a forged `sub` only wastes a slot
in the attacker's own bucket — the reverse is true. An attacker sends
garbage-signed JWTs with `sub=<victim>`; each `check()` consumes a slot in the
victim's bucket before the signature check rejects the call, and after
`GATEWAY_RATE_LIMIT_MAX_REQUESTS` (default 20) the legitimate victim gets
`-32429 rate_limited` on that tool for the window.

**Why not fixed now:** §1 gateway auth surface; reordering the limiter after
token validation (or keying on the verified subject only) is a behavioural change
to the gateway's request pipeline that needs its own blast-radius check.

**Real fix:** key the limiter on the *verified* subject — move the `check()`
after `validateInboundToken`, or fall back to the source IP for unverified
tokens so an unauthenticated caller can only exhaust its own bucket.

**RESOLVED — verified 2026-08-18.** `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts:495-506`
now reaches the limiter only after verification, and says so in place: *"inactive
above and never reaches this check, so an unauthenticated caller can only ever
consume its OWN bucket — it can no longer deny a victim's."* The key is still
`${sub}:${tool}`, but `sub` is now a verified claim, which is the property this
entry was about. Metering remains scoped to `tools/call`.

### [x] 2026-08-18 — MCP gateway WS `close` cancels the call timeout without settling the promise, hanging the request forever

**FIXED 2026-08-18 (PR #2013, merged + deployed).** The `close` handler now rejects
any still-pending call for that socket with `Backend closed connection before
responding to <method>` BEFORE clearing the timers, guarded by the existing
`settled` flag so an already-answered close is never double-settled — the awaiting
caller's `finally` then runs and cleans `inFlightCalls`. Regression test
`tests/proxy-close-pending.test.ts` (rejects-not-hangs + no-double-settle) at the
`proxyJsonRpc` level. Original entry follows.

**Where:** `demo_mcp_gateway/src/proxy.ts:187-190` (`ws.on('close')`), awaited by
`src/index.ts:960` with the `inFlightCalls` cleanup `finally` at ~974.

**What's wrong:** on `close` the handler runs `clearTimeout(timer)` /
`clearTimeout(handshakeTimer)` but never rejects. If a backend completes the
handshake then closes cleanly without answering the proxied request (crash
mid-call, policy-close, restart), `proxyJsonRpc` never resolves and its 30s
safety timeout has just been cancelled — the promise hangs indefinitely, the
client never gets a JSON-RPC response for that id, and the `inFlightCalls` entry
leaks because the `finally` never runs.

**Why not fixed now:** §1 gateway internals; the fix must reject with the right
JSON-RPC error shape without regressing the normal-close path.

**Real fix:** in the `close` handler, reject any still-pending call for that
socket with a transport-closed error before clearing timers, so the `finally`
cleans up `inFlightCalls`.

### [x] 2026-08-18 — MCP gateway introspection cache is unbounded and never pruned

**FIXED 2026-08-18 (PR #2013, merged + deployed).** Both introspection inserts now
route through `cacheInsertWithEviction` (`boundedTokenCache.ts`, made generic over
`{ expiresAt }`) with a 1000-entry cap + FIFO eviction, and the get-path deletes
expired entries instead of only skipping them. Live-token hit/expiry semantics
preserved. Regression test `tests/boundedIntrospectionCache.test.ts`. Original
entry follows.

**Where:** `demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts:26,155,176`.

**What's wrong:** `_cache.set(...)` has no size cap and no sweep; expired entries
are only skipped on `get`, never deleted. Every distinct inbound token (they
rotate per login/exchange; even garbage tokens get their `{active:false}` result
cached) adds a permanent map entry for the process lifetime. The sibling exchange
cache was hardened with `cacheInsertWithEviction` (`boundedTokenCache.ts`, HI-06);
this one was missed, so memory grows monotonically and a caller spraying random
bearers inflates it at will.

**Why not fixed now:** §1 gateway auth; small but should land with the other
gateway-cache hardening and a test.

**Real fix:** route this cache through the same `cacheInsertWithEviction` bound +
periodic sweep the exchange cache already uses.

**RESOLVED — verified 2026-08-18.** `demo_mcp_gateway/src/boundedTokenCache.ts`
now owns the eviction policy (hard cap, sweep-expired, then FIFO-evict-oldest) and
is imported by both `auth/GatewayIntrospectionClient.ts:15` and
`auth/McpTokenExchangeClient.ts:28`. Its header records that the two call sites
previously held a byte-for-byte-identical private copy, so the extraction also
retired the duplication.

### [x] 2026-08-18 — `demo_mcp_proxy` pins `MCP-Protocol-Version: 2025-03-26`, which the Node gateway hard-rejects

**FIXED 2026-08-18 (PR #2058, merged + deployed).** Investigation confirmed the Node
gateway IS a real upstream: `docker-compose.yml:1116` bakes
`MCP_GATEWAY_HTTP_URL: http://mcp-gateway:3005` as the proxy default (and
`run-docker.sh`/`k8s/deploy.sh` make it runtime-selectable); the proxy is stateless
(never sends `initialize`) and sends the version header on every request, so an
authenticated `tools/list`/`tools/call` reaches the gateway's version check and 400s
on the stale value. Both upstreams (Node gateway and PingGateway scripts) want
`2025-11-25`. Fix: one line, `2025-03-26` → `2025-11-25`, with a test that drives a
real `GET /tools` through the proxy and asserts the emitted header. (`400s before
auth` was slightly imprecise — bearer/token checks run first; the version 400 hits
the authenticated case.) No current in-repo consumer calls the proxy's `/tools`, so
it was not user-visible, but the wired upstream rejected it. Original entry follows.

**Where:** `demo_mcp_proxy/server.js:38`; rejected by
`demo_mcp_gateway/src/server/GatewayServer.ts:727-736` (expects `2025-11-25`,
`proxy.ts:31`). Wired to the Node gateway by `docker-compose.yml:1116`
(`MCP_GATEWAY_HTTP_URL: http://mcp-gateway:3005`).

**What's wrong:** every `mcpRpc` the sidecar makes is `tools/list`/`tools/call`
with the stale header, so `GET /tools` and `POST /tools/:name` return 400
`unsupported_protocol_version` before auth even runs — whenever the proxy is
pointed at the Node gateway.

**Why not fixed now:** the version string is a one-liner, but it touches the MCP
transport contract; verify the gateway truly is the intended upstream for this
sidecar (vs PingGateway) before bumping, and that no other consumer depends on
the old value.

**Real fix:** align the proxy's advertised protocol version with the gateway's
(`2025-11-25`), or make it negotiate from the gateway's advertised version.

### [x] 2026-08-18 — `demo_mcp_proxy` per-caller tools/list cache has no TTL and no size bound

**FIXED 2026-08-18 (PR #2042, merged + deployed).** Added a TTL
(`MCP_PROXY_TOOLS_TTL_MS`, default 30s — re-fetched on expiry) and an LRU size bound
(`MCP_PROXY_TOOLS_MAX`, default 500), closing both the unbounded-token-accumulation
window and the scope/vertical staleness window. Regression test
`demo_mcp_proxy/test/toolCache.test.js`. Original entry follows.

**Where:** `demo_mcp_proxy/server.js:15-124` (`_toolCacheByCaller`, keyed
`sha256(bearer)`).

**What's wrong:** entries are deleted only on an MCP error; a successful fetch is
cached forever. (a) tokens rotate per session, so the map grows unbounded for the
process lifetime; (b) while a token stays valid, a change of scope or of vertical
that alters the gateway's filtered tools/list (greyed/denied tools, a vertical
switch via header) is never reflected — the proxy serves the first catalog it saw.

**Why not fixed now:** batched with the gateway-cache hardening above; needs a
TTL + bound decision consistent with the rest of the MCP layer.

**Real fix:** give the cache a short TTL and an LRU bound, and key/scope it so a
vertical or scope change invalidates it.

### [x] 2026-08-18 — MCP gateway SSE passthrough leaks the upstream connection on client disconnect

**FIXED 2026-08-18 (PR #2042, merged + deployed).** `pipeGetToUpstream` now destroys
the upstream request on `req`/`res` `close`, and a real `'timeout'` handler aborts an
idle upstream (the `timeout` option was previously inert). A settle-once guard
detaches the close listeners on normal completion, so normal streaming is unchanged.
Regression test `demo_mcp_gateway/tests/gateway-sse-client-close.test.ts`. Original
entry follows.

**Where:** `demo_mcp_gateway/src/server/GatewayServer.ts:542-591`
(`pipeGetToUpstream`).

**What's wrong:** it never watches `req`/`res` for `close`. When the SSE client
goes away the upstream GET is not destroyed (`pipe` only unpipes, it does not
destroy the source), and the request's `timeout` option (~560) is inert because
no `'timeout'` listener is attached. Each abandoned SSE stream holds an upstream
socket (and the pending middleware promise) until the upstream itself ends, so
browser reconnect loops accumulate zombie upstream connections.

**Why not fixed now:** §1 gateway; the teardown must destroy the upstream without
regressing normal stream completion.

**Real fix:** on `res`/`req` `close`, destroy the upstream request; attach a real
`'timeout'` handler that aborts it.

### [x] 2026-08-18 — LLM proxy: cross-class swaps race and unload each other's just-loaded tier

**FIXED 2026-08-18 (PR #2048, merged — on disk, NOT yet live in the running
proxy).** A global `swapChain` lock now runs every swap behind the previous one, so
a concurrent different-class swap waits instead of overwriting `swapInFlight` and
firing a second `ensure` that unloads the first swap's just-loaded tier; a failed
swap advances the chain (`.catch`) so it can't wedge the queue. Same-class coalescing
and per-swap `SWAP_TIMEOUT_MS` unchanged. Router-logic only — no tier ports/model
names/`LLAMACPP_MAX_TOKENS`/`SWAP_TIMEOUT_MS`/config values touched (frozen surface).
Regression test in `demo_llm_proxy/router.test.js` (mock tier servers; not verified
against a live model backend). **Deploy note:** `run-docker.sh`/`deploy-live.sh` do
NOT manage `llm-proxy` — it goes live only on a deliberate `docker compose up -d
--build llm-proxy`, left to the owner of the frozen LLM surface. Original entry
follows.

**Where:** `demo_llm_proxy/router.js:262-292` (`swapTo`); serialised at
`tier-manager.js:78-84`. (Distinct from the known warmup positional-tier issue.)

**What's wrong:** `swapInFlight` coalesces only same-class swaps; a concurrent
request for a different class starts a second swap and overwrites `swapInFlight`.
Because `ensure` "stops every other tier", the second queued ensure unloads the
first swap's just-loaded target. Classic swap mode, no residents: concurrent
phi-4-mini + gpt-oss → swap A starts streaming on :8096, then `ensure(8091)`
kills :8096 mid-response → ECONNRESET / 502, or the loser polls a dead tier for
the full `SWAP_TIMEOUT_MS` (180s) before a 503.

**Why not fixed now:** LLM proxy is a delicate, effectively-frozen surface
(memory: `feedback-llm-settings-frozen`); a swap-serialisation change needs its
own soak test.

**Real fix:** serialise swaps across all classes (single global swap lock/queue),
or reject/queue a cross-class swap while one is in flight rather than clobbering
`swapInFlight`.

### [x] 2026-08-18 — LLM proxy: the pin-only experimental tier is reachable by normal classification

**FIXED 2026-08-18 (PR #2048, merged — on disk, NOT yet live in the running
proxy).** `:8093` (`llama-3-groq-8b-tool-use`) is now marked `pinOnly: true` and
`smallestLoadedCovering` skips pin-only tiers on substitution (`i !== cls`), so it is
returned only when a route targets class 2 exactly (explicit `LLM_PROXY_PIN_TIER` /
`model=` pin) — never as a health-based substitute-up for a lower class
(`classifyText` only emits class 0/1). `pinOnly` is a minimal marker encoding the
existing 100-103 invariant as data; no tier values changed (frozen surface).
Regression test in `demo_llm_proxy/router.test.js`. Same deploy note as the entry
above — goes live only on a deliberate `llm-proxy` rebuild. Original entry follows.

**Where:** `demo_llm_proxy/router.js:227-232` (`smallestLoadedCovering`), against
the invariant stated at ~100-103.

**What's wrong:** lines 100-103 promise the `llama-3-groq-8b-tool-use` tier
(:8093, class 2, tool-reliability "unproven") is reached only via explicit
`LLM_PROXY_PIN_TIER=8093`, never by keyword classification — but the coverage
loop iterates `i = cls … TIERS.length-1` and returns index 2 whenever it is
healthy and the intended tiers are not. If :8096 is down (crash/swap window) while
:8093 happens to be up, class-1 agent tool-loop requests are silently served by
the smaller unproven model — exactly the "agent shows no result, nothing in the
logs" degradation the downgrade-refusal guard (~477-494) exists to prevent (that
guard only fires on pin-capped routing, not health-based substitution).

**Why not fixed now:** same frozen LLM-proxy surface.

**Real fix:** exclude pin-only tiers from `smallestLoadedCovering` unless the
active route is a pin, so health-based substitution cannot fall onto :8093.

### [x] 2026-08-18 — `helix_llm._generate` blocks the FastAPI event loop for up to ~35s

**FIXED 2026-08-18 (PR #2050, merged + deployed).** A sync function on the loop
thread cannot await the Helix round-trip without blocking that thread, so a
"non-blocking sync path" is physically impossible — and the correct async entry
`_agenerate` already exists and is what every real caller uses (`message_processor.py`
→ `ainvoke`; LangGraph → `astream_events`; grep found no sync `.invoke`/`.stream` on
any graph/model in `src`). So on a running loop `_generate` now refuses immediately
with a `RuntimeError` pointing at the async API instead of freezing the loop. The
non-loop sync path, `_agenerate`, streaming, poll interval and timeout constants are
all unchanged. Regression test `tests/test_helix_llm.py::TestEventLoopNotBlocked`
(25 passed). Tradeoff: a future sync `.invoke()` from inside the loop now errors
clearly rather than silently stalling all sessions. Original entry follows.

**Where:** `langchain_agent/src/agent/helix_llm.py:372-377`.

**What's wrong:** when called on a thread with a running loop (its own comment:
"Inside an already-running loop (e.g. FastAPI)"), it submits `asyncio.run(...)` to
a thread pool and then calls `future.result(timeout=POLL_TIMEOUT_SECONDS + 5)` —
a synchronous blocking wait on the event-loop thread. Any sync LangChain
`.invoke()` path hitting Helix freezes the whole FastAPI/WebSocket loop for the
Helix create-conversation + 1s-interval poll (up to 35s): every other session's
SSE/WS stalls, keepalives stop, clients time out.

**Why not fixed now:** the honest fix is an async refactor of this path, not a
one-liner, and it interacts with the agent's streaming lifecycle.

**Real fix:** make the sync `_generate` path use `run_coroutine_threadsafe`
against the running loop (or expose a proper async `_agenerate`) so the poll does
not block the loop thread.

### [x] 2026-08-18 — `tokenIntrospectionService`'s deliberate `INTROSPECTION_NOT_CONFIGURED` throw is swallowed, reported as "token inactive"

**FIXED 2026-08-18 (PR #2043, merged + deployed).** The catch now re-throws when
`err.code === 'INTROSPECTION_NOT_CONFIGURED'` instead of swallowing it, and
`tokenVerificationService._introspectAsFallback` treats that code as "introspection
skipped" (returns a warning, `error:null`) rather than "token inactive" — so a valid
exchanged token is no longer rejected in fail-closed mode when JWKS is momentarily
down and introspection simply isn't configured. Configured active/inactive behaviour
unchanged. Regression test
`tests/services/tokenVerificationService.introspectionFallback.test.js`. Original
entry follows.

**Where:** `demo_api_server/services/tokenIntrospectionService.js:184` (throw
inside the `try` opened at 151, whose `catch` at 252-265 returns
`{valid:false, error:'token_introspection_failed'}` with no re-throw).

**What's wrong:** the throw is meant to propagate so callers can tell
"skipped/not-configured" from "PingOne said inactive", but it never escapes. When
introspection is unset (common in the demo), `tokenVerificationService._introspectAsFallback`
(~57-77) gets `{valid:false}`, takes the "inactive per RFC 7662" branch, and in
fail-closed mode rejects a genuinely valid exchanged token whenever JWKS was
momentarily unavailable and introspection simply is not configured. The in-code
comment referencing `agentMcpTokenService` is also stale (that service uses JWKS
now).

**Why not fixed now:** §1 token-verification path; changing the fallback's
error discrimination needs the auth regression pass.

**Real fix:** let the `INTROSPECTION_NOT_CONFIGURED` code propagate (re-throw in
the catch when `err.code === 'INTROSPECTION_NOT_CONFIGURED'`) and have the
fallback treat "not configured" as "introspection skipped", not "inactive".

### [x] 2026-08-18 — OIDC nonce is not enforced when the returned ID token omits the `nonce` claim

**FIXED 2026-08-18 (PR #2043, merged + deployed).** The "nonce requested but ID token
has none" branch now fails the callback (`error=nonce_missing`) instead of
`console.warn`-and-proceed, mirroring the existing `nonce_mismatch` path (OIDC Core
§3.1.3.7). The matching-nonce happy path is unchanged. Regression test
`tests/oauthUserCallbackNonce.test.js`. Original entry follows.

**Where:** `demo_api_server/routes/oauthUser.js:460-467`.

**What's wrong:** nonce is validated only inside `if (expectedNonce && idTokenClaims.nonce)`;
the `else if (expectedNonce && tokenData.id_token && !idTokenClaims.nonce)`
branch merely `console.warn`s and proceeds. Per OIDC Core §3.1.3.7, when the
client sent a `nonce` it MUST verify a matching one is present — a login where
`expectedNonce` was set but the ID token comes back with no `nonce` (misconfigured
mapping, or a replayed/substituted token stripped of `nonce`) is accepted and a
session established, defeating the replay protection.

**Why not fixed now:** §1 OAuth callback; related to the known `davinciLogin.js`
nonce gap but a distinct route — should land with a nonce-enforcement pass across
callbacks.

**Real fix:** in the `!idTokenClaims.nonce` branch, fail the callback (reject/
redirect to error) instead of warning, so a missing nonce when one was requested
is treated as verification failure.

### [x] 2026-08-18 — `pkceStateCookie._verify` calls `timingSafeEqual` outside its try/catch, so a malformed cookie 500s the OAuth callback

**Where:** `demo_api_server/services/pkceStateCookie.js:53` (call at 53, `try`
opens at 54); `readPkceCookie` calls `_verify` outside its own `try` (116 vs 118).
Callers: `routes/oauth.js:215`, `routes/oauthUser.js:414`.

**What's wrong:** `crypto.timingSafeEqual` throws `RangeError` on unequal buffer
lengths (reproduced). A malformed/truncated/crafted `_pkce` cookie whose signature
segment decodes to a length other than 32 makes the throw propagate into the
callback handler and surface as a 500 / error redirect, even when the session
already holds valid PKCE state the fallback was meant to use. The sibling
`services/authStateCookie.js:55-60` wraps the identical call in try/catch and
returns `null` — the correct behaviour.

**Why not fixed now:** §1 OAuth path; trivial fix but must land with the callback
regression check.

**Real fix:** move the `timingSafeEqual` call inside the try/catch (or length-
check first) and return `null` on any comparison error, matching
`authStateCookie.js`.

**RESOLVED 2026-08-18 (branch `worktree-fix-pkce-cookie-timingsafe`).**

*What the issue really was:* exactly as described, and reproduced against the real
module before touching it — but there were **two** throws reachable from cookie
text, not one:

```
readPkceCookie({headers:{cookie:'_pkce=abc.zz'}})  -> THROWS RangeError  Input buffers must have the same byte length
readPkceCookie({headers:{cookie:'_pkce=%ZZ'}})     -> THROWS URIError    URI malformed
```

The second is the same defect one frame further out: `_parseCookieHeader` calls
`decodeURIComponent` on every cookie value, and a malformed escape throws there —
before `_verify` is ever reached. Fixing only the `timingSafeEqual` call would
have left the 500 reachable with a one-character cookie, and the entry would have
read as closed.

*What the fix was:* `demo_api_server/services/pkceStateCookie.js`, three
non-throwing points, all returning `null` so the caller falls through to the
session that this cookie only ever backs up:

- `_verify` — `timingSafeEqual` moved inside the existing `try`, matching
  `services/authStateCookie.js`, which has always done it this way.
- `_parseCookieHeader` — per-value `decodeURIComponent` falls back to the raw
  text, so an undecodable cookie fails signature verification instead of throwing.
- `readPkceCookie` — its own second `decodeURIComponent` guarded the same way.

*What was deliberately NOT changed:* verification strength. A wrong signature, a
tampered payload, a cookie signed with a different secret, and an expired cookie
all still return `null`. The fix converts "cannot verify" from *throw* to
*reject*; it never converts it to *accept*. Pinned by
`demo_api_server/tests/pkceStateCookie.test.js`, which asserts the tamper and
wrong-secret cases alongside the two crash cases — a fail-open regression here
would be far worse than the 500 this fixes.

*Note for whoever touches `authStateCookie.js`:* its `_verify` is correct, but its
`_parseCookieHeader` is the same unguarded shape this fix repaired. It was left
alone because nothing in this session showed it reached — but it is the same code,
one file over.

### [ ] 2026-08-18 — Honourable mentions from the audit (lower confidence / not yet load-bearing)

- **`demo_mcp_gateway/src/auth/tokenValidator.ts:223-226`** — a forced JWKS
  re-fetch on an unknown `kid` passes `force=true`, bypassing the in-flight
  dedupe, so tokens with random `kid`s each trigger a full JWKS round-trip: a
  cheap amplification vector against PingOne. **FIXED 2026-08-18 (PR #2042):**
  forced refreshes now share the in-flight fetch and are rate-capped
  (`MCP_GW_JWKS_MIN_REFRESH_MS`, default 10s); a genuine rotation still refreshes
  once. Regression test `tests/tokenValidator-jwksRefetch.test.ts`.
- **`demo_api_ui/src/components/SessionExpiryTimer.jsx:34-82`** and
  **`RecognizeOverlay.tsx:37-41`** — real defects (mount-once fetch that never
  refetches after silent token refresh → shows "Expired" against a live session;
  `load`/`error` attached to an already-settled script tag → retry hangs at
  "Loading face ID…") but both components are currently orphaned (imported only by
  their own tests), so no user-visible failure today. Fix if either gets wired up.
- **`langchain_agent/src/storage/token_cache.py:66`** — `ttl_seconds=0` falls to
  the default via a falsy check, but the class is never instantiated (imported
  only in `storage/__init__.py`), so no runtime impact today.
- **`scripts/sync-status.sh:23`** — computes "behind" against the local
  `origin/main` ref without fetching, so if the launchd sync job is dead (the
  scenario the script exists to surface) it can print "in sync" while GitHub is
  ahead; partially mitigated by the printed last-sync age.
- **Repo-map staleness:** root `CLAUDE.md` lists `demo_mcp_server/`, which does
  not exist (only `demo_mcp_resource_server/` and `oauth-mcp/`). Fold into the
  "reports/docs updated to current codebase" follow-up.

### [ ] 2026-08-18 — `INDETERMINATE` means "evaluation failed" from the cloud and "pause for step-up" locally

**Where:** `demo_authz_server/routes/decision.js` (12 `STEP_UP` / `HITL_CONSENT`
sites) versus the cloud PingOne Authorize decision endpoint; 55 source files and
40 test files reference the value.

**What's wrong:** one word carries two unrelated meanings.

- **Cloud P1AZ** returns `INDETERMINATE` when evaluation FAILED — missing
  attribute, attribute provider unreachable, malformed payload. It should be
  treated as an error and failed closed.
- **`demo_authz_server`** returns it deliberately as a PAUSE: `reason=STEP_UP`
  when an amount crosses the step-up band, `reason=HITL_CONSENT` between confirm
  and step-up. UC7 and UC8 are built on it; `tests/decision.test.js` pins it with
  26 assertions.

Anyone acting on "INDETERMINATE means something is broken" deletes a working
flow. Anyone acting on "INDETERMINATE means step-up" silently swallows a real
cloud evaluation error. The meaning currently lives in `reason`, not `decision`,
so nothing in the type tells a reader which they have.

Baseline captured live 2026-08-18 (real subject and actor, five verticals):
`$600 → INDETERMINATE/STEP_UP`, `$300 → INDETERMINATE/HITL_CONSENT`,
`$100 → PERMIT`, `$2500 → DENY` ceiling. In 45 minutes of ordinary traffic
`demo_authz_server` logged ZERO indeterminate and the cloud endpoint returned
clean `PERMIT`s — today the value only ever appears as the intended pause, so
this is a clarity defect rather than an outage.

**Why not fixed now:** the user chose the full obligation-based rework over the
cheaper rename, and asked for a plan before any code. Scope is 55 source files,
40 test files and PingGateway's Groovy `p1az-decision`, in a REGRESSION_PLAN §1
area covering UC7 and UC8 — not something to start at the end of a session.

**Real fix:** `docs/superpowers/plans/2026-08-18-indeterminate-rework.md` — five
independently-shippable phases beginning with characterisation tests that capture
today's behaviour before anything moves. It also records the cheaper alternative
(rename the pause to `CHALLENGE`/`PENDING`, no behavioural change, the 26
assertions become a rename) in case the trade looks different on reading. Two
traps apply directly: `obligatory:false` is NOT safe to treat as optional, and an
INDETERMINATE with no obligation must resolve to DENY (#1310). Memory:
`project-indeterminate-two-meanings`.

### [ ] 2026-08-18 — The LMDB store is at 66% of a hard 128MB ceiling and nothing watches it

**Where:** `demo_api_server/services/lmdb/openEnv.js` — `mapSize: 128 * 1024 * 1024`.

**What's wrong:** LMDB's `mapSize` is a hard wall, not a hint. Every write past it
throws `MDB_MAP_FULL`, and this env backs conversations, sessions, nav configs and
the operator's persistent config — 14 named DBs. Measured today inside
`ai-demo-api-server`:

```
-rw-r--r-- 1 appuser appgroup 88522752 Aug 18 03:47 data.mdb   # 84.4M of 128M
```

At the ceiling, every LMDB write path 500s at once, and `data.mdb` never shrinks
back on its own — so the failure is permanent from the operator's point of view
and looks like "the whole BFF broke" rather than "a disk-shaped limit was reached".
The `maxDbs: 32` line above it carries a comment explaining its headroom;
`mapSize` carries none, and no check, alert or startup log reports how close the
store is.

**Why not fixed now:** found while trying to reproduce the `hero-shown` 500 (see
that entry), which is a plausible-but-unconfirmed symptom of exactly this. Raising
the number is a one-character change with a real consequence — `mapSize` is the
virtual address reservation, so it should be raised deliberately, not
opportunistically, and the pruning question below is the more interesting half.

**Real fix:** two parts. (1) Log the store's size against `mapSize` at startup and
fail loudly above some fraction of it, so this shows up as a warning rather than
as a fleet of unexplained 500s. (2) Establish why 84MB accumulated at all —
`conversationStore` prunes at `MAX_MESSAGES_PER_THREAD = 500` per thread, and PR
#1976 repaired a broken LMDB delete API, so some of this may be dead entries the
old delete never removed. Measure per-DB sizes before raising the ceiling; a
compaction may be the actual fix.

### [x] 2026-08-18 — `authLevelForUseCase` names two different functions, one taking an id and one taking an object

**Where:** `demo_api_server/config/authRequirements.js:32` takes a use-case **id**
(`authLevelForUseCase('UC24')`); `demo_api_ui/src/utils/useCaseAuth.js:18` takes a
**catalog object** (`authLevelForUseCase(uc)`). The UI one was `useCaseAuthLevel`
until it was renamed into the collision.

**What's wrong:** the same name across the BFF/UI boundary with different inputs
and nothing to catch a mix-up. Passing an object to the server helper returns the
`user` default (the object is not a key); passing an id to the UI helper returns
the same default (`uc.auth` is undefined). Both fail **closed and silently** —
the safest possible wrong answer, which is exactly why it would sit unnoticed.

**Why not fixed now:** both are correct at their own call sites today, and a
rename touches SoT plumbing that four PRs had just stabilised.

**Real fix:** name them for their input — `authLevelForUseCaseId(id)` on the
server, `authLevelOf(uc)` in the UI — or let the UI helper accept either and
normalise.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-small-batch-0818`).**

*What the issue really was:* what the entry described, and its own framing is why
this was worth paying off. Both helpers fail **closed and silently**, so a mix-up
produces no error, no log and no failing test — it produces a sign-in prompt on a
use case that should be public, or the reverse, and it reads as bad config.
Nothing in the linter or the test suite could have caught it, because
`authLevelForUseCase(x)` is a valid call on both sides of the boundary for any `x`.

*What the fix was:* the entry's first option — name each helper for the input it
accepts, so the collision cannot be written down.

- `demo_api_server/config/authRequirements.js` → `authLevelForUseCaseId(id)`,
  call sites updated in `routes/useCases.js` (3), `scripts/check-auth-requirements.js`
  (2), `tests/authRequirements.test.js`.
- `demo_api_ui/src/utils/useCaseAuth.js` → `authLevelOf(uc)`, call sites updated
  in `components/AIAgent.js` and `utils/__tests__/useCaseAuth.test.js`.

Rejected the "accept either and normalise" option: it keeps one name meaning two
things and adds a branch whose wrong side is still silent. Behaviour unchanged —
rename only. `scripts/check-auth-requirements.js` still reports
`OK — 63 use cases, 153 routes, 1 public agent action(s)`.

### [ ] 2026-08-18 — The queued-question resume is held together by two tuned timeouts

**Where:** `demo_api_ui/src/components/AIAgent.js` — the 300ms floating-instance
claim delay (#1967) and `RESUME_VERTICAL_WAIT_MS = 8000` (#1986).

**What's wrong:** both numbers were chosen against *observed* behaviour on one
machine — the vertical manifest resolves in ~2s, an inline instance mounts within
300ms of a floating one — not from anything the code guarantees, and nothing
notices if that stops holding. A slower load pushes the manifest past 8s and the
visitor gets their question handed back for no reason they can see. A slower
inline mount lets the floating instance win a claim it should have lost —
harmless today only because `claimPendingNl` is read-and-remove, so the guard is
doing the work, not the delay.

**Why not fixed now:** the alternative is an explicit readiness signal from the
vertical manifest plus an instance handshake between agent copies. Both are real
work; the timeouts close a user-visible defect today.

**Real fix:** have the vertical context expose a resolved/failed state the resume
can await instead of racing, and let instances register so the claim goes to the
visible one by identity rather than by arrival order.

### [x] 2026-08-18 — A guest typing a banking prompt is redirected to PingOne mid-sentence, with no way to decline

**FIXED 2026-08-18 (PR #2067, merged + deployed).** The `marketingGuestChatEnabled`
branch no longer calls `handleLoginAction("login_user")` directly — it renders the
same "needs you signed in" bubble + **Sign in to continue** button (`showLoginPromptAction`,
the #1952/#1958 pattern), so the visitor chooses. The existing
`BX_AGENT_PENDING_NL_KEY` persist/replay machinery is reused unchanged — the typed
question is still replayed after login. Only the timing changed (on click, not
automatic). Regression test `AIAgent.guestBankingSignIn.test.jsx` asserts the bubble+
button render, no auto-redirect fires, the question is queued, and the click triggers
login. Original entry follows.

**Where:** `demo_api_ui/src/components/AIAgent.js:6440` — the
`marketingGuestChatEnabled` branch in `dispatchNlResult`.

**What's wrong:** it calls `handleLoginAction("login_user")` directly, so a
signed-out visitor typing "what is my balance" on `/` or `/dashboard` is thrown
to PingOne without being asked. Everything else built this session does the
opposite: #1952/#1958 replaced dead ends with a *"needs you signed in"* bubble
and a **Sign in to continue** button, so the visitor chooses. This path predates
that and was never brought into line. Observed live: the redirect fires before
any bubble renders.

**Why not fixed now:** it is not broken — the question is persisted and replayed
after login (verified live), so the visitor does get their answer. It is an
inconsistency in consent, not a failure.

**Real fix:** show the same prompt-plus-button the other paths use. The
persistence and replay machinery it needs already exists.

### [x] 2026-08-18 — `POST /api/conversations/:userId/:vertical/hero-shown` 500s on a normal signed-in load

**Where:** `demo_api_server/routes/conversations.js:229`.

**What's wrong:** observed live on `/dashboard`, signed in as `demouser` in the
`retail` vertical: `POST /api/conversations/me/retail/hero-shown → 500`. The
handler's only 500 path is `conversationStore.saveMessage(...)` throwing, caught
at line 249. The `userId` on the wire is the literal string `me`, not a subject
id — worth checking whether the store rejects that, or whether it is unrelated.

**Why not fixed now:** found while chasing an unrelated agent defect; nothing the
user sees breaks (the hero greeting still renders). It is console noise that
makes real errors harder to spot, which is its own cost.

**Real fix:** reproduce with a session, read the logged `err.message`, and either
fix the store call or stop calling it with a placeholder `userId`.

**PARTLY RESOLVED 2026-08-18 (branch `worktree-techdebt-small-batch-0818`).**
The 500 could **not** be reproduced. What was fixed is the reason nobody could
explain it.

*What was actually tried:* the exact request replayed against the live stack with
a real signed-in `demoUser` session (`tests/real/helpers/session.js`
`resolveSession('enduser')`, run from inside `ai-demo-api-server` so it used the
container's own env):

| probe | result |
|---|---|
| `POST /api/conversations/me/retail/hero-shown`, synthetic body | `200 {"saved":true}` |
| same, with the **real** payload from `GET /api/verticals/retail/hero` | `200` |
| 8 concurrent POSTs to one thread (the StrictMode double-write shape) | `200` × 8 |
| same request sent as `application/x-www-form-urlencoded` | `200` |
| `conversationStore.saveMessage(...)` called directly in the container | `OK` |

The `me` alias is therefore not the cause: `router.param('userId')` resolves it to
`req.user.sub` before the handler runs (`routes/conversations.js:40`), and the
store accepts everything the route can hand it.

*What the issue really was — at least in part:* **the entry's premise was wrong.**
It said "the handler's only 500 path is `conversationStore.saveMessage(...)`
throwing, caught at line 249". There was a second path: `const { greeting, imageUrl }
= req.body;` sat **above** the `try`, so a throw there escaped to Express's default
error handler as a 500 that logged **nothing**. That is the only 500 this route
could emit with no `[conversations.POST.hero-shown] Error` line to find — which
fits a 500 seen once and never explained. (Not reachable on Express 4, which sets
`req.body = {}`; `demo_api_server` pins `^4.18.2` and runs 4.22.2. It becomes
reachable on Express 5, where an unmatched parser leaves `req.body` `undefined`.)

*What the fix was:* `demo_api_server/routes/conversations.js` — body read moved
inside the `try` and defaulted (`req.body || {}`), and the catch logs
`err.stack || err.message` instead of `err.message` alone. The next occurrence
names its own cause instead of costing another session.

**RESOLVED 2026-08-18.** The original 500 *does* have a confirmed cause, and it
had already been fixed the day before — the "partly resolved" pass above simply
never connected the two.

*What the issue really was:* `saveMessage` → `_pruneThreadIfNeeded` called
`db.deleteSync(key)`, which the lmdb-js handle does not define (the API is
`removeSync`). The prune only runs once a thread exceeds
`MAX_MESSAGES_PER_THREAD = 500`, and `demouser:retail` had grown past it (the same
oversized thread behind the 84MB store in the `mapSize` entry). So every
hero-shown write triggered the prune, the prune threw
`TypeError: db.deleteSync is not a function`, and the handler's catch turned it
into the 500 seen on **every** dashboard load — not the once-off the "partly
resolved" note assumed. Neither the `me` alias (resolved since July at
`routes/conversations.js:40`) nor the body-above-`try` path (Express 4 sets
`req.body = {}`, so unreachable here) was ever the cause; both were real but
adjacent cleanups.

*Why it "could not be reproduced":* the live-stack probes above all wrote to
*fresh* threads well under the 500-message cap, so the prune branch never ran.
The bug is only reachable on an over-cap thread.

*What the fix was:* `db.deleteSync` → `db.removeSync` at both call sites in
`conversationStore.lmdb.js`, shipped in **PR #1976** (commit `5d92b23fa`,
2026-08-17) with store-level guard `tests/services/conversationStoreDelete.test.js`
— whose own docstring names this exact hero-shown 500. That landed the day before
this entry's investigation, which is why the 500 was already gone by the time
anyone tried to reproduce it.

*What this pass added:* `tests/routes/conversationsHeroShown.test.js` — the
missing **route-level** guard. It drives `POST /api/conversations/me/:vertical/hero-shown`
through the real router + real store and asserts (1) 200 with the greeting
persisted under the resolved `req.user.sub`, never under literal `me`, and (2) a
hero-shown write onto an at-cap thread runs the prune path and still returns 200
— the precise scenario that 500'd pre-#1976. No production code changed: the bug
was already fixed; only the through-the-route regression was uncovered.

The remaining LMDB `mapSize` headroom concern is real but unrelated to this 500 —
see that entry at the top of the file; it is deliberately *not* fixed here.

### [ ] 2026-08-18 — The launcher's sign-in prompt is nearly unreachable, so nothing in the product exercises it

**Where:** `demo_api_ui/src/pages/UseCaseLauncherPage.js` — `ChipLoginPrompt`
(#1952), rendered when `/api/use-cases/demo/run` refuses with `requiresLogin`.

**What's wrong:** the page is `user`-gated, so a signed-out visitor never reaches
it and the customer branch cannot fire. The admin branch needs a signed-in
customer running an `admin` use case, and `UC-NHI2` is the only one in the
catalog — with a `link` trigger, not a chip. Both branches are live code that
only unit tests touch.

**Why not fixed now:** it is correct and costs nothing to keep. Deleting it would
be wrong the moment `/use-cases` opens up or an admin chip is added.

**Real fix:** nothing in the code — but walk this path live before trusting it,
because that will be its first real exercise.

### [wontfix] 2026-08-18 — The MCP handshake is reported by the Node gateway, which is not the gateway in the path

**ACCEPTED / WON'T FIX 2026-08-18 (owner decision).** The handshake is observable
only on the Node gateway path; real traffic goes through IG (PingGateway), where it
is unobservable without a custom Groovy filter — recording it there is a
disproportionate amount of product-path work for the value. Decision: keep the honest
"not visible from here" narrative (#1960) and treat the Node-gateway `X-Gw-Mcp-Handshake`
header as dormant, correct support for the non-default path (live whenever
`mcp_demo_gateway_url` is the active gateway). The existing plumbing stays — do not
delete it. Reopen only if the IG-path handshake becomes worth a Groovy filter.
Original entry follows.

**Where:** `demo_mcp_gateway/src/server/GatewayServer.ts` (the `X-Gw-Mcp-Handshake`
header added in #1977), consumed by `demo_api_server/services/mcpGatewayClient.js`
(`_parseGwMcpHandshake`) and `mcpToolPipeline.js`.

**What's wrong:** #1977 set out to make the MCP lifecycle handshake
(`initialize` → `notifications/initialized`) visible on the gateway path, since
the BFF is not the MCP client there and cannot observe it. The implementation is
correct and tested — and inert, because it was added to the **Node** gateway
while tool calls go to **PingGateway (IG)**:

```
[GW→PingGateway] REQUEST: url=http://ping-gateway:8080/mcp
MCP_GATEWAY_HTTP_URL=http://ping-gateway:8080
```

Verified live: a real `list_orders` call returns `gw-introspection`,
`gw-authorize`, `gw-filter-chain` and the two `mcp_challenge` events, but no
`mcp-initialize` / `mcp-initialized`. The header is never set because the code
that sets it never runs.

The tell was already on screen and went unread: the filter stages rendering in
the chain are `McpValidationFilter`, `McpAuditFilter`, `McpProtectionFilter` —
IG filter names, which #1965 even added labels for. Same shape as putting the
gateway stages in `TraceStepCard`, a component the focus-mode dashboard never
mounts: right code, wrong host.

**Why not fixed now:** IG is a product. It performs the handshake inside
`McpProtectionFilter`/its upstream client, not in code this repo owns, so there
is no `forwardToUpstream` to instrument. Emitting the header from IG means a
Groovy filter in `ping-gateway/scripts/groovy/` that can observe the upstream
session negotiation — a different piece of work from the Node-side change, and
not one to start at the tail of the session that found it.

**What the real fix looks like:** either (a) an IG Groovy filter that records the
upstream `initialize` response and stamps `X-Gw-Mcp-Handshake` in the same place
`transaction-hop.groovy` already posts to the BFF, or (b) accept that the
handshake is unobservable on the IG path and keep the honest "not visible from
here" narrative #1960 added, treating the Node-gateway header as dormant support
for the non-default path. Do not delete the existing plumbing either way — it is
live and correct whenever `mcp_demo_gateway_url` is the active gateway.

**How to check whether it is fixed:** drive a tool call and assert
`mcp-initialize` appears in the returned `tokenEvents` — not that the code exists.

#### Attempt 2 (#2023) — also inert, reverted. Read this before attempting a third.

The second attempt instrumented `ping-gateway/scripts/groovy/olb-token-exchange
.groovy`, which contains an explicit MCP `initialize` call, and folded the result
into `X-Gw-Audit-Trail` via `p1az-decision.groovy` the way `mtlsResult` already
is. It passed unit tests, both Groovy scripts compile-checked against the
gateway's own `groovy-4.0.28.jar`, and it was merged and deployed. Live result:
`mcp-initialize` **absent**.

**That script never runs on this deployment.**

```
docker logs ai-demo-ping-gateway | grep OlbExchange   →  0 lines
```

The tell was already in the live token events: no `gw-mtls` either, and that
comes from the same script. Reading the code proved the call exists, not that it
executes — the same mistake as attempt 1, one layer deeper.

**Two facts the attempt got wrong, which any third attempt must not inherit:**

1. **The handshake IS performed, in full.** `ai-demo-mcp-server` logs
   `initialize`, then `notifications/initialized`, then `lifecycle ready`, on
   short-lived connections that open and close per call. It is a complete
   three-message lifecycle.
2. **`notifications/initialized` IS sent.** #2023 asserted the opposite in a code
   comment, a commit message and this file, and built an `initializedSent: false`
   flag on top of it. Wrong. Do not carry that assumption forward.

**So the client is not the IG filter chain.** The server authenticates each
connection with an agent token over WebSocket (`Agent token validated via
Authorization header for connection <uuid>`). Identify that client from the
connection ids and instrument *there*; do not instrument anything on the basis of
reading a script until a log line proves it executes on a live call.

**And prove it live before merging.** Both attempts were green, reviewed and
merged before anyone drove a real tool call. `npm run test:e2e:real --
chain-hops-reachable` reports this hop under CONFIG_DEPENDENT and takes 30
seconds.

#### Measured 2026-08-18 — where the handshake actually happens

Before attempting a third time, this was traced by driving each leg separately
and reading container logs, rather than by reading code. The result contradicts
both previous attempts AND the correction above.

**The MCP client is `demo_mcp_gateway` — the Node gateway.** Running the
discovery leg alone opened 3 connections on `ai-demo-mcp-server`; running the
tool-call leg alone opened 2, and `ai-demo-mcp-gateway` logged exactly 2
`[GW] tools/list` in the same window. So #1977 targeted the RIGHT service. It was
not the wrong gateway.

**But the handshake rides the discovery leg, not the tool call.** During the
tool-call leg the MCP server saw:

```
2 : initialize
2 : notifications/initialized
2 : tools/list
```

and **no `tools/call` at all**. The lifecycle belongs to tool discovery. Note
this also settles the earlier claim in #2023 that `notifications/initialized` is
never sent — it is sent, on every connection.

**Why #1977 is still inert:** it stamps `X-Gw-Mcp-Handshake` on the Node
gateway's HTTP proxy response (`GatewayServer.ts`, ~line 1045). Discovery does
not use that path — `agentGatewayClient.listAvailableTools` calls `mcpListTools`
with `getMcpGatewayWsUrl()`, i.e. a **WebSocket**. An HTTP response header cannot
reach a WebSocket caller. Right service, right data, wrong transport.

**What a fourth attempt should do:** carry the handshake in the WS `tools/list`
result — the gateway already returns `_meta` there (`_meta.deniedTools`,
`_meta.authzEngine` are consumed today) — and have `listAvailableTools` turn it
into `mcp-initialize` / `mcp-initialized` events beside the existing
`tools_list_success`. The hops then belong to the discovery leg, which is where
the protocol says they belong.

**And they must be modelled as discovery hops, not tool-call hops.** Today
`buildTraceSteps` places `mcp-initialize` between the gateway and the MCP call.
On the evidence above that is the wrong position — the session is opened and
closed during discovery, before any tool call exists.

#### Attempt 3 (#2049) — VERIFIED LIVE 2026-08-18. This entry is closed.

Two halves shipped on that PR:

- **Position (verified).** The hops moved next to `tools-list`, `MCP_STEP_IDS`
  stopped listing them — `TokenTopologyPanel` partitions spine from branch off
  that list, so while they were in it the topology drew the session as part of
  the invocation, the same wrong claim on a second surface — and the narratives
  stopped saying the handshake "happens on every tool call". Guarded by three
  tests, two verified to fail with the reposition reverted.

- **Transport (NOT verified).** `proxy.ts` captures the initialize result it
  already receives and attaches it non-enumerably to the resolved response;
  `index.ts` folds it into the `tools/list` `_meta`; `agentGatewayClient` emits
  `mcp-initialize` / `mcp-initialized` beside `tools_list_success`.

**Verified on the live stack after merge and a gateway rebuild:**

```
[list] 97 tools, events: ["mcp_challenge","mcp_resource_metadata",
                          "mcp-initialize","mcp-initialized","tools_list_success"]
```

Real events from a real run — the thing neither #1977 nor #2023 ever produced.
What made the difference was not better code: it was tracing where the handshake
happens before writing any. Both earlier attempts were argued from reading the
source.

**Do not revert on an ABSENT reading from the invoke leg.** An earlier version of
this entry said to revert if `chain-hops-reachable` printed ABSENT. That
instruction is now wrong, and following it would delete working code. The hops
appear on the DISCOVERY response (`/api/demo-agent/tools`) and are correctly
absent from `/api/agent/invoke`, because the tool-call leg produces no
`tools/call` on the MCP server at all — measured, see above. The spec reports both
legs separately; read the `[list]` line, not the `[hops]` line.

**DECIDED 2026-08-18: shown on discovery, not as hops of its own.** The owner
chose this over carrying discovery evidence forward into the run chain. The
`mcp-initialize` / `mcp-initialized` STEPS are gone; their evidence now hangs off
the `tools-list` hop that caused the session, as `MCP session`, `MCP server` and
`session opened by` rows plus a `handshake` detail block.

Why this and not the alternative: filling the hops from an earlier request makes
the chain look complete, but a viewer reads two cards between the gateway and the
MCP call as a session negotiated for that call. That is the fiction this whole
thread has been removing. Reporting the session on the hop that opened it says the
true thing and adds no card that is blank most of the time.

The step ids are now history in three positions, which is worth knowing before
moving them a fourth time:

| shape | why it was wrong |
|---|---|
| hops between gateway and MCP call | claimed a session per tool invocation |
| hops next to `tools-list` | honest, but blank on any chain built from one invoke response |
| rows on the `tools-list` hop | current |

`TITLES` / `NARRATIVES` / `STEP_RFCS` / `STEP_SPEC` entries for both ids are
REMOVED, along with `TokenTopologyPanel`'s badge rows for them. Keeping them was
argued for at first — the teaching text was good — but retained metadata for a hop
that no longer exists is the same trap as retained code that no longer runs: it
reads as coverage and sends the next reader looking for a step. The MCP lifecycle
teaching moved onto the `tools-list` spec, which is the hop that actually performs
initialize / notifications/initialized, and the removed text is in git history if a
discovery-detail surface ever wants it verbatim.

The token EVENTS are unchanged and still asserted live in
`chain-hops-reachable.real.spec.js` — the gateway still reports the handshake; only
the rendering moved.

### [x] 2026-08-18 — Nothing proves a token-chain hop is reachable on the gateway actually in use

**Where:** `demo_api_ui/src/components/__tests__/FocusModeChainRenders.test.jsx`
(the render guard), and the whole `buildTraceSteps` step model.

**What's wrong:** the guard added on 2026-08-17 closed one hole — it renders the
real focus-mode component tree and asserts the DOM, so a feature can no longer
ship into a component nobody mounts. It cannot catch the sibling failure: a hop
whose EVIDENCE is produced by a service that is not in the request path. The
handshake entry above is exactly that, and the guard passes for it, because the
guard feeds the store a fixture rather than a live run.

Three hops now depend on which gateway is active, and nothing states that
dependency in code: the filter stages (IG and Node emit different chains), the
handshake (Node only), and the 401 challenge (both, via the BFF's own probe).

**Why not fixed now:** the honest check is an end-to-end assertion against a
running stack, and the `*.real.spec.js` Playwright suites that could host it
require `local.ping-devops.com:4000` and therefore never run in CI — which is
why they caught none of this class today.

**RESOLVED 2026-08-18** — `demo_api_ui/tests/e2e/chain-hops-reachable.real.spec.js`.
Two tests, run deliberately (`npm run test:e2e:real -- chain-hops-reachable`):
one drives a tool call via `/api/agent/invoke` and asserts `mcp_challenge`,
`gw-authorize` and `gw-filter-chain`; the other drives discovery via
`/api/demo-agent/tools` and asserts the `tools/list` challenge plus
`degraded === false` (the shape #1949 took). Hops that depend on which gateway is
active are reported, never asserted, so the check does not encode today's
deployment. Verified green live, 97 tools discovered.

Two things had to be true for it to be worth anything, and both were measured:

- It asserts only ids the preview fallback cannot synthesize.
  `buildSessionPreviewTokenEvents` emits `user-token` / `exchange` /
  introspection when the real chain fails to resolve, so an assertion on those
  passes on a stack with no working gateway at all.
- Run against the Inspector route — which passes `forceDirectMcpAudience: true`
  and bypasses PingGateway — the same request returned 12 token events, the
  entire two-exchange chain, and **none** of the three asserted ids. The
  assertions discriminate.

Still true, and the reason this is a smoke check rather than a CI gate: it needs
`local.ping-devops.com:4000`, so nothing runs it automatically. A chain hop that
passes unit tests is still evidence about the model, not about what a demo will
show — run this before believing otherwise.

### [x] 2026-08-18 — A piped verification command reports the pipe's exit code, so a failed deploy reads as success

**Where:** every `./scripts/deploy-live.sh ... | tail`, `npm test | grep`,
`npx jest | tail` invocation — agent-run and human alike.

**What's wrong:** `cmd | tail` exits with tail's status, not `cmd`'s. A
`deploy-live.sh` run that aborted mid-way with exit 1 was read as exit 0 because
the output was piped; the only reason it was caught is that the deploy stamp had
not advanced. Every "verified, exit 0" claim made through a pipe is unfounded,
and the failure mode is silent by construction.

This is the same shape as the entries above it — a check that cannot observe the
thing it checks — but it applies to the act of verifying itself, so it
invalidates other evidence rather than one feature.

**Why not fixed now:** it is a habit encoded in commands, not a line of code to
change. `set -o pipefail` fixes scripts in the repo but not the ad-hoc
command that reads their output.

**Real fix:** two parts. (1) `set -o pipefail` at the top of every script under
`scripts/` that runs a subcommand whose failure should matter — `deploy-live.sh`
already has `set -euo pipefail`, most helpers do not. (2) A stated rule in
`CLAUDE.md`'s verification section: capture to a file and grep the file, or check
`${PIPESTATUS[0]}` — never conclude from a piped command's status. Cheap to
state, and it retires a whole class of false green.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-small-batch-0818`), with a
deliberate scope reduction — read the audit before assuming the whole class is
retired.**

*What the issue really was:* the mechanism is exactly as the entry describes, but
its premise about the blast radius was measurably wrong. It says "`deploy-live.sh`
already has `set -euo pipefail`, most helpers do not". Audited all 39 scripts
under `scripts/` for a `set -` line **anywhere in the file**, not just near the top:

- **30 already set `pipefail`** — including `deploy-live.sh`, as the entry said.
- **9 do not.** Of those, only 4 declare `set -e` at all — so only those 4 are
  scripts where "a subcommand's failure should matter" is already the author's
  stated intent.

This was never a 39-script problem. It was a 4-script problem plus a habit.

*What the fix was — part 1, the scripts:* added `-o pipefail` to the three that
declare `set -e` and carry a pipeline whose first stage matters:

- `scripts/load-secrets-docker.sh` — the real one. `op item get … | jq …`: when
  `op` fails, `jq` reads empty input, succeeds, and the script continues with no
  secrets loaded and exit 0.
- `scripts/install-hooks.sh`, `scripts/install-master.sh`.

**Deliberately not changed, and why:** `scripts/render-diagrams.sh` also has
`set -e`, but line 20 is `FLOWS=$(ls …/*.mmd 2>/dev/null | wc -l | tr -d ' ')` — a
deliberately tolerant `ls` whose failure is the normal "no diagrams" case.
`pipefail` there converts a supported state into an abort: a behaviour change
disguised as hardening. The other five (`demo-terminal.sh`, `llm-warmup.sh`,
`pac-common.sh`, `ping-email.sh`, `preflight-demo.sh`) do not set `-e`, so
`pipefail` would change nothing except the `$?` of pipelines whose status nothing
reads — and `pac-common.sh` is **sourced**, so a `set` in it leaks into the
caller's shell. Blanket-applying the entry's "every script under `scripts/`"
would have been wrong in six places.

*What the fix was — part 2, the habit:* added the rule to `CLAUDE.md`'s "Before
claiming done" section as its own numbered step. The entry is right that the
scripts are the smaller half — the ad-hoc `cmd | tail` an agent types to read a
script's output is not fixed by anything inside the script.

### [x] 2026-08-18 — A fresh worktree cannot verify anything, and every failure mode looks like a pass

**FIXED 2026-08-18 (PR #2071, merged).** `run-tests.sh` had three points
(`run_api_tests`, `run_ui_vite_smoke`, `run_e2e_tests`) that silently ran
`npm install` when `node_modules` was absent — the exact "stray toolchain
masquerading as a clean run" trap. Replaced all three with a shared
a shared `require_toolchain` guard that refuses with a clear message
("refusing to verify: SERVICE/node_modules is missing — run npm ci in SERVICE
first") and exits non-zero when the service's `node_modules` or the specific
`node_modules/.bin/<tool>` is missing; the Playwright probe now uses
`npx --no-install` so a missing local tool errors instead of downloading a stray
one. Verified end-to-end: a fresh worktree running `run-tests.sh unit` now refuses
and exits 1 instead of silently proceeding. (Covers the run-tests.sh path; ad-hoc
`npx jest`/`npx tsc` typed directly in a shell are still on the operator — the
`verify-ai-demo2` skill documents that.) Original entry follows.

**Where:** any worktree created without `npm ci` in the service being changed.

**What's wrong:** three different false signals, all observed in one session:

- `npx tsc --noEmit` with no local TypeScript silently downloads one and reports
  "No errors found" — a typecheck that never used the project's tsconfig or its
  types. `npm run build` immediately after said `tsc: command not found`.
- `npx jest` with no local jest fetches a stray one and dies in babel, which
  reads as a broken test rather than a missing toolchain.
- `jest` reporting `Cannot find module 'argon2'` for a cross-package import is a
  missing dependency, not a failing test — but it counts as a failed suite, and
  under `SUITE_BLOCKING=1` it fails the gate.

The `verify-ai-demo2` skill documents the jest case. Nothing catches the tsc one,
which is worse because it produces a confident false positive rather than an
error.

**Why not fixed now:** found while doing something else each time, and the
workaround (`npm ci`, wait ~90s) is known once you have been bitten.

**Real fix:** a preflight in the repo's verify scripts that fails loudly when
`node_modules` is absent in the target service — "refusing to verify: run
`npm ci` in that service first" — so a missing toolchain can never be mistaken
for a clean run.
`npx --no-install` would also turn the silent-download cases into an explicit
failure.

### [x] 2026-08-18 — `groupsForUser` cannot tell a caller whether it answered live or from the manifest

**Where:** `demo_api_server/services/groupPolicy.js` — `groupsForUser()` /
`groupsForUserSync()`; correct handling in
`routes/groupMembership.js` (`source: 'pingone' | 'manifest'`).

**What's wrong:** `groupsForUser(username, verticalId, {})` falls back to
manifest data when no `pingOneUserId` is supplied, and returns a bare array. The
caller cannot distinguish "this user IS in AI_Demo_Privileged, live" from "the
manifest says users like this are". Called without the id, it returned
`["AI_Demo_Privileged","Banking_PremiumTier"]` for a user the live directory
reported as being in ZERO groups — and that manifest answer was reported as
verified live membership before enabling `ff_authorize_group_policy`.

The decision-board route already solves this: it does the live lookup and stamps
each row `source`. The service underneath does not, so every other caller can
make the same mistake.

**Why not fixed now:** the callers that matter for the group demo happen to pass
`pingOneUserId`, so nothing is currently wrong in production behaviour — only in
what a caller (or an operator reading a probe) can safely conclude.

**Real fix:** return `{ groups, source }` from `groupsForUser` as the board route
already does internally, and make the manifest path impossible to mistake for a
directory read. `project-group-policy-provision-before-flag` in memory says "live
lookup beats manifest" for exactly this reason; the API should enforce it rather
than rely on the caller remembering.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-small-batch-0818`).**

*What the issue really was:* the entry called this a reporting gap — "only in what
a caller can safely conclude" — and said "nothing is currently wrong in production
behaviour, the callers that matter happen to pass `pingOneUserId`". Auditing every
caller in order to change the return shape showed that was not true. There are
four callers and the fourth is broken:

```js
// services/enterpriseMcpPolicyService.js:64, inside the SYNCHRONOUS demoGroupsForUser()
const fromPolicy = groupPolicy.groupsForUser(username);   // async — returns a Promise
if (fromPolicy.length) return fromPolicy;                 // Promise.length === undefined
```

`groupsForUser` is `async`, so `fromPolicy` is a Promise, `.length` is `undefined`,
the branch is **never** taken, and the manifest fallback this function exists to
provide has never once fired — it drops to the `getAllowedGroups()` username match
instead. That is the entry's own thesis proving itself: an async array-returning
helper is easy to misuse in a way nothing observes. It stayed invisible because
both the right and the wrong answer are "some array".

*What the fix was:* the entry's stated fix.

- `services/groupPolicy.js` — `groupsForUser()` now returns `{ groups, source }`,
  `source` being `'pingone'` for a real directory read and `'manifest'` for the
  vertical manifest's claim about users like this one. The two no longer share a
  shape, so a caller cannot silently conflate them. `groupsForUserSync()` is
  unchanged: its name already says manifest-only and it is the honest choice on a
  path with no PingOne id.
- Destructured at the three real callers — `mcpToolAuthorizationService.js:779`,
  `mcpToolPipeline.js:948`, `agentPreflightService.js:348`. Behaviour identical.
- `enterpriseMcpPolicyService.js:64` switched to `groupsForUserSync(username)`,
  which is what that synchronous function meant all along. **This is a real
  behaviour change:** the manifest branch can now fire where it previously could
  not. It affects only the demo fallback taken when the PingOne Management API is
  unavailable.

Kept the "an empty array from a *successful* live call still wins" rule and wrote
it into the code as a comment, because `docs/LIVE-PINGONE-RUNBOOK.md:108` depends
on it: enable `ff_authorize_group_policy` before the groups exist and "no gate"
becomes "a gate that denies everyone".

### [ ] 2026-08-18 — Shared jest automocks let an assertion pass on a different test's call

**Where:** `demo_api_server/src/__tests__/mcpToolAuthorizationService.test.js`
(fixed there); the pattern is repo-wide wherever a module-level `jest.mock()`
is asserted against without `mockClear`/`mockReset`.

**What's wrong:** automock state persists across tests in a file. A test
asserting `expect(configStore.setRaw).toHaveBeenCalledWith({...})` passed because
an EARLIER test in the same file had made that call — the behaviour it claimed to
cover never ran. Its `.mockRejectedValueOnce` was likewise queueing behind
`*Once` values other tests left unconsumed, so the self-heal branch it existed to
exercise frequently never executed. It passed in isolation and passed in the
suite, while proving nothing.

Found only because a change made the assertion fail; a test that passes for the
wrong reason is invisible until something disturbs it.

**Why not fixed now:** the one instance found was repaired in place
(`mockReset()` before queueing, `mockClear()` before the assertion). Auditing
every automock assertion in ~800 suites is its own pass.

**Real fix:** set `clearMocks: true` (or `resetMocks`) in `demo_api_server`'s
jest config so call history cannot leak between tests, then fix the fallout. That
converts this class from "silently passing" to "loudly failing", which is the
only way to find the rest.

### [ ] 2026-08-18 — UI probes have no settle contract, so "the page renders nothing" is unreliable

**Where:** ad-hoc Playwright scripts driving the live stack; the recipe lives in
memory (`playwright-live-ui-drive-recipe`), not in the repo.

**What's wrong:** two false findings from one session. A route was reported as
rendering blank — 0 characters, 0 buttons — because the probe sampled before
React settled; with a longer wait it rendered 1381 characters and 16 buttons. And
a signed-call verification produced no tool call because the probe submitted a
retail phrase while the session had resolved to the banking vertical, so nothing
matched and the absence of gateway traffic was nearly read as "the fix did not
work".

Neither is a product bug, and both are the same mistake: a probe whose negative
result is indistinguishable from a broken feature. `networkidle` never fires here
because the app holds SSE open, so every script invents its own wait.

**Why not fixed now:** each probe was written for one question and discarded. The
knowledge exists in memory but nothing in the repo carries it, so the next
session re-derives it — and may not notice when a too-short wait produces a
finding.

**Real fix:** a small committed helper under `scripts/` or `demo_api_ui/tests/`
that owns sign-in (the BFF redirect, since the top-nav button is 0x0 headless),
the settle strategy (fixed wait plus a content assertion, never `networkidle`),
and active-vertical resolution — so a probe asserts it reached a usable page
before reporting what it did or did not find.

### [x] 2026-08-18 — The group-policy board cannot produce a PERMIT, so the demo it exists for cannot be shown

**Where:** `demo_api_server/routes/groupMembership.js` (`GET /api/groups/decision-board`)
→ `agentMcpTokenService.resolveMcpAccessTokenWithEvents(req, tool)`.

**What's wrong:** the board's premise is "change the membership below and every
row moves with it". Membership now demonstrably moves — `inRequiredGroup` flips
`false → true` across all 13 rows when the toggle runs — but no decision moves
with it. Every row stays `DENY` on `mcp-invalid-audience`.

The cause is one layer below the board. Each row mints the token the PEP would
present (#1972) so the decision is asked with real evidence rather than a
fabricated audience. That mint SUCCEEDS — it returns a token — but
`decodeJwtClaims(token).aud` yields nothing, so no audience is presented and the
PDP fail-closes on audience before the group rule is ever reached. Deduction, not
guesswork: `tokenError` stays null on exactly one code path, the one where
`minted.token` is truthy.

Three fixes deep on this surface already, each exposing the next: a 429 burst
(#1969) hid the audience deny, the audience deny hid the empty-`aud` mint
(#1972), and the mint hid its own reason (#1976, #1983). What remains is why a
successfully minted MCP token carries no readable `aud`.

**RESOLVED 2026-08-18 (PR #2015) — and the diagnosis above was WRONG.** The
mint was never the problem. `decodeJwtClaims` returns `{ header, claims }`, not
the claims; the board read `.aud` straight off it, so the audience was always
`undefined` for a perfectly good token. Every other caller in `routes/` already
unwrapped `.claims` — this was the one that did not.

The deduction recorded above ("`tokenError` stays null on exactly one code
path") was sound reasoning applied to a symptom the instrumentation had
manufactured. `groupDecisionBoardToken.test.js` mocked `decodeJwtClaims` with a
flat `{ aud }` — the only one of 21 suites to do so — so the test asserted the
same misreading as the code and stayed green. That is the durable lesson here:
green meant "the test and the route agree", not "the route is right".

Verified live, signed in as `demoUser` on the real stack: 13 rows, every one
`tokenPresented: true` with no `tokenError`, and **`mcp-invalid-audience` absent
from every row** — it had previously denied all 13. Two rows now PERMIT
(`HITL,mcp-tool-authorized`).

**Newly visible underneath it, then ADDRESSED 2026-08-18 (PR #2017):** with
`inRequiredGroup: true` on all 13 rows, 11 denied on
`mcp-invalid-a2a-generalist`. Authorize's `DenyA2aDelegationRequired` rule
denies `ActChainDepth < 2` for exactly the tools flagged `a2aDelegated` in
scope-topology — verified: the 10 flagged tools are precisely the ones that
denied, and the 2 unflagged ones are the 2 that PERMITted. The board minted a
one-hop token, so those rows denied on delegation shape and never reached the
group rule; membership could not move them.

Those rows now mint through `a2aDelegationService.delegateToSpecialist()` — the
same chain the real call path uses — keyed on the scope-topology flag rather
than the tool-name list in `pac/policies/mcp-delegation.yaml`, so the two cannot
drift apart silently.

**`ff_a2a_delegation` defaults to `false`**, so the fallback is the DEFAULT path,
not an edge case: the row is probed with the one-hop token (keeping the
informative `mcp-invalid-a2a-generalist` verdict rather than the
`mcp-invalid-audience` you get by presenting nothing) and `tokenError` states
that delegation was unavailable and why.

**Not verified live with the flag ON.** The flag-off path is confirmed on the
real stack; the delegated branch is unit-tested only. The admin
feature-flag endpoint now requires a bearer token, and flipping a live demo flag
is the operator's call, not something to route around an auth gate for.

### [x] 2026-08-18 — A caller token whose scopes miss the backend can never call it, and the error names the wrong cause

**FIXED 2026-08-18 (PR #2059, merged + deployed) — deny with a clear caller-facing
reason (owner's decision).** Rather than change the request (the round-1 trap that
broke two tested contracts), a shared helper
`scopeMismatchReasonFromExchangeError()` maps PingOne's `invalid_scope: multiple
resources` response — gated on that signature AND a confirmed-empty
subject∩backend intersection so it never mislabels other failures — into the
caller-facing response on BOTH transports (HTTP + WS). Same envelope, now with
`data.reason: "scope_mismatch"`, `data.subject_scopes`, `data.backend_scopes`,
`data.backend`, and a message naming both sets, so the caller learns the cause from
the response instead of a gateway log. `exchangeForBackend` is untouched, so the two
deliberate contracts hold — confirmed passing in isolation: "sends no scope without
the flag — the tools/call path is unchanged" and the cache-isolation test. Full
gateway suite 755 passed. Original entry follows.

**Where:** `demo_mcp_gateway/src/auth/McpTokenExchangeClient.ts` —
`exchangeForBackend`, the `requestScopes.length === 0` case.

**What's wrong:** on the call path the requested scope is `subject scopes ∩
target-resource scopes`. When that intersection is empty the exchange goes out
with `scope=` omitted, and PingOne rejects it with `invalid_scope: May not
request scopes for multiple resources` — an error about resource ambiguity that
names neither the caller's scopes nor the backend's. Observed live as a recurring
error-level failure on every `sensitive_order_history` call: a token carrying
`purchase:read` against `backend=olb` (`mcpserver.ping.demo`), which accepts 27
scopes, none of them that one.

A pre-flight warning naming both scope sets now precedes it (#1983), so the cause
is diagnosable — but the underlying condition stands: those tool calls cannot
succeed, and the only signal is a log line.

**Why not fixed now:** the scope-less request is deliberate and tested
(`sends no scope without the flag — the tools/call path is unchanged`) —
inventing a scope the caller does not hold would manufacture authority. Making it
fail locally instead broke that contract plus a cache-isolation test; rewriting
those to fit would have been making the evidence match the conclusion. The defect
that could be fixed without touching the contract — diagnosability — was.

**Real fix:** decide whether these tools are meant to be reachable by such
callers. If yes, grant the scope or add it to the resource's `mirroredScopes` in
`scope-topology.json`; if no, deny at the gateway with a scope-mismatch reason so
the caller learns it from the response rather than from a gateway log.

### [~] 2026-08-18 — `olb` tools/list times out; its tools vanish from the catalog and callers see "tool not found"

**INSTRUMENTED 2026-08-18 (PR #2054, merged + deployed) — root cause not yet
diagnosed (not reproducible on demand).** Investigation ruled out the pool-exhaustion
hypothesis: `proxy.ts::proxyJsonRpc` opens a fresh WebSocket per request — there is no
connection pool and `MCP_WS_MAX_CONCURRENT` does not exist in the codebase. The
timeout is `HANDSHAKE_TIMEOUT_MS = 10_000` and fires only when the socket OPENED but
`initialize` went unanswered for 10s (a never-opening socket trips the 30s call
timeout — a different message). Added structured, greppable diagnostics on the
failure path: the timeout rejection now carries `code: 'handshake_timeout'`,
`timeoutMs`, `elapsedMs`, `connectMs`; `formatToolsListBackendFailure()` emits one
line keeping the `tools/list failed for backend=<id>` prefix plus
`reason=… timeoutMs=… elapsedMs=… connectMs=… attempts=1 pool=none(fresh-ws-per-request)`.
No retry added (it would mask the signal and add ~10s + load to a struggling
backend). So the next occurrence produces data to correlate with mcp-server
restarts/cold starts. `[~]` = instrumented, not cured. Original entry follows.

**Where:** `demo_mcp_gateway/src/index.ts` tools/list fan-out; backend `olb`
(`mcpserver.ping.demo`, WebSocket).

**What's wrong:** `[GW] tools/list failed for backend=olb: MCP handshake timeout`
recurred 5 times in 45 minutes while every other backend answered. That backend's
tools are then simply absent from the merged catalog, so an agent asking for one
gets "tool not found" rather than "backend down".

`/health` now reports partial outages (#1980) — before that it actively CLEARED
the signal whenever any backend answered, so this read as healthy. Visibility is
fixed; the timeout itself is not diagnosed.

**Why not fixed now:** the visibility gap was the reportable defect and was
fixable in one place. Why the `olb` WebSocket handshake intermittently times out
is a separate investigation into that backend's startup/liveness, and it was not
reproducing on demand.

**Real fix:** instrument the handshake path with the timeout value and elapsed
time, and establish whether it correlates with mcp-server restarts, cold starts,
or connection-pool exhaustion (`MCP_WS_MAX_CONCURRENT`).

### [x] 2026-08-18 — Intent tokens cannot be validated on the Node gateway path (`no_signing_key`)

**FIXED 2026-08-18 (PR #2055, merged + deployed) — was a deploy-wiring gap, not a
missing key.** Investigation: the BFF signs intent tokens HMAC-SHA256 with
`INTENT_TOKEN_SECRET || SESSION_SECRET` (`intentTokenService.js`); PingGateway
verifies with the same secret (`p1az-decision.groovy`) and reports
`IntentTokenValid:true` because `refresh-service-envs.js` writes that secret into
`ping-gateway/.env`. The Node gateway's validator (`intentTokenValidator.ts`) already
read the SAME `INTENT_TOKEN_SECRET || SESSION_SECRET` — it was simply never written
into `demo_mcp_gateway/.env`, so `getSigningKey()` threw `no_signing_key`. The fix is
one line in the env writer: emit `INTENT_TOKEN_SECRET` to the gateway `.env` verbatim
in the same form as ping-gateway (no new secret, no rotation, no value committed —
the existing symmetric secret is already shared to PingGateway by design). Regression
guards: `src/__tests__/refreshServiceEnvs.intentSecret.test.js` now covers the gateway
block; `intentTokenValidator.test.ts` adds no-key / SESSION_SECRET-fallback /
wrong-key cases. **Effective when** the gateway `.env` is regenerated
(`refresh-service-envs`) and the container restarts; still latent behind
`ff_mcp_gateway_pinggateway` (Node path off by default). **How to confirm:** flip to
the Node path and assert `IntentTokenValid:true` in the `gw_audit_trail`. Original
entry follows.

**Where:** `demo_mcp_gateway` intent-token validation; visible in every
`gw_audit_trail` from that path as
`IntentTokenValid: "false", IntentTokenError: "no_signing_key"`.

**What's wrong:** the Node gateway cannot verify intent tokens at all — it has no
signing key — so `IntentTokenValid` is always false there. The same call through
PingGateway reports `IntentTokenValid: "true", IntentMatchesTool: "true"`, so the
token itself is fine; only this path cannot check it.

`INTENT_TOKEN_REQUIRED` is declared fail-open on `/health`, so this is disclosed
rather than silent, and nothing is currently bypassed because MCP traffic routes
through PingGateway in the compose stack. It becomes live the moment
`ff_mcp_gateway_pinggateway` flips to the Node path.

**Why not fixed now:** found while auditing for silent failures, and the
enforcement posture is already published — this is a latent gap, not an active
bypass. Provisioning a signing key for the gateway is its own config change.

**Real fix:** give the Node gateway the intent-token signing key (or the JWKS to
verify against), then confirm `IntentTokenValid: true` on that path before
anyone flips the routing flag.

### [x] 2026-08-18 — Testing against the live stack requires editing the shared checkout, and the guardrail only covers two tools

**Where:** the worktree rule in `CLAUDE.md`, the `Write`/`Edit` hard-block hook,
and `docker-compose.yml` — which bind-mounts the SHARED checkout into
`demo-api-server` and friends.

**What's wrong:** two rules collide. Edits must happen in a worktree because
concurrent sessions share one index; but Docker serves the shared checkout, so
the only way to exercise a change against the running stack is to put it there —
which backs off `sync-main-checkout.sh` and stops every other session's deploys.

Four sessions hit this in one day. The hard-block hook covers `Write`/`Edit`;
a peer session reported reaching the same file through a `python3` heredoc via
Bash with no prompt, so the guardrail constrains the obvious path while the
workflow supplies a reason to find another.

Recovery is also non-obvious: restoring the file from `origin/main` is NOT enough
once main has moved past the checkout's HEAD — it stays dirty until the
checkout's own HEAD blob is written (`git show <checkout-HEAD-sha>:<path>`).

**Why not fixed now:** this is a workflow/tooling decision for the repo owner,
not a code change to make unilaterally — and tightening the hook to cover Bash
writes would harden the workaround without removing the reason for it.

**RESOLVED 2026-08-18 (PR #2009).** `npm run serve:worktree here` points the
running stack at the calling worktree: `--project-directory` stays on the main
checkout so all 37 `env_file` entries still resolve, and only the two source
mounts move (`ui` and `demo-api-server` are the only services that bind-mount
source). No argument prints which checkout each container is actually serving;
`main` hands it back. Verified live end to end — repointed, proved the container
read the worktree's files and Vite served its `src`, confirmed the BFF kept its
178 env vars, then handed back.

Deliberately NOT a per-worktree parallel stack: OAuth `redirect_uri` values are
registered per port in PingOne, so a second stack on another port cannot sign in
until someone edits the PingOne app. One stack with a visible owner is the shape
that works.

**Still true:** the hard-block hook covers `Write`/`Edit` only, and a `python3`
heredoc via Bash still reaches the shared checkout. That is now a gap without a
motive rather than a gap with one — the reason to go around the guardrail is
gone. Original framing follows.

**Real fix:** give sessions a sanctioned way to test against the running stack
without touching the shared tree — a compose override or scratch bind-mount
pointing at the requesting worktree. Two supporting fixes already landed:
`deploy-live.sh` now compares against what was last deployed rather than the
checkout SHA against itself (#1944), so a correct post-merge deploy is one
command; and `npm run sync:status` names the blocking files, though only if you
think to run it.
### [ ] 2026-08-18 — 687 error-level lint findings, 455 of them false, hiding the real ones

**Where:** `demo_api_ui` ESLint config — no test-environment globals declared
for the vitest specs or `src/setupTests.js`.

**What's wrong:** `npx eslint src` reports **687 error-level findings**. The
breakdown:

```
455  no-undef                                 <- almost all vitest globals
 48  testing-library/no-node-access
 39  testing-library/prefer-screen-queries
 35  testing-library/prefer-find-by
 32  testing-library/render-result-naming-convention
 28  import/first
```

The `no-undef` mass is `describe`, `it`, `expect`, `vi`, `globalThis` in test
files and `setupTests.js` — all genuinely defined at runtime. They are config
gaps, not bugs. But they are reported at the same severity as a real one, and
they outnumber the real ones roughly 200:1.

The consequence is not hypothetical. `AIAgent.js` contained

```js
handleSubmit({ agentMode: agentMode || 'helix' })
```

where neither identifier existed anywhere in the file — a guaranteed
`ReferenceError` on every MCP-tools selection. ESLint had been reporting both as
`no-undef` **errors** the whole time. They were dismissed repeatedly across a
long session as "the pre-existing baseline" because the *count* never changed,
and nobody read the contents of a 687-line error list. It was found by reading
the list line by line, not by the tooling surfacing it.

Two real production errors sat inside 455 false ones. That is a signal-to-noise
problem, not a discipline problem — no reviewer reliably reads 687 lines to find
2.

**Why not fixed now:** the fix touches the shared ESLint config for the whole UI
package, which affects every contributor's editor and any lint gate in CI. It
was found mid-incident while fixing an unrelated defect, and changing lint
severity across the package during that would have obscured which findings the
fix was responsible for.

**What the real fix looks like:** declare the test environment so the false
`no-undef` mass disappears — an `env: { 'vitest-globals/env': true }` override
(or equivalent `globals` block) scoped to `**/__tests__/**`, `**/*.test.*` and
`setupTests.js`. Once the count reflects reality, `no-undef` is worth gating on
in CI, because in this codebase it means "this line throws at runtime." The
`testing-library/*` and `import/first` findings should be triaged separately —
they are style, and reporting them at `error` alongside a crash is part of what
flattened the signal.

### [ ] 2026-08-18 — Agent tests pass `user` at first render, so a whole class of auth-timing bug is invisible

**Where:** `demo_api_ui/src/components/__tests__/AIAgent.*.test.jsx` — the shared
harness, e.g. `renderAt(path, user = null)` in
`AIAgent.protectedStepLogin.test.jsx:166`, which mounts `<AIAgent user={user} …>`
with the user already resolved.

**What's wrong:** in the real app `user` arrives asynchronously. `isLoggedIn`
is `!!(user || sessionUser)`, both resolved after mount, so there is a window
on every load where the component is mounted and signed-out-looking before the
session lands. Effects fire in that window, and the OAuth return is *the* moment
it matters. The harness never creates that window, so any defect that lives in
it is unreachable from the suite.

This is not theoretical. On 2026-08-17/18 the queued-question resume defect
(#1963) was shipped as fixed **three times** against a green suite. Each round
the tests passed because they encoded an ordering that never happens in a
browser. The measurement that finally found the cause had to be taken in the
running app. A test added afterwards (`waits for the session instead of firing
during hydration`) reproduces it only by rendering `user={null}` first and then
re-rendering with a user — nothing about the default harness suggests that is
the load-bearing detail.

**Why not fixed now:** each fix was scoped to one defect on a REGRESSION_PLAN
§1 surface, mid-incident, and re-shaping the shared harness would have changed
every agent spec at the same time. Doing it while the underlying bug was still
unidentified would also have meant changing the instrument and the subject in
the same step.

**What the real fix looks like:** make the async arrival the default. A
`renderAtHydrating()` helper that mounts with `user={null}` and flips after a
tick, used by any spec touching auth-dependent effects — so the hydration window
exists unless a test opts out, rather than existing only when someone remembers
to build it by hand. At minimum, a comment on `renderAt` saying what it does not
simulate.

### [x] 2026-08-18 — `GET /api/mcp/inspector/tools` is unauthenticated, and the UI grouping implied otherwise

**Where:** `demo_api_server/routes/mcpInspector.js:382` (`router.get('/tools')`),
mounted at `demo_api_server/server.js:1190` (`app.use('/api/mcp/inspector', …)`).

**What's wrong:** neither the route nor the mount carries auth middleware.
Measured against the running stack:

```
curl -sk -o /dev/null -w "%{http_code}" https://api.ping.demo:3001/api/mcp/inspector/tools
200          # no cookie at all
```

The full MCP tool inventory is readable by anyone who can reach the API host.
That may well be intended for a demo — but nothing states it, and the UI
actively implied the opposite by filing "MCP Tools" under `ACTION_GROUPS.admin`,
where the whole group is stripped for non-admins. So the control read as
admin-gated while the data was public, and #1978 opened the UI on the grounds
that it was hiding something already reachable.

The risk is the inverse of the usual one: a reviewer looking at the UI
concludes access is restricted and does not check the endpoint. If the tool
inventory should in fact be restricted, the fix is on the server and the UI
grouping was never protection.

**Why not fixed now:** #1978 was a role-visibility change. Adding auth to a
route that many surfaces already call unauthenticated is a behavioural change
needing its own blast-radius check, and this is a demo where a readable tool
list is plausibly deliberate.

**What the real fix looks like:** decide explicitly, then make the code say so.
Either add the middleware and let the UI grouping mean what it looks like, or
leave it open and note on the route that it is intentionally public so the next
reader does not infer protection from the chip's placement. Generally: UI
grouping is not an authorization boundary and should not be read as one.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-batch2-0818`) — decided, not
gated.**

*The decision:* leave the endpoint open. It is a demo whose point is showing the
tool surface, several callers already reach it without a session, and adding
middleware to a route that many surfaces call unauthenticated is a behavioural
change with no security benefit here — the inventory is names and JSON schemas,
no execution and no account data.

*What the issue really was:* not the openness. It was that **nothing said so**,
while the UI actively implied the opposite by filing "MCP Tools" under
`ACTION_GROUPS.admin`, where the whole group is stripped for non-admins. The
control read as admin-gated while the data was public, so a reviewer who checks
the chip's placement and stops there draws exactly the wrong conclusion. That is
the inverse of the usual risk: the danger is a review that *does not happen*.

*What the fix was:* `demo_api_server/routes/mcpInspector.js` — the `/tools` route
now carries an explicit `INTENTIONALLY UNAUTHENTICATED` block recording the
measured behaviour (200 with no cookie and no bearer), why it is deliberate, and
the general rule this case exists to teach: **UI grouping is not an authorization
boundary and must never be read as one.** If the inventory should ever be
restricted, the middleware goes on the route, not in the menu.

### [ ] 2026-08-18 — Flag arming needs admin, but the steps that need flags are run by any role

**Where:** `demo_api_ui/src/components/AIAgent.js` `ensureRequiredDemoFlags`,
against the admin-gated `PATCH /api/admin/feature-flags`.

**What's wrong:** most demo steps declare required flags — every step with a
`primaryTool` needs `ff_mcp_gateway_pinggateway`, A2A steps also need
`ff_a2a_delegation`. Arming them is an admin-only write. A presenter signed in
as a customer therefore cannot arm anything, and before #1970 the 403 was
swallowed: the flag stayed off and the step quietly misbehaved with nothing
said.

#1970 made the failure visible (check flag state, name the flags that are
actually off, skip the doomed write) but did not close the gap — a customer
still cannot run a flag-gated step correctly without someone else flipping the
flag. It presents as a working demo giving subtly wrong output, which is the
worst failure mode for a demo.

Currently masked: both flags are ON in env `01d89b06`, so nothing misbehaves
today. It bites the first time a flag is off.

**Why not fixed now:** the fix is a product decision, not a bug fix — either
demo flags stop being admin-gated, or steps stop depending on runtime arming.
Both are larger than the visibility fix that surfaced the gap.

**What the real fix looks like:** most likely a separate presenter-scoped
endpoint for demo-flag arming that does not require full admin, or seeding the
demo flags ON at provisioning so no runtime arming is needed. Failing either,
the step catalog should refuse to offer a flag-gated step to a role that cannot
arm it, rather than running it degraded.

### [ ] 2026-08-18 — `renderActionGroups()` never mounted on `/dashboard` for either role

**Where:** `demo_api_ui/src/components/AIAgent.js:10866` —
`{isLoggedIn && renderActionGroups()}`.

**What's wrong:** with a live session on `/dashboard`, `document.querySelectorAll('.ba-action-group')`
returned **0** for a customer and 0 for an admin on the banking vertical, while
`isLoggedIn` was true. The action chips (`account`, `transaction`, `ai`,
`testing`, `attacks`, and `admin` for admins) render nowhere on that surface, so
some enclosing container is not mounting.

Not established: whether that is correct-by-design (these chips may be intended
only for a surface not exercised here) or a real regression. What is certain is
that it cannot be determined from the call site — the condition there is just
`isLoggedIn`, and the gating actually lives in an ancestor.

Consequence already paid: #1978 changed which roles are offered "MCP Tools" and
merged on unit evidence alone, because the rendered chip could not be located in
the running app to confirm placement.

**Why not fixed now:** it needs a decision about intended surface before any
code change, and #1978 was a role-visibility fix that had no business also
relocating a UI region.

**What the real fix looks like:** establish which surfaces are meant to show
action groups. If `/dashboard` is one, find the ancestor that is not mounting
and fix it. If it is not, move the condition to the call site so it reads
`{isLoggedIn && surfaceShowsActions && renderActionGroups()}` — the current form
claims the only requirement is a session, which is false and cost a
verification.

### [ ] 2026-08-18 — Two dispatch paths converge on the resume state but leave through different send functions

**Where:** `demo_api_ui/src/components/AIAgent.js` — `nlResumeAfterAuth` is set
from at least three places (the OAuth-return effect, the launcher deep-link
mount effect, `handleDemoStepSelect`), and the queued value then leaves through
`sendAgentMessage` on the resume effect's path or through `sendAsNl` /
the AG-UI run on others.

**What's wrong:** there is no single point that observes every resume send. A
typed guest question and an `agent-demo-step-select` demo step both queue into
the same state and both call themselves "the resume", but they exit through
different functions hitting different endpoints. Nothing in the code signals
that, so an instrument placed on one path reads as a measurement of the resume
mechanism as a whole.

This is not hypothetical — it cost a full debugging cycle on 2026-08-18. Two
sessions measured the same feature and got contradictory numbers, and both were
right: a probe at the `sendAgentMessage` line reported `resumeSends: 0` while a
probe at the storage/fetch boundary saw a send go out at t=3412ms. The
disagreement was read as a defect for a while before it was recognised as two
narrow instruments on two different paths.

The sharper consequence is diagnostic. #1981 gates the replay on
`effectiveVerticalId` with no timeout or fallback, so a surface where the
manifest never resolves drops the queued question **silently**. From outside the
component that is indistinguishable from a false zero on one path — same
symptom, no fetch, no error. The next person debugging a lost question starts
from an ambiguous signal and cannot disambiguate it without an in-component
probe.

**Why not fixed now:** the fix that found this (#1985, the ref-held claim) is
one line of state plumbing on a `REGRESSION_PLAN` §1 surface, landing beside a
second fix (#1981) from another session. Adding a dispatch-path refactor to
that would have made a two-half coordinated change into a three-way one, with
the paired live validation still outstanding.

**What the real fix looks like:** one instrumentation and dispatch point
downstream of the convergence, that every resume send passes through regardless
of which dispatcher queued it — so `resumeSends` means what its name says, and
a silent drop is distinguishable from a path the instrument does not watch.
Failing that, at minimum name the paths distinctly in code so nobody reads one
as the whole.

### [ ] 2026-08-17 — Every migrated vertical now has two seed stores and nothing keeps them agreeing

**SEED-FILE HALF RESOLVED 2026-08-18 (branch `worktree-seed-single-source`) —
entry stays OPEN for runtime write-divergence.** The resource-server seeds are
now DERIVED from the BFF seeds: `demo_mcp_resource_server/scripts/gen-seeds-from-bff.mjs`
(`npm run seeds:gen`) writes each `seed/<v>.seed.json` as a pure extraction of
the migrated entity from `config/verticals/<v>/seed.json`, and
`tests/seedParity.test.ts` was upgraded from id-match to **full-record deep
equality**, failing with a pointer at the generator. The case list lives once in
`seed/parity-cases.json`, shared by both. Proven live: the deep gate immediately
caught real drift the id-only guard had passed — abercrombie's resource seed had
silently lost `sku`/`size`/`color` (regenerated; its SQLite schema projects 5
columns at ingest, so tool output is unchanged — the served shape is decided in
the db module, not by seed truncation). What remains open is exactly the deeper
half already scoped below: a BFF-side write is invisible to the SQLite copy
regardless of seed agreement — the real fix is still finishing the migration.
Original entry follows.

**INTERIM GUARD ADDED 2026-08-18 (PR #2072) — entry stays OPEN for the real fix.**
`demo_mcp_resource_server/tests/seedParity.test.ts` now asserts the migrated
entity's record ids match between the two seed files for all 8 verticals that keep a
comparable `seed.json` on both sides (retail/sporting-goods/abercrombie-fitch/
government/healthcare/manufacturing/university/workforce; banking and airlines are
documented exclusions with no parallel BFF `seed.json`). Investigation finding: the
ids ALREADY match today — the size gap the entry cites is because the BFF seed
carries many *other* entity types (rewards, wishlist, returns…), not because the
migrated set diverges — so this is a green tripwire for the *next* one-sided seed
edit, not a red gate. It catches **seed-file** divergence only; it does NOT close the
deeper **runtime write-divergence** (a BFF-side cancel is invisible to the resource
server's SQLite copy regardless of seed agreement) that the real fix — finish the
migration, or generate both seeds from one source — must address. Seeds were not
rewritten. Original entry follows.

**Where:** `demo_mcp_resource_server/seed/*.seed.json` (10 files) and
`demo_api_server/config/verticals/<vertical>/seed.json` (+ `data.js`), read
through `demo_mcp_resource_server/src/db/<vertical>Db.ts` and the BFF's own
store respectively.

**What's wrong:** the SQLite migration moved exactly one or two READ tools per
vertical onto `demo_mcp_resource_server` (list + get). Every write action and
every other read still runs against the BFF's seed store. So one vertical now
answers "show my orders" out of `retail.db` and "cancel my order" out of
`config/verticals/retail/seed.json`, from two independently maintained seed
files that were never derived from each other — `retail.seed.json` is 1.0K next
to the BFF's 7.9K. A cancel applied on the BFF side is invisible to the next
list; the demo shows a cancelled order as still open, and no test or gate
notices because each half is internally consistent. It only reads as correct
because the demo scripts happen to exercise the two halves in an order where
the divergence does not show.

**Why not fixed now:** the migration was deliberately scoped to the read path
per vertical (PRs #1913, #1914, #1916, #1918) and shipping it that way was the
right call — the alternative was moving all 8 verticals' write surfaces in one
sweep. The split is the cost of that decision, not an accident.

**What the real fix looks like:** either finish the migration (writes move to
the resource server, the BFF store becomes a client of it) or generate both
seeds from one checked-in source so the two halves cannot describe different
worlds. Interim guard worth having regardless: a test that loads both seeds for
a vertical and asserts the record ids match — divergence is currently invisible
until someone demos the wrong combination of chips. `abercrombie-fitch.mock.json`
still sits in the resource server's seed directory next to the real
`abercrombie.seed.json` it replaced (#1918) — an artifact of the same split.

### [x] 2026-08-17 — Unrouted resource-server tools declare scopes that exist nowhere, and nothing checks

**GATED 2026-08-17.** `scripts/check-tool-scope-registration.js` now fails the
build on any `requiredScopes` string that is not a scope or alias in
`scope-topology.json` (`npm run topology:verify` step 10/10). The 8 known-bad
declarations are listed in `UNROUTED_UNREGISTERED` and exempted ONLY while
nothing routes them — the checker greps `demo_mcp_gateway/src/router.ts` and
fails the moment one is named there, which is precisely the "route it and it
403s" trap. A stale entry (allowlisted tool no longer declared anywhere) also
fails, so the exemption list cannot outlive what it excuses. The 8 declarations
themselves are UNCHANGED and still wrong — that part is deliberately not fixed;
see below. Original entry follows.

**Where:** `demo_mcp_resource_server/src/tools/*Tools.ts` — `healthcare:read`
(`get_patient_record`), `government:read` (`get_permit`), `anf:read`
(`get_anf_order`), `banking:read`, and the rest of each vertical's second tool.

**What's wrong:** those strings are not scopes. `grep` them in
`scope-topology.json` and every one returns zero hits — only `airlines:read` was
ever registered. They survive because `router.ts` deliberately routes just the
one migrated tool per vertical, so the tool carrying the invented scope is never
reached. The moment anyone routes it — the obvious next step, and the exact
motion the last four PRs performed — the call 403s on a scope the platform has
never heard of. That is how the whole migration started: every vertical's
`requiredScopes` was an invented `<vertical>:read`, and the fix in each case was
to replace it with the plain `read` that `scope-topology.json` already declared
for that tool. The unrouted half was left holding the original bug.

**Why not fixed now:** each PR corrected the scope on the tool it routed and
left the others untouched, which kept the diffs honest and reviewable. The
generalisation — every declared scope must resolve — was never the change in
front of anyone.

**What the real fix looks like:** a check in `npm run topology:verify` that
walks every `requiredScopes` entry in `demo_mcp_resource_server/src/tools/` and
fails on any string that is not a scope in `scope-topology.json`. It is a dozen
lines, it would have caught this class before the first vertical shipped, and it
turns "route the second tool" from a live-403 discovery into a build failure.

**What is still open after the gate:** the 8 declarations are still wrong, just
now enforced. Collapsing them to the plain `read` their routed siblings use was
considered and rejected: `read` is carried by every session, and these are
single-record lookups (`get_patient_record`, `get_banking_account`), so that
would quietly turn "unreachable" into "readable by anyone" the day someone
routes one. Neither is the SoT-registration path free — unlike the migrated
tools, these have no `tools.<name>` entry in `scope-topology.json` either, so
there is nothing to match against; giving them real least-privilege scopes means
adding both the tool and the scope to the SoT and provisioning them in PingOne,
which mutates a live environment. That decision belongs to whoever actually
needs one of these tools routed, and the gate now forces them to make it.

**RESOLVED 2026-08-18 by PR #1988** (`feat(topology): fail the build on tool
scopes that exist nowhere`) — verified. `scripts/topology-verify.sh:96` runs
`node scripts/check-tool-scope-registration.js || fail=1`, so the check is a build
gate rather than an advisory script, and `npm run topology:verify` is the entry
point the root `CLAUDE.md` already tells you to run for cross-service changes.

### [x] 2026-08-17 — A guessed authorization outcome is indistinguishable from a real one in the ledger

**FIXED 2026-08-18 (PR #2068, merged + deployed) — primary gap only.** The hop now
carries provenance: `transaction-hop.groovy` stamps `source: 'trail'` when the
outcome came from the parsed `X-Gw-Audit-Trail` and `source: 'inferred'` when it fell
back to the status code (fail-open fallback preserved; the `outcome`/`by`/`reason`
shape is unchanged so downstream consumers keep working). `TransactionTracePage.jsx`
renders an amber "inferred" tag only when `decision.source === 'inferred'`, so a
guessed PERMIT visibly reads as a guess; authoritative and no-provenance hops render
as before. Used `source` (not `authoritative`, which §4 already overloads for
"gateway-as-PDP"). Groovy was verified by reading (no in-repo Groovy harness); 2 UI
tests cover the tag. **Still open (deliberately out of scope):** the two secondary
gaps this entry notes — dropped PDP statement/obligation detail, and folding the
decision into the transport hop rather than a separate `authz.decision` hop.
Original entry follows.

**Where:** `ping-gateway/scripts/groovy/transaction-hop.groovy` (~line 71,
`if (!outcome) outcome = (statusCode >= 400) ? 'DENY' : 'PERMIT'`), reading the
`X-Gw-Audit-Trail` header that `p1az-decision.groovy` stamps.

**What's wrong:** the hop emitter prefers the authoritative decision off the
audit trail — correctly, because a JSON-RPC error rides a 200 envelope and
status alone cannot tell a policy DENY from a successful call. But when the
trail is absent or unparseable the `catch` falls through silently and the
outcome is INFERRED from the status code, and the emitted hop records that guess
in the same `decision.outcome` field, with the same `by: 'ping-gateway'`
attribution, as a real PDP verdict. Nothing in the payload marks it as inferred.
So `/transaction-trace` can display a confident `PERMIT` for a request whose
policy decision was never read — which is the one thing an authorization trace
exists to rule out. The fallback is right to exist (fail-open is correct for an
observability surface); recording it as indistinguishable from the real thing is
not.

Two smaller gaps in the same hop: the PDP's own detail — statements/obligations,
policy id, evaluation latency — is dropped, only `outcome`/`reason`/`op`
survive; and because the decision is folded into the transport hop rather than
carried as its own, a trace cannot separate "IG enforced this" from "PingOne
Authorize decided this."

**Why not fixed now:** the instrumentation is recent and deliberately fail-open,
and this is a fidelity question about what the ledger records rather than a
break in it. It was found while checking a stale claim that the boundary was
uninstrumented at all — it is not.

**What the real fix looks like:** carry the provenance, not just the value —
add a `source: 'trail' | 'inferred'` (or `authoritative: false`) to the emitted
`decision` object and surface it in the trace UI, so a guessed outcome reads as
a guess. Then, if the PDP detail is wanted, emit a distinct `authz.decision` hop
from the same trail data rather than a second emitter in the decision script,
which would duplicate the telemetry that already flows.

### [ ] 2026-08-17 — The P1AZ snapshot generator still pins 7 object versions by hand, and nothing rejects a new one

**Where:** `snapshots/gen-authorize-snapshot.js` — `ver()` derives a version
from content for the attribute/condition/statement/rule builders, but 7 objects
still carry literal `version: 'aaaaaaaa-00NN-…'` strings (the RAR set at ~959-1004,
`mcpStepUp` at 674, `txConsent` at 690/706).

**What's wrong:** PingOne skips any import object whose version is unchanged, so
a pinned version on an object whose CONTENT is generated from
`scope-topology.json` makes the import a silent no-op — the file imports
"successfully" and the cloud keeps the old policy. That is exactly what happened
twice: `AdminRoleOnWriteTool` (#1311) and `HasValidActorChain` (#1897), the
second one costing a live `verify:a2a-policy` failure that read as a policy bug.
PR #1905 converted 7 more objects to `ver()`, but the distinction that matters —
"this object's content is static, so a literal is safe" versus "this object
mutates from a source of truth, so a literal is a bug" — exists only in whoever
is editing the file's head. Nothing in the generator, the tests, or `--check`
tells the two apart.

**Why not fixed now:** #1897 and #1905 fixed the objects that were already
demonstrably wrong. Deciding the general rule means auditing all 7 remaining
literals to confirm each is genuinely static, which was not the change that
found the trap.

**What the real fix looks like:** make `ver()` the only way to produce a version
— every object derives from its own content, static ones included, at which
point a literal in this file is a lint failure rather than a judgement call.
Cheaper interim: a test asserting no `version: '` literal appears in the
generator, with an explicit allowlist for any object deliberately frozen, so
adding one is a deliberate act with a comment attached.

### [x] 2026-08-17 — `abercrombie-fitch` carries render descriptors for tools its own allowlist excludes

**Where:** `demo_api_server/config/verticals/abercrombie-fitch/index.js`
(`ALLOWED_TOOL_NAMES`, filtering the tools it borrows from
`../retail/tools`) versus the descriptors in its `manifest.json`.

**What's wrong:** A&F builds its tool set from retail's and filters it through a
name allowlist, but the manifest kept descriptors for tools the filter removes —
the 2026-08-17 render-descriptor audit counted 4 orphans. They are inert today,
which is the problem: a descriptor pointing at a tool that cannot be called is
indistinguishable, by reading the manifest, from one that is load-bearing, and
the audit that found the real descriptor bugs (#1898, #1901, #1903) had to check
each by hand to tell them apart.

**Why not fixed now:** cosmetic — no user-visible symptom, and it was found
during an audit whose scope was descriptors that actually break rendering.

**What the real fix looks like:** drop the orphans, and add the inverse
assertion to the manifest-schema suite that already validates descriptors: every
descriptor must name a tool the vertical actually exposes. The suite currently
checks descriptor shape, not descriptor reachability, which is why a borrowed-
and-filtered tool set can accumulate these unnoticed.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-batch2-0818`).**

*What the issue really was:* the orphan count was right — 4, confirmed by loading
every vertical and diffing `manifest.render` against the tools it actually
exposes: `view_subscriptions`, `pause_subscription`, `view_price_alerts`,
`remove_price_alert`. All four are retail tools that `ALLOWED_TOOL_NAMES` filters
out of A&F.

**But the entry's proposed assertion was wrong, and writing it as stated would
have broken the build.** "Every descriptor must name a tool the vertical actually
exposes" is false in this repo — a descriptor key is reached three ways, and the
audit found live examples of all three:

1. it names an exposed tool (the common case);
2. a handler returns it explicitly — `return { result, render: 'portfolio_value' }`
   — which is how `investment` reaches `portfolio_value`, `trades`,
   `dividend_summary` and how `oauth-teaching` reaches `token_pair`;
3. a **service-level** map names it for a tool no vertical lists — today
   `A2A_TOOL_RENDER = { get_portfolio_summary: 'portfolio_summary' }` in
   `services/demoAgentLangGraphService.js`, the only reason `investment`'s
   `portfolio_summary` is live.

Applied naively, the entry's rule flags 6 healthy descriptors across two
verticals. The guard would have been reverted on its first red build and the
lesson lost with it.

*What the fix was:*

- Dropped the 4 orphan descriptors from
  `demo_api_server/config/verticals/abercrombie-fitch/manifest.json`.
- Added `demo_api_server/src/__tests__/verticalRenderReachability.test.js`,
  which encodes all three reachability sources and runs per-vertical. Across all
  14 verticals with a `render` block it now reports zero orphans.

One subtlety the test comments call out: source (2) is scanned **per-vertical,
not through borrowed modules**. `retail/tools.js` does contain
`render: 'pause_subscription'`, but that branch belongs to a tool A&F's allowlist
removes — counting it would mark the exact orphans this test exists to catch as
reachable.

*Verified the guard bites:* injecting a `zz_orphan_probe` descriptor into the A&F
manifest fails the suite with `Received + "zz_orphan_probe"`. A guard nobody has
watched fail is not a guard.

### [ ] 2026-08-17 — Only the invest resource server has an audience no-drift gate; every other audience is still trust-by-convention

**Where:** `scripts/check-resource-server-audience-drift.js` (`npm run
topology:verify` step 9/9), which derives one canonical URI from
`scope-topology.json resources["Super Banking MCP Invest"].uri` and diffs the
handful of surfaces that set `MCP_RESOURCE_SERVER_RESOURCE_URI`.

**What's wrong:** `scope-topology.json` is the source of truth for *every*
audience in the chain — banking MCP server, MCP gateway, PingGateway, the A2A
and privilege resources — but only one of them is gated. The gate was written
to close the specific collision that produced `Audience mismatch: got
[mcp-invest.ping.demo], expected one of [mcpserver.ping.demo,
mcpgateway.ping.demo]` across all 7 airline and 4 invest tools, and it is shaped
around that one variable name and that one resource entry. Any other audience
can still drift between `scope-topology.json`, compose, `k8s/02-configmap.yaml`,
the Helm templates and `refresh-service-envs.js` without a check firing. The
failure mode is the same every time and it is invisible until a tool call fails
at runtime in one vertical: checked-in config reads correct, only the running
env is wrong.

**Why not fixed now:** the audience fix that found it was scoped to the invest
server. Generalising means deciding what the canonical mapping from a
`scope-topology.json` resource to an env var on a given surface actually is —
today that relationship is implicit and one-off per service.

**What the real fix looks like:** declare the resource-to-env-var binding in
`scope-topology.json` itself (each resource names the var and the surfaces that
must carry it), then rewrite the step-9 checker to iterate that table instead of
hard-coding `OWN_VAR` / `TOPOLOGY_RESOURCE`. One gate, every audience, and a new
resource is covered the day it is added rather than the day it breaks a demo.

### [ ] 2026-08-17 — Nothing fails a build when a P1AZ request omits an attribute the policy requires

**Where:** `demo_api_server/scripts/verifyA2aDelegationPolicy.js` and
`scripts/verifyAuthorizeCloudParity.js` (both live-only, neither in CI);
`demo_api_server/tests/pingOneAuthorizeIndeterminate.test.js`.

**What's wrong:** live PingOne Authorize returns `INDETERMINATE` only when the
request or the policy is wrong — a missing or null attribute the Trust Framework
references, a failed attribute fetch, a malformed payload, or an unenforceable
obligation. It is never a legitimate outcome for this demo, so it should be
impossible to ship a caller that provokes it. Today nothing prevents it: the
probes learned to send `Amount: 0` / `TransactionAmount: '0'` only after
`verify:a2a-policy` started evaluating INDETERMINATE against a shape the real PEP
never sends, and any new caller can omit the same attribute the same way. The
existing unit test asserts the enforcement behaviour once INDETERMINATE comes
back; it does not assert that we never ask a question that produces one. The live
verifiers that would catch it run by hand against a real environment.

**Why not fixed now:** the fix that found this was a two-line probe-parameter
change. A real guard needs a shared definition of the request contract, and the
policy half of that contract lives in a PingOne snapshot that is imported through
the console — `snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json`
already carries all 11 actor ids, but `verify:a2a-policy` still FAILs airlines and
admin depth-2 with `mcp-invalid-actor` until someone re-imports it, and nothing in
the repo can tell that the live environment has diverged.

**What the real fix looks like:** extract the attribute set the Trust Framework
requires into one checked-in contract (derivable from the snapshot), have every
decision caller — PEP, both verifiers, tests — build its request from it, and add
an offline test that a caller omitting a required attribute fails at build time
rather than at evaluation time. Pair it with a snapshot-parity check so
"policy in the console is older than policy in the repo" is a reported condition
instead of a residual note in `REGRESSION_PLAN.md`.

### [x] 2026-08-17 — `DashboardTokenRail` persists its own default on mount, so every default flip costs a storage-key bump

**Where:** `demo_api_ui/src/components/DashboardTokenRail.jsx` (~line 49, the
`useEffect(() => persistTokenRailCollapsed(collapsed), [collapsed])`), reading
`demo_api_ui/src/utils/tokenRailLayout.js` `readStoredTokenRailCollapsed()`.

**What's wrong:** the effect fires on first render, so the value the component
merely *defaulted* to is written to `localStorage` as though the user had chosen
it. From then on the stored value shadows the default forever. That is why
flipping the Live Pipeline rail to collapsed-by-default could not be done by
changing the default alone — every existing browser already had the old default
persisted — and why the key had to be bumped to `ud_token_rail_collapsed_v2`. The
same trap is now armed for the next flip, and the width effect above it has the
identical shape. `REGRESSION_PLAN.md` §0 records the workaround ("bump the key
again if the default ever changes") rather than the cause.

**Why not fixed now:** the change that found it was a default flip under a
locked-UI area, and correcting the persistence semantics would have altered
behaviour beyond the flip.

**What the real fix looks like:** persist only on user action — write inside the
collapse toggle handler and the resize handler — and let an absent key keep
meaning "no preference". Then a default is genuinely a default: changing it
reaches every browser that never touched the control, and the key never needs
another version suffix. Guarded by asserting that mounting the rail writes
nothing to `localStorage`.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-small-batch-0818`).**

*What the issue really was:* as described — `useEffect` runs after the first
render, so an effect whose only job is "persist this state" cannot tell a value
the user chose from a value the component defaulted to. It writes both. The cost
is not the write; it is that from that moment the stored value **shadows the
default forever**, which makes changing a default unreachable for every browser
that ever loaded the page. `ud_token_rail_collapsed_v2` is the scar from the first
time that bill came due, and the width effect one line above had the identical
shape with the same bill waiting.

*What the fix was:* `demo_api_ui/src/components/DashboardTokenRail.jsx` —
persistence moved out of the effects and into the user actions.

- The remaining `useEffect` reflects `collapsed`/`width` into the
  `--ud-token-rail-width` CSS var only. No storage writes.
- `persistTokenRailCollapsed()` moved into `handleToggle`, which computes `next`
  from `collapsed` and depends on it — rather than writing from inside the
  `setCollapsed` updater, which StrictMode may double-invoke.
- `persistTokenRailWidth()` moved into the drag's `onUp`, with the in-flight width
  held in a `dragWidth` ref so mouseup sees the final value. One write per drag
  instead of one per mousemove.
- `utils/tokenRailLayout.js` untouched — the key stays `ud_token_rail_collapsed_v2`
  and an unset key still reads as collapsed.

*What is now true that was not:* an absent key means "no preference", so the next
default flip reaches every browser that never touched the control, and the key
never needs another version suffix. `REGRESSION_PLAN.md` §1 recorded the
workaround ("bump the key again if the default ever changes") as if it were the
rule; that row now records the cause and the guard instead.

*Guarded by* two new cases in `components/__tests__/DashboardTokenRail.test.jsx`:
mounting writes neither key, and mounting does not overwrite an existing stored
preference. Both assert through `localStorage.getItem` — deliberately **not** a
spy, per the Node 22 CI / Node 26 local storage-spy trap.

### [ ] 2026-08-17 — `demo_agent_service` tests import `demo_api_server`'s vault across the package boundary

**Where:** `demo_agent_service/tests/vault.test.ts` requires
`../demo_api_server/lib/vault/index.js`, which requires `argon2`.

**What's wrong:** the suite depends on a sibling package's internals AND on that
sibling's `node_modules`. `argon2` appears in `demo_api_server/package.json`, not
in `demo_agent_service`'s, so the test only passes where the sibling happens to
be installed. That is true on any developer machine and false on a clean runner —
which is exactly how it surfaced: wiring the suite into CI for the first time
produced `125 passed, 1 suite failed to load`, with zero failing assertions.

**Why not fixed now:** the CI job installs `demo_api_server`'s deps before
running this suite, which is the smallest change that makes the job honest. The
real repair is a decision about the boundary, not a build tweak, and it was not
the change that found it.

**What the real fix looks like:** either extract the vault into something both
packages depend on explicitly (a workspace package with its own `argon2`
dependency), or move the test to `demo_api_server`, where the code and its
dependency already live. Whichever way, `demo_agent_service` should stop
reaching into a sibling's `lib/` — a require path with `../` crossing a package
root is the smell, and it will keep producing environment-dependent green.

**STILL OPEN — but both fixes this entry proposes are wrong. Re-scoped
2026-08-18 (branch `worktree-techdebt-batch2-0818`) after auditing the code.**

*Why "move the test to `demo_api_server`" is wrong:* `vault.test.ts` tests
`demo_agent_service`'s OWN loader — `loadVaultIntoEnv` from `../src/vault`, whose
one behavioural delta from the gateway's copy is the `AGENT_` allowlist prefix.
It only reaches across the boundary to *build the fixture vault* it then loads.
Moving it would put a test of `demo_agent_service` code in another package.

*Why "extract to a workspace package" is bigger than it looks:* the crossing is
**deliberate at runtime**, not just in tests. `demo_agent_service/src/vault.ts:42`
sets `VAULT_LIB_PATH = '../../demo_api_server/lib/vault'` and requires it on
purpose, and `tests/vault.libUnavailable.test.ts` exists specifically to assert
the behaviour when that sibling is **absent** — which is the normal case in the
agent-service image, where `demo_api_server` is never shipped. Extracting the
vault would change that runtime contract and the container layout that depends
on it, not just a `require` path.

*What is actually true today:* `.github/workflows/ci.yml` installs the sibling's
deps (`npm install --prefix demo_api_server`) before the suite, with a comment
pointing here. That works and is honest about why it exists. The residual cost is
one full package install on a job that otherwise needs none.

*Real fix, restated:* pick one deliberately — (a) publish the vault as a workspace
package that BOTH services depend on explicitly, and update the image layout and
`vault.libUnavailable.test.ts`'s premise with it; or (b) give
`demo_agent_service` its own test-only fixture builder so the suite stops needing
the sibling's `argon2` at all, leaving `src/vault.ts`'s deliberate runtime
crossing as the only one. (b) is much the smaller change and removes the CI
install; it costs a second implementation of the vault write path used only by
tests.

### [ ] 2026-08-17 — `PG_GATEWAY_RESOURCE_ID` is both the token audience and the advertised RFC 9728 metadata URL

**Where:** `ping-gateway/.env` (`PG_GATEWAY_RESOURCE_ID=https://api.ping.demo:3036/mcp`),
consumed as `resourceId` by `ping-gateway/config/routes/01-mcp-olb.json` (and the
`/apikey`, `/invest` variants), and checked as `aud` by
`ping-gateway/scripts/groovy/p1az-decision.groovy` (~line 789) and
`jwks-token-validation.groovy`.

**What's wrong:** one value carries two unrelated contracts. As an OAuth audience
it only has to be a stable opaque identifier every party agrees on. As the input
IG's `McpProtectionFilter` derives its RFC 9728 `resource_metadata` URL from, it
has to be a URL that actually serves a metadata document. Nothing enforces the
second property, and for months it did not hold: the identifier said `https` on
port 3036 while the listener there was plaintext, so every `WWW-Authenticate`
challenge pointed clients at a URL that failed the TLS handshake from the host
and from inside the compose network alike. Discovery was unreachable and nothing
reported it, because the audience half kept working perfectly.

**Why not fixed now:** the obvious repair — point the metadata URL at something
reachable — is unavailable, because changing `PG_GATEWAY_RESOURCE_ID` changes the
audience every token in the chain is minted against (`MCP_GW_RESOURCE_URI` in
`docker-compose.yml` lists it, PingOne resources are provisioned with it,
`scope-topology.json` records it as `pingGatewayResourceUri`). PR #1938 therefore
moved the LISTENER to match the identifier instead — IG now serves TLS on 8443,
published as host 3036 — which makes the advertisement true today but leaves the
coupling in place. The Node gateway does not share the problem: `selfBaseUrl.ts`
derives its pointer from the request authority, so its challenge is always
reachable by construction.

**What the real fix looks like:** separate the two roles. Give IG a distinct
`PG_GATEWAY_METADATA_BASE` (defaulting to the request authority, as the Node
gateway already does) used only to build the `resource_metadata` URL, leaving
`PG_GATEWAY_RESOURCE_ID` purely an audience string that never has to be
dereferenceable. That requires either an IG config knob for the filter's metadata
base or moving the challenge out of the built-in `McpProtectionFilter` into the
Groovy that already builds one (`jwks-token-validation.groovy`'s `deny()`), which
is why it was not attempted alongside a TLS change. Until then, a regression test
worth having: assert that the URL in the gateway's `WWW-Authenticate` actually
returns 200 — the failure mode here was silent precisely because nobody followed
the pointer.

### [ ] 2026-08-17 — `davinciLogin.js`'s `/callback` has no ID-token nonce replay verification

**Where:** `demo_api_server/routes/davinciLogin.js` (`POST /callback`).

**What's wrong:** the route exchanges the DaVinci widget's authorization code and
reads the resulting ID token, but never checks it against a stored nonce the way
`routes/oauth.js`'s callback does (`idPayload.nonce !== expectedNonce`, ~line 266-276)
and `routes/oauthUser.js`'s does (`idTokenClaims.nonce !== expectedNonce`, ~line
459-467). Without that check the callback can't detect ID token replay.

**Why not fixed now:** both reference flows generate a nonce themselves and pass
it into `oauthService.generateAuthorizationUrl(..., nonce)` before redirecting to
PingOne, so the nonce round-trips through a redirect URL they control. This route's
flow start is entirely inside the `@forgerock/davinci-client` SDK
(`demo_api_ui/src/lib/davinciWidgetClient.js`'s `davinci({ config })` /
`client.start()`/`client.next()`) — checked the installed package's README and
`dist/src` for `nonce` support and found none, so there's no supported way to set
or retrieve one through the SDK today. Implementing this would mean either forking
the SDK's flow-start call or hand-building the DaVinci authorize request outside
it — both fragile enough to risk breaking the widget flow this fix round wasn't
scoped to touch.

**Real fix:** once the SDK exposes (or a DaVinci-orchestration-level workaround is
found for) a way to pass a nonce into the flow's authorize step and have it echo
back in the ID token, wire up the same pattern as `routes/oauth.js`: generate a
nonce before the widget starts, store it in `req.session`/PKCE cookie, and verify
`idPayload.nonce === expectedNonce` in the callback before establishing a session.

### [ ] 2026-08-17 — `davinciFlowClient._getApiToken()` is a placeholder, not a real token fetch

**Where:** `demo_api_server/services/davinciFlowClient.js` (`_getApiToken()`).

**What's wrong:** returns `` `${apiClientId}:${apiClientSecret}` `` and sends it
as a `Bearer` token to PingOne's orchestrate API. PingOne expects a real OAuth
access token (client_credentials grant) or `Basic base64(id:secret)` at the
token endpoint itself — a raw colon-joined pair as a bearer token will 401
against a live environment. Every consumer of `invokeFlow()` currently runs
against mocked HTTP in tests, so this has never been exercised live.

**Why not fixed now:** scoped out of the plan's Task 3 (`docs/superpowers/plans/2026-08-17-davinci-orchestration-showcase.md`)
on purpose — building a full client_credentials grant + token cache wasn't
needed to land the mockable client shape, and DaVinci console setup (that
plan's Task 1) hasn't happened yet, so there's no live environment to test
against regardless.

**Real fix:** implement a real client_credentials token fetch (mirror
`services/mfaService.js`'s `_getWorkerToken()` pattern) with expiry-aware
caching, before this client is ever pointed at a live PingOne environment.

### [x] 2026-08-16 — `MCP_SERVER_RESOURCE_URI` means two different things across services

**RESOLVED 2026-08-17.** `demo_mcp_resource_server` now reads
`MCP_RESOURCE_SERVER_RESOURCE_URI` (falling back to the old name so a container
or `.env` pinned before the rename keeps working, and logging a warning when it
does). Every surface that sets it — compose, `k8s/02-configmap.yaml`, the
privilege Helm template, `.env.example`, `refresh-service-envs.js` — carries the
invest list under the new name, and `npm run topology:verify` step 9/9
(`scripts/check-resource-server-audience-drift.js`) derives the canonical URI
from `scope-topology.json` and fails if any surface drifts or reverts to the
banking value. The defensive union in `resolveAcceptedAudiences()` stays as
belt-and-braces. Original entry below, kept for the reasoning.

**Where:** `demo_api_server/scripts/refresh-service-envs.js` (shared default
`'mcpserver.ping.demo,mcpgateway.ping.demo'` fanned out to every service env),
`demo_mcp_resource_server/src/index.ts` / `src/server/acceptedAudiences.ts`.

**What's wrong:** everywhere else `MCP_SERVER_RESOURCE_URI` is "the banking MCP
server's accepted-audience list", but inside demo_mcp_resource_server it means
"THIS server's accepted list". Only a per-service override in the env writer
keeps the invest server from inheriting the banking value; a container created
before the override (or a K8s pod on the shared configmap) rejected every
gateway exchange-#3 token with `Audience mismatch: got [mcp-invest.ping.demo]`.
Patched defensively: `resolveAcceptedAudiences()` now always unions the
server's own canonical audience, so a stale env can no longer break tool calls
— but the name collision remains.

**Why not fixed now:** renaming the env var touches compose, K8s manifests,
refresh-service-envs, and docs in one sweep — out of scope for the audience
fix.

**Real fix:** give the invest server its own env name (e.g.
`MCP_RESOURCE_SERVER_RESOURCE_URI`), source it from
`scope-topology.json resources["Super Banking MCP Invest"].uri`, and extend
`npm run topology:verify` to diff every surface that sets it (compose, K8s,
env writer) against the topology.

### [x] 2026-08-16 — Node MCP Gateway's HITL retry path never consumes the receipt

**RESOLVED 2026-08-17.** Both Node gateway retry sites — HTTP
(`middleware/authorizeMcpRequest.ts`) and WS (`index.ts`) — now call
`verifyAndConsumeHitlReceipt()`, which POSTs to the existing consuming
`POST /challenges/:id/verify` instead of `GET /challenges/:id` plus a local
re-implementation. The server runs the same binding checks
(`demo_hitl_service/src/receiptVerification.js` mirrors `verifyHitlReceipt`
message for message) and calls `store.consume()` on success, so a replayed
retry is rejected as `status: consumed`.

Neither of the two options sketched below was needed. `/verify` already existed
and already consumed — the gap was only that this gateway never called it — so
no new endpoint, no `?consume=true` flag, and none of the read-only
`GET /challenges/:id` pollers (`demo_api_server/services/hitlServiceClient.js`,
`demo_authz_server/routes/decision.js`) were touched. `verifyHitlReceipt` stays
exported and tested as the pure binding helper. Regression guard:
`demo_mcp_gateway/tests/hitlReceiptConsume.test.ts` asserts the gateway POSTs to
the consuming endpoint, never GETs, and that a second retry is rejected.
Original entry below, kept for the reasoning.

**Where:** `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts` (~L611-654,
the `_hitl_challenge_id` retry branch) and `demo_mcp_gateway/src/hitlClient.ts`
(`getHitlChallengeStatus` + `verifyHitlReceipt`).

**What's wrong:** BUGS.md #35 fixed HITL receipt replay by having
`demo_hitl_service`'s `POST /challenges/:id/verify` transition the challenge
to a terminal `consumed` status on its first successful call
(`demo_hitl_service/src/routes/challenges.js`, `store.consume()` in
`demo_hitl_service/src/store/challengeStore.js`). That closes the replay gap
for `ping-gateway/scripts/groovy/p1az-decision.groovy`, the only caller of
`/verify`. The Node MCP Gateway (`demo_mcp_gateway`) never calls `/verify` —
it calls `GET /challenges/:id` and re-implements the same binding checks
locally in `hitlClient.ts#verifyHitlReceipt`, with no call that mutates
challenge state. So a replayed retry against the same `_hitl_challenge_id`
through the Node gateway still succeeds every time until the 10-minute TTL,
identical to the bug BUGS.md #35 describes. Per `ping-gateway/README.md:32-34`,
`ff_mcp_gateway_pinggateway` **OFF (the default)** routes MCP traffic through
this unfixed Node gateway path — the fixed PingGateway/Groovy path is opt-in.

**Why not fixed now:** the task scoped the fix to `demo_hitl_service` only
(minimum diff, don't touch the two consumer services). Closing this gap
requires either (a) adding a consuming call from `hitlClient.ts` at its one
use site and a way for `demo_hitl_service`'s `GET /challenges/:id` to
distinguish that consuming read from the read-only polling done by
`demo_api_server/services/hitlServiceClient.js` (BFF dashboard) and
`demo_authz_server/routes/decision.js` (own PDP flow) — both of which also
call plain `GET /challenges/:id` and must not be treated as consuming — or
(b) a new dedicated consuming endpoint the Node gateway calls instead of GET.
Either touches 2-3 more services and needs its own regression pass; out of
scope for a targeted HITL-service fix in a protected area.

**Real fix:** give the Node gateway path a consuming step equivalent to
`/verify`'s, without breaking the other `GET /challenges/:id` pollers — e.g.
a `?consume=true` flag (or dedicated `POST /challenges/:id/consume`) that
only `hitlClient.ts`'s retry-time call sends, verified against a test that
replays the Node gateway's retry twice and asserts the second is rejected.

### [x] 2026-08-15 — mastra_agent: `req.on('close')` fires before the client actually disconnects

**Where:** `mastra_agent/src/runHandler.ts` — `req.on('close', () => abortController.abort())`.

**What's wrong:** Node's `IncomingMessage` is a Readable stream with
`autoDestroy` on, so it emits `'close'` once its own body has been fully
read — not when the underlying connection/client actually goes away. For a
small JSON POST body (this endpoint's whole payload), that happens almost
immediately after Express's body parser finishes, often before
`agent.stream()` even starts consuming `fullStream`. Confirmed live:
instrumenting the handler showed `abortController.signal.aborted` already
`true` by the time the `for await` loop began, in every request. Effect:
`tests/runHandler.test.ts`'s three streaming-event assertions (`RUN_FINISHED`,
`TEXT_MESSAGE_CONTENT`, `TOOL_CALL_START`/`END`) fail — the loop `break`s on
its first `abortController.signal.aborted` check before processing any part,
so `onRunEnd()` falls back to the "model didn't return a usable response"
error path. Reproduced identically on an unmodified `main` checkout (no code
change involved) via `cd mastra_agent && npx jest tests/runHandler.test.ts`,
so it predates and is unrelated to any recent change in this file.

**Why not fixed now:** found while fixing the missing `'tool-error'` branch
in the same file (BUGS.md #14) — a distinct, unrelated code path. The real
fix (switching the disconnect signal from `req` to `res`) touches request
lifecycle handling for every run, which is out of scope for a targeted
tool-error fix and risks the exact abort/stream-teardown behavior this repo
is careful about.

**Real fix:** listen on `res.on('close')` (or `res.on('finish')` paired with
a separate disconnect check) instead of `req.on('close')` — the response
stays open for the SSE duration, so its `'close'` reflects the actual
client/connection state rather than "the request body has been read." Needs
a scoped repro against a real (non-supertest) client to confirm the new
listener still aborts on a genuine client disconnect before landing.

**ALREADY RESOLVED — verified 2026-08-18. No code change needed; this entry was
stale.**

*What happened:* PR **#1975** (`fix(mastra): abort on res close, not req close —
req fires when the body lands`) landed the exact fix this entry specified.
`mastra_agent/src/runHandler.ts:46` now reads `res.on('close', () =>
abortController.abort())`, carrying a comment with the same diagnosis this entry
made.

*Confirmed, not assumed:* the full suite through the CI harness —
`bash scripts/test-service-suite.sh mastra-agent` → `36 passed, 0 failed, 36
total`; `tests/runHandler.test.ts` alone is green. Those are the three assertions
the entry named as failing.

*Bookkeeping note:* this block was supposed to land in PR #2004, whose body and
commit message both claim it. It did not — it was dropped when the annotation
script was rewritten mid-task, and only the accompanying `.github/workflows/ci.yml`
comment fix actually shipped. Recorded here rather than quietly patched, because
"the PR says it was annotated" is exactly the kind of second-hand claim this file
exists to stop people trusting.

### [x] 2026-08-12 — oauth-mcp encrypted-storage CBC mode has no integrity check

**Where:** `oauth-mcp/src/utils/encryption.ts` — uses `aes-256-cbc`.

**What's wrong:** CBC is unauthenticated. Decrypting with the wrong key
doesn't reliably fail — it produces garbage that happens to pass PKCS#7
padding validation roughly 1 run in 256, so `decipher.final()` succeeds and
returns corrupted plaintext instead of throwing. Surfaced as an
intermittent failure in `tests/utils/encryption.test.ts` ("should fail to
decrypt with wrong password") while reviewing an unrelated branch —
untouched by that branch's actual changes.

**Why not fixed now:** found while verifying oauth-mcp's DCR work
(`docs/superpowers/plans/2026-08-12-oauth-mcp-dcr.md`), which never touches
this file. A migration to an authenticated mode changes the on-disk/at-rest
ciphertext format, which is a real migration concern (existing encrypted
data, if any persists across restarts) — bigger than a drive-by fix
belongs in.

**Real fix:** migrate to `aes-256-gcm` (or another AEAD mode), which
fails deterministically — and cryptographically meaningfully — on a wrong
key/tampered ciphertext instead of a ~1-in-256 chance of silent corruption.
Needs a decision on migrating already-encrypted data vs. accepting a
one-time invalidation.

**RESOLVED — verified 2026-08-18.** `oauth-mcp/src/utils/encryption.ts` now
writes **AES-256-GCM** with a versioned layout —
`[0x01][salt(32)][iv(12)][authTag(16)][ciphertext]` — and `decrypt()` dispatches on
that version byte, keeping `_decryptCbc` as a **read-only** path for ciphertext
written before the change.

That also answers the migration question this entry flagged as the reason not to
fix it in passing: existing encrypted data is neither invalidated nor rewritten,
it is simply still readable, and every new write is authenticated. Wrong-key
decryption now fails deterministically on the auth tag instead of ~1-in-256
returning corrupted plaintext.

### [ ] 2026-08-12 — oauth-mcp DCR: two follow-ups from the final review

**Where:** `oauth-mcp/src/oauth/OAuthRouter.ts`, `oauth-mcp/src/oauth/TokenIssuer.ts`.

**What's wrong:**
1. `resolveOwnAudience()` (`TokenIssuer.ts`) takes the first entry of
   `MCP_SERVER_RESOURCE_URI` positionally to decide this AS's own audience.
   Every other resolver answering "what is MY resource URI" in this service
   (`lastHopAuthorization.ts`, `JwtClaimVerifier.ts`) instead prefers a
   dedicated `PINGONE_RESOURCE_MCP_SERVER_URI`-shaped var first, specifically
   so a stale/reordered `MCP_SERVER_RESOURCE_URI` can't silently shadow the
   real audience. Correct in every shipped config today (`mcpserver.ping.demo`
   is always first in `docker-compose.yml`/`k8s/02-configmap.yaml`), but the
   positional dependency is fragile if that list is ever reordered.
2. `POST /register`'s new `DCR_INITIAL_ACCESS_TOKEN` gate (added closing a
   Critical finding — unauthenticated DCR with unbounded scope) isn't wired
   into any deployment yet: not in `docker-compose.yml`'s `environment:`
   block, not in `k8s/02-configmap.yaml`. `/register` therefore 503s
   everywhere until an operator sets it, which is the safe default but means
   DCR is not actually reachable outside unit tests yet.

**Why not fixed now:** (1) is correct behavior today, just a fragility
worth naming, not a bug to chase without a live misconfiguration to fix
against. (2) is deployment/config wiring, not application code, and doing
it blind (no PingOne app exists yet for Part B's redirect-federation half
either — see the design spec's explicit "out of scope for this
implementation pass") risks wiring a secret nobody's ready to rotate.

**Real fix:** (1) switch `resolveOwnAudience()` to prefer a dedicated env
var (e.g. `PINGONE_RESOURCE_MCP_SERVER_URI`, matching sibling resolvers'
precedence) before falling back to `MCP_SERVER_RESOURCE_URI[0]`. (2) once
DCR is meant to be exercised for real, set `DCR_INITIAL_ACCESS_TOKEN` in
the deployment's env and document the value's provenance/rotation.

### [x] 2026-08-11 — gw-authorize fallback duplicated across two client consumers

**Where:** `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`
(around line 594) and `demo_api_ui/src/context/ProofOfEnforcementContext.js`
(`gwAuthorizeEvent()`).

**What's wrong:** on a gateway-authoritative run (`useGateway: true`), the BFF
skips its own Authorize gate — `mcpAuthorizeEvaluationThisRequest` stays a
skip-shaped object with no `.decision` (this is intentional, see Contract C4
comment at `mcpToolPipeline.js:456` — it's how a caller tells "BFF's gate
didn't run" apart from "it ran and permitted"). On PERMIT, the real decision
only ever arrives client-side as a `gw-authorize` token event
(`mcpToolPipeline.js:956-977`), never merged into `trace.authorize`.

This "authorize decision may only be visible as a `gw-authorize` event, not
`trace.authorize` / `body.authorize`" fact is independently reimplemented in
**four** places, not two:

1. `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js:594` — Token
   Chain rail (had it first).
2. `demo_api_ui/src/context/ProofOfEnforcementContext.js`
   (`gwAuthorizeEvent()`) — ProofStrip verdict, added in #1635 because
   nobody had touched it and it silently read "Run failed before
   authorize-decision" on a run that had, in fact, been permitted.
3. `demo_api_server/services/stepVerificationExpectations.js:341-345`
   (`hasAuthorize` in `scoreDelegatedAccessInvoke`) — server-side chip
   prerequisite scorer, same fallback, third independent implementation.
4. `demo_api_server/services/attackSimulatorService.js:295-316`
   (`_authorizeFromPipelineOutcome` → `_normalizeAuthorizeDecision`) — attack
   sim outcome scoring, fourth implementation. Well-documented (docstring at
   282-294 explains the two-source fallback explicitly) so less of a silent
   trap than #2, but still separate logic reimplementing the same fact.

**Why not fixed now:** the fix that found this (#1635) was scoped to the one
broken consumer (#2). Fixing the duplication means normalizing the fallback
in one place per side — client (`tokenChainTraceStore.js`, where
`trace.authorize` gets set, covers #1 and #2) and server (wherever
`stepVerificationExpectations.js` and `attackSimulatorService.js` could share
a helper, covers #3 and #4) — since #3 reads a raw HTTP response body, not
`trace.tokenEvents`, it can't share the client-side store fix directly.
Either normalization touches shared/cross-cutting code used by more than the
one reported bug — bigger surface than a bug fix warrants.

**Real fix:** two separate normalizations, not one:

- Client: merge `gw-authorize` into `trace.authorize` once during ingestion
  (`tokenChainTraceStore.js`), keeping BFF-native vs gateway-native
  provenance distinguishable (e.g. a `source: 'gw-authorize'` field, which
  `buildTraceSteps.js` already stamps) so nothing downstream loses the "who
  actually decided" signal Contract C4 cares about. Fixes #1 and #2.
- Server: extract the `gw-authorize`-token-event fallback shared by #3 and #4
  into one helper (`attackSimulatorService.js`'s `_normalizeAuthorizeDecision`
  is the closer-to-reusable of the two) so both consumers call it instead of
  hand-rolling the `seenIds.has('gw-authorize')` / `events.find(...)` check.

**Do not break:** whatever the fix, `mcpAuthorizeEvaluationThisRequest`
itself must stay skip-shaped on the BFF side for gateway-authoritative
requests — see `mcpToolPipeline.js:456`. Client-side normalization must not
try to make the server stop being honest about that.

**ALREADY RESOLVED — verified 2026-08-18. No code change needed; this entry was
stale.**

*What happened:* PR **#1795** (`refactor(trace): deduplicate gw-authorize fallback
across 4 call sites`) landed the split fix this entry specified, one helper per
side:

- **Server** — `demo_api_server/utils/gwAuthorizeUtils.js` exports
  `gwAuthorizeEventFrom(tokenEvents)`, now the single implementation behind
  `stepVerificationExpectations.js:345` (consumer #3) and
  `attackSimulatorService.js:315` (consumer #4).
- **Client** — `tokenChainTrace/tokenChainTraceStore.js` gained
  `_gwAuthorizeToAuthorize()` + `_syncGwAuthorize()`, which set `trace.authorize`
  from the event after every `tokenEvents` mutation, exactly as the entry
  proposed. Consumers now read `trace.authorize` and nothing else:
  `ProofOfEnforcementContext.js:76` (consumer #2) records this in place —
  "from the gw-authorize token event, so no separate fallback is needed here".

`buildTraceSteps.js` (consumer #1) still contains `findEvent(tokenEvents,
"gw-authorize")` at lines 813 and 1058, which reads like a survivor but is not:
813 uses the event's mere existence as a downstream-liveness probe
(`exchangeProvenDownstream`) and 1058 pulls `filterChain` off it. Neither
re-derives the authorize decision, which is the fact this entry was about.

### [x] 2026-08-18 — The chain's Exchange hop reads "in flight" after a finished run

**Where:** `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js` — the
`exDone` computation added by #1966.

**What's wrong:** on the dashboard's typed-chat path (AG-UI, `POST
/api/agent/run`), a completed run renders:

```
5 MCP  tools/list 401   status 401
6 MCP  tools/list       tools permitted 20
7 LLM  LLM              tokens used prompt 0
8 BFF  Exchange         in flight      <-- never resolves
9 LLM  Reply            no token change
```

The run is over — Reply is rendered — and the Exchange hop still reads "in
flight". #1966 fixed the case where an exchange HAD completed by keying `exDone`
on downstream evidence (`gw-authorize`, `gw-filter-chain`, an MCP result). Here
the model answered without calling a tool, so no downstream evidence exists and
none ever will, and the hop sits unresolved forever.

**Why it matters:** a viewer cannot tell "still working" from "this never
happened". That is the same complaint that started the visibility work — if the
chain stops, it must say why.

**RESOLVED 2026-08-18** — the wording was decided ("Not required") and the hop
now reads `not required` with the reason attached: "No token exchange was needed
— the agent answered from context without calling a tool, so no delegated MCP
token was ever requested."

Two things shaped the fix, and both are worth knowing before touching it again:

- It reuses the existing `notinpath` STATUS rather than introducing a new one.
  Roughly fifteen surfaces bucket statuses (TokenFlowDetailModal,
  TokenTopologyPanel, TraceStepCard, TokenChainPresenter, the clinical panes…);
  a new status string would have rendered unlabelled or unstyled on every one of
  them. Only the node rail's one-line fact is overridden, keyed on
  `detail.notRequired`.
- `buildLiveTokenChainSteps` drops everything that is not active/done/error while
  a trace is incomplete — and live traces usually never set `outcome`. Left
  alone, the fix would have made the Exchange hop VANISH mid-run instead of
  explaining itself, which is worse than the "in flight" it replaced. The filter
  now keeps a hop that carries `notRequired`.

Guarded by two tests in `FocusModeChainRenders.test.jsx` — one that the hop says
"not required" after a reply with no tool call, one that a genuinely in-flight
exchange still says "in flight" so the fix cannot over-reach. Verified to FAIL
with the fix reverted.

`npm run test:e2e:real -- chain-hops-visible` still prints
`[ui] UNRESOLVED after reply:` if the old symptom ever returns live.

### 2026-08-18 — The agent's action chips cannot render on any production route (RESTORED)

**Where:** `demo_api_ui/src/components/AIAgent.js` — `renderActionGroups()`
(~line 1002) and its single call site (~line 10909).

**What's wrong:** `renderActionGroups()` has exactly one call site, and it sits
inside `{!useActionsPopout && (…)}`. But:

```js
const useActionsPopout =
  !isInline || Boolean(distinctFloatingChrome && isInline);
```

Every production mount makes that true — `App.js` (`distinctFloatingChrome`),
`AgentPage.js` (`mode="inline" distinctFloatingChrome`), `PublicRoutes.js`
(`distinctFloatingChrome`), `DemoGuidePopout.jsx` (not inline). So the branch
that renders the chips is unreachable, and no `.ba-action-chip` exists anywhere
in the running app. Confirmed live on `/dashboard`: 0 `.ba-action-chip`, 0
`.ba-action-group`, 0 `.ba-chips-toolbar`, both before and after opening the
`More` trigger (which holds Topology / Floating token chain / Script).

The name is now a lie: `useActionsPopout` reads as "actions live in a popout",
but Task 7 deleted that popout — a comment in the same file says the trigger was
removed because `ba-actions-popout` "no longer exists anywhere in this file". The
flag's real current meaning is "render no actions at all".

Two loose ends confirm it was left behind rather than decided:

- The welcome copy read **"Type a message or use Actions to explore."** with no
  Actions affordance on that surface. Corrected to "Type a message, or open Use
  Cases to explore." — the stale instruction is gone, but the orphaned chip code
  below is untouched and still the open question.
- `renderActionGroups`, `ACTION_GROUPS`, `useCustomChips`, `verticalSuggestionChips`
  and the `.ba-action-chip` / `.ba-action-group` CSS are all still carried.

**Measured 2026-08-18.** Every production mount sets the flag:

| mount | props | `useActionsPopout` |
|---|---|---|
| `App.js:1705` | `distinctFloatingChrome` | true |
| `pages/AgentPage.js:13` | `mode="inline" distinctFloatingChrome` | true |
| `routes/PublicRoutes.js:134` | `mode="inline" distinctFloatingChrome` | true |
| `components/DemoGuidePopout.jsx:84` | no `mode` — not inline | true |

What that strands:

- `renderActionGroups` — `AIAgent.js` lines 1002–1106 (~105)
- the JSX branch holding its only call site — lines 10696–11065 (~370)
- 34 chips in `ACTION_GROUPS`
- 60 rules in `AIAgent.css` matching the chip classes

**Two corrections to the first pass, both of which change the "delete" option.**

*`agentActions.js` is NOT fully dead.* The entry above implies it is. `ACTIONS` is
read at `AIAgent.js:1217` to label a completed HITL consent, and
`getStepSkipExplanation` is passed to a child at `AIAgent.js:11527`. Both are
reachable and have nothing to do with chips. Only the `ACTION_GROUPS` uses at
lines 859/866 (chip collapse state) and those inside `renderActionGroups` are
dead. Deleting the module would break the consent label.

*The unreachable branch is not only chips.* It also contains the session-refresh
row, `ba-suggestion`, the guest chip grid **including the login prompt**,
`ba-left-auth`, and the track chips. All equally unreachable — so the guest-mode
login affordance in there is dead too — but "delete the chips" really means
deleting the entire left column.

**So delete is not the small option.** It is a real refactor of a ~370-line branch
with the reachable pieces (`ACTIONS`, `getStepSkipExplanation`) preserved.
Restoring is cheaper to try: flip the gate for the dashboard mount and look at
what renders.

**Why it matters beyond dead code:** chips are the deterministic tool-call path
(`forceHeuristic`). With no chip in the DOM, a UI-level test cannot drive a tool
call at all, which is why `chain-hops-visible.real.spec.js` can assert only the
discovery leg and has to report the tools/call and gateway hops instead of
asserting them.

**RESOLVED — restored.** The owner chose restore over delete. `useActionsPopout`
is now `!isInline`: the condition says what it means, and the popout it was named
for is gone. Inline mounts (dashboard, AgentPage, PublicRoutes) get the left
column back — chips, the session-refresh row, the suggestion chip, and the guest
grid with its sign-in prompt, which had been unreachable too. Float mode keeps
its own chrome and is untouched.

Guarded by three tests in `AIAgent.chips.test.js` pinning the mount shapes the
real routes use, including one asserting float grows no left column. The
dashboard one is verified to FAIL with the old condition restored — without that
check it would pass for the wrong reason, since bare `mode="inline"` always
worked.

**How to check:** log in, open `/dashboard`, and count
`document.querySelectorAll('.ba-action-chip').length`. Non-zero means this was
resolved. Measured today: 0, before and after opening the `More` trigger (which
holds Topology / Floating token chain / Script, not chips).

### 2026-08-18 — Concurrent deploys raced on one Docker project and one stamp (FIXED)

**Where:** `scripts/deploy-live.sh`.

**What happened:** several agent sessions share one machine, one Docker compose
project (`ai-demo`) and one `.git/deploy-live.last`. Two runs overlapped and
broke each other twice over:

1. `docker compose` renames the old container before creating the new one, so the
   second run collided mid-swap and died:

   ```
   Conflict. The container name "/<hash>_ai-demo-mcp-gateway" is already in use
   by container "<id>"
   ```

   Exit 1, having restarted nothing it was asked to — the `ui` service in that
   run's plan was never reached.

2. The stamp is global. The OTHER session's run finished and wrote the new sha,
   so the failed run's next attempt read `OLD == NEW` and announced
   `containers already serve <sha> — nothing to deploy` while `ui` still served
   the previous bundle. **A failed deploy presented as a completed one.** It was
   caught only by loading the page and reading the copy, which was still the old
   string.

The timeline is what settled it — the stamp's mtime was ~1 minute AFTER the last
command of the failing session, so that session did not write it:

| time | event |
|---|---|
| 07:11:44 | session A deploy — exit 1, nothing restarted |
| 07:12:24 | session A retry — "already serve abd0377d" |
| 07:12:42 | session A restarts `ui` by hand |
| 07:13:40 | stamp written — by session B |

**Fixed by** an atomic `mkdir` lock at the top of the script. A second run refuses
with a message naming the holder's pid instead of racing; a lock whose recorded
pid is gone is reclaimed automatically. Refusal happens BEFORE the `EXIT` trap is
installed, so a refused run cannot delete the live holder's lock — verified, not
assumed. A refusing run also never touches the stamp, so the range stays intact
for the next attempt.

**Why refuse rather than queue:** a waiting run would resume with a range computed
before the other run moved the stamp, which is the same wrong answer arrived at
more slowly.

**Related:** #2010 documents a DIFFERENT hole in the same script — the `OLD != NEW`
path silently deploying `PRE..NEW`. That one is about the fallback being
unreliable; this one is about two runs corrupting each other. Both end the same
way: a stale service under a success line.

### 2026-08-18 — Three test-authoring traps that each read as a real failure

Small, but each one cost a debug cycle by producing an error that pointed
somewhere other than the mistake. Grouped because they share a cause: this repo
runs two assertion libraries and two test runners, and the failure text does not
say which one you are in.

**1. `expect` takes one argument in jest, two in vitest/playwright.**
`demo_api_ui` (vitest) and `tests/e2e` (playwright) both allow
`expect(value, "message").toBe(...)`. `demo_api_server` is jest, which rejects it
with:

```
Expect takes at most one argument.
```

That reads as a problem with the value being asserted, not with the call shape.
Put the diagnostic inside the assertion instead — `expect(list).toContain(x)`
prints the list on failure anyway.

**2. Playwright's `expect.poll` does not evaluate a function `message`.**

```js
await expect.poll(fn, { message: () => `saw: ${calls.join(', ')}` })
```

On failure Playwright prints the SOURCE of that arrow function rather than its
value, so the diagnostic you wrote specifically for the failing case is the one
thing you cannot read. Use a static string and `console.log` the dynamic part as
it arrives — a live run's diagnostics have to be emitted before the assertion
that needs them.

**3. `.ba-welcome` only renders when the transcript is empty.**
Conversation continuity persists the last 30 messages per user+vertical, so on a
real stack the agent panel usually has history and the welcome copy is absent —
`$$eval('.ba-welcome')` returns `[]`, which looks exactly like "the copy is
missing" when verifying a copy change. Click `.ba-start-over-btn` first. Applies
to any live check of first-run UI.

**Why this is here rather than in a test README:** all three were hit while
verifying other work today, and each briefly looked like a product bug. The cost
is not the mistake, it is the detour.

### 2026-08-18 — deploy-live stamped ranges it had not deployed (FIXED)

**Where:** `scripts/deploy-live.sh`.

**What was wrong:** the stamp is a claim that the containers serve a given SHA,
and it was written without checking whether that was true. Two paths let it lie,
both hit live:

1. `filter_running` selected services with `docker ps`, which lists only RUNNING
   containers. A service sitting in `Created` or `Exited` looked exactly like an
   optional profile service that is deliberately off: skipped with a note, and
   the run then stamped the new SHA as deployed. `ping-gateway` sat in `Created`
   while the next run reported `containers already serve <sha> — nothing to
   deploy`. Its changes were recorded as shipped and would never have been
   retried.
2. Nothing verified the outcome. `run-docker.sh restart` returned success having
   left a container in `Created`, and the stamp went in on that success.

**Fixed by** distinguishing *broken* from *absent*, and by verifying before
stamping:

- a container that EXISTS but is not running is now an error, not a skip — it has
  changes it cannot take, so the stamp is withheld and the run exits non-zero
  naming the service
- after deploying, docker is re-read to confirm every touched service is up;
  if any is not, the stamp stays at the old SHA so the next run retries the range
- a container that does not exist at all still skips quietly, which is the
  legitimate case the original behaviour was written for

**Found while fixing it — `filter_running` ran in a subshell.** It is called as
`X="$(filter_running "$X")"`, and command substitution forks: every variable it
assigned was discarded on return. That silently disabled the function's own
`note()` calls, so *every* "changed but its container is not running" warning
this script has ever produced was thrown away before anyone could read it. The
first version of this fix inherited the same bug and did nothing — the guard
never fired because `BROKEN_SET` never reached the parent. Side effects now go
through temp files.

**Still true, and not fixed here:** the stamp remains global. It records what the
containers serve, not what each service serves, so it cannot express "ui is
current but ping-gateway is two commits behind". The verification above closes
the way that state was reached silently; per-service stamps would be the way to
represent it directly, and that is a real refactor of the path→service mapping,
which resolves one range against one service set.

**How to check:** stop a service that has pending changes and run `deploy-live`.
It must exit non-zero, name that service, and leave `.git/deploy-live.last`
untouched. Verified 2026-08-18 with a `Created` container.

### 2026-08-18 — The MCP Inspector cannot invoke the tools it lists

**Where:** `demo_api_server/routes/mcpInspector.js` (`POST /api/mcp/inspector/invoke`).

**What's wrong:** the Inspector's catalog returns 242 tools, and invoking the
FIRST one fails:

```
[inspector] invoking catalogued tool: get_my_accounts
[inspector] invoke status=502
{"error":"mcp_invoke_failed","message":"Insufficient scope for tool 'get_my_accounts'"}
```

This is not the out-of-vertical case. `list_invoices` also 502s there, but
correctly — it is a sporting-goods tool and the Inspector's catalog is banking,
so "Insufficient scope" is the scope check working. `get_my_accounts` is a core
banking tool the Inspector itself offers, and tools run fine through the agent
path.

The route resolves its token with `forceDirectMcpAudience: true`, dialling the
MCP server directly rather than through PingGateway, so it carries a different
token than every other surface. That is the first place to look.

**Why it matters:** this is a demo surface whose whole purpose is showing the
real protocol. It advertises 242 tools and runs none of them.

**Found by** `demo_api_ui/tests/e2e/mcp-inspector.real.spec.js`, added 2026-08-18
— nothing drove this page before, which is why a 502 on its primary action went
unnoticed. That spec deliberately takes the tool FROM the catalog rather than
naming one: an earlier version hardcoded `list_invoices` and would have reported
working scope enforcement as a bug.

**Status:** the third test in that spec is RED on purpose. It states the bar —
whatever the Inspector lists, it must be able to invoke — rather than being
softened to match current behaviour.
