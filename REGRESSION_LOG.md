# Regression Log

A running record of production bugs, their root causes, and the tests that prevent them from recurring.
Update this file whenever a bug is fixed: add the bug, cause, fix, and test reference.

---

## 2026-08-05 — Token Chain could not distinguish live hops from possible steps

**Symptom**: Token Chain rendered the full possible pipeline before the agent
ran, making skipped token exchange or PingOne Authorize look like pending work
and reducing the visual impact of a live demo.

**Root cause**: `TokenChainTraceRail` mapped the complete `buildTraceSteps`
catalog directly for every trace state. The catalog correctly knew every
possible hop, but the UI had no run-aware projection over it.

**Fix**: Added a Live projection that starts empty, reveals active/completed/
failed steps as evidence arrives, and reconciles all possible steps when the run
completes. Any still-pending possibility becomes an explicit `notinpath` step
with a reason, including skipped token exchange and PingOne Authorize. A2A token
events inject distinct main-agent, specialist-agent, exchange, Agent Card, and
SendMessage steps into the live sequence. The unchanged Classic projection
remains selectable and persisted as the immediate demo fallback.

**Do not break**: Classic must always remain available without a redeploy; Live
must not show future steps mid-run; completed Live runs must explain applicable
skips; Clear must empty either projection and reject stale tagged evidence.

**Tests**: `demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx`
(empty Live start, observed-step reveal, completed skip reconciliation,
conditional/repeated steps, persisted Classic fallback, Clear);
`demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`
(reset and late-event rejection); full UI unit suite and production build.

---

## 2026-08-05 — Token Topology showed a fixed route and could repaint after Clear

**Symptom**: Token Topology pre-rendered a fixed set of boxes rather than showing
the route the agent actually took. Clear did not visibly remove those boxes, and
late tagged evidence or a retained inspector selection could repaint stale run
details after another surface reset the trace.

**Root cause**: The panel rendered a static node list and Clear called
`beginTrace()`, which created another run and retained session evidence. After
switching Clear to `reset()`, the store had no active flow identity against which
to reject a late event from the cleared run, while the inspector resolved its
selection against the always-populated step model rather than the observed
topology.

**Fix**: `TokenTopologyPanel` now derives boxes and arrows from active, completed,
or failed trace steps and enriches those nodes as evidence arrives. Clear uses a
full store reset; the store treats that reset as an explicit run boundary that
rejects late tagged evidence until the next `beginTrace`; inspector selection is
resolved only from currently observed topology nodes.

**Do not break**: pending and not-in-path steps must remain absent, conditional
and repeated observed steps must render in trace order, and Clear must leave an
empty topology that cannot be repainted by tagged evidence from the cleared run.

**Tests**: `demo_api_ui/src/components/__tests__/TokenTopologyPanel.a2a.test.jsx`
(observed live topology, detail enrichment, full clear, external-reset inspector
cleanup); `demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`
(late tagged token/SSE evidence rejected after reset); full UI unit suite and
production build.

---

## 2026-08-04 — Blocked-token resolution wasn't checked by direct callers of resolveMcpAccessTokenWithEvents (follow-up to the raw-user-token-forwarding fix)

**Symptom**: Code review (Greptile) flagged that the `blocked` result added to `resolveMcpAccessTokenWithEvents` (see the entry above) was only handled by `mcpToolPipeline.js`. Other direct callers destructured `token` and either surfaced a generic 401/502 instead of the intended 403, or — in `agentPreflightService.evaluate()` — continued past the null token into the P1AZ gate call, where a gate that doesn't run (`!gate.ran`) falls back to `PERMIT`. A blocked resolution could therefore still end up PERMITted.

**Root cause**: `blocked`/`blockCode`/`blockMessage`/`blockHttpStatus` were only added to the return shape; no caller besides `mcpToolPipeline.js` was updated to check for them.

**Fix**: Added `resolved.blocked` checks (short-circuiting to DENY/403 before any downstream gate/gateway/MCP call) to: `services/agentPreflightService.js` (`evaluate()` and `evaluateBatch()` — the real fail-open risk), `services/agentToolsResolver.js`, `services/bffMcpToolExecutor.js` (`callMcpToolAsAgent` and the direct `tool.invoke` fallback), `server.js` (`/api/mcp/scope-upgrade`), and `routes/mcpGatewayConfig.js` (both direct tool-call routes). Added a shared `describeBlockedToken()` helper export in `agentMcpTokenService.js` for future callers.

**Do not break**: `agentPreflightService.evaluate()` must return DENY on a blocked resolution before the gate is ever called, regardless of `ff_authorize_fail_open` — a blocked token must never fall through to the gate's own `!gate.ran → PERMIT` fallback.

**Tests**: `demo_api_server/tests/agentPreflight.regression.test.js` (new blocked-resolution case), `demo_api_server/src/__tests__/mcpToolPipeline.characterization.test.js` (2 new blocked-resolution pipeline cases)

---

## 2026-08-04 — MCP tool calls forwarded the raw user token when `ff_skip_token_exchange` was enabled

**Symptom**: `create_transfer` reached the MCP server with `aud=enduser.ping.demo` instead of a delegated MCP audience, so the gateway/MCP hop failed with an audience mismatch instead of exercising the intended exchange path.

**Root cause**: The `ff_skip_token_exchange` branch in `resolveMcpAccessTokenWithEvents` returned the session user token unchanged. That meant the BFF could hand the MCP hop a raw end-user bearer instead of a delegated token, which is exactly the case the demo should never allow except to demonstrate that it is blocked.

**Fix**: `demo_api_server/services/agentMcpTokenService.js` now treats `ff_skip_token_exchange` as a deny path: it emits an `exchange-skipped` failure event, returns a blocked result, and never forwards the user token. `demo_api_server/services/mcpToolPipeline.js` now surfaces that blocked result as a 403 before any MCP call, and the config comment / unit tests were updated to match.

**Do not break**: keep the normal RFC 8693 exchange path intact, including delegated MCP tokens and token-chain events; only the raw user-token forwarding path is blocked.

**Tests**: `demo_api_server/src/__tests__/agentMcpTokenService.test.js` (`ff_skip_token_exchange` cases)

---

## 2026-07-23 — Consent modal was too tall and needed the screenshot's tighter layout

**Symptom**: The consent modal rendered too tall relative to the reference screenshot, with oversized vertical padding and spacing that made the dialog feel stretched.

**Root cause**: The shared draggable modal shell reused the older tall default sizing, and the persisted modal size state kept the previous dimensions in place so the compact layout never surfaced immediately.

**Fix**: Tightened the consent dialog's default dimensions and internal spacing in `demo_api_ui/src/components/AgentConsentModal.js` and `demo_api_ui/src/components/AgentConsentModal.css`, and updated the modal storage key so the compact layout is applied on the next open.

**Tests**: `cd demo_api_ui && npm run build`

---

## 2026-07-23 — Demo Step 1 could fail with `delegation_chain_broken` when the PingGateway URI setting was unset

**Symptom**: In gateway-brokered mode, Demo Step 1 could fail during the second token exchange with `delegation_chain_broken` and the UI toast "Token exchange failed…" when the PingGateway URI setting was missing.

**Root cause**: Exchange #2 needed an RFC 8707 URI audience (`https://.../mcp`), but the fallback path could use a non-URI audience value from the configured audience list when `pingone_resource_pinggateway_uri` was unset, so the gateway-brokered exchange failed.

**Fix**: `demo_api_server/services/agentMcpTokenService.js` now extracts the first HTTP(S) URI from the available audience values when the explicit PingGateway URI is missing, preserving the required URI-form audience for Exchange #2. Added regression coverage in `demo_api_server/src/__tests__/agentMcpTokenService.test.js` to lock in that fallback behavior.

**Tests**: `cd demo_api_server && npx jest src/__tests__/agentMcpTokenService.test.js --runInBand`

---

## 2026-07-11 — Agent reported "Transferred $X" success on an unparseable tool result; vertical chips rendered `{}`

**Symptom**: When a tool call's raw result body was malformed, blank, or garbage (not valid JSON, or JSON with no recognizable shape), the agent still replied with a success message such as "Transferred $X" as if the transfer had gone through, and vertical action chips rendered an empty `{}` instead of an error or the expected card.

**Root cause**: The upstream parse step swallowed unparseable tool output down to `null` instead of surfacing a failure, and `classifyMcpToolResult(null)` then classified that `null` as `{kind:'ok'}` — a bare absence of content was indistinguishable from a genuine success. Downstream, `parseMcpToolPayload` inherited the same blind spot: when it couldn't find a shape it recognized, it fell back to `result:{}` rather than an error, so the UI had nothing to key off of except an empty object, which several chip renderers treat as "render nothing meaningful" rather than "this failed."

**Fix**: Added `services/llmResponseContract.js`'s `parseToolResult`, which returns explicit error-shaped objects (never `null`, never a bare `{}`, never a false `{kind:'ok'}`) for unparseable or empty tool output. Wired it in at all consumer sites (`tryParseIntentJson` and the 7 `parseToolResult` call sites across the agent/vertical pipeline), and `parseToolResult` parses machine tool output strictly (direct parse, then in-place repairs only — no prose brace-extraction), so unparseable or prose-wrapped tool output now surfaces as an error instead of being silently coerced into a phantom success.

**Tests**: `demo_api_server/src/__tests__/toolResultFalseSuccess.regression.test.js` — reproduces the false-success case (unparseable tool output previously classified `{kind:'ok'}`) and asserts it now surfaces as an error via the classifier contract (`parseToolResult` + `classifyMcpToolResult`) and `parseMcpToolPayload`; the other consumer sites share that same single chokepoint (`parseToolResult`). Part of the broader `llmResponseContract` suite (`llmResponseContract.test.js`, `llmResponseContract.intent.test.js`, `llmResponseContract.toolResult.test.js`, `tryParseIntentJson.test.js`) added alongside it, all green.

---

## 2026-06-24 — Agent action chips silently absent — every PingOne token rejected as `jwt issuer invalid`

**Symptom**: A signed-in customer saw an empty agent Actions dropdown — no "Super Banking Actions" chips — despite the UI showing "Signed in" with a populated token chain. `GET /api/verticals/me` returned `401 invalid_token` on both `localhost:4000` and `api.ping.demo:4000`. Server log: `PingOne token validation failed: jwt issuer invalid. expected: https://auth.pingone.com/{envId}` (no `/as`).

