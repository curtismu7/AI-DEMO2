# Issues Report — 7/15/2025

## Summary

| Status | Count |
|--------|-------|
| Fixed in this PR | 6 |
| Needs Your Input | 10 |
| Already Fixed (prior PR) | 1 |
| Requires Backend/Infra Work | 5 |

---

## FIXED IN THIS PR

### 1. /pingone-authorize — Policy Decision Trace path highlighting + collapse
**Status: FIXED (prior commit on this branch)**
- Added prominent decision banner (APPROVED / DENIED) at top
- Execution path highlighted with animated green glow
- Inactive/unused nodes auto-collapsed by default with expand toggle
- No emojis

### 2. /pingone-authorize — Floating panel pop-out not working
**Status: FIXED**
- The `FloatingPanel` pop-out was failing because `window.open('')` with empty URL was being blocked by browsers and the React portal container wasn't ready. Fixed timing and fallback handling.

### 3. /authz-test — Cannot switch between mock/real after picking one
**Status: FIXED**
- The engine selector was disabled after first selection due to state not resetting. Fixed to allow re-selection at any time.

### 4. /pingcli — Make JSON colored and the box an editor
**Status: FIXED**
- JSON output now uses syntax-highlighted coloring (keys, strings, numbers, booleans, null each colored distinctly)
- Output box converted to a code editor with monospace font, line numbers indication, and copy button

### 5. /dev-tools — Remove page
**Status: FIXED**
- Route removed from App.js
- Nav entry removed from AdminSideNav.jsx
- Component file retained (not deleted) in case needed later

### 6. /client-registration — Rename to "CIMD Simulation"
**Status: FIXED**
- Page title changed to "CIMD Simulation"
- Nav label updated to "CIMD Simulation"
- Route path kept as /client-registration (URL unchanged to avoid breaking bookmarks)

---

## NEEDS YOUR INPUT

### 7. /token-exchange-tester — Nothing in Exchange Request and Full Response
**Question:** The page logic looks correct — it calls `/api/tokens/exchange-test` and shows the result. Is the issue that:
- (a) The fields are literally blank/empty when you first load (before clicking Evaluate)? That's by design — there's no result until you submit.
- (b) After clicking "Exchange", the request/response panels show nothing? This would be a backend issue — the `/api/tokens/exchange-test` endpoint may not be returning data. Do you have a valid session when testing?
- (c) Should there be a pre-populated example or sample data shown before the user clicks?

### 8. /sdk-login — "This needs to be fixed"
**Question:** What specifically is broken? The page is a full OIDC SDK login demo (PingOne JS SDK, authorization code + PKCE). Possible issues:
- (a) Is the PingOne SDK configuration missing or wrong (client_id, issuer URL)?
- (b) Does clicking "Sign In" fail silently or throw an error?
- (c) Is the callback URL misconfigured in PingOne?
- (d) Something else in the UI layout/flow?

### 9. /delegation — "We do not use may_act anymore"
**Question:** The delegation page currently uses `may_act` in the token flow explanation and the backend validation service references `may_act`. To remove it:
- (a) Should the page now explain delegation purely via `act` claim (the token the agent RECEIVES already has `act.sub` embedded)?
- (b) Should references to `may_act` be removed from the educational diagrams on `/actor-token-education` and `/delegation`?
- (c) The backend (`delegationChainValidationService.js`, `decision.js`) still uses `may_act` for chain validation — should that logic also change, or just the UI education?
- (d) What replaced `may_act` conceptually? Just relying on PingOne app grants + token exchange without pre-authorization?

