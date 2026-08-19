# Live UI Findings — Super Banking demo

Source: Playwright drive of `https://local.ping-devops.com:4000` on **2026-08-19**, signed in as Demo User (Customer), vertical Super Banking, Agent mode Heuristics. Ran UC8 (HITL consent transfer, $300 checking→savings) to a terminal decline, then reviewed Home and `/dashboard`.

**Working rule:** when a finding is fixed, flip its Status row to `FIXED` with the PR number and evidence **in the same commit as the fix**, and add a Changelog line. A status column that lags the code is the same false-green failure as finding #1.

## Status key

`OPEN` · `IN PROGRESS` · `FIXED` (needs PR # + evidence) · `WONTFIX` (needs reason) · `INVALID`

## Findings

| # | Finding | Area | Severity | Status | Notes |
|---|---------|------|----------|--------|-------|
| 1 | Verification pill never dismisses | UI | High | FIXED | PR #2155 — `banner → pill → gone` cycle |
| 2 | Pill covers the Sign Out button | UI | High | FIXED | PR #2155 — overlay moved below the 60px TopNav |
| 3 | `consent-challenge/:id/confirm` 404s — request never reaches the BFF | BFF/proxy | High | OPEN | Rescoped 2026-08-19; two of the three original claims were wrong |
| 4 | Chain badge was a hardcoded string, so an errored run looked clean | UI | Medium | FIXED | PR #2155 — badge derives from `runStory.outcome` |
| 5 | Scope diff on chain step 10 is unreadable | UI | Medium | OPEN | Highest demo-value fix |
| 6 | 25 sidebar groups, 7 ways to start a demo, Sign Out ×3 | IA | Medium | OPEN | |
| 7 | Button colours carry no hierarchy | UI | Low | OPEN | |
| 8 | User prompt bubble layout broken | UI | Medium | OPEN | |
| 9 | Home and Dashboard are two different apps | IA | Low | OPEN | |
| 10 | `/dashboard` shows no banking data; `/api/token-chain` 401 on cold load | UI + BFF | Low | OPEN | |

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

**What was actually established:**

`docker logs ai-demo-api-server` over a 120-minute window covering the failing run contains **zero** `POST /api/transactions` of any kind — no challenge create, no confirm. The container had not restarted (up since ~02:42), so the window is intact. `GET /api/transactions/my` from the same page *does* appear. So the confirm never reached the BFF, and the 404 came from something in front of it.

That rules out the whole server-side branch of the original theory: it is not `txConsent.confirmChallenge` failing its session lookup, because that code never ran.

**Also ruled out:** the `#2148` authz-server dotenvx bug (per ai-demo2-54: the fixed container was serving from 02:50:39Z, ~16 min before the failing run, and that bug produced a DENY, not a 404). And the hitl-service challenge store — this endpoint's challenges live in the **BFF session** (`transactionConsentChallenge.js` `store(req.session)`), not hitl-service.

**Not fixed, and deliberately not guessed at.** Two attempts to reproduce failed: the llama.cpp agent stalled mid-run both times and the consent modal never opened. The remaining candidates need a clean reproduction to separate — whether `bffAxios` resolves a different base for POST than GET, and whether the dev proxy is answering 404 without forwarding. Touching `routes/transactions.js` or `transactionConsentChallenge.js` on a guess would be editing a `REGRESSION_PLAN.md` §1 protected surface to fix a fault that the evidence says is not there.

### 4. Chain badge was a hardcoded string, so an errored run looked clean — FIXED (PR #2155)

**Original claim partly wrong:** the `tools/list 401` / `tools/call 401` steps are *not* failures. They are the RFC 9728 challenge probe, and a 401 there is the gateway refusing an anonymous call — the control working. `buildTraceSteps.js` paints them `done` deliberately, and says so.

**The real defect:** `CHAINED` was a literal string in both chain surfaces (`TokenChainTraceRail.jsx`, `TokenChainFilmstrip.jsx`). It never reflected anything, so a run that ended in a genuine error step (step 17, `MCP · error`) wore exactly the same confident badge as a clean one.

**Fixed:** new `chainBadge(trace, steps)` helper in `buildTraceSteps.js`, used by both surfaces. It derives tone from `buildRunStory().outcome`, so it inherits that function's existing judgement — an *expected* DENY stays `CHAINED` because the control worked, and the by-design 401s stay `done`. Only a genuine error step flips the badge to `RUN ERROR` in red.

**Evidence:** 4 new tests in `buildTraceSteps.test.js` (94 pass in that file); full UI suite 389 files / 3319 tests pass; build exit 0.

### 5. Step 10's scope diff is unreadable — OPEN

Renders as `scope ai:agent:readreadtransferopenidprofileoffline_accesswriteemailmortgage:read` — no separators, added and removed scopes mashed into one string, strikethrough landing mid-token. This is the money slide for token exchange and it is currently noise.

**Fix:** split on whitespace, render as chips, colour added vs removed.

### 6. 25 collapsible sidebar groups, and 7 competing ways to start a demo — OPEN

Topbar: Use Cases / Controls / Reset Demo. Toolbar row below: Demo steps / Live Use Cases / Inspectors / Flow Detail / More / Guide / Clear progress. Sidebar repeats Demos / Inspectors / Reset Demo / Sign Out. Sign Out appears three times on one screen.

**Fix:** pick one home for "run a demo", demote the rest.

### 7. Button colours carry no hierarchy — OPEN

Red `Controls`, red `Reset Demo`, green `Demo steps`, purple `Live Use Cases`, blue outlines, salmon `Send` — all equal weight in one 40px band. Red currently means both "destructive" and "open a panel".

**Fix:** one primary per region; reserve red for Reset.

### 8. The user's own prompt bubble is broken — OPEN

The `Copy` button renders as a large blue block at the top-left of the bubble, the prompt text is pushed out of view, and the "You" label sits outside the bubble on the right. Present in every screenshot of the chat pane.

### 9. Home and Dashboard are two different apps — OPEN

Home: no sidebar, marketing hero, four CTAs wrapping 3+1 with `Setup` orphaned on its own row, and `Admin Dashboard` as the filled primary on a customer-facing page. Dashboard: 25-group sidebar, dense toolbars. The four "Core Capabilities" cards are not clickable — they describe the demo, then dead-end.

### 10. `/dashboard` is named Dashboard but shows no banking data — OPEN

For "Super Banking" the whole main area is agent chat + token chain: no balances, no accounts, no transactions, so the transfer has no visible before/after.

**Fix:** surface an accounts strip, or rename to Agent Console.

Related: `/api/token-chain` 401s on every cold page load (fetch fires before the session cookie is live). Harmless, but it is the first thing in the console.

## Not covered

Dark mode · narrow/mobile widths · the other 11 verticals · every admin surface.

## Changelog

- 2026-08-19 — #4 FIXED (PR #2155), #3 rescoped. Investigating #3 disproved two of its three original claims and showed the confirm never reaches the BFF; #4's premise about the 401s was also wrong, though its badge defect was real. Corrections recorded in place rather than quietly dropped.
- 2026-08-19 — #1 and #2 FIXED (PR #2155). `VerifiedBanner` gained a `banner → pill → gone` cycle and moved below the TopNav.
- 2026-08-19 — initial pass, 10 findings, all OPEN.