**Root cause**: PingOne issues tokens with `iss = https://auth.pingone.{tld}/{envId}/as` (confirmed against PingOne's own discovery document). The BFF's expected issuer comes from `oauthEndpointResolver.getIssuer()`, which returns the explicit `oauth_issuer` config value (seeded from `OAUTH_ISSUER`). That value was set **without** the `/as` suffix — unlike every sibling `OAUTH_*` endpoint — so every token's `iss` mismatched and `validatePingOneToken` rejected it. Since `authenticateToken` gates `/api/verticals/me`, the active vertical manifest (which carries `dashboard.chips10`) never loaded, and `BankingChips` had nothing to render.

**Fix**: `getIssuer()` now normalizes a PingOne issuer missing `/as` (auto-appends it) and logs a one-time warning, at the single chokepoint feeding the token validator. Scoped by regex (`^https://auth\.pingone\.[a-z.]+/[^/]+$`) to the PingOne auth domain so non-PingOne IdPs (Okta, Auth0, PingFederate) are left untouched. The triggering value was a local `.env` misconfig (corrected separately); this guard makes the omission self-correcting on any environment. `demo_api_server/services/oauthEndpointResolver.js`.

**Tests**: `demo_api_server/tests/oauth-endpoint-config.test.js` — appends `/as` to a PingOne issuer missing it; leaves an already-`/as` PingOne issuer unchanged; does NOT touch a non-PingOne issuer. 16/16 green.

## 2026-06-21 — Draggable panels could restore to an off-screen position and stay invisible ("What's happening" toggle did nothing)

**Symptom**: Toggling the "What's happening" panel on did nothing — no panel appeared. Live repro confirmed the panel element *was* mounted (`isOpen` true, context present) but rendered off-screen: with `localStorage['anp-pos']` = `{pos:{x:3000,y:1800}}` in a 1440×811 viewport, `.anp-card` existed with `getBoundingClientRect()` at x:3000,y:1800 (`onScreen:false`).

**Root cause**: `useDraggablePanel` restored a saved position from `localStorage` verbatim, by design with "no viewport clamping" so a panel could be dragged onto a second monitor. But the same un-clamped restore means a position saved when the window was larger — or onto a since-detached monitor, or after the window shrank — comes back off-screen on the next load and is permanently invisible. This affected all 10 panels using the hook (`ActivityNarrativePanel`, `TokenChainDisplay`, `FloatingTokenChainPanel`, `LogViewer`, `DelegatedAccessPage`, `DraggableModal`, etc.).

**Fix**: Added `clampPosToViewport(pos, size)` and apply it only to the position *restored from storage* in the `useState` initializer. Live dragging stays unclamped (drag-to-second-monitor still works within a session); on reload the panel is always brought fully back into the current viewport (pinned to an 8px top-left margin if it is larger than the viewport). `demo_api_ui/src/hooks/useDraggablePanel.js`.

**Tests**: `demo_api_ui/src/hooks/__tests__/useDraggablePanel.test.js` — restored off-screen (`{3000,1800}`) and off-top-left (`{-500,-500}`) positions clamp back fully on-screen; an already-on-screen position (`{900,80}`) is returned unchanged. 3/3 green.
## 2026-06-21 — MCP content envelope dumped as raw text on gateway api_key tools (all agent modes)

**Symptom**: Agent chips whose tool routes through the MCP gateway api_key disposition (e.g. manufacturing `view_work_orders` — "Overdue orders") replied with the raw MCP frame `{"content":[{"type":"text","text":"{…render:view_work_orders,data:{…}}"}],"isError":false}` in the chat instead of the rendered card. Reproduced on every agent mode (heuristic / ollama / helix), since all funnel through `executeBffTool`.

**Root cause**: `callToolViaGateway` returns `response.data.result` — the MCP content envelope `{content:[{type:'text',text:'<inner JSON>'}],isError}`. `runMcpToolPipeline` deliberately keeps that envelope as `body.result` (it reads `.content`/`.isError` for SSE publishing, audit logging, and `hitlSignalInResultContent` detection). `executeBffTool` returned it verbatim (`JSON.stringify(result)`), so the vertical consumer `parseMcpToolPayload` saw `{content,isError}` with no `.render`/`.data` and fell back to `render:'text'`, dumping the whole frame. Banking was unaffected because its tools resolve via the local handler (`callToolLocal`), which returns the inner object directly; only the gateway api_key path returns the wrapped envelope. `callMcpToolInternal` already unwrapped `content[0].text` (utils/mcpToolRegistry.js:272) — the gateway pipeline path never did.

**Fix**: Added `unwrapMcpResultEnvelope(result)` — returns the first `type:'text'` part's text when `result` is an MCP content envelope, else the value unchanged — and applied it at both `executeBffTool` and `executeBffToolWithToken` (A2A) result branches, the single chokepoint both agent consumers use. Mirrors `callMcpToolInternal`; inner objects (banking local path) pass through untouched. An `isError:true` envelope whose text is a bare non-JSON sentence is re-wrapped as `{"error":"<sentence>"}` so the message survives the consumer's `JSON.parse` instead of dropping to `{}`/`render:'text'` (JSON error text is passed through so an embedded `.error` is preserved). The pipeline still keeps the envelope internally for SSE/audit/HITL. `demo_api_server/services/bffMcpToolExecutor.js`.

**Tests**: `demo_api_server/src/__tests__/bffMcpEnvelopeUnwrap.regression.test.js` (8 cases) — unwrap to inner text, passthrough of an already-unwrapped object, content-without-text passthrough, bare non-JSON `isError` text re-wrapped (message preserved through `parseMcpToolPayload`), JSON `isError` text passed through, null/undefined safety, full flow through `parseMcpToolPayload` → `render:'view_work_orders'`, and a case documenting the pre-fix `render:'text'` behaviour. Existing suites green: `bffMcpToolExecutor`, `verticalIntentDispatch`, `dispatchVerticalIntent`, `mcpToolPipeline.characterization` (262 passed).

---

## 2026-06-20 — MFA worker-token 401 mislabel extended to selectDevice/submitOtp/getDeviceAuthStatus (PR #346 follow-up)

**Symptom**: Latent — the same `session_expired` loop class fixed for `POST /challenge` (PR #346) still lurked on `PUT /api/auth/mfa/challenge/:daId` and `GET /challenge/:daId/status`.

**Root cause**: PR #346 hardened only `initiateDeviceAuth` to code its worker-token 401 as `mfa_service_auth_failed`. Its sibling worker-token calls `selectDevice`, `submitOtp`, and `getDeviceAuthStatus` still fell through `_wrapError`'s default `token_expired`, so a genuine worker-credential failure would make those routes refresh the (irrelevant) user token and loop to `session_expired`.

**Fix**: Pass `{ workerToken: true }` to `_wrapError` in `selectDevice`/`submitOtp`/`getDeviceAuthStatus`, and added the `mfa_service_auth_failed` → `502 mfa_service_unavailable` branch to the `PUT /challenge/:daId` and `GET /challenge/:daId/status` handlers (mirroring `POST /challenge`). Also pruned the now-unreachable `token_expired` retry branch in the `mfaTest.js` `/initiate` debug route (initiateDeviceAuth can no longer return `token_expired`). `demo_api_server/services/mfaService.js`, `demo_api_server/routes/mfa.js`, `demo_api_server/routes/mfaTest.js`.

**Tests**: `demo_api_server/src/__tests__/mfaService.test.js` — the `submitOtp` worker-token 401 case now asserts `mfa_service_auth_failed`. 30/30 across `mfaService` + `mfaTest.routes`. (FIDO2 `submitFido2Assertion` intentionally left on the user-token default — out of scope, unusable locally.)

---

## 2026-06-19 — MFA step-up `/challenge` 401 `session_expired` was a wrong-audience bug, misdiagnosed as token refresh

**Symptom**: `POST /api/auth/mfa/challenge` returned `401 {error:'session_expired'}` for a logged-in demoUser, blocking the Security Showcase MFA step-up modal. Live probes showed the session was healthy: `/oauth/user/status` `authenticated:true`, `hasRefreshToken:true`, and the access token passed JWKS validation (not expired). A prior diagnosis attributed it to a BFF token-refresh failure in `routes/mfa.js`.

**Root cause**: `mfaService.initiateDeviceAuth` sent the user's own access token (`aud=enduser.ping.demo`) to PingOne `POST /deviceAuthentications`. PingOne MFA rejects that custom-resource audience with `INVALID_TOKEN` / "You do not have access to this resource" — an authorization/audience failure, not expiry. `_wrapError` collapses any 401 to `code:'token_expired'`, so the `/challenge` handler called `_tryRefresh` (which succeeded), retried with another `enduser.ping.demo` token, got the same `INVALID_TOKEN`, and returned `session_expired`. The agent/MCP path "worked" only because it performs the RFC 8693 audience exchange before calling PingOne; the MFA path never did. The sibling `initiateOneTimeOtp` already documents and avoids this by using a worker token.

**Fix**: `initiateDeviceAuth` now uses the worker (client_credentials) token — the same token `initiateOneTimeOtp`, `selectDevice`, and `submitOtp` already use against the same resource — threading a single worker-token mint through `_getDefaultMfaPolicy`. The `_userAccessToken` arg is kept for signature compatibility but ignored. Verified live: `/challenge` → `200 {daId, status:OTP_REQUIRED, devices:[EMAIL]}`. `demo_api_server/services/mfaService.js`.

**Also hardened the mislabel itself**: a worker-token call must never be coded `token_expired`, or a *future* worker-credential failure would re-trigger the same useless user-token refresh → `session_expired` loop. `_wrapError` now takes an optional `{ workerToken: true }`; `initiateDeviceAuth` passes it, so a 401 there is coded `mfa_service_auth_failed`, and `POST /api/auth/mfa/challenge` returns `502 mfa_service_unavailable` (no pointless refresh) instead of a misleading `session_expired`. (The sibling worker-token calls `selectDevice`/`submitOtp` share this latent mislabel via the legacy `token_expired` default — left as a scoped follow-up.) `demo_api_server/services/mfaService.js`, `demo_api_server/routes/mfa.js`.

**Tests**: `demo_api_server/src/__tests__/mfaService.test.js` — updated `initiateDeviceAuth` / `_getDefaultMfaPolicy` cases for the worker-token mint (call-count + ordering), and repaired a pre-existing stale mock (`_embedded.mfaPolicies` → `_embedded.deviceAuthenticationPolicies`, left over from commit 17461910's endpoint switch) that had been silently failing 15 cases via mock-queue bleed. Suite is now 26/26.

---

## 2026-06-19 — demoAgentLangGraphService.dispatchVerticalIntent HITL envelope forwarding

demoAgentLangGraphService.dispatchVerticalIntent local-bypass branch now (a) threads hitlChallengeId into the tool ctx and (b) forwards a hitl_required envelope when a local tool returns one. Additive; fires only for result.error === 'hitl_required'; existing text/education local tools unaffected (covered by oauthTeachingTools.test.js + oauth-teaching-dispatch-hitl.test.js).

---

## 2026-06-11 — Vertical agent route had no token guard/refresh → "No delegated token for MCP tool call"

**Symptom**: Vertical agent requests (e.g. CareConnect "My records", which calls `view_records`) failed with `The agent encountered an error. Please try again.`; the BFF log showed `[AGENT_MCP] No user token in session for tool=view_records` and `Error: [demoAgentLangGraphService] No delegated token for MCP tool call — sign in to continue.` (code `login_required`) thrown at `mcpToolRegistry.callMcpToolInternal`. Confusingly, the header Token Chain panel still showed the user's token as "valid". The model/agent reasoning itself worked (Ollama correctly selected the tool) — the failure was purely the missing subject token for the RFC 8693 exchange.

**Root cause**: `POST /api/agent/invoke` (`agentInvokeRoute.js`, the unified vertical agent route) sourced the subject token directly as `req.session.oauthTokens.accessToken` with no guard and no refresh, whereas the banking route (`/api/banking-agent/message`) runs `agentSessionMiddleware`, which guards for a live session token and auto-refreshes an expired one. So on the vertical route an expired-but-refreshable token was never refreshed, and an absent/expired token flowed through as `undefined` to `processAgentMessage` → `executeBffTool` → `callMcpToolAsAgent` → `resolveMcpAccessTokenWithEvents` (returns `token:null`) → the empty-bearer choke-point in `callMcpToolInternal` threw the deep "No delegated token" error. The "valid" header was misleading: `/api/token-chain` reads a separate persisted token-event store (`tokenChainService`), not the live session, so it can show green after the session access token has expired.

**Fix**: Added the existing `agentSessionMiddleware` to the `/api/agent/invoke` chain (`authenticateToken, agentSessionMiddleware, express.json()`). It now refreshes an expired token in place (so the request succeeds) and returns a clean `401 oauth_session_required` / "Please log in again" when the token is genuinely missing — instead of the misleading deep error. `userId` is still `req.user.sub` from `authenticateToken`, unchanged. `demo_api_server/routes/agentInvokeRoute.js`.

**Tests**: `demo_api_server/src/__tests__/agentInvokeRoute.intentToken.test.js` (updated: the mock session now carries `session.user` so the newly-applied guard passes through; both intent-token cases stay green, confirming the middleware integrates without changing the route's behavior for an authenticated session).
## 2026-06-17 — Test suite shared the operator's persistent LMDB store (could corrupt credentials)

**Symptom**: Running `npm test` locally failed several suites non-deterministically (`allChips.pipeline`, `accounts-cold-start`, `runtime-settings-api`, `configStore.envCoverage`) depending on the machine's persisted state — green in CI, red locally. More seriously, the test run could **write to the operator's real credential/config store**.

**Root cause**: `services/lmdb/openEnv.js` hard-coded `LMDB_PATH` to `data/persistent/lmdb/` — the same store the running app uses for credentials/config that must survive restarts. Every in-process LMDB consumer (configStore, session store, bankingDb, delegation, audit/report stores) routes through `openEnv`, so the test suite read and wrote that operator store. Tests that depend on a clean store (e.g. session-scoped active vertical) saw leftover operator state; CI passed only because a fresh checkout has no `data/persistent/lmdb/` to collide with. Two vault suites compounded it by opening the store directly via a hard-coded path.

**Fix**: `openEnv.js` now honors `process.env.LMDB_PATH` (runtime default unchanged). The default jest config sets `LMDB_PATH` to a per-worker throwaway dir under the OS tmpdir (`src/__tests__/setup.js` + `setup/lmdbTestDir.js`); globalSetup (`setup/loadBrowserToken.js`) wipes it once per run for a fresh start (matching CI). `tests/vault/configStore-{precedence,persistFalse}.test.js` resolve the same `LMDB_PATH` in their direct-LMDB helpers. The real-test config (`jest.real.config.js`) and the runtime server never set `LMDB_PATH`, so they still use the operator store.

**Tests**: Verified by running the full default suite under isolation — the previously-flaky suites pass, and the operator store's `data.mdb` SHA-256 is byte-for-byte unchanged across a run (proving tests no longer touch it). The two vault suites assert read-back through the isolated path (22 tests).

---

## 2026-06-17 — Stored balances could drift off whole cents over many ops (code-maturity item 2)

**Symptom**: An account's stored balance could end up a hair off a whole-cent value (e.g. `9.99999999999998` instead of `10.00`) after many small deposits/withdrawals. Rare in single-action demo flows, but it compounds: the residue persists to `runtimeData.json` and accumulates across sessions.

**Root cause**: `dataStore.updateAccountBalance(accountId, amount)` mutated the balance with `account.balance += amount`. Balances are JS `Number` (IEEE-754 float64), so even when callers pass cent-rounded deltas, float addition carries residue (`0.10 + 0.20 === 0.30000000000000004`), and `updateAccountBalance` — unlike `applyTransfer`, which already re-rounds each side — never re-rounded the result. The deposit / withdrawal / transfer paths in `services/mcpLocalTools.js` and the admin subscription debit (`routes/admin.js`) all flow through it.

**Fix**: `updateAccountBalance` now sets `account.balance = Math.round((account.balance + amount) * 100) / 100`, re-rounding to whole cents on every mutation (matching `applyTransfer`). No caller change needed; the deltas they pass are unaffected.

**Tests**: `demo_api_server/tests/moneyMath.accumulation.test.js` — 100 deposits of `$0.10` → exactly `$10.00`; 300×`$0.01` minus 100×`$0.03` → `$0.00`; 1000×`$0.33` → `$330.00`; half-cent boundary (`10.005` → `10.01`); plus `applyTransfer` 1000-iteration and round-trip drift guards. Every assertion checks the stored balance lands exactly on whole cents.

---

## 2026-06-17 — CIBA agent step-up sent no ACR + poll loop never surfaced denial/expiry

Builds on the casing fix below (which made the route tolerant + aligned the caller). Two gaps remained once the live transfer→CIBA step-up actually armed.

**Symptom**: (1) PingOne always applied its *default* CIBA policy on step-up because the client never forwarded the required ACR. (2) A denied or expired backchannel request left the UI polling indefinitely with no error shown.

**Root cause**: `handleCibaStepUp` sent no `acr_values`, and the agent step-up paths never carried `step_up_acr` to the client — the tools-list MFA gate (`mcpInspector.js`), the local 428 (`mcpLocalTools.checkLocalStepUp` → `mcpToolPipeline.localResultOutcome`), and the preflight STEP_UP response (`demoAgentLangGraphService.js`) all omitted it. Separately, the poll `useEffect` catch swallowed every HTTP error as "keep polling", but the route returns terminal failures as 403 (denied) / 404 (unknown) / 410 (expired).

**Fix**: Capture `step_up_acr` from each 428 into `cibaAcr` and forward it as `acr_values`; add `step_up_acr` (+`step_up_method`) to the three server step-up paths above; treat poll 403/404/410 as terminal (denied vs expired messaging) instead of looping forever; extract a `beginStepUp(data)` helper for the four 428 handlers. The agent-message guard (`AIAgent.js`) was also corrected from the dead camelCase `stepUpRes.stepUpRequired` to the real `step_up_required`/`error==='step_up_required'` fields.

**Tests**: `ciba.test.js`, `step-up-gate.test.js`, `mcpToolPipeline.characterization.test.js`, `demoAgentLangGraph*` suites; UI build clean.

---

## 2026-06-16 — Balance read-modify-write race let concurrent transfers overdraw (code-maturity CRITICAL-1)

**Symptom**: Two transfers/withdrawals issued concurrently from the same account could both succeed even when the account only held enough for one — the account ended negative (lost update). Single-user demo flows rarely triggered it, but it is a textbook double-spend.

**Root cause**: `POST /api/transactions` read `fromAccount.balance` and ran the insufficient-funds check, then `await`ed (Authorize gate, transaction-record creation) before calling `updateAccountBalance(from, -amount)`. Because the check and the mutation were separated by `await` points, two requests could both pass the check before either debited, and the second debit overwrote the first.

**Fix**: New `dataStore.applyTransfer(fromAccountId, toAccountId, amount)` performs the existence + sufficient-funds check and BOTH balance mutations in a single **synchronous** critical section (no `await` between read and write), so Node's single-threaded loop cannot interleave a second transfer; it persists once afterward. `routes/transactions.js` calls it after authorization and before recording the transaction (so a transfer that can't be funded is never recorded). Cent-rounding applied on both sides.

**Tests**: `demo_api_server/tests/applyTransfer.concurrency.test.js` — asserts exactly one of two concurrent $100 debits on a $100 account succeeds and the balance never goes negative (fails if anyone reintroduces an `await` between check and mutate), plus insufficient-funds, cent-rounding, deposit-only, unknown-account, and invalid-amount cases.

---

## 2026-06-16 — TLS verification could be disabled in production (code-maturity CRITICAL-2)

**Symptom**: Two server-to-server HTTPS paths created an agent with `rejectUnauthorized: false` unconditionally (no environment guard), so a production deploy could send/validate over an unverified TLS channel.

**Root cause**: `routes/health.js` built a module-load `_devHttpsAgent` and `routes/mcpGatewayConfig.js` set `rejectUnauthorized: false` for any https probe, neither gated on `NODE_ENV`. (The agent-token, langgraph, and websocket sites were already gated under CR-04/BL-04.)

**Fix**: Both sites now relax TLS only when `NODE_ENV !== 'production'`; production uses the default secure agent. Added a startup fail-fast in `server.js` for the blunt global override `NODE_TLS_REJECT_UNAUTHORIZED=0` in production, mirroring the existing `SKIP_TOKEN_SIGNATURE_VALIDATION` guard.

**Tests**: Covered by existing `health` and `mcpGatewayConfig` route suites (behavior unchanged in non-production); the production fail-fast is a startup guard (no request-time test).

---

## 2026-06-16 — Live transfer→CIBA step-up never started (camelCase/snake_case contract mismatch)

**Symptom**: With `STEP_UP_METHOD=ciba`, a high-value transfer that returned a 428 step-up never progressed — no "waiting for approval" polling began, and the binding message shown out-of-band was always the generic default. The standalone `CIBAPanel` "Try It" tab worked fine, so CIBA itself was healthy.

**Root cause**: The frontend→backend contract for `POST /api/auth/ciba/initiate` was split by casing. `UserDashboard.handleCibaStepUp` sent `{ loginHint, bindingMessage, scope }` (camelCase) and read back `data.authReqId`, but `routes/ciba.js` read `req.body.login_hint`/`binding_message` and returned `auth_req_id` (snake_case). So `bindingMessage` was dropped (route fell back to the default) and `setCibaAuthReqId(data.authReqId)` got `undefined` → polling could not start. `login_hint` still resolved via the `req.user?.email` fallback, masking the first half of the mismatch.

**Fix**: Made `routes/ciba.js` tolerant of both casings (`login_hint`‖`loginHint`, `binding_message`‖`bindingMessage`, `acr_values`‖`acrValues` via a small `field()` helper) and return both `auth_req_id` and `authReqId`; aligned `handleCibaStepUp` to the canonical snake_case contract. Also recorded the granted token in the token chain on poll success (`trackTokenEvent`, structured `grantedVia: 'ciba'`) so the step-up is visible in the new "CIBA Step-Up" tab and the reports badge.

**Tests**: `demo_api_server/src/__tests__/ciba.test.js` › "camelCase/snake_case field tolerance" — asserts a camelCase `bindingMessage` reaches `cibaService`, camelCase `loginHint`/`acrValues` are honored, and the response carries both `auth_req_id` and `authReqId`. All 40 ciba route tests pass.

---

## 2026-06-15 — Every MCP tool call 401'd `token_inactive` (Worker can't introspect a custom-resource user token)

**Symptom**: Clicking any agent action that calls an MCP tool (`My mortgage` → `show_mortgage`, the per-vertical `show_*` chips, etc.) returned `401 token_inactive` ("Session token is no longer active. Please sign in again.") — even immediately after a fresh login with a valid, unexpired user token (JWKS confirmed active).

**Root cause**: The tool-call gate in `mcpToolPipeline.js` does an RFC 7662 introspection of the session (user) access token via `tokenIntrospectionService`, which authenticates as the generic **Worker** CC client. PingOne returns `{"active":false}` (HTTP 200) when a Worker introspects an access token minted for a **custom resource** (`aud: enduser.ping.demo`) that the Worker isn't authorized for — confirmed by a direct probe. The introspection call itself succeeded; PingOne's verdict was `active:false`, so the gate hard-failed with `token_inactive`.

**Fix**: A client can always introspect its **own** tokens (PingOne returns `active:true`). `tokenIntrospectionService.validateToken(token, opts)` now accepts a creds override (`clientId`/`clientSecret`/`authMethod`) with a client-scoped cache key; `middleware/tokenIntrospection.introspectToken` forwards it; and the pipeline's session-token check (`server.js` deps) self-introspects with the issuing user app (`PINGONE_USER_CLIENT_ID`, `CLIENT_SECRET_POST`) when the token's `client_id` matches it, falling back to the Worker for any other issuer. Verified live: `Token introspection completed valid:true client_id=b7d00976…`, gate passed.

**Tests**: `demo_api_server/src/__tests__/tokenIntrospection.test.js` — updated the call-signature assertion and added a case asserting `introspectToken` forwards issuing-client creds opts to `validateToken`; all pass.

---

## 2026-06-15 — `transfer` scope stripped from MCP Gateway delegated tokens (create_transfer always denied)

**Symptom**: The Authorize-driven "Transfer money" agent chip stayed greyed even with the scope picker on "Read + Write" (`create_transfer` came back `permitted:false, deniedReason: insufficient_scope: requires transfer` from `tools/list`). Real LLM-mode `create_transfer` calls hit the same wall at the gateway.

**Root cause**: `buildAllowedScopesByAudience()` in `configStore.js` hardcodes the per-audience scope allow-list used by `validateScopeAudience()` (RFC 8707). The MCP Gateway entry listed `read, write, mcp:invoke, ai:agent, mortgage:read, …` but **not `transfer`**, so the token-exchange step silently narrowed `transfer` out of every delegated token to `mcpgateway.ping.demo` — even though `scope-topology.json` (the SoT) lists `transfer` in the gateway resource's `mirroredScopes`. The hardcoded map had drifted from the SoT.

**Fix**: Added `transfer` to the MCP Gateway audience allow-list (kept it OFF the MCP Server audience — that asymmetry is intentional and matches `scope-topology.json`: `transfer` is a gateway-level authz gate, not a downstream resource scope).

**Tests**: `demo_api_server/src/__tests__/configStore-tokenExchange.test.js` — new case `MCP Gateway audience includes transfer (scope-topology mirroredScopes parity)`; all 30 cases pass.

---

## 2026-06-15 — Token introspection endpoint served at the wrong path (`/api/introspect/introspect`)

**Symptom**: `POST /api/introspect` returned `404 Cannot POST /api/introspect`. The documented RFC 7662 introspection endpoint appeared dead; the handler only responded at the accidental double segment `/api/introspect/introspect`.

**Root cause**: The router was mounted at `app.use('/api/introspect', introspectRoutes)` (`server.js`) while the handler also declared `router.post('/introspect', ...)`. Express concatenates the two, so the live path was `/api/introspect/introspect`. The route's own header comment documented `POST /api/introspect`, so the handler path was simply wrong.

**Fix**: `routes/introspect.js` — handler changed to `router.post('/', ...)`; mount + handler now form `POST /api/introspect`. No behavior change beyond the path.

**Tests**: `demo_api_server/tests/real/shared/token-validation.test.js` — the introspection test now POSTs to `/api/introspect` (was `/api/introspect/introspect`) and treats a `404` as a regression (accepts only `200`/`400`) rather than an accepted outcome.

---

## 2026-06-15 — LmdbSessionStore turned any throwing save-callback into a session self-destruct ("Session save FAILED")

**Symptom**: A successful login could log `[oauth/callback] Session saved OK` and then immediately log `Session save FAILED — aborting admin login: <unrelated error>` and destroy the just-saved session — mislabeling a downstream error (e.g. `Cannot read properties of null (reading 'id')` from `posthog.identify`) as a session-store failure. This is the masking mechanism behind the 2026-06-12 demoAdmin self-destruct (below): the trigger was fixed there, but the latent store defect that converts ANY throwing save-callback into a self-destruct was not.

**Root cause**: Every `LmdbSessionStore` method (`get`/`set`/`destroy`/`all`/`length`/`clear`) invoked its **success** callback *inside* the `try`. The express-session save callback runs application code (the OAuth callback's `posthog.identify`/`capture`, redirect, etc.). When that code threw synchronously, the throw re-entered `catch` and fired `cb(err)` a **second** time — express-session then took the `saveErr` branch and destroyed the session, and the real error was misattributed to the store. Secondary trigger: `posthog.identify`/`capture` in the admin save-callback (`routes/oauth.js`) could throw (e.g. an undefined `distinctId` when `POSTHOG_API_KEY` is set), with no guard.

**Fix**: (1) `services/lmdb/sessionStore.js` — the success `cb(...)` now runs **outside** the `try` in all six methods; `catch` covers only the LMDB op, so a throwing consumer callback propagates to the consumer instead of being re-reported as a store error (no double-callback, no spurious destroy). (2) `routes/oauth.js` — wrapped the `posthog.identify`/`capture` calls in the admin save-callback in try/catch so best-effort analytics can never abort a successful login.

**Tests**: `demo_api_server/src/__tests__/lmdbSessionStore.doubleCallback.test.js` — asserts `set`/`get`/`destroy` invoke their callback exactly once even when the consumer callback throws (the throw propagates, `cb(err)` is not re-fired), and that a real LMDB write error is still reported once via `cb(err)`. Proven to fail against the pre-fix `set()` form.
## 2026-06-15 — Agent-chip login loop: introspection call failure (401) misclassified as a dead session

**Symptom**: After logging into the customer dashboard, running a chip in agent mode showed "you are not logged in" and redirected to the PingOne login page. Re-logging in and running a chip bounced the user out again — an infinite login loop. The BFF session was actually valid (a `GET /my` JWKS validation succeeded seconds before each failure).

**Root cause**: `/api/agent/invoke` runs an RFC 7662 liveness introspection of the user token before the RFC 8693 exchange (`agentMcpTokenService.resolveMcpAccessTokenWithEvents`). `tokenIntrospectionService.validateToken` introspects using `PINGONE_WORKER_CLIENT_ID`, and PingOne returns **HTTP 401 (invalid_client)** because that Worker is not entitled to introspect a token issued to *another* client (the user app). Verified live: same worker → dummy token = `200 {active:false}`, worker → its own token = `200 {active:true}`, worker → user token = `401`. `validateToken`'s catch collapsed the 401 into `{valid:false, error:'token_introspection_failed'}` — the same `valid:false` a genuine `200 {active:false}` produces — so `agentMcpTokenService` threw `TOKEN_INACTIVE`, which `agentInvokeRoute` surfaces as a `401` and the SPA treats as session expiry → re-login → same 401. (Sequel to the 2026-06-14 fix that made introspection actually run: note the introspection path reads `PINGONE_WORKER_CLIENT_ID`, not the dedicated Introspection Worker behind `GW_INTROSPECTION_CLIENT_ID` — flagged for follow-up.)

**Fix**: Distinguish an introspection *call failure* (`intro.error === 'token_introspection_failed'`) from a definitive `200 {active:false}`. On a call failure the liveness check is skipped and the exchange continues with the user token, which the BFF already JWKS-validated (and which the exchange needs anyway). Only a real `active:false` still routes to refresh→`TOKEN_INACTIVE`. The teaching token-chain event now reports `skipped` instead of "token no longer valid". `demo_api_server/services/agentMcpTokenService.js`.

**Tests**: `demo_api_server/src/__tests__/agentMcpTokenService.test.js` — new "introspection call failure (no re-login loop)" block: call failure does NOT throw `TOKEN_INACTIVE` and proceeds to the exchange; emits a `skipped` event; a genuine `{active:false}` still throws `TOKEN_INACTIVE`. Full suite 87/87 pass.

---

## 2026-06-15 — ping-gateway crash loop: stale PID file on a persistent volume

**Symptom**: `ping-gateway` (PingGateway / ForgeRock IG) was perpetually `Restarting` (RestartCount 128). Every boot logged `IllegalStateException: Identity Gateway PID file already exists in '/var/gateway/tmp/ig.pid'. Cannot start`.

**Root cause**: `/var/gateway` is a persistent named volume (`gateway-instance`). A `tmp/ig.pid` left behind by an unclean shutdown (dated 3 days prior) survived every restart, and the stock `start.sh` refuses to boot while a PID file exists — so under `restart: unless-stopped` it crash-looped forever.

**Fix**: Live recovery — removed the stale `tmp/*.pid` from the volume and restarted (booted clean, RestartCount reset, routes loaded). Durable — the compose `entrypoint` now clears `$${IG_INSTANCE_DIR}/tmp/*.pid` before exec'ing the stock launcher, so an unclean shutdown can't reproduce the loop. `ping-gateway/docker-compose.yml`.

**Tests**: Infrastructure/compose change — no unit test; prevention is the entrypoint pid-cleanup itself.

---

## 2026-06-15 — configStore-tokenExchange test asserted stale env var name after rename

**Symptom**: `configStore-tokenExchange.test.js` failed with `Expected: ArrayContaining [StringContaining "PINGONE_AI_AGENT_CLIENT_ID"] / Received: ["PINGONE_AI_AGENT_ACTOR_CLIENT_ID"]` after the env var rename commit.

**Root cause**: The test hardcoded the old name `PINGONE_AI_AGENT_CLIENT_ID` in its assertion that the error message contains the missing-credential key. After the rename to `PINGONE_AI_AGENT_ACTOR_CLIENT_ID` (with backward-compat fallback in configStore), the error message correctly reports the new canonical name — but the test still expected the old one.

**Fix**: Updated `configStore-tokenExchange.test.js` to assert `PINGONE_AI_AGENT_ACTOR_CLIENT_ID` / `PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET` throughout.

**Tests**: `demo_api_server/src/__tests__/configStore-tokenExchange.test.js` — all 20 cases pass.

---

## 2026-06-14 — GW_INTROSPECTION_CLIENT_ID pointed to Token Exchanger (WEB_APP) instead of Worker

**Symptom**: Token introspection silently skipped on every agent call — `tokenIntrospectionService` logged `INTROSPECTION_NOT_CONFIGURED` because the client at `GW_INTROSPECTION_CLIENT_ID` (`f4dd707d`, `Demo AI App - Token Exchanger`, type `WEB_APP`) is not authorised to call `/as/introspect` across other clients. No 401 was surfaced; the service treated the misconfiguration as "not configured".

**Root cause**: `GW_INTROSPECTION_CLIENT_ID` was set to the Token Exchanger (`f4dd707d`) rather than the Worker (`89ad8921`). Only WORKER-type apps in PingOne can cross-client introspect (RFC 7662). The Token Exchanger is a WEB_APP — correct for token exchange, wrong for introspection.

**Fix**: `GW_INTROSPECTION_CLIENT_ID` and `GW_INTROSPECTION_CLIENT_SECRET` updated in `.env` to point to the Introspection Worker (`89ad8921`, `Demo AI App - Introspection Worker`, CLIENT_SECRET_BASIC). `PINGONE_INTROSPECTION_AUTH_METHOD=basic` confirmed. `configStore.envCoverage.test.js` now covers all new env var names.

**Tests**: `demo_api_server/src/__tests__/configStore.envCoverage.test.js` — verifies all `.env` vars resolve via `configStore.getEffective()`, including the new `PINGONE_AI_AGENT_ACTOR_CLIENT_ID`, `PINGONE_TOKEN_EXCHANGER_CLIENT_ID`, and `PINGONE_MCP_GATEWAY_CLIENT_ID` names.

---

## 2026-06-12 — Scope Audit page silently reported everything OK: expected-scope table was hardcoded and never matched the provisioned resource names

**Symptom**: The admin Scope Audit page (`/scope-audit`) listed the live PingOne resources and scopes correctly but showed no missing-scope analysis — every resource rendered as a neutral card, "0 Matched", nothing flagged — even when required scopes (e.g. `transfer`, `mortgage:read`, `admin:read`) were absent from PingOne.

**Root cause**: `routes/scopeAudit.js` compared live scopes against a module-local hardcoded `EXPECTED_SCOPES` table, untouched since before the SoT migration: it expected retired scopes (`sensitive`, `transfer:execute`), knew nothing about newer ones, and matched resources by substring patterns (`'banking api'`, `'mcp gateway'`) that never match the provisioned `Demo *` display names from `provisioning.resourceNames` — so `expected` was `null` for every resource and the comparison never ran. A second copy of the name mapping lived in `scopeAuditService.js` as a hardcoded pair list.

**Fix**: The route derives expectations from `scope-topology.json` via `services/scopeTopology.js` — required = `resourceScopes()` (native + T-10 mirrored) — and matches by audience URI first, then exact display name (canonical or via new `scopeTopology.provisionedResourceName()`). `scopeAuditService.buildScopeReferenceTable()` now derives its keys from the same provisioning block. `demo_api_server/routes/scopeAudit.js`, `demo_api_server/services/{scopeTopology,scopeAuditService}.js`.

**Tests**: `demo_api_server/src/__tests__/scopeAuditRoute.test.js` — runs against the real manifest (no topology mock): matches the provisioned `Demo API` name, matches by audience on a renamed resource, reports missing required scopes, returns `expected: null` only for unmodelled resources, and asserts the SoT no longer contains the retired scopes the old table expected.

---

## 2026-06-13 — MCP tool REQUEST section showed `{}` instead of the tool's input parameters

**Symptom**: In the Token Chain panel → MCP Results tab, the REQUEST section for every tool call showed `{}` (an empty object) even when the tool was invoked with parameters (e.g. `list_orders` with `{ limit: 10 }`). This was a regression — the section had worked previously.

**Root cause**: `publishMcpResultToSse` in `demo_api_server/server.js` accepted `{ tool, result, durationMs, isDelegated, userId }` but never the tool params. All four call sites in `mcpToolPipeline.js` were passing `params` (under the old name) to `recordMcpToolCall` (the 15-second polling path) but omitting it from the `publishMcpResultToSse` call (the SSE live-update path). The SSE payload therefore always had `requestJson: null`, and `TokenChainContext.js` built the card with `requestJson: null`, rendering as `{}`.

**Fix (primary)**: Renamed `params` → `requestJson` throughout the pipeline → SSE boundary. Captured a pre-HITL-strip snapshot (`const requestJson = { ...ctx.params }` before line 313's `delete params[HITL_CHALLENGE_ARG]`) so the full original call is preserved in both the SSE payload and the audit store. Extracted `publishMcpResultToSse` to `demo_api_server/services/mcpSsePublisher.js` so the SSE wire path is independently testable.

**Fix (secondary)**: Fixed a `resultSummary` → `summary` key mismatch at 5 call sites (`mcpToolPipeline.js` ×4, `mcpToolRegistry.js` ×1) — `mcpToolAuditStore.recordToolCall` destructures `summary`, so custom per-tool summaries were silently discarded before this fix.

**Tests**: `demo_api_server/tests/mcpToolPipelineSseRequest.regression.test.js` — 9 tests across 2 suites:

- Suite A-D (pipeline): happy path, empty params, HITL pre-strip snapshot, exchange-failed fallback, remote-unreachable fallback, auth-challenge fallback. Each asserts `payload.requestJson`.
- Suite E (SSE wire): tests the real `publishMcpResultToSse` against a mocked `mcpFlowSseHub`, verifying `requestJson` appears in the emitted event — tests the layer that Suite A-D can't see through the mock boundary.

---

## 2026-06-12 — Admin login ignored return_to: landed on /admin (or a stale path like /scope-reference) instead of the page that asked for it

**Symptom**: Navigating to an admin-gated page (e.g. `/admin/healthcare`) as a non-admin and confirming the "Log in as admin" dialog completed the PingOne flow but landed on `/admin` — or, with an older value lingering in the session store, an unrelated page like `/scope-reference` — instead of returning to the page that initiated the login. The end-user (customer) login honored `return_to` correctly.

**Root cause**: The admin OAuth callback (`routes/oauth.js`) calls `req.session.regenerate()` (P3 session-fixation protection) and then repopulates tokens/user — but read `req.session.postLoginReturnToPath` **after** the regenerate, when the fresh session no longer had it. The value `/login` stored was always lost, so the redirect always took the `|| '/admin'` fallback (or whatever path an old session record supplied). The end-user callback (`routes/oauthUser.js`) already captured the value into a local **before** regenerating — the admin callback predated that pattern.

**Fix**: Mirror the end-user callback: capture `sanitizePostLoginReturnPath(req.session.postLoginReturnToPath)` into a local before `req.session.regenerate()` and redirect to it after login. `demo_api_server/routes/oauth.js`.

**Tests**: Verified live end-to-end (Playwright): customer session → `/admin/healthcare` → "Log in as admin" → PingOne sign-on as demoAdmin → lands on `/admin/healthcare`. Before the fix the same flow reproducibly landed on `/admin`. (No unit test: the callback's PingOne exchange isn't mockable with the existing oauth-callback harness, which only simulates session objects.)

## 2026-06-12 — demoAdmin login self-destructed: createUser map key never matched the OAuth record's id

**Symptom**: Every demoAdmin OAuth login after the first (per BFF boot) completed the full PingOne flow, logged `[oauth/callback] Session saved OK`, then immediately logged `Session save FAILED — aborting admin login: Cannot read properties of null (reading 'id')` and redirected with the session destroyed. `/api/auth/oauth/status` returned `authenticated:false`; every admin real-API test failed with 401 (25 failures in `tests/real/shared`). demoUser logins were unaffected, which made it look like a demoAdmin credential problem — the password was fine.

**Root cause**: `dataStore.createUser` generated a uuid map key but built the record as `{ id, ...userData, ... }`, letting `userData.id` (the PingOne `sub` that `createUserFromOAuth` includes) overwrite the record's `id` via spread. Map key and `user.id` diverged, so the record was unreachable through `getUserById`/`updateUser`. On the next admin login, `getUserByUsername('demoAdmin')` found the record, `updateUser(user.id)` did `users.get(sub)` → miss → returned `null`, and the unguarded `posthog.identify(authedUser.id)` threw inside the `req.session.save` success callback. `LmdbSessionStore.set` calls `cb(null)` inside its `try`, so the throw was caught and the callback re-invoked with the error — taking the saveErr branch, which destroyed the just-saved session. demoAdmin always hit the buggy `createUser` path because `bootstrapData.json` seeds demoUser (id `5`) but not demoAdmin.

**Fix**: `createUser` now honors a caller-provided id as the map key (`const id = userData.id || uuidv4()`; spread before `id`), the same pattern `createAccount` already used, so key and record id always agree. Registration routes (`routes/auth.js`, `routes/users.js`) never pass `id`, so generated-uuid behavior there is unchanged.

**Tests**: `demo_api_server/src/__tests__/dataStore.createUser.test.js` — caller-provided id (OAuth sub) is reachable via `getUserById` and `updateUser`; generated-id path still keys consistently. Verified live: headless `loginViaBff` for both demoUser and demoAdmin returns a working `connect.sid`.
## 2026-06-12 — Ollama agent mode returned an empty answer (request-close false-positive aborted slow-provider streaming)

**Symptom**: With the "Ollama" agent mode selected, every prompt returned `RUN_FINISHED` with `outcome:success` but **zero** `TEXT_MESSAGE_CONTENT` deltas — the agent UI showed an empty reply. Reproduced identically in-cluster and through a port-forward; not specific to any prompt. Cloud providers (Anthropic/Helix) were unaffected.

**Root cause**: `demo_agent_service`'s SSE run handler (`agentRunHandler.ts`) wired its abort flag to `req.on('close', () => { aborted = true })`. In Node 16+, the **request** `IncomingMessage` emits `'close'` when the request *body* stream ends — for a fully-read POST that happens near the start of the run, not on client disconnect. The content-streaming loop is guarded by `if (aborted) break`, so once `aborted` flipped, no text deltas were emitted, yet `TEXT_MESSAGE_END`/`RUN_FINISHED` (which don't check `aborted`) still fired — a silent empty "success". It only bit Ollama because its CPU inference takes 24–89s, long enough for the false `req` close to fire before `reasonOnce` returned the answer; fast providers finished streaming before the race. Instrumentation proved it: `[OLLAMA-DIAG] contentLen:196` (model returned a valid answer) but `[RUN-DIAG] final {answerLen:196, aborted:true}`. Surfaced (not caused) by the in-cluster Ollama deployment, which made the slow local path reachable.

**Fix**: Detect a genuine client disconnect via the **response** stream — `res.on('close', () => { if (!res.writableFinished) aborted = true })` — instead of `req.on('close')`. `res` 'close' fires on a real disconnect; the `writableFinished` guard prevents a normal `res.end()` (which also closes `res`) from being misread as a disconnect. `demo_agent_service/src/agentRunHandler.ts`.

**Tests**: `demo_agent_service/tests/agentRunHandler.disconnect.test.ts` — "streams the answer even when the request stream closes mid-run" mocks `reasonOnce` to return a delayed final answer, fires `req`'s `'close'` mid-run, and asserts a `TEXT_MESSAGE_CONTENT` delta with the answer is still emitted. Verified to **fail** against the old `req.on('close')` code and pass with the fix. Full agent-service suite: 88/88 tests pass (pre-existing unrelated `vault.test.ts` argon2 module-resolution failure aside).

## 2026-06-11 — Login → run an agent prompt → logged out, agent vanished (MCP server JWKS pointed at the Management API host)

**Symptom**: Logging in, then sending any agent prompt, logged the user out and the agent UI disappeared. The BFF session was actually still valid (`/api/token-chain` kept returning 200 with a good session immediately after), and the gateway authorized the call (introspection `active`, Authorize `PERMIT`) — but `POST /api/agent/invoke` returned 401 with `{error:'token_inactive', message:'…Please sign in again.'}`, which the SPA obeyed literally.

**Root cause**: Two stacked defects. (1) **Config**: `mcp-server` had no `PINGONE_JWKS_URI`/`PINGONE_ISSUER`, so `demo_mcp_server/src/auth/jwks.ts` `resolveJwksUri()` fell back to `PINGONE_BASE_URL + /jwks`. `PINGONE_BASE_URL` is the **Management API** host (`api.pingone.com/v1/environments/{env}`), whose `/jwks` returns **403** — not the OIDC JWKS, which lives on the **auth** host (`auth.pingone.com/{env}/as/jwks`). jose threw "Expected 200 OK from the JSON Web Key Set HTTP response" and `TokenIntrospector.verifyTokenSignature` treated that fetch failure as a forged signature, so **every** agent token was rejected → 401 (100% reproducible; only looked transient because the user ran the agent once before being kicked). Sibling of the 2026-06-09 aud-drift bug — same class (a configmap value the live cluster reverts on redeploy). (2) **Misclassification + UX**: `mcpGatewayClient` mapped that downstream 401 (correct gateway aud, NOT expired) to `TOKEN_INACTIVE` + "sign in again", and `isSessionExpiredApiError` (`demo_api_ui/src/utils/authUi.js`) returns true for `token_inactive`, firing `invalidateSession` — logging out a user whose session was fine. Re-auth could never help: a fresh login mints the same token the MCP server still can't verify.

**Fix**: (1) Added `PINGONE_JWKS_URI` on the auth host (`/as/jwks`) to `k8s/02-configmap.yaml` (and `demo_mcp_server/.env.example`) so the durable config is correct after redeploy; applied live via `kubectl set env` to unblock immediately. (2) `mcpGatewayClient` now classifies a decodable, correct-aud, non-expired token rejected downstream as `GATEWAY_TOKEN_REJECTED` (`login_required:false`, `httpStatus:502`); undecodable tokens and an explicit gateway `login_required` still map to `TOKEN_INACTIVE`. `agentInvokeRoute`/`demoAgentRoutes` surface the new code as an inline 502 (not a 401 the SPA treats as session expiry). (3) `verifyTokenSignature` distinguishes a JWKS *availability* failure (non-200/timeout/network) from a real signature mismatch — on unreachable JWKS it retries once with a fresh keyset then warns-and-accepts (the gateway already authorized via introspection); a genuine signature failure still fails closed.

**Tests**: `demo_api_server/src/__tests__/mcpGatewayClient.reauth.test.js` — new case "classifies a valid-aud, non-expired token rejected downstream as GATEWAY_TOKEN_REJECTED (no forced re-login)" asserts `code:'GATEWAY_TOKEN_REJECTED'`, `login_required:false`, `httpStatus:502`; existing undecodable/login_required/aud-mismatch cases still pass (5/5). `demo_mcp_server` `tsc --noEmit` clean; `TokenIntrospector` suites green (27). **Prevention**: `startupConfigGuard.js` (boot tripwire) and `scripts/post-deploy-smoke.sh` (live-configmap gate, new check 3/4) now assert the resolved JWKS endpoint is the auth host and fail loudly if it resolves to the Management API host — mirroring the aud-invariant guard, so a configmap revert on redeploy is caught instead of silently logging users out.

## 2026-06-11 — LangChain agent: Helix could not tool-call, chat WS session hijack, trimming never bounded the LLM context

**Symptom**: Three flagship defects from a full review of `langchain_agent` (plus ~30 smaller verified findings, see CHANGELOG). (1) With `LANGCHAIN_LLM_PROVIDER=helix` (the default) and any MCP tools registered, `initialize_tools()` crashed with `NotImplementedError` and every chat fell to "not properly configured with tools". (2) Any client that could reach port 8889 (bound `0.0.0.0`) could send `session_init` with an existing session id — no token required — and steal the session's output stream or cancel its in-flight agent run. (3) Long sessions blew the model context window despite the Phase 278 trimming work, and `refresh_tools()` silently wiped every session's conversation history.

**Root cause**: (1) `ChatHelix` never overrode `BaseChatModel.bind_tools` (which raises `NotImplementedError`), and langgraph's `create_react_agent` calls it whenever tools are non-empty; `_build_prompt` also dropped all AI/Tool history, so the ReAct loop could never see tool results. (2) `_handle_session_init` created sessions and bound `_session_connections[session_id]` BEFORE token validation, with no ownership check on existing sessions; refusal paths tore down the victim's worker. (3) `ConversationMemory` trimming ran on a parallel store the LLM never reads — the real model input is `MemorySaver` graph state, which had no `pre_model_hook` and was rebuilt (`MemorySaver()` per `initialize_tools()` call) on every refresh; `ConversationMemory()` was also constructed with no args, discarding `LANGCHAIN_MAX_CONTEXT_TOKENS`.

**Fix**: (1) `bind_tools` via `convert_to_openai_tool` + prompt-mediated tool calling (`{"tool_call": {...}}` envelope parsed into `AIMessage.tool_calls`), transcript-preserving `_build_prompt` (`langchain_agent/src/agent/helix_llm.py`). (2) Token validated first; session creation/binding only after success; rebind requires owner (`sub`) match; refusals close `4401` touching only connection-local state; identity-guarded cleanup (`src/api/websocket_handler.py`); chat WS binds `127.0.0.1` by default with `CHAT_WS_HOST` container override (`src/main.py`, `k8s/02-configmap.yaml`, `docker-compose.yml`). (3) One shared `MemorySaver` from `__init__`, lock-guarded init, `delete_thread` on session clear, `pre_model_hook` applying `trim_messages(token_counter=count_tokens_approximately, max_tokens=config)` as `llm_input_messages`, config wired into `ConversationMemory` (`src/agent/langchain_mcp_agent.py`).

**Tests**: `tests/test_helix_tools.py` (19, incl. `create_react_agent` round-trip integration); `tests/test_websocket_handler.py` (6 hijack regressions: no-token/foreign-token cannot create, rebind, or tear down); `tests/test_langchain_mcp_agent.py` (`TestCheckpointerLifecycle`, `TestPreModelHook`, concurrent-init). Full suite: 94F/11E → 714 passed / 0 failed (pre-existing debt also cleared: `aiohttp<3.14` pin for aioresponses compat, hermetic integration tests with no operator `.env`/network dependence).

## 2026-06-09 — Parameterized vertical tools returned an empty "{}" card over MCP (e.g. CareConnect "Book an appointment")

**Symptom**: After the clarification-loop fix landed, answering CareConnect's "To book appointment, I need: Provider, When" with "book with Dr. Smith on Friday" no longer re-looped — but the result was broken: reply "Here are your book appointment." and an empty `{}` card (no appointment data). Same class of failure on every parameterized vertical tool over MCP (`checkout`, `order_status`, `submit_expense`, `request_time_off`, `release_records`, `gear_order_status`, `extend_rental`). Read tools (no params) were unaffected.

**Root cause**: The MCP server registered EVERY vertical action tool with a default empty schema `{ type:'object', properties:{}, required:[], additionalProperties:false }` (`BankingToolRegistry.ts` `VERTICAL_TOOL_DEFS` reduce). So `BankingToolValidator.validateToolParams` rejected every argument — `[BankingToolProvider] Parameter validation failed for book_appointment: Additional property not allowed: when/provider` — and the provider returned a plain-text `Invalid parameters: …` string. The BFF's `parseMcpToolPayload` (`verticalMcpExecution.js`) `JSON.parse`d that text, threw, fell to `result: parsed?.data ?? parsed ?? {}` → `data={}`, `render:'text'`, and (no `.error` field) was NOT flagged as an error. That empty/`text` envelope then hit `buildVerticalReply`'s noun fallback → "Here are your book appointment." and the UI rendered `JSON.stringify({})` → "{}". Secondary defect: `buildVerticalReply` had no write/confirmation case at all, so even with good data it would have said "Here are your book appointment." `tools/list` also advertised no params, so the LLM agent path couldn't fill them either.

**Fix**:

- `demo_mcp_server` — added the real `inputSchema` for the 8 parameterized vertical tools to `VERTICAL_TOOLS` (`handlers/verticalHandlers.ts`, kept in sync with each `config/verticals/<id>/tools.js`), and `BankingToolRegistry.ts` now uses `t.inputSchema || <empty default>`. Params are accepted, the tool executes, the real result + `render` flow back, and `tools/list` advertises the params.
- `demo_api_server` — `buildVerticalReply` (`demoAgentLangGraphService.js`) now emits confirmations for write actions (`book_appointment`, `release_records`, `checkout`, `submit_expense`, `request_time_off`), keyed off the stable `action` (not `render`, which degrades to `'text'` on a failed round-trip) so the copy holds and degrades gracefully on empty data.

**Tests**: `demo_mcp_server/tests/tools/BankingToolRegistry.test.ts` — "parameterized vertical tools declare their params (not the empty default)" (8 tools). `demo_api_server/src/__tests__/buildVerticalReply.writeActions.test.js` — write-action confirmations incl. the `render='text'` degraded-payload case and a read-action regression guard. MCP typecheck + build clean; BFF `verticalIntentDispatch` + plugin-route suites green.

## 2026-06-09 — Every agent MCP tool call 401'd: gateway→MCP-server audience drift

**Symptom**: Across verticals, agent tool calls (e.g. CareConnect "Check coverage" / "My records") failed with "Gateway authentication failed — Invalid or expired token" (and, before login, "Empty JWT payload"). The gateway introspected + authorized the call (PERMIT) but the MCP server rejected the forwarded token.

**Root cause**: The gateway forwards the inbound bearer to the MCP server UNCHANGED — no RFC 8693 re-exchange (`demo_mcp_gateway` `authorizeMcpRequest.ts` Step 4; `GatewayTokenPolicy` D-05 even forbids a downstream MCP-server aud in the inbound token). But `MCP_SERVER_RESOURCE_URI` was `mcpserver.ping.demo` (the `mcpServer` audience) while the gateway forwards a `mcpgateway.ping.demo` token, so the MCP server's local aud check (`demo_mcp_server` `TokenIntrospector.ts`) failed: `token_aud=mcpgateway.ping.demo expected=mcpserver.ping.demo`. The boot guard (`startupConfigGuard.js`) didn't catch it because it validated `MCP_SERVER_RESOURCE_URI` against its own `mcpServer` role (internal SoT consistency) rather than the cross-service forward-unchanged contract — so it PASSED the broken config. Second bug: the tokenless heuristic-vertical path dispatched anyway and forwarded an empty bearer → "Empty JWT payload" (the platform path already guarded this; the heuristic branch did not).

**Fix**: `service-topology.json` `MCP_SERVER_RESOURCE_URI` → `aud:mcpGateway` (regenerate `k8s/02-configmap.yaml`); `startupConfigGuard` maps that key to `mcpGateway` so the drift fails loudly at boot; `scope-topology.json` description corrected to forward-unchanged (no "hop #3"); `demoAgentLangGraphService` heuristic-vertical `!userToken` guard returning a clean `need_auth`, plus a choke-point guard in `mcpToolRegistry.callMcpToolInternal` that rejects an empty bearer for ALL agent paths (vertical, banking, LLM).

**Tests**: `src/__tests__/startupConfigGuard.mcpServerAud.test.js` (flags the old `mcpServer` value as drift; accepts the gateway audience), `tests/demoAgentLangGraphService.heuristicVerticalTokenGuard.regression.test.js` (tokenless → clean `need_auth`, no dispatch). Operational gate: `scripts/post-deploy-smoke.sh` asserts the live-configmap aud invariant after every deploy (this bug recurred when a redeploy reverted the configmap).

## 2026-06-09 — CI red on main: 2 failing api-server tests (scope-doc drift + platform-branch fixture gap)

**Symptom**: the "API Server (Node.js)" CI job was failing on `main` (red for several commits), blocking a clean signal. Two failing tests:

1. `src/__tests__/scopeTopology.regression.test.js` — "docs/scope-topology.md matches a fresh render of the manifest". Cause: PR #110 added 3 tools to `scope-topology.json` without regenerating the committed `docs/scope-topology.md`. **Already fixed** on `main` by the `docs(scope-topology): regenerate scope-topology.md` commit — passes on latest `main`; no action needed here.

2. `tests/demoAgentLangGraphService.modes.test.js` — "platform branch: RFC 8693 subject is the session userToken (I-1 regression guard)": `performTokenExchange` called 0× (expected 1). **Cause**: the platform branch resolves the gateway URL via `getMcpGatewayHttpUrl()` (line ~841), which an earlier hardening refactor made STRICT — it now THROWS when neither `MCP_GATEWAY_HTTP_URL` env nor `mcp_gateway_http_url` config is set (no-localhost-fallback). The test configured `pingone_resource_mcp_gateway_uri` but NOT the gateway URL, so the resolver threw before reaching the RFC 8693 exchange; an outer catch returned an error envelope → 0 calls. Not a production regression (real envs always set the gateway URL via configmap/env) — a test-fixture gap exposed by the resolver hardening.

**Fix**: added `mcp_gateway_http_url: 'https://gw.example:3005'` to the platform-branch test's `resetCfg` so the resolver returns a URL and the guard actually exercises the exchange. `tests/demoAgentLangGraphService.modes.test.js`.

**Tests**: the modes suite now passes 3/3; full api-server suite shows the 2 target tests green. (Note: a serial `--runInBand` full run surfaced unrelated cross-suite ordering artifacts in `vault/cli.regression` + `clientRegistration` that PASS in isolation and on CI's parallel workers — not real failures.)

## 2026-06-09 — Restart-hardening audit: 4 spurious-failure surfaces (demo "fails when not told to")

**Context**: Audit of startup + runtime + SoT hardening to confirm the demo survives restarts and only fails on operator intent. Verdict: SoT config survives restarts deterministically (ephemeral k8s LMDB → every pod re-derives from configmap/env; `topology:check` gate; boot guard fails loud). Found and fixed 4 surfaces where a normal restart could fail spuriously.

**1. Cold-start introspection 401 (HIGH).** The MCP gateway's RFC 7662 introspection (`GatewayIntrospectionClient`) is the only fail-closed *network* guard on the hot path. On a transient PingOne/AS blip it failed closed AND negative-cached the result for 5s with no retry; `/health` doesn't verify introspection warmth, so `run.sh` declares ready while it's cold → the first tool call after a restart could 401 for non-policy reasons. **Fix**: bounded retry (1 retry, 250ms) on transport/5xx errors; do NOT cache transport-error negatives (immediate recovery). Genuine `active:false` (HTTP 200) still cached. `demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts`; test `demo_mcp_gateway/tests/GatewayIntrospectionClient.test.ts` (4 cases).

**2. Last cold-start URL race (MED).** `mcpWebSocketClient.getMcpServerUrl()` resolved `mcp_server_url` via `configStore.getEffective` only (LMDB-first) with a `ws://localhost:8080` fallback — same class as the gateway-URL bug (`b7c13d89`), the last un-fixed instance. The async env→LMDB seed means an early read returns the committed localhost default. **Fix**: env-first `process.env.MCP_SERVER_URL || getEffective(...) || default`, matching `getMcpGatewayHttpUrl`/`tokenChainService`. `demo_api_server/services/mcpWebSocketClient.js` (+ debug route `routes/pingoneTestRoutes.js`); test `demo_api_server/tests/mcpServerUrlResolver.test.js`.

**3. Configmap drift ungated outside run-k8.sh deploy (MED).** `topology:check` (drift of configmap/compose/.env.example vs `service-topology.json`) ran only in `run-k8.sh deploy` — NOT in `k8s/update.sh --config` or CI, so a stale/hand-edited configmap (historically the #1 502/401 cause) could ship unvalidated. **Fix**: added the drift gate to `k8s/update.sh` (before `kubectl apply`) and a `topology` job to `.github/workflows/test.yml` (pure-Node, no npm deps).

**4. Vault preflight checked non-empty, not actually-decrypts (MED-HIGH).** A wrong/rotated `VAULT_PASSWORD` passed `run.sh`'s non-empty preflight, then crashed BFF + MCP gateway + agent with three opaque "open failed" logs. **Fix**: `run.sh` now attempts a real decrypt up front (`openVault`) and aborts with one clear message — but ONLY on a confirmed decrypt failure (exit 3); if the check can't run (no node/deps) it falls back to prior behavior, so it never introduces a spurious abort. Verified: correct password → exit 0, wrong → exit 3.

**Tests**: gateway `GatewayIntrospectionClient.test.ts` (4 pass), BFF `mcpServerUrlResolver.test.js` (3 pass) + existing `mcpGatewayResolver.test.js` (4 pass). Bash `-n` clean on run.sh/update.sh; `topology:check` = no drift; gateway typecheck clean. Note: the gateway test suite has 4 PRE-EXISTING failures from PR #111 (`GatewayConfig.authorizedActorClientId` missing in test fixtures) — unrelated to this change (proven by identical failure count with changes stashed) and not in CI; flagged separately. Commit: (this PR).

## 2026-06-09 — All verticals: agent clarification follow-ups looped for required-param actions without a server extractor

**Symptoms**: Across verticals, answering an agent clarification with the example it suggested re-asked the same question forever. CareConnect "book appointment" → "book with Dr. Smith on Friday" re-prompted "I need: Provider, When". Great Buy "Checkout" → "buy headphones $79" re-prompted "I need: Product" (amount was captured, product was not). Same class of bug on healthcare `release_records` and workforce `request_time_off`.

**Root cause**: On a clarification follow-up the UI stuffs the whole reply into only the first missing param (`parseClarificationReply` generic fallback in `BankingAgent.js`), then re-dispatches a flattened synthesized message (e.g. `"checkout buy headphones $79"`) with `forceHeuristic:true`. The server heuristic (`nlIntentParser.js`) re-extracts params from that string — so **any** required-param action whose heuristic lacked an extractor came back with empty params every turn and re-issued the same clarify. Extractors existed for amount / accountType / orderId / rentalId / expense (category+amount), but four required-param actions had none or only a partial one: healthcare `book_appointment` (provider+when), retail `checkout` (had amount, missing product), healthcare `release_records` (recordId), workforce `request_time_off` (days).

**Fix** (`nlIntentParser.js` — four new opt-in extractor blocks, mirroring `extractsExpenseParams`; flags wired into each vertical's `index.js`, with regexes broadened so the suggested examples also match directly):

- `extractsAppointmentParams` → healthcare `book_appointment`: `when` (relative date / day-of-week / clock time) + `provider` ("with Dr. Smith" → `dr smith`; else a department → `cardiology`).
- `extractsCheckoutParams` → retail `checkout`: `amount` + `product` (words left after stripping trigger verbs and the amount).
- `extractsRecordId` → healthcare `release_records`: numeric `recordId` (also fixed the wrong hint "rec-001" → "102"; record IDs are numeric).
- `extractsDays` → workforce `request_time_off`: number of `days`.

**Tests**: `demo_api_server/src/__tests__/nlIntentParser.pluginAmount.test.js` — 5 new cases (appointment provider+when ×2, checkout product+amount, numeric recordId, time-off days). 130 tests pass across nlIntentParser + verticalIntentDispatch + healthcare + vertical-plugin contract suites. Verified no routing collisions: "time off"/"pto balance" → `pto_balance` (not `request_time_off`); "my orders" → `list_orders` (not `checkout`); "my appointments" → `list_appointments`. Commit `84c91bb6` (amended). See REGRESSION_PLAN §4 (2026-06-09).

## 2026-06-08 — K8s startup: rollout-restart quota stall + MCP gateway cold-start ECONNREFUSED

**Symptoms**: Two failures during/after `./run-k8.sh` on local OrbStack K8s. (1) Startup hung in the rollout wait loop — `kubectl rollout status` sat on `Waiting for deployment "mcp-server" ... 0 out of 1 new replicas have been updated` for minutes. (2) For ~45s after the BFF (`banking-api-server`) pod started, agent "HEURISTIC" tool calls (e.g. CareConnect "My records" / "My appointments") returned `connect ECONNREFUSED 127.0.0.1:3005`.

**Root causes**:
- **Quota stall**: the `ai-demo` namespace `ResourceQuota` caps `limits.cpu` at 8; the 12 deployments use ~5700m at steady state. With no `strategy:` set, the Deployments used the default RollingUpdate (`maxSurge=1, maxUnavailable=0` for a single replica), so `kubectl rollout restart` of all 12 at once tried to create each new pod before terminating the old one. The surge pushed `limits.cpu` past 8 → repeated `FailedCreate: exceeded quota`; new replicas could not be created until old pods died, serializing the rollout into a long stall (180s-timeout-prone).
- **Cold-start ECONNREFUSED**: `mcpGatewayClient.getMcpGatewayHttpUrl()` resolved the gateway URL via `configStore.getEffective('mcp_gateway_http_url')` only. For this key getEffective resolves LMDB/vault → env → committed default. The env→LMDB seed is async at process start, so for the first ~45s `getEffective` returned the committed default `https://api.ping.demo:3005`; inside a pod `api.ping.demo` resolves to `127.0.0.1`, where nothing listens on 3005. (Paired with a separate fix `7ab1bea8` that corrected the configmap `MCP_GATEWAY_HTTP_URL` from `mcp-server:8080` — which 401'd on audience — to `http://mcp-gateway:3005`.)

**Fix**:
- Quota: set `strategy.rollingUpdate maxSurge:0 / maxUnavailable:1` on all 12 deployed manifests (`k8s/{10,20,30,40,60,61,62,63,64,65,66,67}-*-deployment.yaml`). Each restart terminates the old pod first, freeing CPU before the new pod is created — restarts stay within the 8-CPU quota and the 10-CPU node.
- Resolver: resolve env-first — `process.env.MCP_GATEWAY_HTTP_URL || configStore.getEffective('mcp_gateway_http_url')` in `getMcpGatewayHttpUrl()`. The env var is set from boot (K8s `http://mcp-gateway:3005`), so the first request resolves correctly; matches the env-first `useGateway` resolution in `server.js` and the configStore "env always wins" doctrine.

**Tests**: `demo_api_server/tests/mcpGatewayResolver.test.js` — env-first precedence (prevents the cold-start race), configStore fallback when env unset, trailing-slash strip, and the unconfigured-throw path (`npx jest --testPathPattern=mcpGatewayResolver` → 4 pass). Quota fix verified operationally: a full concurrent `kubectl rollout restart` of all 12 deployments completed in ~14s with zero `FailedCreate`/quota events (was an indefinite stall). Commits `f4c00bb8` (quota), `b7c13d89` (resolver).

## 2026-06-02 — TopNav profile menu looked empty (white-on-white dropdown)

**Symptoms**: Clicking the top-right person icon on `/dashboard` showed a blank or unusable menu — Profile, Sign In, and Log Out were not visible; presenters believed logout was removed from the app.

**Root cause**: `UserMenu.css` reused dark-topnav colors (`color: #ffffff`, white icon/hover) inside `.user-menu-dropdown`, which has a white background. Email, role, icons, and default hover states were invisible. On narrow viewports, the token pill plus dashboard controls could push the avatar past the viewport with no horizontal scroll on `.topnav-container`.

**Fix**: Dropdown text/icons use slate grays; dividers `#e5e7eb`; hover `#f1f5f9`. `TopNav.css` — `overflow-x: auto` on the bar, `flex-shrink: 0` on `.user-menu`, hide token pill display name below 1100px.

**Tests**: Manual — `cd demo_api_ui && npm run build` → 0; open person menu → readable items; Log Out navigates to `/api/auth/logout`. Commit `52821a99`. See REGRESSION_PLAN §4 (2026-06-02 user menu).

## 2026-05-31 — External agent runtimes: every tool call crashed (`callMcpTool` undefined) + verticals invisible

**Symptoms**: With any external agent runtime active (OpenAI Agents SDK / Mastra / Pydantic AI — i.e. `llm_framework` != `langchain`), every tool call from the agent failed. Separately, in a non-banking vertical, the external runtimes never offered the vertical's tools (e.g. healthcare's `book_appointment`/`view_coverage`) — they only saw the banking catalog while the prompt spoke the vertical's language.

**Root causes**:
- **Crash**: `routes/agentTool.js` (the `/internal/agent-tool` callback all external runtimes POST to in order to execute a tool) did `const { callMcpTool } = require('../services/mcpWebSocketClient'); await callMcpTool(...)`. `mcpWebSocketClient` exports `mcpCallTool`, not `callMcpTool` — so the call was `await undefined(...)` → `TypeError: callMcpTool is not a function` on every invocation.
- **Schema gap**: `routes/agentRun.js` built the tool list for external runtimes solely from `agentGatewayClient` (gateway tools or `getLocalToolsCatalog()` — banking only), never consulting the active vertical's plugin. So per-vertical plugin tools were never sent to the LLM.
- **Dispatch gap**: even if a plugin tool name were called, `/internal/agent-tool` never consulted `verticalDispatch`, so it had no handler for plugin tools.

**Fix**: (crash) `callMcpTool` → `mcpCallTool` in `agentTool.js`. (dispatch) `agentTool.js` now checks `verticalDispatch.resolvePlugin(activeId)` first — if the requested tool belongs to the active vertical's plugin, it executes in-BFF via `verticalDispatch.executeToolFor` (no MCP token needed); otherwise it falls through to the MCP `mcpCallTool` path (token-exchange + 428 handling unchanged). (schema) `agentRun.js` now post-processes its tool list through `resolveAgentRunTools(tools, activeId)` → `verticalDispatch.toolSchemasFor` when a plugin is active. All 4 runtimes now: vertical prompt + vertical tool schemas + vertical tool execution.

**Tests**: `demo_api_server/src/__tests__/agentTool.verticalDispatch.test.js` (plugin-tool detection + dispatch) and `demo_api_server/src/__tests__/agentRun.verticalTools.test.js` (vertical schemas sent when plugin active, banking kept otherwise). Offline e2e confirmed: with healthcare active, agentRun serves healthcare tools and agentTool executes `view_coverage` in-BFF returning real coverage data. `npx jest agentTool agentRun` → 32 pass. Live per-runtime LLM round-trip pending a logged-in session.

## 2026-05-30 — Banking heuristic help catalog collapsed 10→6 items (themed-branch misfire on the default vertical)

**Symptoms**: In the default banking vertical, the heuristics-only "I can help with:" catalog (shown on an unrecognized phrase / Mode-1 / Helix-unconfigured) dropped from the 10-item hand-authored `CAPABILITY_CATALOG` — losing `deposit`, `withdraw`, `spending summary`, `mortgage` and the example phrasings like "transfer $100 from checking to savings" — down to 6 generic chip-label items. Reply nouns also re-cased ("Your balances" → "Your Balance").

**Root cause**: `resolveActiveVerticalCtx()` (the single source feeding the live heuristic catalog + reply wording) returned `{ terminology, chips }` whenever the active manifest had a `terminology` block. Banking's `config/verticals/banking/manifest.json` HAS a terminology block, so for active=banking the resolver returned a non-null ctx, and `buildCatalogItems` took its themed-derived branch instead of the `if (!term) return CAPABILITY_CATALOG` verbatim branch. The function's own docstring said "or null for banking", but the code never special-cased banking. Introduced pre-Plan-1 in the DRY catalog-builder + ctx-threading commits (`3f7ba1e1`, `eb40876f`, `014005d1`).

**Why it shipped green**: every existing test exercised `buildCatalogMessage()` / `parseHeuristic(msg, 'banking')` with NO ctx argument (or mocked `resolveActiveVerticalCtx → null`, or never called `verticalManifest.init()`), so all tests hit the verbatim branch while the running server (which calls `init()` and passes the resolved ctx) hit the derived branch.

**Fix**: `resolveActiveVerticalCtx()` now returns `null` when the active vertical is `banking` (or unresolved) BEFORE reading terminology — selecting the verbatim catalog/wording, matching the documented contract. Themed verticals still receive their terminology. Surfaced by the high-effort `/code-review` of Plan 1; not caused by Plan 1 (its plugin branch is gated behind `hasPlugin()`, false for banking).

**Tests**: `demo_api_server/tests/nlIntentParser.catalog.test.js` — new `describe('resolveActiveVerticalCtx — live banking path (regression)')` calls `verticalManifest.init()`, sets active=banking, and asserts `resolveActiveVerticalCtx()` is null and the live catalog keeps deposit/withdraw/mortgage and equals the verbatim render. `npx jest nlIntentParser.catalog` → 11 pass.

## 2026-05-30 — Helix conversational fallback (`helix_fallback`) unreachable when Helix is the selected provider

**Symptoms**: When Helix was the configured NL provider and its JSON intent-router returned `kind:none` or non-JSON (including after the refusal-retry nudge), the user received the silent heuristic result instead of Helix's conversational answer. The documented `source:'helix_fallback'` outcome (and the `answerWithHelix` conversational path) could never fire for the common case where Helix was selected — both the LLM-only `answerWithHelix` block and the heuristic-mode Ollama→answerWithHelix block were dead code behind an early return.

**Root cause**: In `geminiNlIntent.js` `parseNaturalLanguage`, the Helix JSON-router block ended with `return { source: 'heuristic', result: heuristicResult, llm_attempted: true }` at the `kind:none`/non-JSON point. The inline comment said "fall through to conversational Helix answer", but the `return` terminated the function inside the `if (selectedProvider === 'helix')` block, making everything downstream (lines for LLM-only `answerWithHelix` and heuristic-mode Ollama→`answerWithHelix`) unreachable whenever Helix was selected.

**Fix**: Replaced the early `return` with a fall-through — set a `let llmAttempted` flag instead of returning, letting control reach the existing downstream fallback logic. The three heuristic-floor returns now carry `llm_attempted: llmAttempted` so the UI's "Helix couldn't map this" message (`BankingAgent.js`) still distinguishes attempted-vs-never-tried. The conversational `answerWithHelix` call uses a different (conversational) system prompt than the JSON router, so it is not a duplicate call.

**Tests**: `demo_api_server/src/__tests__/geminiNlIntent.llmOnly.test.js` — the three previously-failing cases ("falls through to answerWithHelix when JSON router returns kind:none", "…when JSON router parse fails", and the heuristic-mode "kind:none from helix router falls through to answerWithHelix after Ollama") now pass. `npx jest geminiNlIntent` → 13 pass.

## 2026-05-25 — Authorize wire-contract divergence and implicit fail-open on engine error (F7/F6/F4)

**Symptoms**: (F7) The `/api/authorize/test-evaluate` endpoint returned `consentRequired` when using the simulated engine but `hitlRequired` when using PingOne — different field names for the same concept. A UI component reading either field would work in one mode and silently fail in the other. (F6) When PingOne Authorize was unreachable (network error, 5xx), the catch block in `transactionAuthorizationService` returned a raw `{ ran: true, pingoneError: err }` object, which propagated behavior that depended on the calling route's ad-hoc error handling — no declared failover policy. (F4) Unrecognised obligation types from PingOne Authorize (e.g. a new policy attribute) were silently discarded by `_classifyRawObligations`, producing a PERMIT decision when the policy intended a gate.

**Root causes**:
- **F7**: The route forwarded `result.consentRequired` for the simulated branch but `result.hitlRequired` for the PingOne branch — each service used its own field name and the route didn't normalize.
- **F6**: No `authorize_failover_mode` config existed; the service let errors propagate as untyped error objects without a declared policy for network-unreachable scenarios.
- **F4**: `_classifyRawObligations` called `classifyObligations()` but never warned when an obligation type fell through all patterns unrecognised.

**Fix**: (F7) Both engine branches in `test-evaluate` now emit both `consentRequired` and `hitlRequired` (identical values, both always present). (F6) Added `authorize_failover_mode` to `configStore` FIELD_DEFS (default `fallback_simulated`); `transactionAuthorizationService` and the `test-evaluate` route both apply the configured policy on catch — `fallback_simulated` keeps the demo running with in-process policy, `deny` returns 503, `permit` fail-opens with a warning log. Legacy `ff_authorize_fail_open=true` maps to `permit`. (F4) `_classifyRawObligations` now logs `console.warn` for unrecognised obligation types.

**Tests**: `demo_api_server/src/__tests__/authorize.parity.test.js` (NEW) — 14 tests asserting simulated ≡ PingOne enforcement flags for the same inputs, DENY parity, and wire-contract field presence. `npx jest authorize.parity authorizeObligations authorize-gate transactions.authorization` → 51 pass.

---

## 2026-05-16 — Token Chain blank/unfaithful (review C1–C3, H1–H5, M1–M5)

**Symptoms**: The Token Chain diagnostic panel did not faithfully reflect the agent flow. Most damaging: on an RFC 8693 exchange failure the panel went completely blank; failed/denied steps rendered with benign amber styling (looked "in progress"); the gateway's second token exchange for real banking tools was invisible; a panel refresh after a failure showed a corrupted/empty chain; a failed call left the previous call's chain on screen labelled "live".

**Root causes**:
- **C1**: the single-exchange catch built the `exchange-failed` event into a local array then `throw err` without `err.tokenEvents = tokenEvents`. Every caller reads the chain off the thrown error, so the chain was lost exactly on failure.
- **C2**: `buildSessionPreviewTokenEvents` is `async`; called without `await`, so `(Promise).tokenEvents` was `undefined` → `[]`.
- **C3**: the gateway OLB/invest WS path returned the raw backend result with no `_meta.tokenEvents`.
- **H2**: the SPA `StatusBadge`/row/History only knew 7 statuses; everything else (incl. `failed`/`error`/`denied`/`expired`) fell through to the benign "waiting" bucket.
- **H4**: NL-path persistence wrote `eventType: event.status` (wrong domain) and `token: ''` (wiped claims); `getTokenChain` sorted DESC, reversing the live order.
- Others: H1/H3/H5/M1–M5 per REGRESSION_PLAN.md §4 (2026-05-16).

**Fix**: Attach `err.tokenEvents` on the failure throw; add the missing `await`; inject synthesized `_meta.tokenEvents` (cache-aware) on the gateway WS path; `resolveStatusVisual()` maps every status to a visual bucket with unknown/negative → red `failed`; fix the persistence eventType domain + claim fallback + ascending sort; bound the audit fetch with `AbortSignal.timeout`; scrub token-chain routes; add MCP request/response, resource-server, and agent-reasoning steps; clear stale chain + per-user history isolation.

**Tests**: `banking_api_server/src/__tests__/tokenChainService.regression.test.js` (NEW — H4 claim fallback, ascending order, H5 unverified marker, M1 graceful degradation; module had zero prior coverage). `agentMcpTokenService.test.js` — added C1 (failure attaches `exchange-failed` to `err.tokenEvents`) and M4 (no raw JWT in `tokenEvents`) cases. Full: `npx jest tokenChainService.regression agentMcpTokenService` → 90 pass; `oauthStatus.* hitlRoute.*` → 38 pass (no regression).

---

## 2026-05-15 — banking_agent_service: loopback default, body cap, prompt shipping (commit `03ec8e0e`)

**Symptoms**: Three Important findings from a security review of `banking_agent_service`. (1) `HOST` defaulted to `0.0.0.0` although `:3006` is documented loopback-only (REGRESSION_PLAN §3) — a misconfigured deploy exposes the token-exchange endpoint on all interfaces. (2) `express.json()` had no size limit, so an oversized body could amplify load before the cheap HI-04 subject-token shape check. (3) `tsc` did not copy `src/prompts/` into `dist/`, so the compiled service silently fell back to a minimal inline system prompt — dropping the curated `default.json` guardrail ("never reveal raw token values").

**Root cause**: (1) host default predated the loopback-only port policy. (2) `express.json()` used the framework default with no explicit cap for this small-payload, exchange-triggering endpoint. (3) `build` was bare `tsc`, which does not copy non-TS assets; `PROMPTS_DIR = join(__dirname, 'prompts')` resolves to an empty `dist/prompts/` at runtime, hitting the weak inline fallback.

**Fix**: `HOST` default `0.0.0.0` → `127.0.0.1` (explicit `HOST` still overrides for staging/prod; startup warns when bound to ALL interfaces — mirrors the MCP-server precedent in REGRESSION_PLAN §3070). `express.json({ limit: '16kb' })`. `build` → `tsc && npm run copy:assets` (`cp -R src/prompts dist/prompts`); the no-prompt-file path now logs loudly via `console.error` instead of degrading silently. Also corrected a stale HI-04 doc comment that claimed "base64 only" — the code already decodes the JWT payload as base64url (no logic change).

**Tests**: `banking_agent_service/tests/config.test.ts` — loopback default + explicit-HOST override + port default. `banking_agent_service/tests/promptStore.test.ts` — curated `default.json` loads (not the inline fallback) + CR-01 path-traversal allowlist. Full package suite: 3 suites / 15 tests green; pre-existing `vault.test.ts` unaffected.

---

## 2026-05-07 — Helix LLM service: answer read from POST response, not poll

**Symptoms**: Helix responses never returned — service polled a GET endpoint indefinitely. The real Helix API returns the completed answer synchronously in the `POST /messages` response body (`message_class=complete`).

**Root cause**: Original implementation always polled. Real API shape returns `{ message_class: "complete", content: [{ class: "complete", value: "..." }] }` directly in the POST response.

**Fix**: Read answer from `sendMessage` POST response when `message_class === "complete"`; polling retained as fallback. Made `helix_prompt_field_id` required (no safe default). Added `extractHelixResponse()` helper that also unwraps JSON-string `{response: "..."}` values.

**Tests**: `s:helixLlmService.test.js` — 19 tests; happy path asserts exactly 2 fetch calls (no poll) when POST returns complete.

---

## 2026-05-07 — Helix LLM stub replaced with real conversation API

**Symptoms**: Helix LLM calls always failed. Three root causes: (1) auth used `Authorization: Bearer` — Helix requires `x-api-key` header. (2) endpoint was a guessed `/api/environments/.../invoke` — real API is a 3-step conversation flow. (3) `helix_agent_id` was treated as a UUID but is actually an agent name string.

**Root cause**: `helixLlmService.js` was a stub pending confirmation of the real API shape.

**Fix**: Rewrote service with correct conversation API (createConversation → sendMessage → poll for `class=complete`), `x-api-key` header, and `/dpc/jas/helix/v1` path normalisation. Updated HelixPanel label/placeholder and `llmProviderStatus` display label to "Agent Name".

**Tests**: `s:helixLlmService.test.js` — 19 tests covering auth header, URL shape, poll retry, JSON unwrap, and error paths.

---

## 2026-05-07 — BankingAgent.chipRouting test contract updated (not a bug fix)

**Note**: `BankingAgent.chipRouting.test.js` updated to reflect that all chips (including AI chips) route through `runAction()` directly. The NL-input path is only for chips that need user-typed text before execution. No production regression — test contract aligned to existing runtime behaviour.

**Tests**: `BankingAgent.chipRouting.test.js` — contract assertions updated.

---

## 2026-05-02 — BankingAgent.chips float-mode test selector fixed (Phase 264-03)

**Symptoms**: 3 float-mode tests in `BankingAgent.chips.test.js` timed out at 1050ms each: "float mode: renders action items in Actions popout after opening panel", "float mode: shows education items in discovery popout after opening panel", "clicking 'Actions' trigger button opens the discovery popout in float mode".

**Root cause**: Tests waited for `screen.getByTitle(/PingOne Identity/i)` to confirm the panel was open, but the element rendered later than the panel `role="dialog"`. Then `document.querySelector(".ba-actions-trigger")` returned the compliance toggle button (same class, wrong element) instead of the real Actions trigger.

**Fix**: Replaced `getByTitle` wait with `getByRole("dialog", { name: /AI Agent/i })`. Replaced class-only `.ba-actions-trigger` selector with `.ba-actions-trigger[aria-haspopup='dialog']` to target the correct button.

**Tests**: `BankingAgent.chips.test.js` 60/60 pass.

---

## 2026-04-25 — Pre-existing test/code mismatches fixed (Phase 231 test-suite maintenance)

**Symptoms**: `AgentUiModeContext.test.js` had 3 assertions expecting `placement: "none"` for empty/unrecognised localStorage; `PingOneAudit.test.jsx` had `getByText("Run Audit")` matching both a `<strong>` and `<button>` element (ambiguous query), and `getByText("banking:ai:agent")` matching duplicate scope-tag spans.

**Root cause**: Tests were written against an earlier default of `placement: "none"`, but `defaultState` and `readLegacyMode()` were later changed to return `"middle"`. The PingOne audit component renders the same scope value in both "expected" and "current" columns, making exact-text queries ambiguous.

**Fix**: Updated 3 assertions in `AgentUiModeContext.test.js` to expect `"middle"`. Replaced all `getByText("Run Audit")` click targets with `getByRole("button", { name: /run audit/i })`. Changed duplicate scope assertion to `getAllByText(...).length > 0`.

**Tests**: `AgentUiModeContext.test.js` 9/9 pass; `PingOneAudit.test.jsx` 14/14 pass.

---

## 2025-06 — 2-exchange delegation: hardcoded client_secret_post caused auth failure (commit `3497664`)

**Symptoms**: AI-Agent→MCP 2-exchange delegation path returned "Unsupported authentication method" from PingOne when using the `_performTwoExchangeDelegation` flow. Affected all 4 PingOne calls in that path (2× client_credentials, 2× token-exchange).

**Root cause**: `getClientCredentialsTokenAs` and `performTokenExchangeAs` both included `client_secret: clientSecret` directly in the `URLSearchParams` body (CLIENT_SECRET_POST), but the PingOne apps (`Super Banking AI Agent Gateway` and `Super Banking MCP Service`) are configured for CLIENT_SECRET_BASIC (Authorization: Basic header). The 1-exchange path was fixed in an earlier commit (`92b3a1e`) via `applyTokenEndpointAuth`, but the 2-exchange-specific methods were overlooked.

**Fix**: Both methods now call `applyTokenEndpointAuth(clientId, clientSecret, method, body, headers)` with an optional `method` parameter (default `'basic'`). `_performTwoExchangeDelegation` reads `AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD` and `MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD` (both default `'basic'`) and passes them to all 4 call sites.

**Tests**: `oauthService.test.js` — 14 new tests added in `describe('token exchange — client authentication method', ...)` covering basic/post for all 5 BFF token methods. `CI=true npx jest --testPathPattern=oauthService` → 59 pass.

---


## 2026-03-28 — DemoDataPage build error: handleResetDefaults called missing setAccounts (commit `0058450`)

**Symptoms**: `CI=true npm run build` failed with `'setAccounts' is not defined` (eslint `no-undef`), blocking every Vercel deploy.

**Root cause**: `handleResetDefaults` in `DemoDataPage.js` was written against an old array-based accounts state (`setAccounts`) that was removed when the component was refactored to the type-slot model (`setTypeSlots`). The stale call was never caught locally because the dev server runs with `CI=false`.

**Fix**: Replaced the `setAccounts(prev => prev.filter(...).map(...))` call with `setTypeSlots((prev) => { ... })`. The new callback directly updates the `checking` and `savings` slots using `defaults.checkingName/Balance` and `defaults.savingsName/Balance`, matching the object-keyed shape that the rest of the component uses.

**Tests**: `CI=false npm run build` — compiled successfully. No runtime regression; `handleResetDefaults` is invoked by the "Reset to defaults" button on the Demo Data page.

---

## 2026-03-28 — Routing audit: 3 bugs fixed, 41 button routing tests added (commit `b21dcf7`)

**Symptoms**:
1. LandingPage "Logs" quick-link triggered admin OAuth sign-in instead of opening the log viewer.
2. OAuthDebugLogViewer "← Dashboard" always navigated to `/` (landing page) regardless of user role.
3. Admin Dashboard Quick Actions (7 buttons) used `window.location.href` causing full page reloads that break SPA state.

**Root causes**:
1. `onClick` was wired to `handleOAuthLogin('admin')` — a copy-paste error from an adjacent "Admin sign in" button.
2. `<Link to="/">` was hardcoded; role-aware path (`/admin` vs `/dashboard`) was never applied.
3. Buttons used `window.location.href = '/...'` instead of React Router `<Link>` components.

**Fix**:
- `LandingPage.js`: changed "Logs" button to `window.open('/logs', '_blank')`.
- `OAuthDebugLogViewer.js`: added `const dashboardPath = user?.role === 'admin' ? '/admin' : '/dashboard'`; changed link to `<Link to={dashboardPath}>`.
- `Dashboard.js`: replaced all 7 `window.location.href` Quick Action buttons with `<Link to="...">` for `/activity`, `/users`, `/admin/banking`, `/accounts`, `/transactions`, `/settings`, `/mcp-inspector`.

**Tests**: `src/components/__tests__/buttonRouting.test.js` — 41 tests, all passing. Covers DashboardQuickNav (8), PageNav (5), LandingPage (5), OAuthDebugLogViewer (6), Dashboard Quick Actions (7), DemoDataPage (6), Onboarding (2), Footer (2).

---

## 2026-03-28 — get_account_balance: type-name IDs like 'checking'/'savings' now resolved (commit `3aaeee4`)

**Symptoms**: 💰 Check Balance chip returned `❌ Account checking not found` when the ActionForm rendered before live accounts loaded from the server (uses `generateFakeAccounts()` placeholder IDs).

**Root cause**: `mcpLocalTools.js::get_account_balance` called `dataStore.getAccountById(account_id)` directly. Real account IDs are UUIDs; the UI placeholder IDs are `'checking'`/`'savings'`. `create_deposit`, `create_withdrawal`, and `create_transfer` all passed through `resolveAccountId()` first — `get_account_balance` was the only tool that was missed.

**Fix**: `get_account_balance` now loads user accounts via `ensureAccounts(userId)` then calls `resolveAccountId(rawStr, accounts)` before `getAccountById`, matching the pattern of the other write tools.

**Tests**: Covered by the existing routing test suite (`buttonRouting.test.js`) account-ID resolution path and manual verification via the Check Balance chip.

---

## 2026-03-28 — may_act absent: "will fail" changed to "may fail" — exchange always attempted (commit `f48120d`)

**Symptoms**: Token Chain panel showed `may_act absent — exchange will fail` as a hard guarantee, confusing users whose PingOne policy permits exchange without a `may_act` claim.

**Root cause**: `describeMayAct()` in `agentMcpTokenService.js` and the `MayActEduBox` in `TokenChainDisplay.js` used deterministic language ("PingOne will reject") that contradicts actual server behaviour — the RFC 8693 exchange is always attempted; PingOne decides based on its token policy.

**Fix**: Changed to "may fail" in the edu-box header, body paragraph, legend item, and the server-side `describeMayAct` reason string.

**Tests**: Display-only copy change; verified visually. No automated test added.

---

## 2026-03-28 — Investment accounts lost on cold-start: dataStore in-memory with no snapshot persistence (commit `1a93c77`)

**Symptoms**: Investment account (and any non-default account type saved via `/demo-data`) appeared immediately after saving but disappeared after the next Vercel cold-start or server restart. Only checking and savings accounts survived.

**Root cause**: `dataStore` is an in-memory `Map` — `persistAllData()` is a no-op by design. On cold-start `GET /api/accounts/my` found 0 accounts and called `provisionDemoAccounts(userId)`, which **deleted all existing accounts** and re-created only checking+savings. Investment accounts had no way to survive across Lambda invocations because `demoScenarioStore` (Redis/KV) only persisted settings, not accounts.

**Fix**:
- `demoScenario.js` — added `saveAccountSnapshot(userId)` helper that writes all current user accounts to `demoScenarioStore` (Redis/KV) as an `accountSnapshot` array. Called at the end of every `PUT /api/demo-data` and after fresh provisioning on `GET /api/demo-data`.
- `demoScenario.js` — added `restoreAccountsFromSnapshot(userId)` helper that reads the snapshot and recreates any accounts missing from the in-memory store. Called in `GET /api/demo-data` before `provisionDemoAccounts`.
- `accounts.js` — `GET /my` now calls `restoreAccountsFromSnapshot` before `provisionDemoAccounts`; saves snapshot after provisioning so even first-login cold-starts persist.
- `accounts.js` — `POST /reset-demo` saves the fresh 2-account snapshot after provisioning, so post-reset cold-starts restore the reset state (not the old custom configuration).

**Tests**: Node require-checks passing; `CI=false npm run build` successful. Manual: save investment account in `/demo-data` → simulate cold-start → `/dashboard` and `/demo-data` show all 3 accounts.

---

## 2026-03-28 — Bottom dock and admin middle agent lost: EmbeddedAgentDock guard bug (commit `db73404`)

**Symptoms**: Selecting "Bottom" placement showed a floating FAB instead of the full-width bottom dock on `/dashboard`, `/admin`, and `/`. Selecting "Middle" placement on the admin dashboard (`/admin`) showed no agent at all.

**Root cause**: Commit `669bf36` ("bottom-dock agent inside dashboard content") added an `isBankingAgentDashboardRoute(pathname)` guard to `EmbeddedAgentDock.js` intended to prevent the App-level dock from rendering on dashboard routes (since `UserDashboard` was supposed to render it internally). However:
1. The same guard also caused `UserDashboard`'s own `<EmbeddedAgentDock>` render to return null — the dock never showed on any dashboard route.
2. `App.js` suppressed the global float agent for ALL `middle` placements (`agentPlacement !== 'middle'`), including when the admin was on `Dashboard.js` which has no inline middle FAB of its own. Admin in middle mode ended up with no agent at all.

**Fix**:
- `EmbeddedAgentDock.js` — removed the `isBankingAgentDashboardRoute` guard and its import. The component now renders wherever it is mounted (App level or UserDashboard level) as long as the user and placement guards pass.
- `App.js` — added `onUserDashboardRoute` flag (`pathname === '/dashboard'` OR `pathname === '/' && role !== 'admin'`). Used in two places:
  1. App-level `<EmbeddedAgentDock>` is skipped on UserDashboard routes (UserDashboard renders it inside its own layout).
  2. Middle-mode float suppression is scoped to UserDashboard routes only, so the admin Dashboard.js still receives the float agent in middle placement.

**Tests**: `CI=false npm run build` — successful. Manual: bottom dock shows full-width below content on `/dashboard`; admin on `/admin` with middle placement sees the float FAB.

---

## 2026-03-28 — Delegated Access: static Act-as panel replaced with live Token Exchange Simulator

**Symptoms**: The "Act as" panel on `/delegated-access` was purely static — it showed a hard-coded RFC 8693 explainer but did not make any real API call or display actual before/after tokens. There was no way to see the live exchange chain or inspect JWT claims.

**Root cause**: `ActAsPanel` was intentionally a demo-only explainer; no live exchange integration had been wired up.

**Fix**: Replaced `ActAsPanel` with `TokenExchangeSimulator`:
- On open, fires `POST /api/mcp/tool` (→ BFF → RFC 8693 exchange chain → `tokenEvents[]`).
- Left column renders the token chain steps (user-token → exchange-required → agent-actor-token → exchanged-token) with status badges.
- Right column shows selected event's `POST /as/token` request body, JWT claims with `may_act`/`act` highlighting, explanation, and full JWT toggle.
- Retry button, spinner, and error state handle network/auth failures.

**Tests**: `u:components/__tests__/DelegatedAccessPage.test.js` — 17 tests covering: dialog open, `fetch` call params, chain label rendering, auto-select of user-token, row-click panel switch, exchangeRequest body display, error state, empty tokenEvents, retry re-fetch, close, Full JWT toggle, page structure, and tab navigation.

---

## 2026-03-27 — Float panel: compact scrollable chips + free-resize (commits `4d1ea23`, `9cc0654`)

**Symptoms**:
1. Chips and action buttons in the float-mode left rail were too large — overflow was clipped, not scrollable.
2. Dragging the SE / E / S resize handles appeared to work but the panel stopped growing at 560 × 720 px.

**Root causes**:
1. `.banking-agent-panel` base rule had `max-width: 560px` and `max-height: min(85vh, 720px)`. CSS `max-*` properties always win over inline `width`/`height` regardless of specificity, so the JS resize logic was correctly updating `panelSize` but the CSS caps silently clamped the rendered size.
2. The base rule also included `resize: both`, which browsers ignore when `overflow: hidden` is set — dead code contributing to confusion.
3. `handleResize` used `Math.min(560, …)` for width and `Math.min(720, …)` for height — the same hard caps in the JS.
4. When `dragPos` was `null` (panel not yet dragged), `handleResize` did not anchor the panel position before resizing, so the first resize could shift the panel.
5. Float-mode left rail was 148 px wide with full-size chips (font 13 px, padding 8 px 10 px) — too much for the compressed space.

**Fixes**:
- **`BankingAgent.css`** — Removed `max-width`, `max-height`, and `resize: both` from `.banking-agent-panel`. Lowered `min-height` from `260px` to `220px`. Added compact float-mode chip overrides: left rail `width: 130px`, chip `font-size: 11px; padding: 5px 7px`. SE handle redesigned (20 × 20, visible grip `::after` dots); E handle full-height `6px`; S handle full-width `6px`.
- **`BankingAgent.js`** — `handleResize`: replaced `Math.min(560, …)` / `Math.min(720, …)` caps with `Math.floor(window.innerWidth * 0.9)` / `Math.floor(window.innerHeight * 0.9)`. Added `dragPos`-anchor logic: when `dragPos` is null, reads `panelRef.current.getBoundingClientRect()` and calls `setDragPos` synchronously before the first `mousemove`.

**Tests**: `CI=false npm run build` — compiled successfully. Manual: drag SE grip — panel grows beyond old 560/720 limits up to 90 % of viewport; chips in left rail are smaller and the rail scrolls when content overflows.

---

## 2026-03-27 — "Session expired" banner showing when user is signed in (commit `b7e806a`)

**Symptoms**:
User sees a yellow "Your session has expired. Please log in again." banner on the dashboard even though they just signed in via PingOne OAuth.

**Root cause**:
The Vercel serverless deployment (and any cold-start scenario) can restore a session from the signed `_auth` cookie with `accessToken: '_cookie_session'` (a stub). `GET /api/auth/oauth/user/status` returns `authenticated: true` (cookie-based user data is present), but `GET /api/accounts/my` returns `401` because `authenticateToken` finds no real bearer token. `fetchUserData` in `UserDashboard.js` treated any 401 as a genuine session expiry and fired `toastCustomerError` — showing the banner even though the PingOne SSO session was still valid and a silent re-auth would succeed instantly.

**Fix**:
- **`UserDashboard.js`** — on non-silent `401` from `/api/accounts/my` or `/api/transactions/my`, redirect immediately to `/api/auth/oauth/user/login` instead of showing the banner. PingOne's SSO session makes this transparent (no credentials required). A `sessionStorage` guard key (`bx-dashboard-reauth`) prevents redirect loops: if re-auth still yields `401` after one redirect (broken PingOne config), the guard fires and the banner is shown as a fallback so the user can act.
- On successful data fetch, the guard key is cleared so future expiry after a genuinely-expired SSO session still redirects once.

**Tests**: `CI=false npm run build` — compiled successfully. Manual: open dashboard with expired/stub token — browser is silently redirected to PingOne and back, no banner shown; PingOne SSO session expired — banner appears after one redirect attempt.

---

## 2026-03-27 — Float agent not visible + drag broken after expand button

**Symptoms**:
1. Float agent FAB and open panel both disappeared on dashboard routes.
2. After clicking the expand/restore (⊞/⊟) button, dragging the panel no longer moved it.

**Root causes**:
1. `showFloatingAgent` in App.js gated on `agentPlacement === 'none' || agentFab`. If the user had previously set placement to `'bottom'` or `'middle'` with `fab: false` (via the Agent UI Mode toggle), `showFloatingAgent` became `false` and the entire `BankingAgent` component — including the FAB — was never rendered.
2. `handleDragStart` only called `setDragPos` when `dragPos === null` (first drag). After clicking ⊞ expand, `setIsExpanded(true)` is called. `panelStyle` checks `isExpanded` **before** `dragPos`, so the centered/expanded style always won — dragging set `dragPos` but the panel didn't move. The `[dragPos]` dependency on the `useCallback` also caused a stale closure when `dragPos` was already set.

**Fixes**:
- **App.js** — `showFloatingAgent`: removed the `(agentPlacement === 'none' || agentFab)` gate. Float agent now always renders on dashboard routes when the user is signed in. If an inline/dock agent is also active, the FAB coexists as a small corner button.
- **BankingAgent.js** — `handleDragStart`: now always calls `setDragPos({ x: rect.left, y: rect.top })` (unconditionally) and adds `setIsExpanded(false)` to exit expanded mode before applying the drag position. Removed stale `[dragPos]` dep — callback is now `[]`.

**Tests**: `CI=false npm run build` — compiled successfully. Manual: drag panel → click ⊞ → drag again → panel moves correctly. FAB visible even when `agentPlacement` is `'bottom'` or `'middle'` in localStorage.

---

## 2026-03-27 — Floating agent panel closes on page refresh

**Symptoms**:
Floating (FAB) agent panel was always closed after a browser refresh, even if the user had opened it. The panel also defaults to closed on `/dashboard` routes — so a refresh always reset the open state.

**Root causes**:
1. `useState` initializer read `isBankingAgentFloatingDefaultOpen(pathname)` which returns `false` for all dashboard routes — no localStorage fallback existed.
2. Route-change `useEffect([location.pathname, isInline])` fired on initial mount (same pathname) and called `setIsOpen(false)` again, overriding anything the initializer could have set from storage.

**Fixes** — `BankingAgent.js`:
- **`useState` initializer** — now checks `localStorage.getItem('banking-agent-open')` first; falls back to `isBankingAgentFloatingDefaultOpen` only when no saved value exists. Inline mode (`isInline=true`) is excluded and always returns `false`.
- **`hasMountedRef` guard** — a `useRef(false)` flag in the route-change effect skips the first call (initial mount), preserving the localStorage-restored value; subsequent pathname changes still close the panel on dashboard routes as designed.
- **Persist effect** — a new `useEffect([isOpen, isInline])` writes `String(isOpen)` to `localStorage('banking-agent-open')` on every toggle.

**Tests**: `CI=false npm run build` — compiled successfully. Manual: open panel → refresh → panel stays open.

---

## 2026-03-27 — Log viewer: remove nav buttons + light background

**Symptoms**:
1. Standalone `/logs` window had a top nav bar of buttons (Dashboard / Admin / Demo config) cluttering the top of the window.
2. Full dark background (`#1e1e1e`/`#252525`) matched the terminal aesthetic but was hard to read in bright environments.

**Root causes**:
1. `LogViewerPage.js` rendered a `log-page-nav` div with three `Link` buttons above the `LogViewer` component.
2. All CSS was hard-coded to dark palette — header/controls `#252525`, table `#1e1e1e`, text `#ddd`, borders `#333`/`#444`.
3. Refresh, Download, and Clear action buttons in the toolbar were redundant with auto-refresh.

**Fixes**:
- **`LogViewerPage.js`** — Removed `log-page-nav` div and unused `Link` import. Standalone viewer now fills the full `100vh` window with no nav bar.
- **`LogViewer.js`** — Removed Refresh, Download, and Clear buttons from the controls toolbar. Auto-refresh/auto-scroll checkboxes remain. Added `eslint-disable` comments on `clearLogs`/`downloadLogs` (preserved but not rendered).
- **`LogViewer.css`** — Full light-theme rewrite: backgrounds `#ffffff`/`#f8fafc`/`#f1f5f9`, borders `#e2e8f0`/`#cbd5e1`, text `#0f172a`/`#1e293b`/`#64748b`. Chip buttons, selects, inputs, table headers/rows, footer, scrollbars all updated to light palette. `log-viewer-standalone` height changed to `100vh` (was `calc(100vh - 56px)` to accommodate the removed nav bar).

**Tests**: `CI=false npm run build` — compiled successfully. Manual: open `/logs` — no nav buttons, light background, table rows legible.

---

## 2026-03-27 — API Traffic window: freeze button + light theme

**Symptoms**:
1. Live log kept updating while the user was trying to read an entry — no way to pause/inspect.
2. Dark background (`#0f172a` slate) made the viewer hard to read in bright environments.

**Root causes**:
1. `ApiTrafficPanel` subscribed to the store unconditionally with no freeze mechanism.
2. All CSS colours were hard-coded to dark slate palette.

**Fixes**:
- **`ApiTrafficPanel.js`** — Added `frozen` + `frozenEntries` state. **⏸ Freeze** button snapshots `liveEntries` into `frozenEntries`; list shows the snapshot while frozen. **▶ Resume** clears the snapshot and reverts to live feed. A `FROZEN` amber badge appears in the title bar. Live capture continues in the background regardless.
- **`ApiTrafficPanel.css`** — Full light-theme rewrite: background `#ffffff`/`#f8fafc`, borders `#e2e8f0`, text `#0f172a`/`#334155`. JSON syntax colours updated to dark-on-white (keys `#1d4ed8`, strings `#15803d`, numbers `#b45309`). Token event status badges updated to light variants. Added `.api-traffic-btn--frozen` amber style.

**Tests**: `CI=false npm run build` — compiled successfully. Manual: open `/api-traffic` — light background; click Freeze — list stops updating, badge shows FROZEN; inspect entry; click Resume — live again.

---

## 2026-03-27 — Split3: agent bottom cut off, columns unequal, layout disconnected from header

**Symptoms (3 bugs)**:
1. Agent panel bottom was cut off — input bar / action strip not visible.
2. All three columns were not equal width (token rail was fixed 300 px, the other two divided the rest).
3. 3-column grid appeared visually disconnected from the header (32 px gap, rounded corners on header).

**Root causes**:
1. `.banking-agent-panel` base rule has `max-height: min(85vh, 720px)`. `.ba-mode-inline` never reset it, so taller grids clipped the panel at 720 px.
2. `grid-template-columns: 300px 1fr 1fr` — hardcoded first column, not equal thirds.
3. `height: min(calc(100vh - 130px), 900px)` — wrong magic number (real header is ~165–180 px tall, not 130 px), so the grid always overflowed the viewport by 35–50 px. Also, `dashboard-header-stack` had `margin-bottom: 32px` creating a visual gap. A duplicate property `height: auto` was immediately overridden by the `height: min(…)` below it on the same rule.

**Fixes**:
- **`BankingAgent.css`** — Added `max-height: none; min-height: 0` to `.banking-agent-panel.ba-mode-inline` so container drives the height in inline contexts.
- **`UserDashboard.css`** — Changed `grid-template-columns` from `300px 1fr 1fr` to `1fr 1fr 1fr` everywhere (base rule + `ud-body--2026` override + `@media (max-width:1280px)`).
- **`UserDashboard.css`** — Dropped the magic-number `height: min(calc(100vh - 130px), 900px)` and `min-height: 500px`. The `.user-dashboard--split3` wrapper is now `height: 100vh; display: flex; flex-direction: column; overflow: hidden` so the 3-col grid receives `flex: 1 1 0%` and fills exactly the remaining viewport.
- **`UserDashboard.css`** — In split3 mode `dashboard-header-stack` gets `margin-bottom: 0` + no bottom border-radius so it connects flush to the grid edge → one cohesive page.

**Commits**: `8a8d1b4`, `0f91ffa`

**Tests**: `CI=false npm run build` — compiled successfully. Manual: Middle split — all 3 columns equal width; agent chat input visible; no overflow; header and grid appear as one unit.

---

## 2026-03-27 — Split3: flush columns, wider token rail, integrated bottom dock, quick nav everywhere

**Symptoms (multiple)**:
1. Token chain column too narrow (220 px) — RFC labels and flow text cramped.
2. Visual gap / whitespace between agent column and customer data column in Middle split view.
3. Bottom dock (Bottom Agent UI mode) looked like a detached floating widget (rounded corners, gradient shadow).
4. Quick nav rail (Home / Dashboard / API / Logs) disappeared on `/demo-data`, `/config`, `/mcp-inspector`, `/logs`, `/activity`.
5. Left-rail padding (`App--has-quick-nav`) intermittently missing — content overlapped FAB buttons.

**Root causes**:
1. `grid-template-columns` hard-coded `220px` for token rail.
2. `.ud-agent-column` had `padding: 10px 10px 0` — shrinking the agent panel away from its right neighbour. `.ba-split-column` had `border-radius: 10px 10px 0 0` leaving corner gaps.
3. `.global-embedded-agent-dock-wrap` had `border-radius: 12px 12px 0 0`, gradient `box-shadow`, isolated background.
4. `isDashboardQuickNavRoute()` only covered `/`, `/admin`, `/dashboard`, `/admin/banking`.
5. `AppRouteChrome` added `App--has-quick-nav` via `classList.toggle()`; React re-renders overwrote `className`, stripping it.

**Fixes**:
- **`UserDashboard.css`**: token rail `220px → 300px`; outer split3 container `border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden`; agent column `padding: 0` (was `10px 10px 0`).
- **`BankingAgent.css`**: `.ba-split-column` `border-radius: 0; width: 100%` — fills column flush.
- **`App.css`**: dock wrapper — removed gradient shadow and border-radius; toolbar has blue left accent + section-label title.
- **`embeddedAgentFabVisibility.js`**: `isDashboardQuickNavRoute` expanded to include `/demo-data`, `/config`, `/mcp-inspector`, `/logs`, `/activity`.
- **`App.js`**: removed `AppRouteChrome`; `showQuickNav` + `isOnDashboard` computed inline and included in declarative `className`.

**Tests**: `CI=false npm run build` — compiled successfully. Manual: Middle split — 3 columns flush, no whitespace between agent and accounts; Bottom dock visually part of page; nav rail on all signed-in pages.

---

## 2026-03-27 — Agent UI placement (Middle/Bottom/Float) + bottom dock integration

**Symptom**: Agent UI toggle only offered Floating/Embedded/Both with no clear distinction between "agent in middle column" vs "agent pinned at the bottom"; bottom dock had a visible gap between page content and the panel, with rounded corners that made it look detached.

**Root cause**: `AgentUiModeContext` stored a flat `mode` string with no separation of placement vs FAB overlay. `EmbeddedAgentDock` rendered the resize handle between the toolbar and the agent body (not at the top), and `padding-bottom: 12px` on `.user-dashboard--embed-agent` created a gap before the dock.

**Fix**: `AgentUiModeContext` — state is now `{ placement: 'middle'|'bottom'|'none', fab: boolean }`, persisted as `banking_agent_ui_v2`. `AgentUiModeToggle` — **Middle / Bottom / Float** buttons; **+ FAB** checkbox when placement is middle or bottom (not all three at once). `EmbeddedAgentDock` — resize handle moved to first child (acts as the seam); no `margin-top`; rounded corners only when collapsed; `padding-bottom: 0` on dashboard wrapper. Split3 token-chain column reduced to `160–200px`. `demoScenario.js` GET handler — `bankingAgentUi` now computed via `effectiveBankingAgentUi` before use in response payload.

**Tests**: `AgentUiModeContext.test.js`, `embeddedAgentFabVisibility.test.js`, `demo-scenario-api.test.js`. Manual: toggle between Middle/Bottom/Float; verify dock flush-joins content; verify token rail stays slim in split view.

---

## 2026-03-27 — Split-column agent: SecureBank-style chrome, scroll regions, education hamburger

**Symptom**: Split-dashboard middle column needed a compact assistant look (navy header, bubbles, **Send**), independent scrolling for transcript vs chips/actions, and **Education** / agent UI controls could not sit in a full-width bar beside the token rail.

**Root cause**: Inline **`BankingAgent`** in the three-column grid used the same two-column body as other embeds; **`.ba-split-column`** visual tokens were incomplete; **EducationBar** was a horizontal strip.

**Fix**: **`BankingAgent.css` / `BankingAgent.js`** — **`splitColumnChrome`** styling (header session, **Sign out**, message/input/send, **`ba-split-suggestions-row`**), flex **`order`** so chat + input sit above the tray, overflow on messages and tray. **`EducationBar`** — top-right hamburger + panel (offset from **`UIDesignNav`**). **`UserDashboard.css`** — agent column flex height for embedded panel. **`docs/PINGONE_AUTHORIZE_PLAN.md`**, **`MCP_GATEWAY_PLAN.md`**, **`PingOneAuthorizePanel.js`** — Authorize/decision-endpoint cross-links.

**Tests**: **`cd banking_api_ui && CI=true npm run build`**. Manual: **`/dashboard`** Split view — scroll chat and lower tray; **Classic** + **Embedded** — bottom dock; **Floating** FAB on dashboard routes when mode allows.

---

## 2026-03-27 — Customer split dashboard; agent modes (Floating / Embedded / Both); HITL consent popup

**Symptom**: Users lost the top-of-screen agent mode switch on `/dashboard`; they wanted token chain left, embedded assistant center, banking content right, with a way to revert to the previous layout. High-value HITL navigated away to a full consent page.

**Root cause**: `/dashboard` did not render the same education/toolbar affordances as home; layout was single-column banking + floating zone. Consent flow used **`navigate('/transaction-consent?challenge=…')`** only.

**Fix**: **`dashboardLayout.js`** + **`DashboardLayoutToggle`** — **`split3`** (default) vs **`classic`** in **`localStorage`**, event **`banking-dashboard-layout`** for **`App.js`** to re-evaluate FAB/dock vs inline agent. **`UserDashboard`** — three-column grid when **`split3`**, **`BankingAgent`** **`mode="inline"`** in center column. **`AgentUiModeContext`** + **`demoScenario.js`** — restore **`both`** (FAB + bottom dock) when not on split3 ( **`customerSplit3Dashboard`** suppresses duplicate chrome). **`TransactionConsentModal`** — modal + checkbox authorizing the assistant; **`openConsentFlowForPayload`** sets **`consentChallengeId`** instead of navigating; **`TransactionConsentPage`** thin route wrapper for deep links. **`App.js`** — hooks before loading return; **`split3Customer`** memo with **`dashboardLayoutTick`**.

**Tests**: **`CI=true npm run build`** (`banking_api_ui`); **`AgentUiModeContext.test.js`**, **`embeddedAgentFabVisibility.test.js`**, **`demo-scenario-api.test.js`**. Manual: **`docs/runbooks/regression/post-deploy.md`** §2 (consent popup, Split/Classic, agent toggle).

---

## 2026-03-26 — Embedded agent on `/config` (setup focus); Demo config page matches 2026 dashboard shell

**Symptom**: Application Configuration had no embedded bottom dock when Agent UI mode was embedded; the dock copy and shortcuts were banking-centric everywhere. **`/demo-data`** still used the older **`app-page-shell`** layout (gradient hero + **`PageNav`**) instead of the customer **`UserDashboard`** header stack and toolbar.

**Root cause**: **`isBankingAgentDashboardRoute`** gated **`EmbeddedAgentDock`** and **`App--has-embedded-dock`** to **`/`** / **`/admin`** / **`/dashboard`** only — **`/config`** was excluded. **`BankingAgent`** had no “application setup” variant for the dock. **`DemoDataPage`** did not import **`UserDashboard.css`** or reuse **`dashboard-header-stack`** / **`dashboard-toolbar`**.

**Fix**: **`embeddedAgentFabVisibility.js`** — **`isEmbeddedAgentDockRoute(pathname)`** includes **`/config`**; floating FAB still uses **`isBankingAgentDashboardRoute`** only (no FAB on **`/config`**). **`App.js`** — **`hasEmbeddedDockLayout`** uses **`isEmbeddedAgentDockRoute`**. **`EmbeddedAgentDock`** — show on embedded dock routes; on **`/config`**, dock title/lead and **`embeddedFocus="config"`** on **`BankingAgent`**. **`BankingAgent`** — prop **`embeddedFocus`** **`'banking'`** | **`'config'`**; config mode: setup title/subtitle, **`SUGGESTIONS_CONFIG_*`**, actions limited to **MCP tools** + **Log out**, updated welcome copy. **`DemoDataPage`** — **`user-dashboard user-dashboard--2026`**, same header/toolbar pattern as **`UserDashboard`** (breadcrumbs, education shortcuts, theme toggle); **`section` / **`ud-hero`** for intro; **`useEducationUI`**; removed **`PageNav`** / **`appShellPages`** for this page.

**Tests**: **`embeddedAgentFabVisibility.test.js`** (**`isEmbeddedAgentDockRoute`**, FAB hidden on **`/config`** when floating); **`DemoDataPage.test.js`** mocks **`EducationUIContext`**. Manual: embedded mode — dock on **`/config`** with setup copy; **`/demo-data`** matches dashboard chrome.

---

## 2026-03-27 — Banking Agent: dashboard-only floating UI; HITL routes; floating panel sizing; consent GET

**Symptom**: Floating agent appeared on marketing and tool routes; panel was too small to read chips and suggestions; HITL consent page and admin banking ops were not routed; `DashboardQuickNav` crashed (`isBankingAgentDashboardRoute` referenced without import).

**Root cause**: `showFloatingAgent` used `!user || agentUiMode === 'floating'` (agent everywhere when signed in); default panel size and expanded height used `min(80vh, 260px)`; server lacked **`GET /api/transactions/consent-challenge/:challengeId`** for the consent UI snapshot.

**Fix**: **`App.js`** — `Router` wraps **`AppWithAuth`**; floating agent only when **signed in**, **floating mode**, and **`isBankingAgentDashboardRoute(pathname)`** (`/`, `/admin`, `/dashboard`); **`App--has-embedded-dock`** only on those routes. **`BankingAgent.js` / `BankingAgent.css`** — larger defaults, fixed expand dimensions, resize limits, results panel offset. **`routes/transactions.js`** — register **GET** consent challenge before **`GET /:id`**. **Routes**: **`/admin/banking`**, **`/transaction-consent`**; **`UserDashboard`** — on **`consent_challenge_required`**, create challenge and navigate to consent; return-state toasts. **`DashboardQuickNav`** — use **`isDashboardQuickNavRoute(pathname, user)`**. **`embeddedAgentFabVisibility`** — **`shouldShowGlobalFloatingBankingAgentFab`** matches dashboard-only rule. **Logo SVGs** — explicit **`#ffffff`** text fills; landing **`.brand-name`** white.

**Tests**: `embeddedAgentFabVisibility.test.js`; `App.session.test.js` mock includes **`Router`**; `banking-agent.spec.js` — no FAB on unauthenticated `/`; title assertion on `/dashboard`; `npm test` in `banking_api_server` (consent). Manual: **`docs/runbooks/regression/post-deploy.md`**.

---

## 2026-03-27 — Dashboard shell UX: quick nav scope, rail layout, admin lookup, agent mode toggle

**Symptom**: Left-rail controls overlapped main content and headers; quick nav appeared on marketing and config routes; users wanted CIBA/CIMD-style blocks with alternating colors; admin needed customer lookup with PingOne-enriched profile and accounts/transactions.

**Root cause**: `DashboardQuickNav` mounted for all routes with `App--has-quick-nav` always on; no `padding-left` on `.App` reserved space for the fixed stack; link-styled `<Link>` rows; admin lookup returned transactions only from local seed.

**Fix**: **`DashboardQuickNav`** only when **signed in** and path is **`/`**, **`/admin`**, or **`/dashboard`** (`isBankingAgentDashboardRoute`); **`AppRouteChrome`** toggles **`App--has-quick-nav`** for content inset; base **`--stack-fab-top-demo`** when quick nav off vs full stack when on; **`pingOneUserLookupService`** + **`POST /api/admin/transactions/lookup`** merges PingOne directory fields when worker token can read users; **`AgentUiModeToggle`** on landing nav, learn bar, and Config; alternating red/teal quick-nav buttons; static mocks under **`public/design/`** updated.

**Tests**: `embeddedAgentFabVisibility` / demo-scenario tests where touched; manual per **`docs/runbooks/regression/post-deploy.md`**.

---

## 2026-03-27 — Playwright BankingAgent E2E specs out of sync with current UI

**Symptom**: `tests/e2e/banking-agent.spec.js` failed (collapse control, action-row clicks, form assertions). Examples: collapse locator matched **two** `role="button"` nodes (header drag handle + collapse icon); `/Transfer/i` matched **suggestion** chips and **action** rows; **`ActionForm`** uses **Account** `<select>`s and labels like **Amount ($)** / **From Account**, not free-text “Account ID” or the old input order.

**Root cause**: Tests were written for an older BankingAgent layout and form schema; Playwright **accessible name** matching is not unique for `getByRole('button', { name: 'Collapse agent' })` when another `role="button"` exists in the panel header.

**Fix**: Scope **collapse** to `.ba-header-tools button[aria-label="Collapse agent"]` ; scope **MCP action** clicks to `.ba-action-item` under the panel; assert **core** banking actions by label instead of a fixed `.ba-action-item` count (Session / Learn rows added more buttons); align balance/deposit/withdraw/transfer tests with **`#field-accountId`**, **`#field-amount`**, etc., and dynamic MCP `account_id` / transfer IDs from the selected options.

**Tests**: `cd banking_api_ui && npm run test:e2e:agent` (or `npx playwright test tests/e2e/banking-agent.spec.js`).

---

## 2026-03-26 — UI notifications: centralized toasts (success / error / warning)

**Symptom**: Mixed patterns (`alert()`, inline banners, direct `toast.*`) made outcomes inconsistent; **`Transactions.js`** called **`setError`** without state (silent failure); **`OAuthDebugLogViewer`** called **`setError`** without state; **`BankingAdminOps`** used **`toast.error`** without importing **`toast`**.

**Root cause**: No single convention for user-visible feedback; some components predated **`appToast`** helpers.

**Fix**: **`banking_api_ui/src/utils/appToast.js`** — **`notifySuccess` / `notifyError` / `notifyWarning` / `notifyInfo`**; **`dashboardToast.js`** for session messages with **Sign in** actions. Migrated **Dashboard**, **UserDashboard**, **BankingAgent**, **Config**, **DemoDataPage**, **ActivityLogs**, **AgentUiModeToggle**, **ClientRegistrationPage**, **SecuritySettings**, **Transactions**, **OAuthDebugLogViewer**, **BankingAdminOps**. **UserDashboard** step-up (428) uses a **persistent warning toast** with CIBA / email verify (**`toastId: customer-step-up`**). **`McpInspector`**: JSX spacing fix for ESLint **`no-undef`**. **`EmbeddedAgentDock`**: CSS custom property style object lint.

**Tests**: **`cd banking_api_ui && CI=true npm run build`**; manual checks per **`docs/runbooks/regression/post-deploy.md`** (§4 step-up toast).

---

## 2026-03-26 — HITL consent HTTP routes missing; scope tests out of sync with GET /api/transactions/my

**Symptom**: `transaction-consent-challenge.test.js` and `step-up-gate.test.js` failed (404 on `/api/transactions/consent-challenge`; high-value `POST /api/transactions` returned **201** without a consent flow). OAuth scope suites expected **200** on **`GET /api/transactions/my`** when the token only had **`banking:accounts:read`** or **`banking:write`**.

**Root cause**: **`transactionConsentChallenge`** existed (and MCP/local tools used it), but **`routes/transactions.js`** did not register **`POST /consent-challenge`** / **`POST /.../confirm`** or call **`verifyAndConsumeChallenge`** on **`POST /`**. Tests assumed **`/transactions/my`** behaved like **`/accounts/my`** (scope-independent).

**Fix**: Register consent routes **before** **`GET /:id`**; after balance checks, require a consumed session challenge for non-admin **deposit** / **withdrawal** / **transfer** when **amount > $500**. Align Jest expectations with **`requireScopes(['banking:transactions:read', 'banking:read'])`** on **`GET /my`**.

**Tests**: `cd banking_api_server && npm test -- --forceExit`; `transaction-consent-challenge.test.js`, `step-up-gate.test.js`, `oauth-scope-integration.test.js`, `scope-integration.test.js`, `oauth-e2e-integration.test.js`.

---

## 2026-03-26 — Customer dashboard blank / no accounts or transactions

**Symptom**: Dashboard looked **empty** or failed to show accounts and activity even when the user was signed in.

**Root cause**: **`GET /api/accounts/my`** and **`GET /api/transactions/my`** were requested together — **`/transactions/my`** requires **banking read scopes**; a **403** failed the **entire** request so accounts never applied. Some API rows used **`created_at`** or missing **`balance`**, which broke rendering. No **fallback** when OAuth session was missing or loads failed.

**Fix**: **Separate** fetches; on transaction **403**, show **sample** activity with an info toast; **normalize** account/transaction fields; **`cloneDemoAccounts` / `cloneDemoTransactions`** when API returns no accounts, on soft **401**, session error, or hard errors; **“No transactions yet”** row when accounts exist but history is empty.

**Tests**: Manual.

---

## 2026-03-26 — Duplicate “session expired” toasts while still signed in

**Symptom**: Two stacked toasts: “Your session has expired. Please log in again.” with **Sign in**, despite an active session.

**Root cause**: **`/api/accounts/my`** / **`/api/transactions/my`** can return **401** while **`/api/auth/oauth/*/status`** still shows authenticated (JWT/session lag, rate limits, or races). The UI treated every **401** as hard expiry. **Parallel** agent refreshes and **react-toastify** without a stable **`toastId`** could stack identical session toasts.

**Fix**: **Retry** banking GETs on **401** with backoff; **`resolveSessionUser()`** — if a user still exists, **one** soft **`toast.warn`** (`toastId`) instead of expiry; only when no user: **`toastCustomerError`** + **`toastId: customer-auth-required`**. Agent refresh: **single** delayed fetch.

**Tests**: Manual.

---

## 2026-03-26 — Dashboard did not update after agent transfer (hosting window + agent results)

**Symptom**: After a transfer (or deposit/withdraw) via the Banking Agent, **Recent Transactions** on the main dashboard and the agent results panel did not show the new activity.

**Root cause**: **`UserDashboard`** had **no** `window` listener for **`banking-agent-result`**, so nothing refetched **`/api/accounts/my`** / **`/api/transactions/my`**. **`BankingAgent`** only dispatched that event in **full-page** display mode, and MCP write responses use **`success` / `operation` / nested `transaction`** shapes without top-level **`transaction_id`**, so the results panel often skipped updates until a manual “Recent Transactions” run.

**Fix**: **`UserDashboard`**: listen for **`banking-agent-result`**, apply optimistic row updates where applicable, and **silent `fetchUserData`** on a short delay; allow overlapping **silent** refreshes so agent double-fire is not dropped. **`BankingAgent`**: **`inferAgentResultTypeAndData`**, always dispatch **`banking-agent-result`** for panel + full page, and after **transfer/deposit/withdraw** call **`get_my_transactions`** so the side panel lists fresh rows.

**Tests**: Manual (agent transfer while on `/` or `/dashboard`).

---

## 2026-03-26 — MCP token exchange “skipped”; `get_account_balance` “Account optional not found”; floating agent scroll / expand layout

**Symptom**: Token Chain / toasts said token exchange was **skipped** (`MCP_RESOURCE_URI` unset) and the user token was forwarded; NL “Check my account balance” failed with **`Account optional not found`**; floating Banking Agent could not scroll chat; clicking **expand (⊞)** left the **Recent Transactions** results panel in the wrong place (still bottom-right while the agent centered).

**Root cause**: (1) **`resolveMcpAccessTokenWithEvents`** returned the **user access token** when `mcp_resource_uri` was unset — no RFC 8693, no audience/scope narrowing. (2) Groq/Gemini NL prompts used **`"accountId":"optional"`** as schema documentation; models copied the literal **`optional`** as `account_id`, producing **`Account optional not found`**. (3) Flex layout: left rail **`min-height: auto`** let the column dictate row height so **`.banking-agent-messages`** never got a bounded scroll area. (4) Results panel CSS assumed a **docked** agent width; **expanded** mode centers the agent but results still used the old **`right:`** position.

**Fix**: **Mandatory** `mcp_resource_uri` / `MCP_RESOURCE_URI` for MCP — **no passthrough**; **≥ `MIN_USER_SCOPES_FOR_MCP_EXCHANGE`** (default 5) distinct scopes on the user JWT before exchange; **admin + user OAuth** `scopes` now include **banking scopes** from `getScopesForUserType` so authorize requests enough scopes to narrow. NL prompts/sanitizer + **`mcpLocalTools.get_account_balance`** ignore placeholder **`optional`**. **BankingAgent.css**: flex **`min-height: 0`** on columns, **`touch-action: pan-y`** on messages. **BankingAgent.js**: **`useMemo`** positions **`ResultsPanel`** when **`isExpanded`** (left of centered agent). **`server.js` / `mcpInspector`**: return **`err.httpStatus`**, **`err.code`**, **`err.tokenEvents`** on resolution failures.

**Tests**: `agentMcpTokenService.test.js`, `nlIntentSanitize.test.js`; `npm test` subsets for MCP + NL.

---

## 2026-03-26 — HOME rail opened dashboard instead of marketing landing

**Symptom**: **HOME** navigated to **`/admin`** / **`/dashboard`** (same as the dashboard FAB), not the public marketing page.

**Root cause**: **`homeFabPath`** was set to the same paths as the second dashboard button for “nested splat” reliability.

**Fix**: **`homeFabPath`** → **`/welcome`** when signed in; route **`/welcome`** renders **`LandingPage`**; **Admin** / **Dashboard** FABs unchanged.

**Tests**: Manual.

---

## 2026-03-26 — “Session expired” toast while still signed in; Banking Agent panel too large

**Symptom**: Red toast “Your session has expired…” appeared during normal use; floating/embedded Banking Agent UI dominated the screen.

**Root cause**: `UserDashboard.fetchUserData` retried **401** on accounts but not before the final failure path; **`GET /api/transactions/my`** could return **401** during JWT/session lag while the BFF still reported an authenticated user via `/api/auth/oauth/user/status`. Admin dashboard showed the same toast on **401** after retries without re-checking admin session.

**Fix**: Retry **401** up to three times with backoff; **401** after retries calls **`resolveSessionUser()`** — if a user is still returned, show a **warning** (refresh / agent token) instead of the session-expired toast; **pending refetch** after a soft 401 remains allowed. Admin dashboard: same check before **`toastAdminSessionError`**. Banking Agent default size **halved** (e.g. **260×210** float, **320×260** expanded, narrower left column and results panel; embedded dock default/max heights halved in `App.js`).

**Tests**: Manual / existing `accountsHydration` unit tests.

---

## 2026-03-26 — Demo config save shows `invalid_token` toast

**Symptom**: Saving demo configuration showed **invalid_token** toasts (regression; save had worked before).

**Root cause**: `authenticateToken` validated the OAuth access token from `session.oauthTokens` when no `Authorization` header was present; an **expired or JWKS-invalid** access token produced **401** even when the BFF session cookie and `session.user` were still valid.

**Fix**: When token validation fails but `req.session.user` exists and the route is not blocked, attach **`req.user`** from session (with `sessionAccessTokenInvalid: true`) and **`next()`** — same trust model as `_cookie_session`. **`DemoDataPage`** maps **`invalid_token`** to a short user-facing hint (refresh token in Banking Agent or sign in again).

**Tests**: `banking_api_server` — `demo-scenario-api.test.js` and auth-related Jest suites pass.

---

## 2026-03-26 — Session BFF contract tests + `test:session` script

**Symptom**: Risk of regressions in `GET /api/auth/session` (`sessionStoreHealthy` / `sessionStoreError`) and session debugging without a dedicated test or npm script.

**Fix**: `banking_api_server` adds `npm run test:session` (Jest subset). `authSession.test.js` includes a **production-shaped** middleware block that sets `req._sessionStoreHealthy` / `req._sessionStoreError` before auth routes, asserting the JSON contract. `banking_api_ui/tests/e2e/session-regression.spec.js` adds Playwright API smoke for `/api/auth/session` and `/api/auth/debug`. Runbook: `docs/runbooks/session-regression.md`.

**Tests**: `banking_api_server/src/__tests__/authSession.test.js` — `session store ping contract`; `npm run test:session`; `npm run test:e2e:session` or `npm run test:e2e:api` in `banking_api_ui` (with API server up).

---

## 2026-03-26 — OAuth callback redirected to dashboard when session save failed

**Symptom**: After PingOne login the browser reached `?oauth=success` while `/api/auth/debug` could still show `accessTokenStub: true` — user appeared “logged in” but MCP/NL and token-backed routes failed.

**Root cause**: `req.session.save()` errors in the OAuth **callback** were treated as non-fatal: the code still set the signed `_auth` cookie and redirected to `/dashboard` or `/admin`, so the UI looked successful even when persistence did not complete.

**Fix**: On `saveErr`, call `req.session.destroy()`, `clearAuthCookie()`, and redirect to `/login?error=session_persist_failed` (end-user and admin OAuth callbacks). Login shows a dedicated message. **Note:** `UpstashSessionStore.set()` and the wire `faultTolerantStore` still invoke `cb(null)` when Redis SET fails, so many persistence failures never surface as `saveErr`; server logs remain important.

**Tests**: `banking_api_server/src/__tests__/oauth-e2e-integration.test.js` — still green; callback success paths unchanged when save succeeds.

---

## 2026-03-26 — Banking Agent blamed “unhealthy Redis” when Upstash was healthy (stub token)

**Symptom**: Session debug showed `sessionStoreHealthy: true` and `sessionStoreError: null`, but `accessTokenStub: true` and MCP/NL failed. The Banking Agent copy implied the session **store** was broken.

**Root cause**: Cookie-restore injects `oauthTokens.accessToken === '_cookie_session'`. With no `sessionStoreError`, the agent’s “not hydrated” message defaulted to generic “unhealthy store” wording instead of “tokens missing for this session / cookie restore.”

**Fix**: `buildSessionNotHydratedChat` branches on healthy store vs quota vs errors; `/api/auth/session` returns `sessionStoreHealthy`; `/api/auth/debug` adds `oauthTokenSummary`, `diagnosisHints`, `sessionInMemoryCache`, `sessionCircuitLastError`, and optional `?deep=1` Redis row probe (`getPersistenceDebug`). Banking Agent “Open session debug” uses `/api/auth/debug?deep=1`.

**Tests**: `banking_api_server/src/__tests__/upstashSessionStore.test.js` — `getPersistenceDebug()` suite.

---

## 2026-03-26 — AI agent FAB: opens then immediately closes (flash)

**Symptom**: Clicking the floating banking agent to expand showed the panel briefly, then it collapsed again (or felt like it “flashed”).

**Root cause**: `isBankingAgentOpenByDefaultForPath` was stubbed to always return `false`, but several `useEffect` hooks still called `setIsOpen(isBankingAgentOpenByDefaultForPath(...))` whenever **`user`** resolved, on **mount session discovery**, and on every **`userAuthenticated`** event. After the user opened the panel, the next auth sync forced **`isOpen` back to `false`**.

**Fix**:

- Introduce `isBankingAgentFloatingDefaultOpen(pathname)` in `banking_api_ui/src/utils/bankingAgentFloatingDefaultOpen.js` (collapsed on dashboard homes, open on other routes — aligned with `isBankingAgentDashboardRoute`).
- **Only** apply that default when **`location.pathname` changes** (and for initial `useState`), not when `user` / session / `userAuthenticated` updates.
- Remove `setIsOpen` from user/session/`userAuthenticated` effects; keep welcome-message and `checkSelfAuth` behavior.

**Tests**: `banking_api_ui/src/utils/__tests__/bankingAgentFloatingDefaultOpen.test.js`

---

## 2026-03-26 — Customer dashboard: no account rows after login

**Symptom**: After customer login, the dashboard showed “No account data” / empty table even though the demo should auto-provision accounts.

**Root causes (combined)**:

- **401 / session drift** — OAuth status could show authenticated before `GET /api/accounts/my` accepted the token (partially addressed elsewhere by `refreshIfExpiring` on `/api/auth/oauth`).
- **Transient 5xx / 503** — the UI retried some 5xx but **excluded 503**, so cold-start style responses were not retried.
- **Empty list** — no client-side retry when the first response returned **200 with `accounts: []`** (provision race).

**Fix**:

- `banking_api_ui/src/services/accountsHydration.js` — `fetchMyAccountsWithResilience`: bounded retries with backoff for **401**, **5xx including 503**, and **empty** lists; respects `userLoggedOut`.
- `UserDashboard.js` — uses the helper for hydration; empty-state copy + **Retry loading accounts** button.
- Transient classification for this flow: **429** is not retried in the helper (rate-limit UX unchanged).

**Tests**: `banking_api_ui/src/__tests__/accountsHydration.test.js`

**Ops**: `docs/runbooks/customer-account-hydration.md`

---

## 2026-03-26 — API traffic log spam (oauth status / session loop)

**Symptom**: Api Traffic showed endless `GET /api/auth/oauth/status`, `/api/auth/oauth/user/status`, and `/api/auth/session` in quick succession (all 200).

**Root cause**: `BankingAgent`’s `checkSelfAuth()` dispatched `userAuthenticated` after **every** successful self-check. `App.js` listens and runs `checkOAuthSession()` (same three endpoints). The agent also listens and runs `checkSelfAuth()` again → dispatch again → infinite loop.

**Fix**: Stop dispatching `userAuthenticated` from `checkSelfAuth` (mount and OAuth-retry paths still dispatch once when they first discover a session). Narrowed `userAuthenticated` listener effect deps and used a ref for welcome copy so `sessionUser` updates do not re-bind the listener unnecessarily.

**Tests**: `banking_api_ui/src/__tests__/App.session.test.js` — pass.

---

## 2026-03-26 — Could not transfer from savings / only one transfer

**Symptom**: Transfers from savings failed or only one transfer seemed possible.

**Root cause**: `POST /api/transactions` enforced **Transfer amount must be at least $50** (and the same check in `transactionConsentChallenge.validateIntent`, MCP `create_transfer`, and local inspector tools). After moving a large amount out of savings, the **remaining balance was often below $50**, so further transfers from savings were rejected. Small transfers under $50 from savings were also rejected.

**Fix**: Drop the transfer-specific $50 floor; keep **positive amount** and **insufficient balance** checks. UI: hint under transfer amount and `min="0.01"` on the amount input. Small transfers under $50 from savings are allowed.

**Tests**: `banking_mcp_server/tests/tools/BankingToolRegistry.test.ts` — `create_transfer` amount `minimum` is `0.01`.

---

## 2026-03-26 — Recent transactions blank after transfer

**Symptom**: After completing a transfer, the Recent Transactions list went empty or looked blank.

**Root causes**:

1. **Client**: `setTransactions` used `data?.transactions ?? []` — any non-array / missing payload cleared the list. Full `fetchUserData()` after a write set `loading` to true and replaced the whole dashboard with the loading screen.
2. **Server**: `provisionDemoAccounts` deleted **all** user transactions whenever it ran, including when `getAccountsByUserId` returned **no rows** (e.g. race or cold instance). That could wipe history before re-seeding sample data.

**Fix**:

- **UI**: Only call `setTransactions` / `setAccounts` when the response is an actual array; after transfer/deposit/withdraw (and after high-value consent return), refresh with `fetchAccountsOnly` + `fetchTransactionsOnly` (no full-page loading).
- **API**: Delete transactions in `provisionDemoAccounts` only when they reference **deleted** account IDs — do not mass-delete when no accounts were removed.

**Tests**: Manual verification; no new automated test.

---

## 2026-03-26 — Had to log out twice

**Symptom**: After clicking Log out, the app still behaved as signed in (or session came back) until logging out again.

**Root cause**: The startup `useEffect` removed `userLoggedOut` from `localStorage` immediately while `fetch('/api/auth/clear-session')` was still in flight. A second effect run (e.g. React Strict Mode remount or `checkOAuthSession` reference update) could run `checkOAuthSession` before cookies were cleared, restoring the user.

**Fix**: Remove `userLoggedOut` only in the `clear-session` `finally` callback; treat `/logout` as a post-logout landing path; `history.replaceState` to `/` after cleanup. Module-level `_didLogOut` still guards in-session re-runs.

**Tests**: `banking_api_ui/src/__tests__/App.session.test.js` — `userLoggedOut` flag cleared after `fetch` completes; no `/api/auth/*` GETs during logout path.

---

## 2026-03-26 — Vercel production UI build failed (ESLint)

**Symptom**: `cd banking_api_ui && npm run build` exited with 1 on Vercel (`CI=true` treats warnings as errors).

**Root cause**: `import/first` — `axios.defaults.withCredentials = true` sat between import statements in `App.js`. `no-unused-vars` — unused `subscribe` import in `ApiTrafficPage.js`.

**Fix**: Move the axios default below all imports; remove unused import.

**Tests**: CI build; no new unit test.

---

## 2026-03-26 — Admin token exchange ignored “Client Secret Post”

**Symptom**: PingOne returned `invalid_client` / “Unsupported authentication method” on the admin OAuth callback when the PingOne app expected `client_secret_post`.

**Root cause**: `refreshAccessToken` used configurable basic/post auth, but `exchangeCodeForToken` still always sent `Authorization: Basic` after a partial refactor.

**Fix**: Single helper `applyAdminTokenEndpointClientAuth`; config `admin_token_endpoint_auth_method` / env `PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH` (`post` | `basic`).

**Tests**: `banking_api_server/src/__tests__/oauthService.test.js` — PKCE + confidential client sends secret in body when `tokenEndpointAuthMethod` is `post`.

---

## 2026-03-26 — 429 on `/api/demo-scenario` and dashboard hydration

**Symptom**: `GET /api/demo-scenario` returned 429 (Too Many Requests) on Vercel; dashboard loads could fail alongside other `/api/*` calls.

**Root cause**: The global IP rate limiter applied to almost every API route. Paths such as `/api/demo-scenario`, `/api/tokens/*`, and session/OAuth status endpoints were **not** excluded (unlike `/api/accounts/my` / `/api/transactions/my`). Shared IPs or a low `RATE_LIMIT_MAX` exhausted the 15‑minute window during normal SPA hydration.

**Fix**: `shouldSkipGlobalRateLimit()` in `server.js` now excludes `/api/demo-scenario`, `/api/tokens`, `/api/auth/session`, `/api/auth/oauth/status`, and `/api/auth/oauth/user/status`. The UI coalesces concurrent `fetchDemoScenario()` calls to avoid duplicate GETs (e.g. React Strict Mode).

**Tests**: No dedicated rate-limit unit test; behavior verified in production. Client dedupe is in `demoScenarioService.js`.

---

## 2026-03-26 — 401 on `/api/accounts/my` while OAuth status looked signed-in

**Symptom**: After login, `GET /api/auth/oauth/user/status` could show `authenticated: true` while `GET /api/accounts/my` returned 401.

**Root cause**: `refreshIfExpiring` (RFC 6749 silent refresh) ran only on routes like `/api/accounts` and **not** on `/api/auth/oauth/*`. The OAuth status handlers only checked that a non–`_cookie_session` access token **existed**, not that it was still valid. `authenticateToken` on data routes validates the JWT with PingOne — expired tokens failed there first.

**Fix**: Apply `refreshIfExpiring` to the `/api/auth/oauth` path prefix in `server.js` so tokens refresh before OAuth status and related handlers run.

**Tests**: Existing `tokenRefresh` / OAuth integration coverage; manual verification on Vercel.

---

## 2026-03-25 — Redis cold-start 500 on `/api/accounts/my`

**Symptom**: "Failed to load your account information" banner after login.  
**Error log**: `{"error":"server_error","error_description":"An internal server error occurred","path":"/api/accounts/my"}`

**Root cause**:  
`RedisStore.get()` was calling `cb(err)` when Upstash had not yet completed its TLS handshake.
`express-session` propagated that error to Express's `next(err)`, which `oauthErrorHandler` converted to a 500.

**Fix**:  
Wrapped `RedisStore.get/set/destroy` in `services/faultTolerantStore.js`.
`get` errors return `cb(null, null)` (empty session → 401); `set`/`destroy` errors are logged and `cb(null)` is called.

**Tests**:  
`src/__tests__/session-store-resilience.test.js` — `faultTolerantStore wrapper` suite.

---

## 2026-03-25 — `?error=session_error` on customer sign-in

**Symptom**: Clicking "Customer Sign-In" on the homepage redirected to `/login?error=session_error` instead of PingOne.

**Root cause**:  
`oauthUser.js /login` called `req.session.save()` to persist the PKCE state.
When Redis was slow on a cold start the save callback received `err`, and the route responded with `res.redirect('/login?error=session_error')` before the user reached PingOne.
The PKCE state was already stored in a signed cookie (the fallback), so the session save was not essential.

**Fix**:  
Changed the `session.save()` callback in `/login` to log a `console.warn` and redirect to PingOne regardless of the error.
Applied the same non-fatal pattern to `session.regenerate()` and `session.save()` in the `/callback` routes of both `oauthUser.js` and `oauth.js`.

**Tests**:  
`src/__tests__/oauth-login-resilience.test.js` — `oauthUser /login — session.save() resilience` suite.

---

## 2026-03-25 — Eager Redis connect race condition

**Symptom**: Even with fault-tolerant store wrappers, the first cold-start request would block for ~8 s waiting for Redis to connect, and subsequent requests raced against a connect that had not started yet.

**Root cause**:  
`redisClient.connect()` was called lazily inside `awaitSessionRedisReady` (the first request middleware), meaning every cold start incurred the full TLS handshake latency on the hot path.

**Fix**:  
`redisClient.connect()` is now called **eagerly at module load time** in `server.js`, storing the promise as `_redisConnectPromise`.
`awaitSessionRedisReady` simply awaits the already-in-flight promise rather than issuing a new connect.
This allows the TLS handshake to overlap with the remaining Express startup cost.

**Tests**:  
`src/__tests__/session-store-resilience.test.js` — `awaitSessionRedisReady middleware` suite.

---

## 2026-03-25 — `userEmail: null` in session debug

**Symptom**: `/api/auth/debug` returned `"userEmail": null` even though the user had an email in PingOne.

**Root cause**:  
PingOne's `/userinfo` endpoint did not return the `email` claim because the attribute mapping had not been configured in the PingOne application.
`oauthService.createUserFromOAuth()` only looked at `userInfo.email`, so the email was null.

**Fixes applied**:
1. `oauthUser.js` callback decodes the ID token and merges its claims into `userInfo` before calling `createUserFromOAuth`, providing a fallback when `/userinfo` is incomplete.
2. `oauthService.createUserFromOAuth()` also checks `userInfo.email_address` (PingOne alternate claim) before giving up.
3. User configured the PingOne attribute mapping (permanent fix at the IdP level).

**Tests**:  
`src/__tests__/oauthService.test.js` — `createUserFromOAuth — email / name fallbacks` suite.

---

## 2026-03-25 — E2E scope tests incorrectly asserted 403 on `/my` dashboard routes

**Symptom**: CI failures: two tests in `oauth-e2e-integration.test.js` expected 403 on `/api/accounts/my` and `/api/transactions/my` when called with a write-only or accounts-read-only token.

**Root cause**:  
The tests were written assuming scope enforcement applied to all routes.
The `/my` routes are intentionally **scope-free** (BFF dashboard pattern): any authenticated user can read their own data regardless of which scopes are in the Bearer token.
Scope enforcement is only applied to admin/collection endpoints (`GET /api/transactions`, `GET /api/accounts`, etc.).

**Fix**:  
Updated the two tests to:
- Assert 200 on `/api/accounts/my` and `/api/transactions/my` for any valid token.
- Assert 403 on `GET /api/transactions` (collection endpoint) to verify that scope enforcement still works.

**Tests**:  
`src/__tests__/oauth-e2e-integration.test.js` — `Scope-based Access Control in E2E Flow` suite.

---

## Rule: Test Every Bug Fix

When fixing a production bug:
1. Add an entry here describing the symptom, root cause, and fix.
2. Write (or update) a focused unit test that reproduces the bug and verifies the fix.
3. Run the full suite (`npm test` in `banking_api_server/`) before committing.
4. The PR description must reference the test file and test name.

---

## 2026-03-27 — `/consent-url` missing PKCE caused token exchange 400

**Symptom**: Clicking "Grant agent permission" would redirect to PingOne, but the callback would fail with an `invalid_grant` or `400 Bad Request` because the `code_verifier` sent at token exchange had no matching `code_challenge` registered.

**Root cause**:  
`GET /api/auth/oauth/user/consent-url` built the authorization URL manually using `URLSearchParams` and omitted `code_challenge` and `code_challenge_method: S256`. Additionally it was missing the `setPkceCookie` call, so Vercel serverless callbacks running on a different instance had no PKCE recovery path. A missing `validateRedirectUriOrigin` check was also identified.

**Fix**:  
- Replaced manual `URLSearchParams` builder with `oauthService.generateAuthorizationUrl()` which includes PKCE S256 automatically.  
- Added `setPkceCookie(res, { state, codeVerifier, redirectUri, nonce }, _isProd())` for cold-start recovery.  
- Added `validateRedirectUriOrigin` guard matching the login route.

**Files**: `banking_api_server/routes/oauthUser.js`

---

## 2026-03-27 — In-app consent replaced PingOne ACR gate

**Symptom**: The agent consent gate required the PingOne admin to create an "Agent Consent" agreement, an "Agent-Consent-Login" auth policy, and attach it to the web app — blocking demos where PingOne config was unavailable or out of scope.

**Root cause**:  
The original design relied on `acr: "Agent-Consent-Login"` in the user's access token (issued only after PingOne shows the consent agreement screen). Missing `acr` caused the MCP token exchange to throw `AGENT_CONSENT_REQUIRED`, leaving the agent permanently blocked.

**Fix**:  
Replaced the PingOne ACR gate entirely with an in-app consent flag stored in the BFF session:
- `POST /api/auth/oauth/user/consent` sets `req.session.agentConsentGiven = true` after the user accepts the in-app modal.
- `DELETE /consent` revokes for demo reset.
- `agentMcpTokenService.js` now checks `req.session.agentConsentGiven === true` instead of comparing `acr` to `AGENT_CONSENT_ACR`.
- `SKIP_AGENT_CONSENT=true` env var disables the gate entirely for automated testing.
- New `AgentConsentModal.js` / `AgentConsentModal.css` renders a consent agreement modal without any PingOne dependency.

**Files**: `banking_api_server/routes/oauthUser.js`, `banking_api_server/services/agentMcpTokenService.js`, `banking_api_ui/src/components/AgentConsentModal.js`, `banking_api_ui/src/components/BankingAgent.js`

---

## 2026-03-28 — Dead Upstash database; sessions not shared across Vercel Lambdas (commits `4b66502`)

**Symptom**: Every login produced a working PingOne token but `GET /api/accounts/my` returned 401. Dashboard briefly showed "Session expired" on every cold page load, even immediately after signing in.

**Root cause**:  
Upstash database `steady-yeti-84614.upstash.io` no longer resolved in DNS (deleted/expired free-tier DB). `upstashSessionStore.set()` suppressed the Redis error by calling `cb(null)` unconditionally, so the OAuth callback thought the session was saved. Each Vercel Lambda had its own empty in-memory session; the shared Redis key was never written, so a different Lambda handling `/api/accounts/my` saw no session at all and returned 401.

**Fix**:  
- `upstashSessionStore.set()` now calls `cb(err)` on failure, surfacing Redis write errors to `req.session.save()` in the OAuth callback. Login now redirects to `/login?error=session_persist_failed` instead of silently continuing with a broken session.
- Ran `update-upstash.sh` to provision new database `select-dinosaur-85186.upstash.io` and update `KV_REST_API_URL` + `KV_REST_API_TOKEN` in Vercel production.

**Files**: `banking_api_server/services/upstashSessionStore.js`, `update-upstash.sh`

**Regression check**: After sign-in call `GET /api/auth/debug?deep=1` → verify `sessionStoreHealthy: true` and `redisKeyPresent: true`.

---

## 2026-03-28 — Token audience mismatch: all API calls return 401 after login (commit `82b4213`)

**Symptom**: Console: `Token audience [https://api.pingone.com] does not match any known audience for this service.` Every `/api/accounts/my` and `/api/transactions/my` returned 401 despite a valid PingOne access token.

**Root cause**:  
`auth.js` had hardcoded fallback defaults `ENDUSER_AUDIENCE = 'banking_jk_enduser'` and `AI_AGENT_AUDIENCE = 'banking_mcp_01_JK'` for environments where the env vars were not set. Standard PingOne environments without a custom resource server issue tokens with `aud: 'https://api.pingone.com'`. Neither hardcoded string matched, so the audience check failed on every request.

**Fix**:  
- Removed hardcoded defaults; both vars are now `null` when the env var is absent (skips strict audience check for that role).
- Added `https://api.pingone.com` as an always-accepted fallback audience regardless of `ENDUSER_AUDIENCE` / `AI_AGENT_AUDIENCE`.

**Files**: `banking_api_server/middleware/auth.js`

**Regression check**: Sign in → accounts and transactions load. For custom resource server installs, set `ENDUSER_AUDIENCE` in Vercel env to the resource server audience value.

---

## 2026-03-28 — Infinite 401 redirect loop to PingOne (commits `28f2438`, `6c726c5`)

**Symptom**: After login the browser looped between `/dashboard/accounts` and the PingOne login page indefinitely. Console showed `Data fetch 401 — server reason: ... | REAUTH_KEY: 1`, then redirect, then 401 again.

**Root causes**:  
1. `App.js` was calling `sessionStorage.removeItem('bx-dashboard-reauth')` when `?oauth=success` appeared in the URL. This cleared the one-shot guard the moment after it was set, so the next 401 triggered another redirect unconditionally.
2. `/api/auth/oauth/user/status` was returning `authenticated: true` for sessions with expired tokens (only checked that the token existed, not `expiresAt`). `fetchUserData` called accounts/my → 401 → set key → redirect → status still authenticated → loop.

**Fix**:  
- Removed the `sessionStorage.removeItem` call from `App.js`. The guard is only cleared inside `fetchUserData`'s success code path.
- Both status endpoints (`routes/oauthUser.js`, `routes/oauth.js`) now check `Date.now() < expiresAt` before returning `authenticated: true`.

**Files**: `banking_api_ui/src/App.js`, `banking_api_server/routes/oauthUser.js`, `banking_api_server/routes/oauth.js`

**Regression check**: Sign in → land on dashboard → accounts load without redirect loop. Let token expire → status returns `authenticated: false` → demo mode shown, no infinite redirect.

---

## 2026-03-28 — `session-preview` 401 noise on every dashboard mount (commit `0860bcb`)

**Symptom**: `GET /api/tokens/session-preview 401` appeared in the browser console on every dashboard page load before the user was authenticated.

**Root cause**:  
`TokenChainDisplay` called `fetchSessionPreview()` unconditionally on component mount. Because the component mounts before auth state is confirmed, the request always fired unauthenticated.

**Fix**:  
Added `didAuthRef` boolean ref. Component skips `fetchSessionPreview` on initial mount. Actual first fetch is triggered by the `userAuthenticated` custom event (dispatched after successful login), which also sets `didAuthRef.current = true`.

**Files**: `banking_api_ui/src/components/TokenChainDisplay.js`

---

## 2026-03-28 — /demo-data may_act section: static-mode notice + dynamic explainer (commit `5ecf83e`)

**Change**: The `/demo-data` may_act toggle section now clearly reflects that `may_act` is always present in the token when using the static PingOne attribute mapping expression.

**What was added:**
- Amber notice banner (🔒) at the top of the section: "Static mapping active — `may_act` is always present in your token via the PingOne attribute mapping expression."
- Status messages updated to say "mayAct attribute set/cleared on user record" (no longer implies the token changes).
- `<details>` explainer (collapsed by default): step-by-step instructions for switching from the static hardcoded expression to the dynamic `${user.mayAct}` expression in PingOne → Applications → bankingAdmin → Attribute Mappings.
- CSS: `.demo-data-static-notice`, `.demo-data-dynamic-explainer`, `.demo-data-code-block`.

**Background**: PingOne rejects `${user.mayAct}` as an expression even though the `mayAct` JSON attribute exists in the user schema. Keeping a static hardcoded expression (e.g. `${"client_id": "<app-client-id>"}`) ensures `may_act` always appears in every token issued by the bankingAdmin app, making the Token Chain `✅ may_act valid` state reliable without user-attribute manipulation.

**Files**: `banking_api_ui/src/components/DemoDataPage.js`, `banking_api_ui/src/components/DemoDataPage.css`

**Regression check**: Go to `/demo-data` → may_act section must show amber notice banner; Enable/Clear buttons still fire `PATCH /api/demo/may-act` (call succeeds, no error); `<details>` expander opens and shows PingOne steps.

---

## 2026-03-28 — Admin role detection: 4-signal resolution

**Problem**: The previous logic only preserved admin role if the user **already existed** in the dataStore with role `admin`. A first-time admin login always got `customer`. The only workaround was to manually edit the dataStore JSON.

**Fix**:  
Replaced the single-signal check with four independent signals. Any one being true is sufficient to grant `admin`:
1. **Username allowlist** (`admin_username` config) — comma-separated `preferred_username` values that always receive admin.
2. **Population ID** (`admin_population_id` config) — PingOne population ID; members receive admin without any schema changes.
3. **Custom claim** (`admin_role_claim` + `admin_role` config) — any userinfo/ID-token claim compared against the configured admin role value; supports string and array (group membership).
4. **Existing record** — preserves admin granted in a previous session (prevents downgrade).

New config fields added: `admin_username`, `admin_population_id`, `admin_role_claim` in `configStore.js` with corresponding UI fields in `Config.js`.

**Files**: `banking_api_server/routes/oauthUser.js`, `banking_api_server/services/configStore.js`, `banking_api_ui/src/components/Config.js`

**Regression check**: Log in as a user not in the allowlist → gets `customer`. Add their username to `admin_username` → next login grants `admin`. Existing admin users are not downgraded.

---

## 2026-05-07 — Helix `apiBase()` broke when user stored a console URL

**Symptoms**: Helix LLM calls failed when `helix_base_url` was set to a console/UI path (e.g. `https://openam-helix.forgeblocks.com/dpc/{env-id}/ai-agents/LLM/draft/initial`). The old implementation only checked if `/dpc/jas/helix` was present and appended the path suffix verbatim, producing a broken double-path URL.

**Root cause**: `apiBase()` used a substring check (`s.includes('/dpc/jas/helix')`) instead of normalising to the origin. A browser console URL that contains `/dpc/{env-id}/...` (not `/dpc/jas/...`) bypassed the guard and got the full helix path appended at the wrong point.

**Fix**: Rewrote `apiBase()` to extract `new URL(baseUrl).origin` and always append `/dpc/jas/helix/v1`, so any URL the user copies from the Helix console is handled correctly.

**Tests**: `helixLlmService.test.js` — "does not double-append" and "normalises tenant-root base URL" tests cover both cases.

## 2026-06-19 — Agent masked MCP `invalid_token` as an empty-but-successful account list (D-2)

**Symptom**: When the downstream MCP/gateway rejected the agent's delegated token (401 `invalid_token`) on an accounts/balance/transactions read, the heuristic agent replied "You don't have any accounts yet." with `success:true` — hiding the auth failure behind a plausible empty result instead of surfacing it.

**Root cause**: In `dispatchBankingAction` (`demo_api_server/services/demoAgentLangGraphService.js`), the read path's error guard checked only `!parsed2 || parsed2.error`. An MCP error result arrives as `{ content:[{ text }], isError:true }` with **no top-level `.error`**, so the guard didn't fire; `parsed2.accounts` was then `undefined` → `[]` → the `!accts.length` branch returned the masked "no accounts yet" `success:true`. The write/sensitive path already handled this (`if (!rawResult || rawResult.isError)`), but the read path omitted the `isError` check.

**Fix**: Extended the read-path guard to `if (!parsed2 || parsed2.error || parsed2.isError)` and to unwrap the real message from `parsed2.content?.[0]?.text`, returning `success:false` with the actual error (mirroring the write path). `demo_api_server/services/demoAgentLangGraphService.js`.

**Tests**: `demo_api_server/tests/real/shared/token-chain-pipeline.test.js` — codifies the trace harness as a real-call suite (MCP inspector invoke + agent invoke) and asserts a 200 agent response carrying a backend error signal must NOT be paired with `success:true` (the D-2 masking shape).

---

## 2026-06-19 — "Using the demo authorize server" modal re-popped on every refresh

**Symptom**: The "Using the demo authorize server" fallback modal appeared on **every** page refresh, despite being designed (and documented) as a once-per-session heads-up.

**Root cause**: Two layers. (1) The once-per-session guard in `AIAgent.js` was a `useRef` (`authzFallbackShownRef`), which is reset to `false` on every full page reload — so it only deduped within a single page load, never across refreshes. Any `degraded:true` from `POST /api/demo-agent/tools` re-showed the modal each time. (2) The backend kept landing in the degraded state on cold starts: `agentToolsResolver.resolveAvailableTools` retried tool discovery only **once** (one 400ms backoff) before falling back to the local catalog and returning `degradedReason:'discovery_unreachable'`, so a transient blip while the gateway/authz sidecar was warming up (or a token-exchange race) tripped degrade on the first post-login discovery.

**Fix**: (1) Persist the modal dismissal in `sessionStorage` (`authzFallbackModalShown`) via the existing `sessionStorageService` — survives refresh, clears on tab close — so it shows at most once per session; the persistent "Demo Authorize" badge (`degradedAuthz`) still indicates degraded mode, so the state is never hidden. (2) Hardened discovery to retry with backoff (3 attempts, 0/400/900ms) before degrading. `demo_api_ui/src/components/AIAgent.js`, `demo_api_server/services/agentToolsResolver.js`.

**Tests**: `demo_api_server/src/__tests__/agentToolsResolver.degraded.test.js` — updated the "retries then returns the local catalog" case to assert 3 attempts before degrading; the success-on-retry, need_auth-rethrow, and mock-failover cases stay green (8 tests across the two resolver suites).
