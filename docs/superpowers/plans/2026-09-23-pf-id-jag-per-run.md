# PingFederate ID-JAG Per-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make UC40 the only demo run that selects PF ID-JAG, while every other demo step and PF login retain the ordinary provider path.

**Architecture:** Carry the catalog use-case ID through the existing AG-UI run context. The BFF uses it to select the enterprise policy and PF ID-JAG lane only for UC40; ordinary PF calls use a separate standard access-token exchanger. UC40 does not toggle shared feature flags or leave session state behind.

**Tech Stack:** Node.js >=22, CommonJS, Express, Jest; React/Vite and Vitest for the UC40 page.

**Spec:** `docs/superpowers/specs/2026-09-23-pf-id-jag-per-run-design.md`

## Global Constraints

- Preserve BFF-only token custody; never return raw tokens or credentials to the browser.
- UC40 is selected only by validated run context `enterprise-managed-mcp-authorization`.
- Ordinary PF calls use access-token exchange; UC40 alone issues and redeems ID-JAG.
- Do not change shared PF/provider configuration or enterprise feature flags during a run.
- Preserve PingOne behavior, token audience restrictions, gateway D-05, act-chain checks, and per-tool scopes.
- Do not mutate a live PingFederate environment.
- UI changes must respect the project emoji allowlist and pass `cd demo_api_ui && npm run build`.

---

## File map

- `demo_api_server/services/agentMcpTokenService.js`: choose ID-JAG only for UC40 and enterprise policy on the UC40 run.
- `demo_api_server/services/enterpriseMcpPolicyService.js`: accept a per-run enterprise-policy override without persisting run-only policy/session state.
- `demo_api_server/services/configStore.js`, `demo_api_server/services/envReconcile.js`, `demo_api_server/config/oauth.js`, `demo_api_server/services/oauthService.js`: hold and use credentials for a normal PF access-token exchanger separately from the existing ID-JAG client.
- `demo_api_server/src/__tests__/agentMcpTokenService.pfProviderIsolation.test.js`, `demo_api_server/src/__tests__/oauthService.idJag.test.js`, and `demo_api_server/src/__tests__/enterpriseMcpPolicyService.test.js`: pin provider-lane selection, credential selection, and no residue.
- `demo_api_ui/src/pages/EnterpriseMcpDemoPage.jsx` and its test: send UC40 in the request context and stop arming the shared flag.
- `demo_api_server/config/useCases.js` or a focused BFF test fixture: source the UC40 catalog ID for parity coverage; do not change generated output by hand.

## Tasks

### Task 1: Pin the PF ordinary and UC40 exchange lanes

**Files:**
- Modify: `demo_api_server/src/__tests__/agentMcpTokenService.pfProviderIsolation.test.js`
- Modify: `demo_api_server/services/agentMcpTokenService.js`

- [ ] Add a failing test where provider is `pingfederate`, active use-case ID is an ordinary catalog ID, and the resolver does not call `performIdJagExchange` or `redeemIdJag`.
- [ ] Add a failing test where the active use-case ID is `enterprise-managed-mcp-authorization` and the resolver calls ID-JAG issuance and redemption exactly once.
- [ ] Run `cd demo_api_server && CI=true npx jest src/__tests__/agentMcpTokenService.pfProviderIsolation.test.js --forceExit`; confirm the ordinary-call test fails because the current unconditional PF branch invokes ID-JAG.
- [ ] Change the PF branch to require both PF provider mode and the validated UC40 run ID. Let ordinary calls continue into the standard exchange lane.
- [ ] Run the focused suite and confirm ordinary calls skip ID-JAG while UC40 retains ID-JAG.

### Task 2: Configure a separate standard PF exchanger

**Files:**
- Modify: `demo_api_server/services/configStore.js`
- Modify: `demo_api_server/services/envReconcile.js`
- Modify: `demo_api_server/config/oauth.js` only if the existing standard exchange method needs a provider-aware accessor.
- Modify: `demo_api_server/services/oauthService.js`
- Modify: `demo_api_server/src/__tests__/agentMcpTokenService.pfProviderIsolation.test.js`
- Modify: `demo_api_server/src/__tests__/oauthService.idJag.test.js` or add a focused standard-PF exchange test beside it.

- [ ] Add a failing unit test proving normal PF exchange selects PF standard-exchanger credentials and requests `urn:ietf:params:oauth:token-type:access_token`.
- [ ] Set distinct sentinel PingOne and PF client IDs in the test, invoke ordinary PF exchange, and assert the request uses only PF credentials, PF auth method, and the PF token endpoint.
- [ ] Run the focused OAuth service test and confirm the current PingOne credential selection cannot satisfy it.
- [ ] Add `pf_standard_token_exchange_client_id`, `pf_standard_token_exchange_client_secret`, and `pf_standard_token_exchange_token_endpoint_auth_method` configuration, keeping existing `pf_token_exchange_*` and ID-JAG settings for UC40.
- [ ] Route the normal PF exchange through the configured PF standard exchanger and PF token endpoint. Preserve actor token, audience, scope, and error telemetry where configured; never fall back to the PingOne client in PF mode.
- [ ] Run the focused OAuth tests and confirm the posted PF request uses the new client and access-token type, while ID-JAG still uses its existing settings.

### Task 3: Make UC40 enterprise policy run-scoped

**Files:**
- Modify: `demo_api_server/services/agentMcpTokenService.js`
- Modify: `demo_api_server/services/enterpriseMcpPolicyService.js`
- Modify: `demo_api_server/src/__tests__/enterpriseMcpPolicyService.test.js`
- Modify: `demo_api_server/src/__tests__/agentMcpTokenService.pfProviderIsolation.test.js`

