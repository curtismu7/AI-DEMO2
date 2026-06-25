# Regression Testing — Quick Reference

This folder contains focused runbooks for each regression layer.
No single file is allowed to exceed ~300 lines so context windows stay manageable.

| File | Covers |
|------|--------|
| [api-session.md](api-session.md) | Jest session/OAuth unit tests; BFF store ping; auth state cookies |
| [ui-browser.md](ui-browser.md) | Playwright browser E2E: customer dashboard, landing page, admin dashboard, Banking Agent |
| [post-deploy.md](post-deploy.md) | Manual smoke checks after production or preview deploys |
| [../PINGONE_AUTHORIZE_PLAN.md](../PINGONE_AUTHORIZE_PLAN.md) | PingOne Authorize integration plan (decision endpoints, overview links) |

**Toast notifications**: User-visible success / error / warning should use **`appToast`** (`notify*`); session + Sign-in use **`dashboardToast`**. See **`REGRESSION_LOG.md`** (2026-03-26 — UI notifications) and **post-deploy.md** §4 (step-up toast).

**Split dashboard agent** (2026-03-27): **Split view** embeds **`BankingAgent`** with **`splitColumnChrome`** (navy header, session id, **Sign out**, compact input + **Send**, suggestion chips). Scroll the transcript and the lower tray independently. See **`REGRESSION_LOG.md`** (2026-03-27 — split-column agent UX + SecureBank-style chrome).

**Agent UI placement** (2026-03-27): `AgentUiModeContext` now stores `{ placement: 'middle' | 'bottom' | 'none', fab: boolean }` under `banking_agent_ui_v2`. Toggle renders **Middle / Bottom / Float** buttons; **+ FAB** checkbox appears when placement is `middle` or `bottom` (Middle+Bottom together not permitted). Key regressions: (1) toggle persists across reload; (2) Middle sets `split3` layout with slim token-chain column (`160–200px`); (3) Bottom renders `EmbeddedAgentDock` flush to page content with drag-to-resize handle as the visual seam; (4) Float shows FAB only.

**Bottom dock integration** (2026-03-27): Resize handle moved to top of dock (acts as the join between page content and panel — no gap). Collapsed state retains rounded-pill top corners; expanded state is flush/square. `padding-bottom` removed from `.user-dashboard--embed-agent`. Dark-theme overrides updated.

**Token Inspector panel** (2026-03-27): Each token chain event row now shows a hover-reveal inspect icon (magnifying glass SVG). Clicking it opens a floating `TokenInspectorPanel` (portal → `document.body`) that is draggable by header, resizable via bottom-right grip, collapsible, and can move off-screen. Key regressions: (1) panel opens on inspect-icon click; (2) drag and resize work; (3) collapse toggles body visibility; (4) close dismisses the panel; (5) clicking a different row's icon opens a new panel at that row's position.

**Landing page quick-links** (2026-03-27): Hero section now includes `.hero-quick-links` row of shortcut buttons: CIBA guide (fires `education-open-ciba` event), CIMD Simulator (fires `education-open-cimd`), Home (`/`), Dashboard (OAuth user login), API (`/api-traffic` popup), Logs (OAuth admin login), Demo config (`/demo-data`). Key regressions: (1) all 7 buttons are visible in the hero; (2) CIBA and CIMD buttons dispatch the correct custom events; (3) API button opens the traffic window; (4) Demo config navigates to `/demo-data`.

**mcp_resource_uri Config field** (2026-03-27): Admin → Config now shows "MCP Resource URI (RFC 8693 audience)" text field. Key regressions: (1) field appears alongside MCP Agent URL; (2) saving a URI persists it to configStore; (3) `agentMcpTokenService` reads the saved value and uses it as the token exchange audience.

**Best Practices panel** (2026-03-27): New `BestPracticesPanel.js` education drawer. Accessible from the hamburger menu → `⭐ AI Agent Best Practices` (featured blue button). Key regressions: (1) button appears in edu-bar menu; (2) panel opens with Overview tab showing the 5 Ping Identity practice cards; (3) each of the 5 practice tabs renders with implementation status rows and code snippets; (4) `EduLink` buttons inside each tab open the related panel and close Best Practices first; (5) panel closes on Escape and X button.

**Delegated Access** (2026-03-27): New route `/delegated-access` (`DelegatedAccessPage.js`). Two tabs — "Access I've granted" and "Granted to me". "+ Add person" modal supports name, email, relationship, and multi-account checkbox selection. "Act as" button opens a dark RFC 8693 explainer panel with the token-exchange request params and `act` / `may_act` claim explanation. "Revoke" removes a delegation. Quick-action link added to UserDashboard. Key regressions: (1) page renders at `/delegated-access` for authenticated users; (2) add-person modal validates required fields and account selection; (3) new delegation appears in list after save; (4) Act as panel opens and simulate button fires toast.

## Run everything (CI order)

```bash
# 1. API + session unit tests
npm run test:session

# 2. UI smoke (no running server needed — mocked API)
npm run test:e2e:ui:smoke

# 3. Full Playwright suite (needs CRA dev-server or build)
cd banking_api_ui && npm run test:e2e:ci
```
