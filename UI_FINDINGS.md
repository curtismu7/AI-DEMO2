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
| 3 | `consent-challenge/:id/confirm` 404s during a live drive | unknown | High | OPEN | Rescoped twice; 3 of 4 claims withdrawn, incl. my own log evidence |
| 4 | Chain badge was a hardcoded string, so an errored run looked clean | UI | Medium | FIXED | PR #2155 — badge derives from `runStory.outcome` |
| 5 | Scope diff on chain step 10 is unreadable | UI | Medium | OPEN | Highest demo-value fix |
| 6 | 25 sidebar groups, 7 ways to start a demo, Sign Out ×3 | IA | Medium | OPEN | |
| 7 | Button colours carry no hierarchy | UI | Low | OPEN | |
| 8 | User prompt bubble layout broken | UI | Medium | OPEN | |
| 9 | Home and Dashboard are two different apps | IA | Low | OPEN | |
| 10 | `/dashboard` shows no banking data; `/api/token-chain` 401 on cold load | UI + BFF | Low | OPEN | |
| 11 | CIBA phone simulator is a dead end in every non-pending state | UI | High | FIXED | PR #2158 — reported by the user as "never accepts Approve" |

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

**Open, being reproduced properly.** Method for the retry, since the last two attempts were void for a different reason (the llama.cpp agent stalled and the modal never opened): pin `docker inspect <ui,bff> --format '{{.State.StartedAt}}'` before and after the run, and treat the run as void rather than a finding if either moved. Capture the 404 response body — JSON means the BFF answered, HTML means a proxy or static handler did, which separates the two remaining branches in one look.

**Standing lesson, worth more than this one 404.** `deploy-live.sh` takes a lock so two deploys cannot race, but nothing warns a session mid live-UI-drive that its containers are about to be pulled. Any deploy restarts `ui` and/or `demo-api-server` under whoever is driving the browser, and it surfaces as an inexplicable 404/502 with no server-side trace. Before trusting any live-drive observation, check when the ground moved.

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

## Not covered

Dark mode · narrow/mobile widths · the other 11 verticals · every admin surface.

## Changelog

- 2026-08-19 — #11 added and FIXED (PR #2158): the CIBA phone simulator's dead-end footer, the single-fetch that could never recover, and a §0 muted-text violation in the same modal.

- 2026-08-19 — #3 rescoped again: my "zero POST in the BFF logs" evidence was void (the BFF container restarted after the failure, so I queried logs from a container that was not running at the time). Reproduction method corrected to pin container StartedAt before and after a run.
- 2026-08-19 — #4 FIXED (PR #2155), #3 rescoped. Investigating #3 disproved two of its three original claims and showed the confirm never reaches the BFF; #4's premise about the 401s was also wrong, though its badge defect was real. Corrections recorded in place rather than quietly dropped.
- 2026-08-19 — #1 and #2 FIXED (PR #2155). `VerifiedBanner` gained a `banner → pill → gone` cycle and moved below the TopNav.
- 2026-08-19 — initial pass, 10 findings, all OPEN.
