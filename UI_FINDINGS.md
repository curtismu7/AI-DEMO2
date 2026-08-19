# Live UI Findings

Findings from live Playwright drives of `https://local.ping-devops.com:4000` (the only host where
sign-in works), signed in as Demo User (Customer), Agent mode Heuristics.

- **#1–#10** — 2026-08-19, vertical **Super Banking**. Ran UC8 (HITL consent transfer, $300
  checking→savings) to a terminal decline, then reviewed Home and `/dashboard`.
- **#11–#21** — 2026-08-19, vertical **Super Sports** (`sporting-goods`), all 22 entries of the
  **Demo Steps** script driven end to end, including the HITL / step-up / CIBA approval controls.

**Working rule:** when a finding is fixed, flip its Status row to `FIXED` with the PR number and evidence **in the same commit as the fix**, and add a Changelog line. A status column that lags the code is the same false-green failure as finding #1.

## Status key

`OPEN` · `IN PROGRESS` · `FIXED` (needs PR # + evidence) · `WONTFIX` (needs reason) · `INVALID`

## Findings

| # | Finding | Area | Severity | Status | Notes |
|---|---------|------|----------|--------|-------|
| 1 | Verification pill never dismisses | UI | High | FIXED | PR #2155 — `banner → pill → gone` cycle |
| 2 | Pill covers the Sign Out button | UI | High | FIXED | PR #2155 — overlay moved below the 60px TopNav |
| 3 | `consent-challenge/:id/confirm` 404s during a live drive | environment | — | INVALID | No code fault — containers recreated under the drive |
| 12 | launchd sync job dead since its cwd change — silent staleness | scripts | High | FIXED | PR #2162 — found while proving #3 |
| 4 | Chain badge was a hardcoded string, so an errored run looked clean | UI | Medium | FIXED | PR #2155 — badge derives from `runStory.outcome` |
| 5 | Scope diff on the chain map card is unreadable | UI | Medium | FIXED | PR #2160 — map states the shape, detail panel keeps the chips |
| 6 | 25 sidebar groups, 7 ways to start a demo, Sign Out ×3 | IA | Medium | OPEN | |
| 7 | Button colours carry no hierarchy | UI | Low | OPEN | |
| 8 | User prompt bubble layout broken | UI | — | INVALID | Not a bug — I photographed a scrolled pane |
| 9 | Home and Dashboard are two different apps | IA | Low | OPEN | |
| 10 | `/dashboard` shows no banking data; `/api/token-chain` 401 on cold load | UI + BFF | Low | OPEN | |
| 11 | CIBA phone simulator is a dead end in every non-pending state | UI | High | FIXED | PR #2158 — reported by the user as "never accepts Approve" |
| 13 | UC6 intentional DENY scores itself "Incomplete / Run failed" | BFF + UI | High | FIXED | `85971fabd` — gateway backstop DENY now carries authorize evidence |
| 14 | UC8 flips green → "Mismatch" the moment the human approves | UI | High | FIXED | `85971fabd` — skip-shaped evaluation no longer wipes the gate |
| 15 | UC10 cross-owner DENY renders "Mismatch" | BFF | Medium | OPEN | Authorize genuinely PERMITs; needs a product decision (see below) |
| 16 | UC22 CIBA "Approve" loops instead of completing | BFF + UI | High | OPEN | Duplicate waiting cards accumulate every ~60s |
| 17 | Super Sports stores advertise an "ATM" badge | data | Low | FIXED | `85971fabd` — `atm: true` was hard-coded on all non-banking locations |
| 18 | "Here are your extend rental." | BFF | Low | FIXED | `85971fabd` — 70 sibling actions still affected, see `TECH_DEBT.md` |
| 19 | UC18/UC29 don't demonstrate the defense they claim | BFF | Medium | OPEN | Declare `DENY_429`/`DENY_503`, both return plain `403` |
| 20 | `/personal-agent` greets with airlines copy in every vertical | UI | Low | OPEN | "your MileagePlus account… upcoming flights" under Super Sports |
| 21 | Approval strips claim "then permitted" before the human answers | UI | Low | OPEN | Shown while the consent modal is still open |
| 22 | UC2/UC2.5 "Incomplete — Waiting on user-token" | — | — | INVALID | Harness artifact; correct in the real flow (see below) |
| 23 | UC2/UC20/UC38 demo-step buttons missing | — | — | INVALID | Harness raced the popout's catalog fetch |

Findings 13–23 come from a second drive on **2026-08-19**: all 22 entries of the **Demo Steps**
script, vertical **Super Sports** (`sporting-goods`), signed in as `demoUser`, Agent mode
Heuristics. Evidence (29 screenshots, raw response bodies, driver scripts) in
`/Users/cmuir/Development/ai-demo2-demo-steps-run/`; full write-up in
`.claude/DEMO_STEPS_LIVE_RUN.md`.

Tally for that drive: 10 PASS · 6 FAIL · 6 WARN, then 4 fixed. Two of the eleven turned out to
be my own harness, not the product — recorded above as INVALID rather than dropped.

---

### 1. The green ✅ verification pill never goes away — FIXED (PR #2155)

`demo_api_ui/src/components/VerifiedBanner.jsx` collapsed the banner to a pill after 6s, and nothing ever cleared the pill — no dismiss timer, no close button. It stayed pinned top-right reading `✅ hitl-consent verified` while the confirm call 404'd twice and the user declined the transaction.

Worst case in front of a customer: a green checkmark parked over a broken flow.

**Fixed:** `VerifiedBanner` now runs a three-phase cycle — `banner` (6s) → `pill` (15s) → `gone` — replacing the one-shot `collapsed` boolean. Clicking the pill restarts the cycle from `banner`, which also closes a latent bug in the old code: re-expanding set `collapsed = false` without arming a new timer, so a re-opened banner stayed open for the rest of the session.

**Evidence:** `VerifiedBanner.test.jsx` — 7 tests pass; the two new ones fail against the pre-fix component (verified by stashing the fix and re-running).

### 2. That pill physically covers the Sign Out button — FIXED (PR #2155)

`createPortal` → `document.body` at `top: 14px`, inside the 60px TopNav. "Sign Out" rendered as "Si".

**Fixed:** both `.verified-banner` and `.verified-pill` moved to `top: 72px`, clearing the nav. `TopNav.css` untouched — it is a `REGRESSION_PLAN.md` §1 protected surface, and the overlay is the thing that was in the wrong place.

### 3. `POST /api/transactions/consent-challenge/:id/confirm` 404s — OPEN, rescoped

**The 404 is real.** Two on the same challenge id, ~3.5s apart, during a live UC8 run.

**Two of the three original claims were wrong, and are withdrawn:**

- ~~"the button fired twice with no in-flight guard"~~ — `TransactionConsentModal.tsx:317` guards on `submitting` and returns early. The double-fire has another cause.
- ~~"the verdict scored green without checking the transfer executed"~~ — by design. UC8's `expectedOutcome` is `HITL_REQUIRED`, which `ProofOfEnforcementContext.js:18` maps to the `denied-as-expected` family. The verdict proves *enforcement* — that the approval gate fired — not that the transaction succeeded. A decline is still a pass, correctly. `handleDenialConfirm` already records the decline via `tokenChainTraceStore.ingestApprovalDeclined()`.

**A third claim is now also withdrawn — this one was mine, and it was the load-bearing one.**

I reported that `docker logs ai-demo-api-server` over a 120-minute window contained **zero** `POST /api/transactions`, and concluded the confirm never reached the BFF. That evidence is void:

```bash
docker inspect ai-demo-api-server --format '{{.State.StartedAt}}'
  -> 2026-08-19T03:11:41Z          # the failing run was ~03:06:45Z
docker inspect ai-demo-ui         --format '{{.State.StartedAt}}'
  -> 2026-08-19T03:06:10Z          # ~35s before the failing request
```

The BFF container restarted *after* the failure, so I was reading the logs of a container that had not been running when the request was made. Absence of log lines there proves nothing at all. `docker ps` at the time reported "Up 25 minutes", which is what I checked — but that was a snapshot taken before the 03:11 restart, not a statement about the window I went on to query.

**What is actually known:**

- The 404 happened. That is directly observed in the browser console.
- The endpoint itself is healthy. Probed both ways (ai-demo2-54): `POST .../consent-challenge/probe-nonexistent/confirm` returns an identical JSON 401 through nginx on `:4000` and direct on `:3001`. The route is mounted, nginx proxies POSTs, and the response is BFF JSON — not an HTML proxy 404.
- `ai-demo-ui` (nginx — serves the SPA *and* proxies `/api` for anything loaded from `:4000`) restarted 35 seconds before the failing request.

**Still ruled out:** the `#2148` authz-server dotenvx bug (fixed container serving from 02:50:39Z, ~16 min before the run, and it produced a DENY not a 404). The hitl-service store (wrong subsystem — these challenges live in the BFF session). Single-use consumption and TTL expiry (those return 409 and 410 respectively, from code paths with different status codes).

**Leading hypothesis, not yet proven:** collateral from the `ai-demo-ui` restart rather than a code fault. It fits the timing and would explain why the window closed and the failure could not be reproduced afterwards. It does not yet explain a clean 404 a full 35s after nginx came back.

**RESOLVED — no code fault. See below.**

_Original plan, kept for the record:_

**Reproduced properly.** Method for the retry, since the last two attempts were void for a different reason (the llama.cpp agent stalled and the modal never opened): pin `docker inspect <ui,bff> --format '{{.State.StartedAt}}'` before and after the run, and treat the run as void rather than a finding if either moved. Capture the 404 response body — JSON means the BFF answered, HTML means a proxy or static handler did, which separates the two remaining branches in one look.

**Resolution: there is no code fault. The stack is recreated under live drives.**

The controlled reproduction settled it — by failing the same way, on cue. I pinned `docker inspect ... StartedAt` before the run, drove UC8, and:

```
before   ai-demo-api-server  10:13:19Z
prompt sent                  10:16:39Z
after    ai-demo-api-server  10:16:41Z     <- recreated 2s into the run
```

The run produced `502`s instead of a modal. `ai-demo-ui` was then recreated again at 10:17:54Z. Neither restart came from `deploy-live.sh` — its own ledger (`.git/deploy-live.restarts`) records only two, at 10:00 and 10:07, both `ui` only.

The cause is structural: **five other Claude sessions were live on this machine** (`/tmp/cc-socks/`), sharing one Docker stack whose compose project is the main checkout. Any of them recreates `ui` / `demo-api-server` at will. A live UI drive gets its containers pulled mid-request and sees an inexplicable 404 or 502 with no server-side trace — which is exactly what the original UC8 run recorded.

So the 404 was never a defect in the consent-challenge path. Every server-side hypothesis (session lookup, TTL, single-use consumption, hitl-service, `#2148`) was chasing a fault that was not there, and the one piece of evidence that seemed to localise it was itself void.

**What to do instead of fixing it:** before trusting any live-drive observation, pin `docker inspect ai-demo-ui ai-demo-api-server --format '{{.State.StartedAt}}'` either side of the run and void the run if either moved. That check is cheap, and it is the difference between a finding and an hour in the routing layer.

### 12. The launchd sync job has been dead, failing silently every 15 minutes — FIXED (PR #2162)

Found while proving #3, and the more serious of the two.

`~/Library/Logs/aidemo2-sync-main.log` is wall-to-wall `fatal: not a git repository (or any of the parent directories): .git`. The 15-minute job that is supposed to catch merges landing outside an agent session has been failing on **every run**.

**Cause:** `scripts/sync-main-checkout.sh` resolved the repo with a bare `git rev-parse --git-common-dir`, which asks about the **caller's** cwd. That is fine for an agent standing in the repo and fatal for launchd, whose cwd is `/`. The plist (`com.aidemo2.sync-main.plist`) sets no `WorkingDirectory`, so there was nothing to save it.

**Fixed:** anchor the lookup on the script's own location — `git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse …`, the idiom `scripts/pac-common.sh:76` already uses. This keeps the worktree property the original comment relied on, because `--git-common-dir` maps any worktree copy back to the main checkout regardless.

**Evidence:** run from `/` exactly as launchd does — unfixed exits **128** with that log's error, fixed exits **0** and reports `up to date`. The fix is in the script rather than the plist deliberately: the plist is not version-controlled, so a plist-only fix would not survive a new machine and would not help anyone else invoking the script from outside the repo.

This is the same silent-staleness failure mode the job exists to prevent, one level up: the safety net was down, and it announced it only in a log nobody reads.

### 4. Chain badge was a hardcoded string, so an errored run looked clean — FIXED (PR #2155)

**Original claim partly wrong:** the `tools/list 401` / `tools/call 401` steps are *not* failures. They are the RFC 9728 challenge probe, and a 401 there is the gateway refusing an anonymous call — the control working. `buildTraceSteps.js` paints them `done` deliberately, and says so.

**The real defect:** `CHAINED` was a literal string in both chain surfaces (`TokenChainTraceRail.jsx`, `TokenChainFilmstrip.jsx`). It never reflected anything, so a run that ended in a genuine error step (step 17, `MCP · error`) wore exactly the same confident badge as a clean one.

**Fixed:** new `chainBadge(trace, steps)` helper in `buildTraceSteps.js`, used by both surfaces. It derives tone from `buildRunStory().outcome`, so it inherits that function's existing judgement — an *expected* DENY stays `CHAINED` because the control worked, and the by-design 401s stay `done`. Only a genuine error step flips the badge to `RUN ERROR` in red.

**Evidence:** 4 new tests in `buildTraceSteps.test.js` (94 pass in that file); full UI suite 389 files / 3319 tests pass; build exit 0.

### 5. Scope diff on the chain map card is unreadable — FIXED (PR #2160)

**One of my claims was wrong.** I said the scopes had "no separators". They did: `.tcnr-fact-gone` and `.tcnr-fact-kept` both carry `margin-right: 4px`. What I read as a spacing bug was the accessibility snapshot concatenating adjacent spans — an artifact of how I captured the page, not of the page.

**The real defect is density.** `TokenChainNodeRail.jsx` rendered one chip per `before` scope into a ~130px map card. A real exchange has nine, so they wrapped into an unreadable block with strikethrough running through it. The card is a *map*; it cannot hold a chip-by-chip diff.

**Fixed:** the map now states the shape of the change — `scope narrowed 9 → 3` — with the full before/after on the element's `title`. That is also the claim the demo exists to make, said in words instead of left for the viewer to count. Widening reads as `scope 1 → 2` and an identical set reads `scope unchanged`, so a narrowing is never asserted unless scopes were actually dropped.

The chip-by-chip diff was already implemented and already good, in the step detail panel (`TraceStepCard.jsx:348`, `tctr-sc--kept` / `tctr-sc--gone`) — which has the room for it. Nothing was lost; the two surfaces now do different jobs.

**Evidence:** 4 new tests in `TokenChainNodeRail.test.jsx`, confirmed to fail against the pre-fix renderer (stashed, re-ran, `4 failed | 12 passed` — exactly the four). Full UI suite 389 files / 3325 tests pass, build exit 0.

### 6. 25 collapsible sidebar groups, and 7 competing ways to start a demo — OPEN

Topbar: Use Cases / Controls / Reset Demo. Toolbar row below: Demo steps / Live Use Cases / Inspectors / Flow Detail / More / Guide / Clear progress. Sidebar repeats Demos / Inspectors / Reset Demo / Sign Out. Sign Out appears three times on one screen.

**Fix:** pick one home for "run a demo", demote the rest.

### 7. Button colours carry no hierarchy — OPEN

Red `Controls`, red `Reset Demo`, green `Demo steps`, purple `Live Use Cases`, blue outlines, salmon `Send` — all equal weight in one 40px band. Red currently means both "destructive" and "open a panel".

**Fix:** one primary per region; reserve red for Reset.

### 8. The user's own prompt bubble is broken — INVALID

There is no layout bug. Every part of this finding was an artifact of the screenshot I read it from. Measured against the live page:

| What I claimed | What the page does |
|---|---|
| "prompt text is pushed out of view" | `overflow: visible` on `.banking-agent-msg`, `scrollHeight 53` vs `clientHeight 51` — a 2px sub-pixel delta. Nothing is clipped. |
| "`Copy` renders as a large blue block at the top-left" | No Copy button exists in the DOM for a typed message, at rest or on hover. It renders only for `msg.isPrompt` (demo-step prompts), as `display: inline-block` **below** the text (`AIAgent.css:1456`). |
| "the 'You' label sits outside the bubble" | That is the design. The label sits beside the bubble on every message, user and assistant alike. |
| implied: the pane does not follow the conversation | `distanceFromBottom: 0`, `lastMsgVisible: true`. Auto-scroll works. |

**What I actually photographed.** The capture was taken just after dismissing a modal, with the chat pane scrolled mid-message, so only the bubble's lower edge — which is where the Copy button lives — sat above the fold, with its text scrolled past the top of the scroll container. Ordinary scrolling, read as a broken layout.

**Why it is worth leaving in the doc.** This is the third finding in this set whose evidence dissolved on contact, and the second where the fault was in how I captured the page rather than in the page. Deleting the row would hide that pattern; a fix invented to match the description would have added spacing and re-ordering to a component that was already correct.

### 9. Home and Dashboard are two different apps — OPEN

Home: no sidebar, marketing hero, four CTAs wrapping 3+1 with `Setup` orphaned on its own row, and `Admin Dashboard` as the filled primary on a customer-facing page. Dashboard: 25-group sidebar, dense toolbars. The four "Core Capabilities" cards are not clickable — they describe the demo, then dead-end.

### 10. `/dashboard` is named Dashboard but shows no banking data — OPEN

For "Super Banking" the whole main area is agent chat + token chain: no balances, no accounts, no transactions, so the transfer has no visible before/after.

**Fix:** surface an accounts strip, or rename to Agent Console.

Related: `/api/token-chain` 401s on every cold page load (fetch fires before the session cookie is live). Harmless, but it is the first thing in the console.

### 11. CIBA phone simulator is a dead end in every non-pending state — FIXED (PR #2158)

Reported by the user as "CIBA is broken, it never accepts Approve and keeps looping". Reproduced on the live stack: the phone renders with **no Approve button at all** — only Close.

**Mechanism.** `CibaApprovalPage.js` builds its footer as `status === "pending" && details ? <Approve/Deny> : undefined`. `DraggableModal.jsx:240` reads an **undefined** footer as "render my default Close footer", not as "render nothing". So in `loading`, `error` and `expired` the user's Approve/Deny are silently swapped for a lone Close, with no explanation and no way forward — while the dashboard keeps polling `/poll/:authReqId` every 5s. That polling is the "looping".

Two things made that state easy to reach and impossible to leave:

- The page fetched the challenge **once on mount** (`useEffect` deps `[authReqId, apiBase]`) and never again, so its state was a snapshot that could not recover.
- The simulated engine auto-approves after 60s (`SIMULATED_APPROVE_DELAY_MS`) while the request lives 300s, so an Approve click races a timer that would approve anyway. Live logs bear this out: the poll response goes 41 → 88 bytes at the 60s mark with **zero `/approve-now` POSTs** in the window. The approval the user saw land was never their click.

**Fixed:** `error` now offers a working **Try again** that re-runs the load (`loadAttempt` in the effect deps) and can recover into `pending`. `expired` stops saying "please try again" — which reads as "press something here" when expiry is terminal and the BFF has already deleted the challenge — and instead says where a new request comes from. Retry is deliberately *not* offered on `expired` for that reason.

**Also fixed, a §0 violation found here:** the phone frame re-skins the panel dark (`#1c1c1e`) but the body text kept `DraggableModal`'s dark-on-light colour, so every message rendered grey on near-black. `§0` forbids muted modal text. `.ciba-phone-modal .dm-scroll` now sets an explicit high-contrast colour.

**Why the tests missed it.** `CibaApprovalPage.test.jsx` mocks `DraggableModal` as `{footer && <div>…</div>}`, which renders *nothing* for an undefined footer — the opposite of the real component's default-Close substitution. The test double diverged from the real component in exactly the place the bug lived. The 3 new tests assert the recovery path rather than the mock's shape.

**Evidence:** full UI suite 389 files / 3322 tests pass, build exit 0. The 3 new tests were confirmed to fail against the pre-fix page (stashed the component, re-ran, `3 failed | 12 passed` — exactly the three).

**Left alone deliberately:** the 60s auto-approve. `/approve-now` is *built on* it (it backdates `initiatedAt` past the delay rather than setting a flag), so removing it needs a replacement approved-by-user flag plus server test changes. It makes Approve feel broken even when it works, so it is worth doing — but it is a demo-behaviour change, not part of this bug.
### 13. UC6's intentional DENY reported itself as a failed run — FIXED (`85971fabd`)

`extend my rental $2500` is *supposed* to be denied. The chat said so correctly ("declined by
the gateway's authorization policy — no changes were made"), but three other surfaces called it
broken at once: TopNav pill `AUTHZ-DENIED — INCOMPLETE / no evidence yet`, proof strip
`Incomplete / Run failed before authorize-decision`, Token Chain badge red **RUN ERROR**.

PingGateway's local backstop (`denyLocal`, `p1az-decision.groovy:444`) answers 403 with a bare
`{error, message, tool}` body and **no** `X-Gw-Audit-Trail`, so all ~8 of its reasons
(`tier_amount_exceeded`, `insufficient_scope`, `invalid_iat`, …) arrived with no authorize
evidence. Same chip on a PERMIT carried `gw-introspection` + `gw-authorize` + `gw-mcp-audit` +
`gw-mtls` + `gw-filter-chain`; the DENY carried none of them.

**Fixed:** synthesize the authorize DENY block BFF-side (`_syntheticBackstopDenyTrail`), so it
also holds for a gateway that has not been redeployed. Labelled `gateway-backstop`, **not**
`pingone` — the tier ceiling is a gateway-local rule precisely because P1AZ cannot map a PingOne
group array to a tier, and crediting Authorize would be theatre.

Note this is vertical-dependent: banking's `$2500` transfer *does* return a full P1AZ trail. The
gap only shows where the gateway's own rule fires first.

### 14. Approving UC8's consent turned the green box amber — FIXED (`85971fabd`)

Tick "I have reviewed the details above and authorize this action" → **Agree & Continue** → the
rental really is extended (`success: true`, a correct **Rental Extended** card). The proof strip
then flipped from `Verified (as expected)` to `Mismatch — Result did not match the expected
outcome`. Approving made a correct run look wrong.

On the gateway-authoritative path the BFF answers with a **skip-shaped** evaluation carrying no
`decision` at all (`{ran:false, skipped:true, skipReason:'gateway_authoritative'}`) — the real
PERMIT arrives separately as the `gw-authorize` token event. `ingestAuthorize`'s gate-carry guard
required `decision === 'PERMIT'`, so it never fired and the `HITL_REQUIRED` gate was overwritten.

**Fixed:** the guard now also accepts an absent `decision`. `!evaluation.outcome` still excludes a
genuine later block. UC7's step-up shares this path.

**Not a defect, though first suspected:** both consent modals disable their primary CTA until the
review checkbox is ticked. That is correct UX — my first harness just wasn't ticking it.

### 15. UC10's cross-owner DENY renders "Mismatch" — OPEN, needs a product decision

`cross-owner-account → 403 DENY / requested resource belongs to a different user` is exactly the
declared `expectedOutcome`. The strip still says `Mismatch`. Measured cause — the same catalog
shape, opposite verdict, one field apart:

| | UC13 `rogue-actor` (green) | UC10 `cross-owner-account` (amber) |
|---|---|---|
| `authorize` | `{decision:"DENY", outcome:"DENY"}` | **`{decision:"PERMIT", outcome:"PERMIT"}`** |
| what blocked it | PingOne Authorize | the tool/API layer |

**The strip is telling the truth.** PingOne Authorize genuinely permits the cross-owner read and
the data plane catches it — `attackSimulatorService.js`'s own comment already flags the gap
("Prefer Authorize ResourceOwnerId DENY when the BFF gate populates ResourceOwnerId for this
tool"). Two fixes, not equivalent:

- **Honest:** populate `ResourceOwnerId` so Authorize actually denies. The step's "Used: PingOne
  Authorize" claim becomes true and it goes green on its own.
- **Cosmetic:** teach `computeVerdict` to accept a data-plane deny. Green box, demo keeps
  claiming an enforcement point that never fired. Not recommended.

### 16. UC22's CIBA "Approve" never completes — OPEN

`extend my rental $150` → `step_up_required / ciba` and a **Approve** button. Watched 170s after
clicking:

| t | what happened |
|---|---|
| 1 s | button flips to "Approving…" |
| 5 s | reverts to "Approve" — the approval failed |
| 68 s | a **second** waiting card + Approve appears (auto-retry) |
| 129 s | a **third** appears |

Four `/api/agent/invoke` calls, every one returning `step_up_required`. The copy's promise ("it
will continue automatically in about a minute") fires but only re-issues the same challenge, so
duplicate cards accumulate. Verdict pill reads `MISMATCH`; no inline proof strip.

### 17. Super Sports stores advertised an ATM — FIXED (`85971fabd`)

Not a render bug — `atm: true` was hard-coded on **every** non-banking location in the public
catalog (16 entries, duplicated in `demo_api_server/data/publicBranchCatalog.js` and
`oauth-mcp/src/tools/handlers/publicCatalogHandlers.ts`). Retail stores and university campuses
had it too. Now only the 7 Super Banking branches keep it.

### 18. "Here are your extend rental." — FIXED for one action, 70 still open (`85971fabd`)

The reply-heading builder hand-cases 10 write actions and falls everything else through to
`Here are your ${noun}.`. **71 write actions across all 12 verticals** hit it: "Here are your pay
bill.", "Here are your withdraw.", "Here are your transfer.", "Here are your redeem miles."

Only `extend_rental` — the one this drive named — was fixed. The obvious generic rule ("no read
verb ⇒ write") misclassifies genuine reads like `afford_check`, `biggest_purchase`, `browse_gear`,
and a copy change touching every vertical does not belong in a bug-fix PR. Real fix and the full
list are in `TECH_DEBT.md`.

### 19. UC18 and UC29 don't demonstrate the defense they advertise — OPEN

Catalog declares `DENY_429` (rate limit) and `DENY_503` (introspection outage / fail-closed); both
sims return plain `403` with the generic "Gateway policy denied the tool call". Both still render
**green**, because each one's evidence chain is only `["user-token"]` and both expectations are in
`DENIED_LIKE_OUTCOMES`, so the outcome-family check is skipped entirely. Right colour, wrong
reason, and the specific defense each step claims is never actually shown.

### 20. `/personal-agent` greets with airlines copy in every vertical — OPEN

Loads under Super Sports branding, then: *"Hello! I'm your personal agent. I can access your
**MileagePlus** account and help manage your upcoming **flights**."* UC38's landing page.

### 21. Approval gates claim "then permitted" before the human answers — OPEN

UC8 and UC7 render `Human approval required as expected — **then permitted**` /
`Step-up MFA required as expected — **then permitted**` at the moment the gate opens, while the
consent modal or OTP picker is still on screen and unanswered. `computeVerdict` has a
`gateDeclined` branch for a refusal but no pending state, so it asserts an outcome that has not
happened yet.

### 22. UC2/UC2.5 "Waiting on user-token" — INVALID (my harness)

Reported as a failure; it is not. `user-token` is a **session-scoped** card that `beginTrace`
carries across traces (`SESSION_EVENT_IDS`). My first harness reloaded the page before every
step, wiping the in-memory store, so UC2 ran with no `user-token` and its evidence chain could
not match. Driven the way a presenter actually drives it — UC1, then UC2, then UC2.5, no reload:

```
### UC1   -> ["Delegated access with proof — Verified"]
### UC2   -> ["A2A delegation — Verified"]
### UC2.5 -> ["A2A Orchestrator — Interactive Learning — Verified"]
```

Left alone rather than "fixed" — the real flow is correct. Residual rough edge worth knowing: a
presenter who hard-reloads and clicks UC2 first *will* see amber.

### 23. UC2/UC20/UC38 step buttons "missing" — INVALID (my harness)

`[data-testid="demo-step-UC2"]` returned 0 elements. The popout fetches `/api/use-cases` on open
and takes >1.5s to populate; I queried too early. With a wait for the list to reach 22 entries,
all 22 render and every one runs.

## Not covered

Dark mode · narrow/mobile widths · the other 11 verticals · every admin surface.

## Changelog

- 2026-08-19 — #3 closed INVALID (no code fault: containers recreated mid-drive by one of six concurrent sessions) and #12 added and FIXED — the launchd sync job had been dying every run on `fatal: not a git repository`.

- 2026-08-19 — #8 closed INVALID. Re-verified against the live page before touching anything: no clipping, no misplaced Copy button, auto-scroll working. The original capture was a scrolled pane, not a layout bug.

- 2026-08-19 — #5 FIXED (PR #2160). Also withdrew its "no separators" claim: the chips were spaced, and the run-on text was an artifact of how I captured the page. The real defect was nine chips in a 130px card.

- 2026-08-19 — #11 added and FIXED (PR #2158): the CIBA phone simulator's dead-end footer, the single-fetch that could never recover, and a §0 muted-text violation in the same modal.

- 2026-08-19 — findings #13–#23 added from a second drive: all 22 Demo Steps, vertical Super Sports. #13, #14, #17, #18 FIXED in `85971fabd` (same commit as this status update). #22 and #23 recorded INVALID — both were my own harness (a page reload between steps that wiped session-scoped evidence; a query that raced the popout's catalog fetch), not the product. #13 was also narrower than first written up: banking returns a full P1AZ trail, only the gateway-local backstop path lost its evidence.
- 2026-08-19 — #3 rescoped again: my "zero POST in the BFF logs" evidence was void (the BFF container restarted after the failure, so I queried logs from a container that was not running at the time). Reproduction method corrected to pin container StartedAt before and after a run.
- 2026-08-19 — #4 FIXED (PR #2155), #3 rescoped. Investigating #3 disproved two of its three original claims and showed the confirm never reaches the BFF; #4's premise about the 401s was also wrong, though its badge defect was real. Corrections recorded in place rather than quietly dropped.
- 2026-08-19 — #1 and #2 FIXED (PR #2155). `VerifiedBanner` gained a `banner → pill → gone` cycle and moved below the TopNav.
- 2026-08-19 — initial pass, 10 findings, all OPEN.
