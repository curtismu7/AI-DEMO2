# PingFederate ID-JAG Run Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reversible live PingFederate ID-JAG launcher plus an offline mock replay to the ID-JAG demo page, Mission Control, and agent, with truthful dynamic token visualizations and reset behavior.

**Architecture:** Introduce a shared run-mode contract with `live-id-jag`, `mock-id-jag`, and ordinary provenance. Live launchers create a server-bound, one-shot UC40 intent, use the existing provider-aware logout/login boundary, and require a PingFederate session before the BFF selects native ID-JAG. The mock launcher feeds a deterministic trace fixture directly into the existing trace store and never calls auth, agent, flag, or live-token APIs. All visual surfaces derive ID-JAG visibility from trace provenance/events rather than a global flag.

**Tech Stack:** React 19/Vite, Vitest, Express/CommonJS, Jest/Supertest, existing `tokenChainTraceStore`, `buildTraceSteps`, `TokenChainFilmstrip`, `SequenceReelDiagram`, and Playwright CLI for browser validation.

**Spec:** `docs/superpowers/specs/2026-09-24-pingfederate-id-jag-run-mode-design.md`

## Global Constraints

- Work from the latest `main-current` commits, including the existing ID-JAG page/nav/agent-mount and dark-button fixes; do not base implementation on the older planning worktree snapshot.
- Keep ordinary PingOne and ordinary PingFederate login/token-exchange behavior unchanged.
- Only an explicit live Run action starts logout/login; opening `/pingfederate-id-jag/demo` is non-destructive.
- The BFF is the sole browser-token custodian; mock mode uses fixture data and never claims a live PF signature.
- Use the existing same-origin redirect sanitizers and provider-aware logout endpoint; do not add hardcoded localhost OAuth redirects.
- UI changes require `cd demo_api_ui && npm run test:unit && npm run build`; preserve the emoji allowlist and theme rules.
- Before editing auth, token exchange, sessions, or `demo_api_ui/`, read `REGRESSION_PLAN.md` §0–§1 and invoke the repository regression guard.
- Use an isolated worktree and stage only intended paths. Do not run Docker Compose from the worktree; use `npm run serve:worktree here` for live validation.

## File map

- Create `demo_api_ui/src/utils/idJagRunMode.js`: shared run-mode constants, validation, one-shot client launch event helpers, and reset helpers.
- Create `demo_api_ui/src/utils/idJagMockTrace.js`: deterministic, visibly non-production mock trace fixture and replay function.
- Modify `demo_api_ui/src/utils/useCaseRunContext.js`: persist/restore the run mode and clear it at ordinary-login/logout boundaries.
- Modify `demo_api_ui/src/pages/EnterpriseMcpDemoPage.jsx` and `.css`: add separate mock/live controls, status labels, and live handoff behavior.
- Modify `demo_api_ui/src/components/DemoStepsDropdown.jsx` and its tests: expose the UC40 Mission Control chip through the shared live launcher.
- Modify `demo_api_ui/src/components/AIAgent.js`/`AIAgentFull.js` and focused tests: recognize UC40-scoped ID-JAG phrases and preserve the one-shot launch context.
- Modify `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`, `buildTraceSteps.js`, `TokenChainFilmstrip.jsx`, `SequenceReelDiagram.jsx`, `TokenChainDisplay.jsx`, and related trace tests: carry provenance/mode and label/filter live versus mock ID-JAG evidence.
- Modify `demo_api_server/server.js`, `routes/oauthUser.js`, and the narrowest existing auth/session service boundary: persist, consume, and clear the server-side pending live intent; enforce PF for live UC40.
- Modify `demo_api_server/services/agentMcpTokenService.js` and its ID-JAG tests: require the validated run mode before native PF exchange and reject provider mismatch without standard fallback.
- Add focused UI and BFF tests beside each touched module, plus `demo_api_ui/tests/e2e/pf-idjag-run-mode.spec.js` for the mock path and live launch boundary using the repository’s existing Playwright helpers.

### Task 1: Establish the run-mode contract and failing tests

**Files:**
- Create: `demo_api_ui/src/utils/idJagRunMode.js`
- Create: `demo_api_ui/src/utils/idJagMockTrace.js`
- Modify: `demo_api_ui/src/utils/useCaseRunContext.js`
- Test: `demo_api_ui/src/utils/__tests__/idJagRunMode.test.js`
- Test: `demo_api_ui/src/utils/__tests__/useCaseRunContext.test.js`

