# Regression — UI Browser Tests (Playwright)

No live `banking_api_server` needed — `/api/*` is stubbed via Playwright route intercepts.

## Smoke suite (fastest, runs in CI)

```bash
npm run test:e2e:ui:smoke
```

Specs included:
- `tests/e2e/customer-dashboard.spec.js` — Customer Dashboard loads, accounts/transactions display, demo fallback, transfer/deposit/withdraw forms
- `tests/e2e/landing-marketing.spec.js` — Landing page hero, CTA buttons, feature copy

**Floating Banking Agent** is **not** rendered on the unauthenticated marketing `/` — agent E2E (`test:e2e:agent`) assumes FAB only after sign-in on **`/dashboard`** or **`/admin`**.

## Individual spec runners

```bash
# Customer dashboard only
cd banking_api_ui && npm run test:e2e:customer

# Landing page only
cd banking_api_ui && npm run test:e2e:landing

# Admin dashboard
cd banking_api_ui && npm run test:e2e:admin

# Banking Agent (FAB, MCP action buttons, collapse)
cd banking_api_ui && npm run test:e2e:agent
```

## Full browser suite

```bash
cd banking_api_ui && npm run test:e2e:ci
```

Includes admin dashboard, Banking Agent, security settings, session regression.

## After UI changes — what to re-run

| Changed file | Run |
|---|---|
| `UserDashboard.js` / `TransactionConsentModal.js` / `dashboardLayout.js` | `test:e2e:customer` + manual post-deploy §2 (HITL popup, Split/Classic) |
| `LandingPage.js` | `test:e2e:landing` |
| `BankingAgent.js` / `ActionForm.js` | `test:e2e:agent` |
| `Dashboard.js` (admin) | `test:e2e:admin` |
| `App.js` / `App.css` / `DashboardQuickNav.*` / `AgentUiModeToggle.*` / `EducationBar.js` | `test:e2e:landing` + `test:e2e:customer` + `test:e2e:admin` + manual post-deploy rail + agent toggle |
| `appToast.js` / `dashboardToast.js` / toast copy in any screen | Smoke affected routes; confirm success/error/warning uses **react-toastify** (no `alert()`, no orphan `toast.*` except dismiss/update/loading in Banking Agent) |
| Any auth/session flow | `test:e2e:session` |

## Mock helpers

`tests/e2e/helpers/customerDashboardMocks.js` — shared Playwright route stubs for
`/api/auth/oauth/*`, `/api/accounts/my`, `/api/transactions/my`. Import and call
`setupDashboardMocks(page)` inside your `test.beforeEach`.
