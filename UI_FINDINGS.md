# Live UI Findings — Super Banking demo

Source: Playwright drive of `https://local.ping-devops.com:4000` on **2026-08-19**, signed in as Demo User (Customer), vertical Super Banking, Agent mode Heuristics. Ran UC8 (HITL consent transfer, $300 checking→savings) to a terminal decline, then reviewed Home and `/dashboard`.

**Working rule:** when a finding is fixed, flip its Status row to `FIXED` with the PR number and evidence **in the same commit as the fix**, and add a Changelog line. A status column that lags the code is the same false-green failure as finding #1.

## Status key

`OPEN` · `IN PROGRESS` · `FIXED` (needs PR # + evidence) · `WONTFIX` (needs reason) · `INVALID`

## Findings

| # | Finding | Area | Severity | Status | Notes |
|---|---------|------|----------|--------|-------|
| 1 | Verification pill never dismisses | UI | High | OPEN | |
| 2 | Pill covers the Sign Out button | UI | High | OPEN | Same root cause as #1 |
| 3 | `consent-challenge/:id/confirm` 404s twice, demo still scores ✅ | BFF + verdict | High | OPEN | |
| 4 | Chain badged `CHAINED` while carrying 401s | UI | Medium | OPEN | |
| 5 | Scope diff on chain step 10 is unreadable | UI | Medium | OPEN | Highest demo-value fix |
| 6 | 25 sidebar groups, 7 ways to start a demo, Sign Out ×3 | IA | Medium | OPEN | |
| 7 | Button colours carry no hierarchy | UI | Low | OPEN | |
| 8 | User prompt bubble layout broken | UI | Medium | OPEN | |
| 9 | Home and Dashboard are two different apps | IA | Low | OPEN | |
| 10 | `/dashboard` shows no banking data; `/api/token-chain` 401 on cold load | UI + BFF | Low | OPEN | |

---

### 1. The green ✅ verification pill never goes away — OPEN

`demo_api_ui/src/components/VerifiedBanner.jsx:20-38` collapses the banner to a pill after 6s, but the pill has no dismiss timer and no close button. It stayed pinned top-right reading `✅ hitl-consent verified` while the confirm call 404'd twice and the user declined the transaction.

Worst case in front of a customer: a green checkmark parked over a broken flow.

**Fix:** second `setTimeout` to clear the pill, or add an ✕.

### 2. That pill physically covers the Sign Out button — OPEN

`createPortal` → `document.body`, fixed positioning, no z-index coordination with the topbar. "Sign Out" renders as "Si". Resolved by fixing #1.

### 3. `POST /api/transactions/consent-challenge/:id/confirm` 404s twice, demo still reports success — OPEN

Console showed two 404s on the same challenge id ~3.5s apart. Route exists (`demo_api_server/routes/transactions.js:198`), so `txConsent.confirmChallenge` did not find the challenge in session — and the button fired twice with no in-flight guard. The verdict engine scored "approval was required" ✅ without ever checking that the transfer executed.

**Fix:** disable confirm while in-flight; make the UC8 verdict require the terminal outcome, not just that a challenge was raised.

### 4. Token chain says `CHAINED` while carrying `tools/call 401` and `MCP error` — OPEN

Steps 16 and 17 are red failures inside a chain badged green `CHAINED`. The badge means "steps are linked"; the audience reads "it worked".

**Fix:** rename to `LINKED`, or make the badge reflect worst-step status.

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

- 2026-08-19 — initial pass, 10 findings, all OPEN.
