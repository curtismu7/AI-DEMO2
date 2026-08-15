# New Relic dashboard, webhook fix, and naming split — design

**Date:** 2026-08-08
**Status:** approved, ready for implementation planning
**Mock:** `docs/superpowers/specs/2026-08-08-newrelic-dashboard-mock.html`

---

## Problem

`/monitoring/new-relic` renders a blank page with no header and no side nav, and
shows "No events received yet" permanently. Three separate defects sit behind
that one screen.

**No chrome.** `App.js` matches `/monitoring/new-relic` before the general
`/monitoring/*` route and returns a bare `NewRelicRoute` that renders
`<PingOneEventPanel />` with no `AppShell`. PR #1452 stripped the chrome
deliberately to make the route public. The result is a 92-line panel alone on a
white page.

**Wrong data source.** The page is named "New Relic" but renders PingOne webhook
events from `/api/pingone-events`. Actual New Relic data — 118 `app_event` plus
`ui_event` records in account 8369622, confirmed by NRQL read-back — is
displayed nowhere in the UI.

**Webhook can never fire.** `PINGONE_WEBHOOK_SECRET` is unset in the container
and absent from every `.env`. `_hmacOk()` returns `false` before examining the
request, so every POST to `/webhook/pingone` gets 401 `invalid_signature`
(verified live). Independently, the endpoint lives on `api.ping.demo:3001`, a
local hostname PingOne cannot route to.

---

## Decisions

| Question | Decision |
|---|---|
| Auth posture | Page and proxy stay **public** — no session required |
| Dashboard content | Identity pipeline story, not classic ops metrics |
| PingOne panel | Moves to its own page and nav entry |
| Theme | Light/dark toggle wired to the app's existing `useTheme()` |

**On the public choice.** This was chosen with the tradeoff stated: NR log
attributes carry `username`, `sessionId`, and `requestId`
(`newRelicForwarder.js` `forwardAppEvent`), so an unauthenticated visitor can
read them. Locally that is demo data behind a local-only hostname. On the SE AWS
deployment (`ai-demo.ping-devops.com`) the page is reachable from the open
internet. Revisit if real user data ever flows through `app_event`.

---

## Scope A — the dashboard

### Routing and chrome

`App.js` passes `user` and `logout` into `NewRelicRoute`; the route wraps its
content in `AppShell`, restoring `TopNav` and `AdminSideNav`. The page stays
public — no auth guard is added.

`TopNav` and `AdminSideNav` are already null-safe (`user?.role`,
`{user && …}`, `user?.role || "guest"`, an early `if (!user) return`), so
rendering full chrome for a signed-out visitor is safe. `/monitoring/new-relic`
is deliberately **not** added to `isNoChromeRoute()` — with `user` null,
`appRendersSideNav` returns false and `shellRendersSideNav` returns true, so
`AppShell` supplies the sidebar.

The duplicate `<Route path="new-relic">` in `MonitoringRoutes.js` is removed. It
is dead code: `App.js` matches first, so it has never rendered.

### BFF proxy

New `demo_api_server/routes/newRelicQuery.js`, mounted public at
`/api/newrelic`. One endpoint:

```
GET /api/newrelic/pipeline?window=30m|1h|24h
```

**Named queries only — the client sends no NRQL.** The public decision governs
what is displayed, not whether arbitrary queries are accepted. An open
passthrough would let any caller run expensive NRQL against account 8369622 and
read every event type in it, not just this demo's. `window` is validated against
a fixed map and never interpolated raw.

Three NRQL statements issued in one NerdGraph request:

| Purpose | Query |
|---|---|
| Funnel | `SELECT count(*) FROM Log WHERE logtype='app_event' FACET category SINCE <w>` |
| Timeseries | same, plus `TIMESERIES` |
| Stream | `SELECT timestamp, message, category, severity, correlationId FROM Log WHERE logtype='app_event' SINCE <w> LIMIT 50` |

Auth uses `NR_USER_API_KEY` and `NR_ACCOUNT_ID`, already present in
`demo_api_server/.env`. Returns 503 `{ error: 'newrelic_not_configured' }` when
either is absent, mirroring the forwarder's existing no-op discipline. 10s
timeout. Never throws.

### Dashboard component

New `NewRelicDashboard.jsx` and `.css`:

