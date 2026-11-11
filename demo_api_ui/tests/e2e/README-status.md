# E2E spec status (2026-11-10)

Measured on one Mac against a throwaway Vite dev server (`CERT_DIR=... PORT=4041 npx vite`, HTTPS) with
`PLAYWRIGHT_BASE_URL=https://127.0.0.1:4041 PLAYWRIGHT_SKIP_WEBSERVER=1`, one browser worker per spec file
group, video/trace off. Code under test: `curtis/main` at `f1a417b9e` (2026-11-10), which includes the
`/dashboard` frame (#3563). The branch is rebased onto `2c7ca86e0`, 4 commits later (none touch e2e files,
but the specs were not re-run on them). Counts are real runs, not estimates. This work is parked: see "Not finished".

## What runs in CI

Only one job runs Playwright: `ci.yml` job `ui`, step "Movie reel is on screen and the shell is
keyboard-reachable", and only when `scripts/reel-guard-needed.mjs` says the UI change needs it:

    playwright test tests/e2e/movie-reel-visible.spec.js tests/e2e/shell-keyboard.spec.js   (CI=true, port 4173)

Every other spec below exists but no workflow runs it. `url-smoke.spec.js` is deliberately manual
(`npm run test:e2e:smoke`, see `scripts/run-url-smoke.mjs`). The 40 `*.real.spec.js` specs run only through
`playwright.real.config.js` (`npm run test:e2e:real*`) and need a live tenant/stack.

## Why so many specs were red

1. **Stale page structure.** Pages were converted or replaced and the specs were never re-run (no CI job
   runs them): `/mcp-inspector` -> `/pingone-mcp-inspector`, `/agent-flow-inspector` is now the run-history
   page, the Agent Gateway Configuration page has no route, `/` is the landing page, `/dashboard` has no
   banking column in the default Focus Mode layout, non-admins at `/admin` get a confirm modal, etc.
2. **Specs were not hermetic.** They stub the `/api` calls they know about; any other call goes through the
   dev-server proxy. With a BFF running on :3001 (the normal local stack) that answers `401`, which opens the
   global "Sign in required" modal over the page (and makes every `getByRole` miss, because the modal makes the
   rest of the page inert). With no BFF (CI) the same call fails differently and the spec passes by accident.
   Fixed with a lowest-priority `**/api/**` -> `200 {}` catch-all in the specs' mock helpers.
3. **A route glob that matched source files.** `'**/mcp**'` (abort) also matched dev-server module URLs such
   as `/src/services/mcpCallStore.js`, so the page failed to load. Replaced by an exact `/mcp` matcher.

## Results (before -> after, this branch)

"Before" is the spec as on `curtis/main`. Where a run was cut off the count says so.

