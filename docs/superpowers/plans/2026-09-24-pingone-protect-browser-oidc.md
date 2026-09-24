# PingOne Protect Browser OIDC Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser sign-in demo that gathers PingOne Signals, asks Protect to score an authentication event, and demonstrates Low → OIDC success, Medium → PingOne MFA, and High → block.

**Architecture:** A dedicated Protect lesson under the **Ping products** navigation embeds a run chip and can open as a clean pop-out route. It uses the existing public PKCE OIDC SDK. It gathers Signals in the browser and posts them with the login identifier to a session-scoped BFF evaluation route; the BFF derives request context and calls Protect with its Worker token. The page branches on the risk result and reports authentication completion to the BFF after OIDC returns. Protect runs only when a user clicks the chip; it is not an app-wide feature flag or sign-in hook.

**Tech Stack:** React, React Router, `@forgerock/oidc-client`, PingOne Signals Web SDK, Express, existing PingOne management-token service, Jest/Supertest, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-pingone-protect-browser-oidc-design.md`

## Global Constraints

- Use the existing `PINGONE_SDK_DEMO_CLIENT_ID`, configured redirect URI, PKCE flow, callback, and `step_up_acr_value`.
- Keep PingOne Worker credentials and risk evaluation IDs server-side; bind every evaluation to the current browser session and consume completion once. Carry the evaluated user identifier and issue time in a sessionStorage marker for at most 10 minutes, and only report SUCCESS when the validated OIDC ID token identifies that same user.
- Do not start OIDC on HIGH or on an SDK, config, or Protect evaluation error.
- The page must describe this as a demo application gate; do not imply PingOne's hosted authorization service itself consumes the preflight risk result.
- Keep the existing agent Protect path isolated from the new authentication route and remove agent-dispatch as the Protect page's demo action/copy.
- Place the Protect demo under the side-nav group **Ping products** and keep the project emoji allowlist and theme/contrast requirements.
- After UI changes run `cd demo_api_ui && npm run build`; focused UI tests use Vitest. BFF tests run with `CI=true`.
- Before running a service's tests, run `npm ci` in that service if its `node_modules` are missing.
- Use `npm run serve:worktree here` if the shared local stack must serve worktree code; never run `docker compose` from the worktree.

---

## File Map

- `demo_api_server/services/pingOneProtectService.js`: add an authentication evaluation method while preserving existing agent-dispatch behavior.
- `demo_api_server/routes/protectAuthentication.js`: create and complete Protect evaluations, scoped to the Express browser session.
- `demo_api_server/server.js`: mount the new BFF route.
- `demo_api_server/tests/protectAuthentication.test.js`: route contract, session binding, completion lifecycle, and failure tests.
- `demo_api_server/tests/pingOneProtectService.authentication.test.js`: Protect request body and API error behavior.
- `demo_api_ui/src/services/protectAuthenticationService.js`: browser calls for create/complete endpoints.
- `demo_api_ui/src/lib/pingOneSignalsSdk.js`: load/init/getData for the Signals web SDK with bounded timeouts and no payload logging.
- `demo_api_ui/src/pages/PingAiProductPage.jsx`: replace agent-dispatch Protect content/action with the browser OIDC lesson and embed the run experience.
- `demo_api_ui/src/pages/PingOneProtectBrowserDemo.jsx` and `.css`: provide the themed run chip, outcomes, status/error states, and pop-out presentation.
- `demo_api_ui/src/components/AdminSideNav.jsx`, `navStructureCatalog.js`, and `DemoConfigPage.js`: place PingOne Protect in the exact **Ping products** group.
- `demo_api_ui/src/App.js` and `demo_api_ui/src/routes/sideNavOwner.js`: mount the standalone `/protect-auth-demo` pop-out without app chrome.
- `demo_api_ui/src/pages/SdkLoginCallback.jsx`: preserve normal SDK login and popup behavior; add the Protect flow completion and return path only when the session-scoped Protect marker is present.
- `demo_api_ui/src/pages/__tests__/PingAiProductPage.test.jsx`, `SdkLoginCallback.test.jsx`, and new service/SDK focused tests: pin UI branches, callback feedback, and safe SDK failure behavior.
- `demo_api_ui/src/routes/sideNavOwner.js`: keep `/ai-products/protect` in the normal app shell and let the pop-out route omit app chrome.

## Task 1: Add a session-bound authentication evaluation API

**Files:**
- Modify: `demo_api_server/services/pingOneProtectService.js`
- Create: `demo_api_server/routes/protectAuthentication.js`
- Modify: `demo_api_server/server.js`
- Create: `demo_api_server/tests/pingOneProtectService.authentication.test.js`
- Create: `demo_api_server/tests/protectAuthentication.test.js`

**Interfaces:**
- Service `createAuthenticationEvaluation({ userId, ip, userAgent, signalsData, targetResourceId, sessionId })` sends an `AUTHENTICATION` risk event, with `user.type = 'PING_ONE'`, to the existing risk-evaluation endpoint and returns the evaluation resource.
- `POST /api/protect-auth/evaluations` accepts `{ userId, signalsData }` plus `x-protect-auth-csrf`; it returns `{ flowId, level, recommendedAction }` and keeps the evaluation ID in `req.session` under that flow ID. HIGH is completed as FAILED server-side before returning; an unrecognized level is completed as FAILED and returned as an explicit error.
- `POST /api/protect-auth/completions` accepts `{ flowId, completionStatus }` plus the same header; status is only `SUCCESS` or `FAILED`, must match the current session, and is consumed once.

- [ ] **Step 1: Write service tests** for `AUTHENTICATION` event type, `PING_ONE` user, Signals payload, request IP/UA, target OIDC client, management token authorization, normalized HIGH/MEDIUM/LOW level, and redacted Protect API errors.
- [ ] **Step 2: Run the focused service test** with `cd demo_api_server && CI=true npx jest tests/pingOneProtectService.authentication.test.js --forceExit`; confirm the missing method fails.
- [ ] **Step 3: Implement the authentication evaluation method** in `pingOneProtectService.js`; leave `createAgentDispatchEvaluation` call shape and decision helpers intact.
- [ ] **Step 4: Write Supertest route tests** for missing/oversized fields, absent CSRF header, no client ID, server-derived IP/UA, session-scoped handles, HIGH auto-completion, unknown-level failed completion, invalid status, cross-session handles, replay, and Protect/network failure.
- [ ] **Step 5: Run the focused route test** with `cd demo_api_server && CI=true npx jest tests/protectAuthentication.test.js --forceExit`; confirm it fails before route implementation.
- [ ] **Step 6: Implement the router** with strict body validation, a bounded payload size, a random opaque handle, per-session expiry, one-time completion, and no evaluation ID in responses. Mount it at `/api/protect-auth`.
- [ ] **Step 7: Run both focused BFF tests** and confirm all assertions pass.
- [ ] **Step 8: Commit** the BFF service, route, mount, and tests.

## Task 2: Build the browser Signals and BFF client helpers

**Files:**
- Create: `demo_api_ui/src/lib/pingOneSignalsSdk.js`
- Create: `demo_api_ui/src/services/protectAuthenticationService.js`
- Create: focused Vitest files beside those modules.

**Interfaces:**
- `collectPingOneSignals()` resolves to the SDK's string payload; it rejects on load, readiness, initialization, timeout, or `getData()` error.
- `evaluateProtectAuthentication({ userId, signalsData })` posts to `/api/protect-auth/evaluations` with same-origin credentials and the CSRF header; it returns `{ flowId, level, recommendedAction }`.
- `completeProtectAuthentication({ flowId, completionStatus })` posts to `/api/protect-auth/completions` with same-origin credentials and the CSRF header.

- [ ] **Step 1: Write SDK-helper tests** for script reuse, ready-event race, one-time initialization, string/object payload normalization, SDK errors, and load/readiness/getData timeouts.
- [ ] **Step 2: Run the focused Vitest file** using `cd demo_api_ui && npx vitest run src/lib/__tests__/pingOneSignalsSdk.test.js`; confirm it fails because the module is absent.
- [ ] **Step 3: Implement the Signals loader** using the documented `https://apps.pingone.com/signals/web-sdk/latest/signals-sdk.js`, event readiness, `init`, and `getData`; never log, persist, or render the raw payload.
- [ ] **Step 4: Test and implement the BFF service helper** for same-origin requests, CSRF header, response validation, and surfaced HTTP errors.
- [ ] **Step 5: Run focused helper tests** and commit the browser integration helpers.