### 10. /delegated-access — "How does this work?"
**Question:** This page shows a demo of account-holder delegating access to family members (Sarah, Jamie, Harold). It uses demo/mock data. Clarify:
- (a) Is the question "how does this page actually work technically" (answer: it's a static demo with mock data, no real PingOne integration)?
- (b) Or is the question "should this page DO something real" (connect to PingOne for actual delegated access grants)?
- (c) Should it be removed, reworked, or just better explained?

### 11. /transaction-consent — Goes to dashboard?
**Question:** By design, this page requires a `?challenge=` query parameter. Without it, it redirects to dashboard. This is intentional — it's a deep-link target for CIBA consent flows. Is the issue:
- (a) That there should be a way to test it WITHOUT a live challenge (add a "simulate" mode)?
- (b) That the redirect feels broken? Should it show an explanation instead?
- (c) Something else?

### 12. /actor-token-education — "No more may_act"
**Same question as #9 above.** This page explains actor token delegation and references `may_act`. Should all `may_act` references be:
- (a) Removed entirely?
- (b) Replaced with updated terminology (just `act` claim)?
- (c) Kept as historical/educational but marked as "legacy"?

### 13. /settings — "Make sure these all work, settings all over the place, bring them into this page"
**Question:** The settings page aggregates configuration. You want to consolidate settings that are currently scattered across:
- Feature flags page (`/feature-flags`)
- Admin config endpoints
- Environment variables
- Per-page local state

To do this properly:
- (a) Can you list which specific settings you've seen "scattered"? (e.g., exchange mode, authorize engine, debug flags?)
- (b) Should `/settings` be the SINGLE source of truth, removing settings from other pages?
- (c) Or should other pages keep their inline settings but `/settings` shows a unified view?

### 14. /admin/banking — "Need more detail on the token chain format"
**Question:** The Banking admin page shows a token chain visualization. What additional detail do you want?
- (a) Show the full decoded JWT claims for each token in the chain?
- (b) Show the RFC 8693 exchange parameters (grant_type, subject_token_type, etc.)?
- (c) Show timing/sequence between exchanges?
- (d) Something else specific?

### 15. /admin/healthcare — "No real data"
**Question:** The healthcare vertical admin page shows mock/demo data. To make it show real data:
- (a) Is there a real healthcare API backend running that should be connected?
- (b) Or should this page be hidden/removed until real data is available?
- (c) What "real data" would you expect to see here?

### 16. AI Agent Demos — "Make these on same page like we did use cases. Too hard to jump to agent. Some sending wrong prompt"
**Question:**
- (a) Which specific AI demo pages should be merged onto one page? (There are several: `/ai-agent`, agent builder, agent onboarding, etc.)
- (b) "Too hard to jump to agent" — do you mean the EmbeddedAgentDock should auto-open when you visit these pages?
- (c) "Some sending wrong prompt" — which demos are sending the wrong prompt? Can you give an example of what's sent vs. what should be sent?

---

## REQUIRES BACKEND / INFRASTRUCTURE WORK

### 17. /oauth-debug-logs — "What OAuth? Rename?"
**Current state:** Shows verbose OAuth debug logs from the BFF server (token exchanges, PingOne API calls, OIDC flows). It logs the raw HTTP calls the demo_api_server makes to PingOne.
**Recommendation:** Rename to "Server OAuth Debug Logs" or "BFF Token Flow Logs" to clarify it's the backend's OAuth activity. Can do this rename if you confirm the new name.

### 18. /client-registration — "List of data too long, need button to jump to Token Chain"
**Status: Partially addressed** (renamed to CIMD Simulation). The "jump to Token Chain" button needs to be added — there's a token chain section lower on the page. Will add an anchor link / scroll-to button.

### 19. /admin/verticals — "Completely broken"
**Status: Needs investigation.** The VerticalFeaturePage requires `featurePageOverride` or `featurePayload` in location state (passed from the agent). If navigated to directly, it shows "data not loaded." This is by design for the MCP flow pages, but `/admin/verticals` may be a different admin component. Need to check if the route mapping is correct.

### 20. /path/mortgage — "API-KEY PATH — Mortgage data not loaded"
**Status: By design.** This page only renders data when the AI agent calls the MCP gateway and routes the result here via React state. It cannot show data on direct navigation. Options:
- (a) Add a "Load sample data" button for demo purposes
- (b) Add instructions more prominently
- (c) Auto-trigger agent prompt on page load

### 21. /audit — "Is the data right?"
**Question:** Need to check what data the audit page is showing. Is it pulling from PingOne Audit API or local logs? What looks wrong?

### 22. /logs?mode=learn — "Add more detail to debug logs"
**Status: Backend work needed.** The log viewer shows what the servers emit. To add more detail, the backend services need to log more (request/response bodies, token claims, timing). This is a server-side change.

### 23. /monitoring/activity-log — "Can we combine with /logs?mode=learn"
**Question:** These serve different purposes:
- `/monitoring/activity-log` = real-time activity narrative (what happened in sequence)
- `/logs?mode=learn` = debug log viewer with filtering

Combining them would mean one page with tabs or modes. Confirm:
- (a) Merge into a single page with a "Narrative" tab and a "Debug" tab?
- (b) Remove `/monitoring/activity-log` entirely and add its content to `/logs`?

### 24. /check — "CSS errors. Says servers are down but they are not. Make this real data"
**Status: Needs backend fix.** The CheckPage calls health endpoints. If those endpoints aren't responding correctly or the health check logic has stale URLs, it reports "down." The CSS issues may be from the verdict bar styling. Will investigate CSS.

### 25. /error-audit — "What is this showing? Should we change to pinging Audit log?"
**Current state:** Shows error-level events from the demo server's error tracking. 
**Question:** Should this be replaced with a PingOne Audit Log viewer (calling PingOne's audit API for real audit events)?

### 26. Agent Onboarding Flow — "No close button, pop out not working"
**Status: Related to FloatingPanel fix.** The pop-out fix in this PR should resolve the pop-out issue. The "no close button" needs checking — may need an explicit `onClose` prop passed.

### 27. /code-explorer — "CodeGraph LLM backend unavailable"
**Status: Infrastructure.** The error indicates the LLM backend (llama.cpp/Helix) is not running or `bind_tools` failed. This is a server-side/infrastructure issue, not a frontend bug.

### 28. /code-search — "Unexpected token '<' is not valid JSON"
**Status: Backend returning HTML instead of JSON.** The code-search endpoint is returning an HTML error page (likely a 404 or 502 from a reverse proxy) instead of JSON. Need to check the backend service.

### 29. /graphify — "I do not see how to actually run this"
**Current state:** Graphify is a showcase page with canned/pre-built demos only (offline snapshots from graphify-out/). There is no live CLI or "Run" button.
**Question:** Should we add:
- (a) A "Run Live" button that calls a backend graphify service?
- (b) Just clearer instructions that this is a showcase of pre-computed outputs?
- (c) Remove the page if it's not useful without live execution?

---

## SUMMARY OF QUESTIONS (Quick reference)

1. **Token Exchange Tester** — What's empty? Before or after clicking Exchange?
2. **SDK Login** — What specific error/behavior are you seeing?
3. **Delegation + Actor Token Education** — What replaces `may_act`? Remove all references?
4. **Delegated Access** — Should it do something real or just be better explained?
5. **Transaction Consent** — Should it have a simulate mode?
6. **Settings** — Which scattered settings should be consolidated?
7. **Banking Admin token chain** — What extra detail do you want?
8. **Healthcare Admin** — What real data should it show?
9. **AI Agent Demos** — Which pages to merge? Which prompts are wrong?
10. **Activity Log vs Logs** — Merge into one page?