- [ ] Add a failing test that `checkPolicy(req, { runScoped: true })` checks policy even with `ff_enterprise_managed_mcp_auth` off and leaves `req.session` unchanged.
- [ ] Run the focused policy suite and confirm it fails because the global flag currently gates policy.
- [ ] Add an explicit run-scoped option to the policy checker. In that mode, bypass the shared feature-flag gate and session cache, and do not write policy-cache, consent, or auto-connect fields to the session.
- [ ] Make the token service use this option only for UC40. Keep existing global-flag behavior unchanged for other enterprise-managed flows.
- [ ] In run-scoped mode, leave `agentConsentGiven`, `agentConsentedAt`, `enterpriseMcpAutoConnect`, `enterpriseMcpPolicyCache`, and `enterpriseMcpPolicy` untouched on the session.
- [ ] Run both focused suites and confirm UC40 can evaluate policy without shared or persistent state changes.

### Task 4: Pass UC40 from the dedicated demo page

**Files:**
- Modify: `demo_api_ui/src/pages/EnterpriseMcpDemoPage.jsx`
- Modify: `demo_api_ui/src/pages/__tests__/EnterpriseMcpDemoPage.test.jsx`
- Modify: `demo_api_server/src/__tests__/agentMcpTokenService.pfProviderIsolation.test.js` if the use-case contract needs an API-level assertion.

- [ ] Add a failing UI test that the page launches the demo with `useCaseId: "enterprise-managed-mcp-authorization"` and does not patch `/api/admin/feature-flags`.
- [ ] Run `cd demo_api_ui && npm run test:unit -- src/pages/__tests__/EnterpriseMcpDemoPage.test.jsx`; confirm the test fails because the page currently arms the global flag and omits the use-case ID.
- [ ] Change the page to dispatch the auto-send prompt with the catalog UC40 ID and remove shared flag arm/reset behavior and related state. Keep the explanation and token-chain viewer; update text to describe automatic per-run setup and cleanup.
- [ ] Run the focused Vitest suite, then run `cd demo_api_ui && npm run build`.

### Task 5: Add full catalog lane parity coverage

**Files:**
- Create or modify: `demo_api_server/src/__tests__/agentMcpTokenService.pfCatalogParity.test.js`
- Read: `demo_api_server/config/useCases.js`, canonical vertical manifests, and scope topology.

- [ ] Build the test's ordinary demo-step list from canonical use-case data, excluding only `enterprise-managed-mcp-authorization` and entries with no tool/token path.
- [ ] Assert each ordinary step uses the PF standard access-token lane and emits no PF ID-JAG issue or redemption event. Assert UC40 alone uses ID-JAG.
- [ ] Run the parity test and confirm it fails on the existing implementation for at least one ordinary PF step.
- [ ] Keep the list source-driven so additions to the catalog are included or must be explicitly classified as non-token/no-tool steps.
- [ ] Run the focused parity test. Record catalog entries that require provider capabilities the current PF deployment does not expose; do not mark them passing by skipping them silently.

### Task 6: Preserve PF login and callback behavior

**Files:**
- Test: `demo_api_server/src/__tests__/oauthUserService.pingfederate.test.js`
- Test: `demo_api_server/tests/oauth-endpoint-config.test.js`

- [ ] Add or strengthen an assertion that PF login reads only `pf_user_*` endpoints/client configuration and never reads the new standard exchange or ID-JAG client settings.
- [ ] Run `cd demo_api_server && CI=true npx jest src/__tests__/oauthUserService.pingfederate.test.js tests/oauth-endpoint-config.test.js --forceExit`; confirm the user login and callback configuration remains independent of tool exchange settings.

### Task 7: Verify and record the change

**Files:**
- Modify: `REGRESSION_PLAN.md` §4 with a reverse-chron bug entry.
- Modify: `demo_api_server/env.example` and `demo_api_server/docs/FEDERATE-SETUP.md` for the new standard exchanger settings.

- [ ] Document all new PF environment/config keys and distinguish standard access-token exchange from UC40 ID-JAG issuance.
- [ ] Add a §4 entry with Files changed, What was broken, What was fixed, Do not break, and Verify.
- [ ] Run the touched BFF Jest suites with `CI=true`; run the UI focused Vitest suite using `cd demo_api_ui && npm run test:unit -- src/pages/__tests__/EnterpriseMcpDemoPage.test.jsx`, then run `npm run build`.
- [ ] Run `npm run topology:verify` if changes affect the catalog/tool-to-scope contract.
- [ ] Inspect `git diff --check`, `git status`, and the exact staged paths; commit only intended files on `fix/pf-id-jag-opt-in`.
- [ ] Report local test evidence and distinguish mocked provider coverage from any unavailable read-only real-PF verification.

## Self-review

- Spec goal and current behavior: Tasks 1–2 separate the two PF exchange modes.
- Per-run selection and cleanup: Tasks 1, 3, and 4 carry UC40 and prevent shared or persistent state changes.
- Security invariants: Tasks 1–3 preserve BFF custody, fail-closed behavior, scope/audience, and PingOne isolation.
- All non-ID-JAG steps: Task 5 adds source-driven catalog parity checks.
- PF login parity: Task 6 pins that login stays separate from exchange configuration.
- PF environment requirement: Task 7 documents separate configuration and reports that mocked tests do not prove live provisioning.
- UI regression contract: Task 4 includes the UI build gate; Task 7 includes regression-plan documentation.