## Task 3: Implement Protect risk branches and OIDC callback feedback

**Files:**
- Modify: `demo_api_ui/src/pages/PingAiProductPage.jsx`
- Modify: `demo_api_ui/src/pages/PingAiProductPage.css`
- Modify: `demo_api_ui/src/pages/SdkLoginCallback.jsx`
- Modify/create: page and callback Vitest tests.

**Interfaces:**
- Store only a versioned Protect flow marker and opaque `flowId` in `sessionStorage` before redirect. Do not store Signals data or the Protect evaluation ID in browser storage.
- On an OIDC callback marked as a Protect flow, exchange code using the existing OIDC client, report `SUCCESS`, and return to `/ai-products/protect` with a success state. On an OIDC error or exchange failure, report `FAILED` and return with an error state. Without the marker, preserve current `/sdk-login` and popup behavior exactly.

- [ ] **Step 1: Add failing UI tests** for collect → evaluate order, LOW normal OIDC authorization, MEDIUM `acr_values` from `/api/sdk-demo/config` plus `max_age=0`, HIGH block without authorization, unknown level/error fail-closed, and no raw payload in rendered output.
- [ ] **Step 2: Run the Protect page tests** with `cd demo_api_ui && npx vitest run src/pages/__tests__/PingAiProductPage.test.jsx`; confirm they fail for the new behavior.
- [ ] **Step 3: Implement the Protect run state** in the product page: identifier input, Signals/evaluation progress, result summary, MFA handoff, success, block, and explicit error views. On HIGH show the block returned by evaluation without calling the completion endpoint again. The API receives only the identifier and Signals payload; authorize URL construction stays in the existing PKCE SDK client.
- [ ] **Step 4: Add failing callback tests** for successful completion, returned OIDC denial, token exchange failure, malformed/stale marker, and unchanged normal SDK callback behavior.
- [ ] **Step 5: Implement callback handling** so Protect completion runs only after a completed callback result and uses the session-bound one-time flow handle. Preserve popup message handling and normal callback recovery.
- [ ] **Step 6: Run focused page/callback tests**, then check accessibility labels, keyboard operation, and both-theme contrast against `THEMING.md` §1.4.
- [ ] **Step 7: Commit** UI flow and callback changes.