**Interfaces:**
- `ID_JAG_USE_CASE_ID` is `'enterprise-managed-mcp-authorization'`.
- `RUN_MODES` exposes `LIVE_ID_JAG`, `MOCK_ID_JAG`, and `STANDARD`.
- `isIdJagRunMode(mode)` returns true only for live or mock ID-JAG.
- `createIdJagLaunchIntent({ mode, message, returnTo })` returns a bounded `{ useCaseId, mode, message, returnTo }` object and rejects non-ID-JAG modes or unsafe return paths.
- `requestLiveIdJagRun(detail)` dispatches `id-jag-run-requested` with the validated intent.
- `requestMockIdJagReplay()` dispatches `id-jag-mock-replay-requested` with `createMockIdJagTrace()`.
- `clearIdJagRunState()` removes only the ID-JAG run-context keys and dispatches `id-jag-run-cleared`.
- `createMockIdJagTrace()` returns a complete trace object with `provenance: 'mock-id-jag'`, safe `mock-pingfederate` claims, `id-jag-issued`, and `id-jag-redeemed` events.

- [ ] **Step 1: Write failing tests for mode validation, bounded return paths, launch events, reset events, and mock provenance.** Assert that `createIdJagLaunchIntent` rejects `https://evil.example` and that the fixture never contains a real-looking live issuer or token.
- [ ] **Step 2: Run the focused tests.** Run `cd demo_api_ui && npm run test:unit -- src/utils/__tests__/idJagRunMode.test.js src/utils/__tests__/useCaseRunContext.test.js`; expect failures because the new helpers and mode fields do not exist.
- [ ] **Step 3: Implement the contract and context persistence.** Preserve existing run-context fields and add `mode` without changing ordinary event consumers. Clear mode on `userLoggedOut` and `userAuthenticated` unless the event explicitly carries the validated ID-JAG callback mode.
- [ ] **Step 4: Run the focused tests again and commit.** Expect PASS. Commit `feat: add explicit ID-JAG run-mode contract` with only the Task 1 files.

### Task 2: Add the server-side live intent and provider guard

**Files:**
- Modify: `demo_api_server/server.js`
- Modify: `demo_api_server/routes/oauthUser.js`
- Modify: `demo_api_server/services/agentMcpTokenService.js`
- Create: `demo_api_server/src/__tests__/idJagRunIntent.test.js`
- Test: `demo_api_server/src/__tests__/agentMcpTokenService.pfIdJag.test.js`
- Test: `demo_api_server/src/__tests__/agentMcpTokenService.pfProviderIsolation.test.js`

**Interfaces:**
- Add a server-side pending intent shape `{ useCaseId, mode: 'live-id-jag', message, returnTo, createdAt, nonce }` with a five-minute TTL and single-consume semantics.
- Add an internal helper `setPendingIdJagRun(req, intent)`, `consumePendingIdJagRun(req)`, and `clearPendingIdJagRun(req)` in the existing auth/session boundary rather than trusting sessionStorage.
- Extend the existing logout/login handoff so a live launcher can request `return_to=/pingfederate-id-jag/demo` and resume only a same-origin path.
- Native UC40 selection must require `req.session.oauthType === 'user'`, the effective provider `pingfederate`, and a consumed pending `live-id-jag` intent. Otherwise return a structured `id_jag_login_required`/`id_jag_provider_required` error and never call ordinary exchange as fallback.

- [ ] **Step 1: Add failing route/service tests.** Cover intent TTL, same-origin return path, single consume, PF success, PingOne rejection, ordinary PF rejection, and clearing on logout/normal login.
- [ ] **Step 2: Run the focused BFF tests.** Run `cd demo_api_server && CI=true npx jest src/__tests__/idJagRunIntent.test.js src/__tests__/agentMcpTokenService.pfIdJag.test.js src/__tests__/agentMcpTokenService.pfProviderIsolation.test.js --forceExit`; expect failures for the new intent and provider assertions.
- [ ] **Step 3: Implement the smallest session-bound handoff.** Reuse `sanitizePostLoginReturnPath`, the existing unified `/api/auth/logout`, PF end-session handling in `sessionCookies`, and existing OAuth callback state. Do not duplicate token revocation or provider logout logic.
- [ ] **Step 4: Add the BFF response metadata required by the UI.** Successful live UC40 traces must identify `provenance: 'live-id-jag'`/`mode: 'id-jag'`; rejected requests must expose a stable error code and a safe login target.
- [ ] **Step 5: Re-run focused BFF tests and commit.** Expect PASS. Commit `feat: enforce PingFederate ID-JAG run intent` with only Task 2 files.

### Task 3: Implement the live and mock page controls