| Spec | Runs in CI? | Before | After | Why it failed (class) | Next action |
|---|---|---|---|---|---|
| pingone-mcp-inspector | no | 4 pass / 17 fail of 21 (owner saw 16; the 17th was a cold-compile timeout on the first test) | 21 / 21 | Stale: page is `McpInspectorPageClean` on `InspectorLayout`: one "Server" `<select>` instead of source pills, a searchable tools table, "Send" not "Execute", no Form tab (result card instead), "Server profile" select, new Add-server placeholders, "All API calls" source, default source is AI Demo MCP. The MFA step-up banner test was dropped: the BFF no longer returns `mfa_required` (asserted in `mcp-inspector.test.js`) and the page has no banner. | none |
| mcp-inspector | no | 0 / 2 | 2 / 2 | Stale: tested the removed `/mcp-inspector` page (redirects to the unified inspector). Rewritten for the current page: tools table, required-param block, Send, result card. | none |
| pinggateway-inspector | no | 13+ of 17 failing (run disturbed by an edit) | 13 / 13 | Stale: the tabbed "Agent Gateway Configuration" page (`McpGatewayConfig`) has no route; `/agent-gateway-inspector` is `AgentGatewayInspectorClean`. Rewritten for it (status chip, Gateway picker, Authz toggle, decisions, Send, redirects). | `McpGatewayConfig.jsx` is orphaned (no route imports it): delete or re-mount, owner decision |
| agent-flow-inspector | no | 1 / 9 run, 8 fail (cut off; 11 tests) | 7 / 7 | Stale: `/agent-flow-inspector` is the "Agent & Token Flow History" page; the 3-tab inspector is gone from it. Rewritten for the master-detail history view. | none |
| ciba-approve | no | 17 / 19 | 19 / 19 | Stale copy: title is "Local CIBA Simulation", prompt "This local simulation needs your approval." | none |
| customer-dashboard | no (`test:e2e:landing/customer` scripts exist) | 0 / 7 | 7 / 7 | Stale: default `/dashboard` is Focus Mode with no banking column; specs now set `banking_agent_ui_v2` placement `none` to get accounts/transactions. Sign Out is the icon-only side-nav item and asks for confirmation. `/mcp-inspector` redirects. Non-admin at `/admin` gets the "Admin sign-in required" dialog (Cancel goes home), not a redirect. | none |
| admin-dashboard | no | 6 / 12 | 12 / 12 | Hermeticity (401 modal) + `**/mcp**` glob + stale: `/` is the landing page (Users/Accounts nav now checked on `/admin`, "Administration" group); non-admin gets the prompt. | none |
| banking-agent | no | 0 / 11 run (cut off; 14 tests) | 14 / 14 | `**/mcp**` glob + hermeticity; sign-out and Admin Tools trigger live in the Demo Controls dock now. | none |
| agent-legacy-bottom-no-duplicate | no | 0 / 1 | 1 / 1 | `**/mcp**` glob. | none |
| hitl-transfer | no | 0 / 2 | 2 / 2 | Race (agent panel mounts before the dashboard chunk; wait for the h1), float layout needed for the transfer form, ambiguous `getByText('Transfer')`. | none |
| hitl-agui-interrupt | no | 0 / 1 | 1 / 1 | AG-UI path is only taken in an LLM agent mode; default Heuristics goes to `/api/demo-agent/nl`. Spec now stubs `agent_mode: llamacpp`. | none |
| pf-idjag-run-mode | no | 7 / 8 | 8 / 8 | UC40 test: "Demo steps" is the header button (`topnav-demo-steps-trigger`) on `/dashboard`; the modal scrim it asserted was removed 2026-09-28 (unit-tested in `DemoStepsDropdown.test.jsx`). Opens it before the dock (the dock covers the header button) and asserts no scrim + chip edge not covered. | none |
| session-lab | no | 1 / 4 (0 / 4 whenever a BFF is up) | 4 / 4 | Hermeticity: unstubbed `/api/user/nav-config` -> 401 modal. | none |
| security-settings | no | 2 / 11 | 11 / 11 | Hermeticity (401 modal). | none |
| use-cases-catalog | no | 2 / 15 | 15 / 15 | Hermeticity + signed-out visitors now see "Sign in required" in place (no redirect). | none |
| use-cases-live | no | 0 / 18 | 18 / 18 | Same, plus "Policy" glance label is now "Verdict", card title is "1 . <title>", drawer heading by role. | none |
| token-exchange-tester | no | needs live stack | 5 skipped | Hard-wired to `https://api.ping.demo:4000` and posts an exchange to that BFF. Now skips unless `E2E_LIVE_STACK=1`. | run with `E2E_LIVE_STACK=1` against the live stack (not run here) |
| task-10-token-chain-qa | no | needs live stack | 14 skipped | Hard-wired to `https://api.ping.demo:4000`. Same skip gate. | same |
| movie-reel-visible | **yes** | 9 / 9 | 9 / 9 | n/a | none |
| shell-keyboard | **yes** | 14 / 14 | 14 / 14 | n/a | none |
| landing-marketing | no | 3 / 3 | 3 / 3 | n/a | none |
| focus-ring-contrast | no | 14 / 14 | 14 / 14 | n/a | none |
| contrast-misc | no | 15 / 15 | 15 / 15 | n/a | none |
| modalFocusZoom | no | 13 / 13 | 13 / 13 | n/a | none |
| mobile-layout | no | 26 / 27 (one `page.goto` timeout while the machine was at load 160) | 27 / 27 | Load, not the spec | none |
| academy-preview | no | 1 / 1 | 1 / 1 | n/a | none |
| telemetry | no | 17 / 17 | 17 / 17 | n/a | none |
| url-smoke | no (manual) | 100 pass / 13 fail of 159 when stopped | not re-run | 13 failures are all in "every converted route mounts as a Ping UI page": `/obo-demo`, `/client-registration`, `/scope-audit`, `/session-lab`, `/delegated-commerce`, `/use-cases/live`, `/group-policy`, `/group-policy/full`, `/settings`, `/feature-flags`, `/agent-lifecycle`, `/aic-token-exchange`, `/agent-builder` (48 s timeouts). Not investigated: these are the routes that need a signed-in user, so likely the same 401/sign-in cause, **unverified**. | investigate (see below) |
| health, banking-operations, session-regression | no | not run | not run | API-only specs (`playwright.api.config.js`), need the BFF on `BANKING_API_BASE`. Needs live stack. | run against a BFF |
| 40 `*.real.spec.js` | no | not run | not run | Need a live tenant/credentials (`playwright.real.config.js`). Needs live stack. | run by the owner |

Unchanged specs were re-run on the merged code and are green: after the changes the whole non-live set
(270 tests) was 213 pass / 57 fail, and the 57 were all in the five specs fixed afterwards
(mcp-inspector, pinggateway-inspector, security-settings, use-cases-catalog, use-cases-live), each re-run
green on its own.

## Not finished

- `url-smoke.spec.js` was stopped at 110 of 159 results (13 failures listed above). It was not re-run.
- Nothing was run through `npm run test:e2e:ci` / CI itself; all runs are the throwaway Vite server above.
- Unit tests were not run (the Air was unreachable); only test files and `playwright.config.js` changed.
- `token-exchange-tester` and `task-10-token-chain-qa` were not run against the live stack.

## Product findings

No product bug found. Behaviour changes the specs now reflect, all by design in source:
`RequireAdminLogin` shows a confirm dialog (never redirects) for non-admins; Focus Mode `/dashboard` has no
banking column; the removed scrim; the dropped MFA step-up banner. One cleanup candidate:
`src/components/McpGatewayConfig.jsx` has no route any more (only a CSS import and hooks reference it).

## Config change

`playwright.config.js` `testIgnore` now also lists `**/*.real.spec.js`. Before, `npx playwright test` with no
file arguments collected the live specs too, and the whole run died while loading
`capture-goldens.real.spec.js` (it requires `demo_api_server` modules that are not installed in
`demo_api_ui`). The live specs keep running through `playwright.real.config.js` (own `testMatch`).