## Task 4: Keep the Protect page under Ping products and replace the incorrect agent action

**Files:**
- Verify: `demo_api_ui/src/components/AdminSideNav.jsx`
- Modify: `demo_api_ui/src/pages/PingAiProductPage.jsx`
- Modify: `demo_api_ui/src/pages/PingAiProductPage.css`
- Modify: `demo_api_ui/src/pages/__tests__/PingAiProductPage.test.jsx`

- [ ] **Step 1: Confirm the existing PingOne Protect item remains under PingOne Products** and links to `/ai-products/protect`; keep the existing group label and links unchanged.
- [ ] **Step 2: Replace Protect-specific agent dispatch text** with browser authentication education and a visible **Run PingOne Protect sign-in** demo chip/action that starts the on-page flow. Remove only the Protect page's UC36 launcher path; do not delete shared agent UC36 service behavior in this task.
- [ ] **Step 3: Add tests** that the product link remains under PingOne Products, the Protect page describes browser OIDC outcomes, and the run chip starts the browser flow without calling `/api/use-cases/demo/run`.
- [ ] **Step 4: Run the sidebar and product-page Vitest suites** and the full UI unit suite.
- [ ] **Step 5: Build the UI** with `cd demo_api_ui && npm run build` and rerun the required light/dark contrast audit.
- [ ] **Step 6: Commit** the learning copy, chip/action, and tests.

## Task 5: End-to-end verification

- [ ] **Step 1: Run focused BFF tests**, then `cd demo_api_ui && npm run test:unit && npm run build`.
- [ ] **Step 2: Start or update the shared local stack using the repo's worktree serving command** (`npm run serve:worktree here`); do not invoke `docker compose` from this worktree.
- [ ] **Step 3: Use Playwright at `https://local.ping-devops.com:4000/ai-products/protect` with deterministic mocked evaluation responses** to exercise LOW, MEDIUM, and HIGH; verify only MEDIUM sends the configured ACR, HIGH never navigates to PingOne, and the Signals payload is not displayed or placed in the URL.
- [ ] **Step 4: If configured credentials and a reachable PingOne tenant are available, run one live Protect evaluation and complete an OIDC login**; record the returned risk level and whether MFA was actually presented. Do not represent mocked branch verification as a live tenant test.
- [ ] **Step 5: Inspect final `git diff`, rerun `git diff --check`, and commit only intended files.**

### Current verification record

- Focused BFF tests: 2 suites, 10 tests passed.
- Focused UI tests: the navigation and theme regression suites passed, 5 files and 64 tests.
- UI production build passed.
- The full UI suite passed: 668 files; 5,098 tests passed and 24 were skipped.
- Fixed the DaVinci sidebar/catalog drift by restoring its seven live learning links, replaced the undefined `--th-bg-surface` with `--th-bg-card`, and added `--th-text` to five themed agent surfaces. Lowered the ground-without-ink ratchet from 485 to 484 after the count dropped to 484.
- Worktree is serving on the local stack. Playwright confirmed the lesson, Ping products group, pop-out route and controls. The page contrast audit returned no failures in either theme.
- A live risk evaluation and OIDC callback were not run; the tenant's policy-controlled risk outcome and MFA presentation remain to verify.
- Callback handling checks evaluated identity against ID token email, preferred username, or username; mismatch revokes local tokens, reports FAILED, and returns to the demo. Stale/future flow markers are discarded.

## Spec coverage review

- Browser Signals initialization and collection: Task 2.
- BFF credentials, event context, API evaluation, session binding, one-time completion, and errors: Task 1.
- LOW/MEDIUM/HIGH decisions, normal/step-up OIDC, callback feedback, and UI states: Task 3.
- Ping products navigation, dedicated learning/running page, and Protect demo chip: Task 4.
- UI build, server/UI tests, both-theme contrast, Playwright, and live integration distinction: Task 5.