**Files:**
- Modify: `demo_api_ui/src/pages/EnterpriseMcpDemoPage.jsx`
- Modify: `demo_api_ui/src/pages/EnterpriseMcpDemoPage.css`
- Modify: `demo_api_ui/src/pages/__tests__/EnterpriseMcpDemoPage.test.jsx`
- Test: `demo_api_ui/src/utils/__tests__/idJagMockTrace.test.js`

**Interfaces:**
- The page renders two distinct buttons: `Run live ID-JAG demo` and `Run mock demo`.
- Live button calls `requestLiveIdJagRun({ mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: '/pingfederate-id-jag/demo' })` and does not dispatch `banking-agent-prefill` before login.
- Mock button calls `requestMockIdJagReplay()` and does not call `fetch`, `apiClient`, logout, feature flags, or `banking-agent-prefill`.
- Page status text and badges distinguish `Live PF ID-JAG` from `Mock replay — no login or live tokens`.

- [ ] **Step 1: Add failing component tests.** Assert both buttons exist, mock mode works while signed out without network/auth events, live mode emits only the launch event, and mock copy appears in the page/visualization container.
- [ ] **Step 2: Run the page tests and confirm failure.** Run `cd demo_api_ui && npm run test:unit -- src/pages/__tests__/EnterpriseMcpDemoPage.test.jsx src/utils/__tests__/idJagMockTrace.test.js`.
- [ ] **Step 3: Implement the controls and fixture replay.** Keep the existing live page content and TokenChainFilmstrip; add the mock path as a sibling action, not a replacement for live execution. Keep all button colors readable in both themes.
- [ ] **Step 4: Run tests and commit.** Expect PASS. Commit `feat: add live and mock ID-JAG demo controls`.

### Task 4: Wire Mission Control and agent phrases to the shared launcher

**Files:**
- Modify: `demo_api_ui/src/components/DemoStepsDropdown.jsx`
- Modify: `demo_api_ui/src/components/AIAgent.js`
- Modify: `demo_api_ui/src/components/AIAgentFull.js`
- Modify: `demo_api_ui/src/components/__tests__/DemoStepsDropdown.test.jsx`
- Modify: `demo_api_ui/src/components/__tests__/AIAgent.chips.test.js`
- Modify: `demo_api_ui/src/components/__tests__/AIAgent.publicUseCase.test.jsx`

**Interfaces:**
- UC40’s Mission Control row invokes `requestLiveIdJagRun` instead of dispatching an ordinary prefill directly.
- The agent recognizes `run demo`, `run ID-JAG demo`, and `enterprise managed MCP` only when the current use-case context is UC40 or the user explicitly selects the ID-JAG chip. A generic free-typed `show my balance` outside UC40 remains unchanged.
- After the callback, the pending message is replayed exactly once as `banking-agent-prefill` with `useCaseId: ID_JAG_USE_CASE_ID` and `mode: 'live-id-jag'`.

- [ ] **Step 1: Add failing launcher/routing tests.** Assert the Mission Control click emits the shared launch event, the three supported phrases create the same intent in UC40 context, and a second callback cannot replay the message.
- [ ] **Step 2: Run focused UI tests and confirm failure.** Run `cd demo_api_ui && npm run test:unit -- src/components/__tests__/DemoStepsDropdown.test.jsx src/components/__tests__/AIAgent.chips.test.js`.
- [ ] **Step 3: Implement the shared event path.** Preserve existing chip behavior for every other use case; make the new branch explicit by `useCaseId` and mode.
- [ ] **Step 4: Run focused tests and commit.** Commit `feat: launch ID-JAG from Mission Control and agent`.

### Task 5: Add truthful dynamic trace provenance and mock replay