- **Pipeline strip** — fixed stage order `oauth → token_exchange →
  introspection → intent_auth → mcp`, count per stage, bars scaled to the
  largest stage, zero-count stages dimmed.
- **Timeseries** — stacked area via `chart.js` + `react-chartjs-2`, both already
  in `package.json`. No new dependency.
- **Recent events table** — time, category, severity, message, correlationId.
  The correlationId column is what makes one agent turn legible across stages;
  it is the payoff of the correlation fabric from PR #1442.
- **Controls** — window selector (30m/1h/24h, default 1h), manual refresh, 30s
  auto-poll.
- **States** — loading, not-configured, error, empty, each explicit.

Severity is rendered with CSS dots, not emoji: REGRESSION_PLAN §0 permits only a
ten-emoji allowlist, and `info`/`warn` markers are not on it.

### Theme

The dashboard consumes the app's existing `useTheme()` from
`context/ThemeContext.js` and renders a toggle matching the `role="switch"` plus
thumb idiom already used in `TokenTopologyPanel.jsx`. It does **not** introduce
page-local theme state — that would create a second, competing source of truth.
`ThemeProvider` wraps at `App.js:456` and the route sits at line 510, so
`useTheme()` resolves even signed-out.

One constraint is inherited deliberately: `ThemeContext` is never seeded from
`prefers-color-scheme`, and its comment explains why — only some components
carry dark styling, so following the OS turned dark-capable panels dark with no
way back. The dashboard defaults light and changes only on explicit toggle.

This makes the dashboard one of the few fully dark-capable pages. That is
acceptable because it is self-contained: it shares no styling with the legacy
panels the original constraint was written about.

---

## Scope B — the PingOne webhook

Generate `PINGONE_WEBHOOK_SECRET`, add it to `demo_api_server/.env` and document
it in `.env.example`. This alone lifts the blanket 401.

Reachability is **documented, not provisioned.** PingOne must reach
`/webhook/pingone` over the public internet; `api.ping.demo:3001` is local-only.
The spec records the tunnel requirement and the PingOne-side subscription steps.
Until that is stood up the panel still reads zero, and the implementation must
not claim otherwise.

---

## Scope C — naming

- `/monitoring/new-relic` — the New Relic dashboard. Nav label unchanged, now
  finally accurate.
- `/monitoring/pingone-events` — `PingOneEventPanel`, new nav entry, also public,
  also `AppShell`-wrapped.

---

## Non-goals

- Fixing the mangled APM transaction names. PR #1442's middleware emits a single
  concatenated name — `WebTransaction/Expressjs/GET//api/users,/api/accounts,…`
  — instead of naming the route. Real defect, separate change.
- Reconciling `TokenFlowDetailModal.jsx:767`, which holds local `useState(true)`
  dark mode detached from the shared context. Pre-existing inconsistency.
- APM/ops metrics on the dashboard. Deferred until transaction naming is fixed,
  since the names currently read poorly.
- Provisioning any public tunnel or changing PingOne configuration.

---

## Verification

| Layer | Command | Gate |
|---|---|---|
| BFF | `cd demo_api_server && CI=true npm test -- --forceExit` | new route: 503 path, window validation, NerdGraph failure |
| UI unit | `cd demo_api_ui && npm run test:unit` | dashboard renders each state |
| UI build | `cd demo_api_ui && npm run build` | exit 0 — REGRESSION_PLAN §0 hard gate |
| Cross-service | `npm run topology:verify` | no drift |

Manual check on `local.ping-devops.com:4000/monitoring/new-relic` (the only host
where sessions work): header and side nav present, pipeline counts non-zero,
theme toggle flips the page, and the panel degrades to the not-configured state
when `NR_USER_API_KEY` is removed.

All work happens in an isolated worktree per CLAUDE.md; staging is explicit,
never `git add -A` (a BFF jest run regenerates hundreds of data artifacts).

---

## Risks

**Empty dashboard during a demo.** The pipeline shows real but bursty traffic —
a measured 12h window ran `0 3 0 0 0 0 0 0 0 0 93 29`. A cold environment shows
mostly zeros. The empty state must read as "no traffic yet", never as an error.

**NerdGraph rate limits.** 30s polling across several open tabs could trip
account limits. The endpoint issues one request per poll, not three.

**Public exposure on SE AWS.** Stated above; accepted for the demo environment.
