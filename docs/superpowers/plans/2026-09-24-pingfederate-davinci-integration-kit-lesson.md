# PingFederate DaVinci Integration Kit Lesson Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PingFederate-gated demo page for the installed PingOne DaVinci Integration Kit and explain its widget-based and API-based modes.

**Architecture:** Add a public React route linked from the DaVinci master page (no extra sidebar entry). A dedicated PF end-user client uses the already registered callback for a separate authorization-code/PKCE handshake. The page exposes the run action only when that callback has verified a PF ID token; normal PingOne login and tokens remain untouched. The installed adapter runs through PF's authentication policy. Keep the browser and BFF out of direct DaVinci API calls.

**Tech Stack:** React 19, Vite 8, plain JSX/CSS, existing lesson/navigation primitives, Vitest for future implementation checks.

**Spec:** `docs/superpowers/specs/2026-09-24-pingfederate-davinci-integration-kit-lesson-design.md`

## Global Constraints

- Node >=22; UI sources are JavaScript/JSX, not TypeScript.
- Keep the route public in `demo_api_server/config/auth-requirements.json` and run `npm run authz:verify`.
- Preserve the project's emoji allowlist and theme token rules in `REGRESSION_PLAN.md` §0.
- Never include live company IDs, policy IDs, API keys, or user data in samples.
- The target PF and adapter are installed; do not attempt to install or redeploy them.
- A PingOne session must not satisfy the PF demo gate.
- After UI changes, run `cd demo_api_ui && npm run build`.

## Live runtime prerequisite

The installed PF discovery endpoint is reachable at `local.ping-devops.com:9031`.
The dedicated PF end-user client ID and secret are present in the local BFF
environment; its registered callback is `/api/auth/oauth/user/callback` and it
uses confidential client authentication. Do not copy its secret into this plan
or chat. Live completion still requires a human PF sign-in.

---

### Task 1: Add the lesson route and master-page link

**Files:**
- Create: `demo_api_ui/src/pages/PingFederateDavinciKitPage.jsx`
- Create: `demo_api_ui/src/pages/PingFederateDavinciKitPage.css`
- Create: `demo_api_ui/src/pages/__tests__/PingFederateDavinciKitPage.test.jsx`
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/routes/PublicRoutes.js`
- Modify: `demo_api_ui/src/pages/OrchestrationSdkExplainerPage.jsx`
- Modify: `demo_api_server/config/auth-requirements.json`
- Modify: `demo_api_server/services/oauthUserService.js`
- Modify: `demo_api_server/routes/oauthUser.js`
- Modify: `demo_api_server/src/__tests__/oauthUserService.test.js`

**Interfaces:**
- Route: `/pingfederate-davinci-kit` renders the lesson as a public page.
- The DaVinci SDK master page links to the PF Integration Kit page; no second DaVinci sidebar item is added.

- [x] Add the route and mark it public in the authorization source of truth.
- [x] Link the route from the single DaVinci master page; preserve one DaVinci sidebar entry.
- [x] Show session readiness and require a PingFederate provider marker to run; the button starts a fresh configured OIDC sign-in.
- [x] Add focused tests for PF acceptance, PingOne rejection, and the sign-in handoff.
- [x] Verify route authorization and run focused UI tests.

### Task 2: Teach the kit deployment and SSO sequence

**Files:**
- Modify: `demo_api_ui/src/pages/PingFederateDavinciKitPage.jsx`
- Modify: `demo_api_ui/src/pages/PingFederateDavinciKitPage.css`
- Create: `demo_api_ui/src/pages/__tests__/PingFederateDavinciKitPage.test.jsx`

**Interfaces:**
- The page consumes the authenticated user object already loaded by the app and asks the BFF for its configured login provider.
- The sign-in action uses the existing BFF OAuth login route only when it reports PingFederate; the page makes no direct DaVinci calls.
- The page links to the DaVinci master page, which links to `/davinci-widget` and `/davinci-orchestration-sdk`.

- [x] Add the ordered sign-in flow: application → PF authentication policy → DaVinci IdP Adapter → flow → returned attributes → application.
- [x] Describe the live sequence: app → PF authentication policy → installed DaVinci IdP Adapter → DaVinci flow → response.
- [x] Explain that the installed kit is the target PF default and the adapter instance supplies company, policy, and flow mode.
- [x] Distinguish widget mode (interactive UI through the PF template) from API mode (no UI; PF consumes flow results).
- [x] Test that the page distinguishes a PF session from a PingOne session and presents both adapter modes.

### Task 3: Add operations and compatibility guidance

**Files:**
- Modify: `demo_api_ui/src/pages/PingFederateDavinciKitPage.jsx`
- Modify: `demo_api_ui/src/pages/PingFederateDavinciKitPage.css`
- Modify: `REGRESSION_PLAN.md`

- [x] Add troubleshooting for company/policy/flow references, regions, widget CSP, and PF logs.
- [x] Explain kit upgrades and deployment consistency across PF engine nodes.
- [x] Link the Integration Kit guide, deployment instructions, adapter settings, SSO flow, and DaVinci integration methods.
- [x] Add a reverse-chron `REGRESSION_PLAN.md` §4 entry with files, behavior, invariants, and verification commands.
- [x] Run the focused UI and BFF tests, UI build, authz verification, and contrast audit in light and dark themes.

### Task 4: Keep PF login separate from PingOne login

**Files:** `demo_api_server/routes/pfDavinciAuth.js`,
`demo_api_server/routes/oauthUser.js`,
`demo_api_server/tests/routes/pfDavinciAuth.test.js`, and the PF lesson page.

- [x] Start authorization-code/PKCE through the dedicated PF client and its registered callback.
- [x] Verify callback state, nonce, signed ID token, issuer, audience, and expiry before recording a short-lived PF proof.
- [x] Require that proof in the lesson, while retaining any existing PingOne session for the other demos.
- [x] Preflight the PF authorize request with a valid PKCE challenge; PF returns its Sign On page.
- [ ] Complete one human PF sign-in to verify the installed adapter and DaVinci flow execute to the callback.