**Files:**
- Modify: `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`
- Modify: `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`
- Modify: `demo_api_ui/src/components/TokenChainFilmstrip.jsx`
- Modify: `demo_api_ui/src/components/SequenceReelDiagram.jsx`
- Modify: `demo_api_ui/src/components/TokenChainDisplay.jsx`
- Modify: `demo_api_ui/src/components/__tests__/TokenChainDisplay.idJag.test.jsx`
- Modify: `demo_api_ui/src/components/__tests__/TokenChainFilmstrip.test.jsx`
- Modify: `demo_api_ui/src/components/__tests__/SequenceReelDiagramLanes.test.js`
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.idJag.test.js`

**Interfaces:**
- `beginTrace({ prompt, flowTraceId, provenance, mode })` carries `mode` and `provenance` in the trace snapshot while preserving existing callers’ defaults.
- `replayTrace(trace)` replaces the active trace with a fixture, marks it complete, records it as non-live history, and notifies existing subscribers.
- `isNativeIdJagTrace(trace)` returns true only when the trace is live PF ID-JAG or contains the validated native PF event pair; `isMockIdJagTrace(trace)` is separate.
- Visual components use these predicates for badges and labels. They do not infer live ID-JAG from `ff_enterprise_managed_mcp_auth` alone.

- [ ] **Step 1: Add failing store/step-model tests.** Assert mode survives `beginTrace`, mock replay publishes to subscribers, live and mock provenance are distinct, ID-JAG steps appear only for the corresponding trace, and ordinary traces omit them.
- [ ] **Step 2: Run focused trace tests and confirm failure.** Run `cd demo_api_ui && npm run test:unit -- src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js src/services/tokenChainTrace/__tests__/buildTraceSteps.idJag.test.js src/components/__tests__/TokenChainDisplay.idJag.test.jsx`.
- [ ] **Step 3: Implement provenance and rendering gates.** Reuse existing ID-JAG event IDs and explanatory text. Ensure the mock fixture displays `Mock replay` and safe mock claims in every surface; live PF displays `PingFederate ID-JAG`.
- [ ] **Step 4: Run all focused visualization tests and commit.** Commit `feat: render ID-JAG evidence by run provenance`.

### Task 6: Reset state across logout and ordinary login

**Files:**
- Modify: `demo_api_ui/src/hooks/useAuth.js`
- Modify: `demo_api_ui/src/context/SessionTokenContext.js`
- Modify: `demo_api_ui/src/components/OAuthProviderToggle.jsx`
- Modify: `demo_api_server/server.js`
- Modify: `demo_api_server/routes/oauthUser.js`
- Modify: `demo_api_server/routes/featureFlags.js` to reset the run-only flag through the existing flag boundary
- Create: `demo_api_ui/src/hooks/__tests__/useAuth.idJagReset.test.jsx`
- Create: `demo_api_ui/src/components/__tests__/OAuthProviderToggle.idJagReset.test.jsx`
- Test: `demo_api_server/src/__tests__/idJagRunIntent.test.js`

**Interfaces:**
- Normal `userAuthenticated` events clear stale ID-JAG mode unless the callback carries the validated live intent.
- `userLoggedOut`, provider toggle, failed/cancelled callback, and completed/abandoned runs clear pending mode and client replay data.
- Reset is idempotent and does not remove ordinary session/token UI state beyond the existing logout behavior.

- [ ] **Step 1: Add failing reset tests.** Cover normal PingOne login, ordinary PF login, provider toggle, logout, cancelled live login, and repeated reset calls.
- [ ] **Step 2: Run focused auth/reset tests and confirm failure.** Run `cd demo_api_ui && npm run test:unit -- src/hooks/__tests__/useAuth.idJagReset.test.jsx src/components/__tests__/OAuthProviderToggle.idJagReset.test.jsx`; expect failures before the reset listeners exist.
- [ ] **Step 3: Implement the reset listeners and server cleanup.** Keep mock replay isolated: it resets only visualization state and never logs out or clears provider configuration.
- [ ] **Step 4: Run focused tests and commit.** Commit `fix: clear stale ID-JAG run state on auth changes`.

### Task 7: Browser verification and integration gates

**Files:**
- Create: `demo_api_ui/tests/e2e/pf-idjag-run-mode.spec.js`
- Artifacts: `output/playwright/` only for captured screenshots/traces

- [ ] **Step 1: Install/verify service dependencies as required by the repository.** Run `cd demo_api_ui && npm ci` and `cd demo_api_server && npm ci` before tests; do not let `npx` fetch an unrelated toolchain.
- [ ] **Step 2: Run focused UI tests and build.** Run `cd demo_api_ui && npm run test:unit && npm run build`.
- [ ] **Step 3: Run focused BFF tests.** Run `cd demo_api_server && CI=true npx jest src/__tests__/idJagRunIntent.test.js src/__tests__/agentMcpTokenService.pfIdJag.test.js src/__tests__/agentMcpTokenService.pfProviderIsolation.test.js --forceExit`.
- [ ] **Step 4: Run topology/auth/hygiene checks.** Run `npm run topology:verify`, `npm run hygiene:check`, and `npm run authz:verify`.
- [ ] **Step 5: Serve the isolated worktree correctly.** Run `npm run serve:worktree here`; never run Docker Compose from the worktree.
- [ ] **Step 6: Use Playwright against `https://local.ping-devops.com:4000`.** Pin stack generation before and after. Verify page load does not log out, mock replay works signed out, live launch logs out then reaches PF login, Mission Control and agent launchers behave identically, and normal login removes ID-JAG state.
- [ ] **Step 7: Capture evidence and review the diff.** Confirm mock labels, no live tokens in fixture output, readable buttons in both themes, and no unrelated files staged. Commit any final test-only changes separately.
