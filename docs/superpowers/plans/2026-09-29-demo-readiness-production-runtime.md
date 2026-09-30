# Demo Readiness Production Runtime Plan

> **For agentic workers:** Continue in this worktree and commit each task independently. This plan extends the approved readiness design; do not infer a live green result from configuration presence.

**Goal:** Make the local Docker and hosted SE readiness runner execute with four independently authenticated provider lanes and report every missing production prerequisite before a demo.

**Architecture:** Keep the admin BFF as the orchestrator. It will communicate with dedicated PingOne and PingFederate worker runtimes for each target; each worker owns its credentials, cookie jar, and session store. Target audit adapters use explicit per-target BFF, Gateway, Authorize, and expected-revision settings. The active presenter BFF provider setting is never changed.

**Tech Stack:** Node >=22, CommonJS, Express BFF, Jest, HTTPS worker API, existing readiness audit and scenario validators.

**Spec:** `docs/superpowers/specs/2026-09-26-demo-readiness-and-repair-design.md`, especially provider isolation, target adapters, 15-minute deadline, and the approved Authorize policy-tree waiver.

## Global Constraints

- Cover local Docker and hosted SE with four separate target/provider lanes.
- Keep worker credentials, cookies, session IDs, and raw tokens out of job state, logs, and reports.
- Never switch the presenter's process-wide OAuth provider or reuse an admin/presenter session.
- Hosted SE remains read/execute only; no remote repair or deployment.
- Missing worker identities, runtime URLs, revisions, or unsupported readbacks remain blocking.
- Preserve all `REGRESSION_PLAN.md` §0–§1 OAuth, session, audience, role, and redirect invariants.
- Keep the temporary Authorize policy-tree read waiver visible; all other required checks stay required.
- Maintain `docs/demo-readiness.md`; run focused tests and `graphify extract . --code-only --no-cluster --timing` for each code task.

## Task 1: Explicit production target and worker configuration contract

**Files:**
- Create: `demo_api_server/services/demoReadinessRuntimeConfig.js`
- Create: `demo_api_server/tests/demoReadinessRuntimeConfig.test.js`
- Modify: `demo_api_server/services/demoReadinessRunner.js`
- Test: `demo_api_server/tests/demoReadinessRunner.test.js`
- Modify: `docs/demo-readiness.md`
- Modify: `docs/superpowers/plans/2026-09-29-demo-readiness-production-runtime.md`

**Interfaces:**
- `loadDemoReadinessRuntimeConfig(env)` reads explicit settings for `local` and `se` and the `pingone` and `pingfederate` lanes. It returns runtime-only values separately from sanitized finding rows.
- Target settings: `DEMO_READINESS_<TARGET>_BFF_URL`, `..._GATEWAY_URL`, `..._AUTHORIZE_URL`, and `..._EXPECTED_REVISION`.
- Lane settings: `DEMO_READINESS_<TARGET>_<PROVIDER>_WORKER_URL`, `..._WORKER_TOKEN`, and `..._IDENTITY_REF`.
- URLs must be absolute HTTPS URLs without embedded credentials, query strings, or fragments. Revisions must be 7–40 hexadecimal Git SHA characters. Every lane must have its own URL, bearer token, and named identity reference.
- Findings list missing or invalid variable names and safe reasons only; values (especially worker tokens) never appear in a finding.
- Runner prerequisites consume these findings and continue to report the absent production worker implementation as blocked until Task 2 is complete.

- [x] Write tests for a complete four-lane configuration, missing one lane field, malformed HTTP/credential-bearing URLs, invalid revision, and ensuring a sentinel token never appears in serialized findings.
- [x] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessRuntimeConfig.test.js --forceExit`; it failed first because the module did not exist.
- [x] Implement the parser/validator and wire safe findings into runner prerequisites without treating configuration presence as worker health or readiness.
- [x] Update `docs/demo-readiness.md` with exact variable names, secret handling, and the remaining worker-runtime blocker.
- [x] Run the focused config and runner suites (5/5 and 26/26), `git diff --check`, and `graphify extract . --code-only --no-cluster --timing` (AST 155.5s; total 164.7s).
- [x] Stage only the paths listed for this task and commit on `feat/demo-readiness-production-runtime`.

## Task 2: Authenticated worker protocol client and execution lifecycle

**Files:**
- Create: `demo_api_server/services/demoReadinessWorkerClient.js`
- Create: `demo_api_server/tests/demoReadinessWorkerClient.test.js`
- Modify: `demo_api_server/services/demoReadinessExecutionService.js`
- Modify: `demo_api_server/tests/demoReadinessProviderIsolation.test.js`
- Modify: `demo_api_server/services/demoReadinessRunner.js`
- Modify: `demo_api_server/tests/demoReadinessRunner.test.js`
- Modify: `docs/demo-readiness.md`
- Modify: this plan

**Interfaces:**
- Worker URL is the HTTPS service base; the client uses `GET /api/demo-readiness/v1/health`, `POST /api/demo-readiness/v1/contexts`, `POST /api/demo-readiness/v1/contexts/:contextId/operations`, and `DELETE /api/demo-readiness/v1/contexts/:contextId`.
- Every request uses the lane's bearer token. Health and context responses must echo exact target, provider, and `IDENTITY_REF`, plus unique opaque runtime, cookie-jar, and session-store IDs. The created context must prove an authenticated session for the selected provider. These IDs remain in worker-client memory and are never report evidence.
- Operations are `verify-case-prerequisites`, `execute-case`, `verify-feature-prerequisites`, and `execute-feature`; the last carries the exact checked-in feature family. Request data contains catalog contracts and selectors only, never credentials or browser session data.
- `createReadinessExecutionService({ productionWorkerAdapter })` may use only an explicitly injected server-side factory in production; its existing Jest-only `createWorker` injection remains unavailable outside tests.
- `dispose()` releases every remote context after matrix completion or failure. A failed cleanup makes scenario execution NOT READY.

- [x] Write tests for target/provider/identity handshake, rejected provider mismatches, duplicate isolation IDs, authenticated lane calls, bounded health aborts, sanitized errors, cleanup, runner health checks, target URL/revision wiring, and cleanup-failure matrix blocking. The missing runner integration and failed worker disposal tests were observed red before implementation.
- [x] Run the worker client and provider-isolation tests; the initial worker client/module and adapter coverage failed before implementation, then passed after the client/lifecycle implementation.
- [x] Implement the HTTPS client and production-only adapter injection, then wire target runtime URLs/revision and worker health into runner prerequisites. The runner retains a completed matrix inventory through a bounded 10.5-second cleanup drain after deadline; it remains NOT READY.
- [x] Update the master guide with the protocol and the fact that a compatible worker service is still required.
- [x] Run the four focused client, provider-isolation, execution, and runner suites together: 97 passed/1 skipped. `git diff --check` is clean. The CLI safely exits NOT READY in 13 ms with 12 missing configuration blockers and no audit or matrix attempt.
- [x] Run `graphify extract . --code-only --no-cluster --timing` after final source changes (AST 5.7s; total 22.1s; no clustering).
- [x] Stage only Task 2 paths, inspect the staged diff, and commit Task 2 independently on `feat/demo-readiness-production-runtime`.

## Task 3: Authenticated isolated-worker HTTP service boundary

**Files:**
- Create: `demo_api_server/services/demoReadinessWorkerServer.js`
- Create: `demo_api_server/tests/demoReadinessWorkerServer.test.js`
- Modify: `docs/demo-readiness.md`
- Modify: this plan

**Interfaces and limits:**
- `createReadinessWorkerHttpService({ targetId, provider, identityRef, workerToken, createSession, ...limits })` returns an Express app, worker ID, expiry sweep, and async close hook. This is a protocol/service factory, not yet a standalone worker process.
- The process pins its target, provider, and identity reference. Every endpoint requires a bearer token checked with constant-time digest comparison. JSON requests and evidence responses have a 512 KiB limit.
- Context creation is idempotent per run ID, concurrency-safe for retries, capacity-limited, and expires after a bounded TTL. Setup timeout/cancellation aborts the adapter signal and keeps its slot reserved until setup and late-session cleanup settle. If cancellation cannot be confirmed within the cleanup bound, the worker latches unavailable and rejects new sessions. A real adapter must provide an authenticated lane-matching session and distinct opaque runtime, cookie-jar, and session-store IDs.
- Only the four client operations and checked-in `FEATURE_DISPATCHERS` families are accepted. PingFederate-only feature families cannot dispatch from PingOne. Results are redacted before returning; raw adapter errors and credentials do not cross the service boundary.
- Cleanup failures make the worker unavailable. Request cancellation, operation timeout, TTL expiry, and service close attempt session disposal.
- This boundary intentionally accepts a trusted `createSession` adapter. It does not supply actual PingOne/PF login, browser/process isolation, the 46 step triggers, feature adapters, or local/SE packaging. Before those adapters are written, resolve the process-wide OAuth provider setting by giving each lane its own provider-configured BFF runtime; never toggle the presenter BFF.

- [x] Add tests first; the initial test run failed because `demoReadinessWorkerServer` did not exist.
- [x] Implement bearer authentication, lane handshake, waiter-aware retry coalescing, bounded contexts, source-validated operation inputs, allowlisted feature dispatch, redaction, expiry, timeouts, safe errors, and fail-closed cleanup behavior.
- [x] Run the worker service test suite (20/20), then run it with the existing worker-client, provider-isolation, execution, and runner suites (5 suites; 117 passed, 1 skipped).
- [x] Update this guide to distinguish the service boundary from missing provider login adapters and deployable worker processes.
- [x] Run `git diff --check` and `graphify extract . --code-only --no-cluster --timing` after final source changes; Graphify completed with AST extraction 21.3s, total 83.8s, and 44,698 nodes/100,969 edges.
- [x] Stage only Task 3 paths, inspect the staged diff, and obtain follow-up review.
- [x] Commit Task 3 independently on `feat/demo-readiness-production-runtime`.

## Task 4: Provider-aware PingFederate user-session configuration

**Files:**
- Modify: `demo_api_server/services/configStore.js`
- Modify: `demo_api_server/services/oauthRedirectUris.js`
- Modify: `demo_api_server/src/__tests__/configStore-providerMode.test.js`
- Create: `demo_api_server/tests/oauthRedirectUris-providerMode.test.js`
- Modify: this plan, `docs/demo-readiness.md`, and `REGRESSION_PLAN.md` §4

**Interfaces and limits:**
- `configStore.isUserOAuthConfigured()` uses the selected provider's configuration: PingOne continues to require its environment ID and user client ID; PingFederate requires its issuer and PF user client ID. Do not require a client secret because public PKCE clients are valid.
- `getUserRedirectUri()` selects `pf_user_redirect_uri` only in PingFederate mode and retains the existing PingOne redirect key and canonical-origin fallback in PingOne mode.
- Preserve authorization-code + PKCE, state/nonce checks, session provider matching, callback-origin validation, callback session regeneration, and PingOne's resource/scope behavior. Do not change the presenter's process-wide provider setting or live IdP configuration.
- This fixes the existing PF login route's local readiness/configuration seam. It does not claim a real isolated worker login or live PF registration verification.

- [x] Add tests for PingOne/PF readiness requirements, provider-specific redirect overrides, and canonical fallback; the new PF readiness test failed before implementation.
- [x] Implement only the selected-provider config and redirect lookup.
- [x] Run the focused config/provider and redirect tests plus `tests/oauthUser.test.js` (4 suites, 57 tests passed); inspect `git diff --check`.
- [x] Update the master guide, this plan, and `REGRESSION_PLAN.md` §4 with the fixed PF login seam and remaining isolated-worker blocker.
- [x] Stage only Task 4 paths, inspect the staged diff, self-review, and commit Task 4 independently; the task reviewer reads the post-commit implementer report.

## Task 5: Fresh provider login session client

**Files:**
- Create: `demo_api_server/services/demoReadinessProviderLoginClient.js`
- Create: `demo_api_server/tests/demoReadinessProviderLoginClient.test.js`
- Modify: `demo_api_server/routes/oauthUser.js`
- Test: `demo_api_server/src/__tests__/oauthStatus.integration.test.js`
- Modify: `docs/demo-readiness.md`, `REGRESSION_PLAN.md` §4, and this plan

**Interfaces and limits:**
- `createDemoReadinessProviderLoginClient({ provider, dedicatedBffUrl, identityRef, username, password, expectedIssuer, expectedSubject, transport })` starts a fresh user authorization-code login at the explicitly supplied dedicated provider-configured BFF URL. It does not read global demo-user credentials or change process-wide provider configuration.
- Implement the existing PingOne flow API and PingFederate hosted-form/optional-consent paths using a private in-memory cookie jar per session. Do not import or reuse `tests/real/helpers/session.js`: the readiness path must not inspect `.test-session.json` or the shared LMDB session store, and must never fall back to an existing cookie.
- After callback, verify `/api/auth/oauth/user/status` reports authenticated, the selected provider, the expected issuer, and the configured identity subject. Add authenticated-user-only `user.providerSubject` from `session.oauthTokens.subjectSub`; never return access or ID tokens. Reject a cross-origin callback or status response. Return only a private session handle and safe metadata; keep cookie values, codes, tokens, credentials, usernames, email, and provider subject out of logs/reports.
- Preserve OAuth status expiry/stale-session checks, role behavior, token custody, and all existing response fields; `user.providerSubject` is populated only for an authenticated user session.
- The caller supplies credentials from protected runtime configuration; this task does not create a secret backend, provision identities, or claim that the supplied BFF URL has a private session store. Task 6 must wire only dedicated lane BFF runtimes.
- `dispose()` drops the in-memory cookie jar and invalidates the handle. HTTP transport is injectable for mocked protocol tests; no live PingOne/PF calls are part of this task.

- [x] Add protocol tests for fresh PingOne and PF logins, consent, wrong provider/issuer/subject, rejected callback origin, no cached/shared session fallback, cookie isolation, and disposal; prove the new module tests fail first.
- [x] Implement the minimal client and private session handle.
- [x] Run the new tests plus Task 4 provider and user-login suites; inspect `git diff --check`.
- [x] Document the credential input and remaining dedicated-BFF/runtime blockers.
- [ ] Stage only Task 5 paths, inspect the staged diff, obtain task review, and commit Task 5 independently.

## Remaining tasks

6. Build the bootable lane worker and its dedicated provider-configured BFF runtime packaging. Wire four isolated local/SE × PingOne/PingFederate lanes, private LMDB/session secrets, worker tokens, and lane-only user credentials from existing protected runtime configuration. Do not deploy to SE or use live secrets in code tests.
7. Implement the exact 46 Demo Steps triggers and all feature-family probes, including a PingFederate login session and UC40 native ID-JAG through PingFederate. Verify every adapter uses the declared provider and target revision; unresolved PF contracts remain blocked.
8. Wire target-specific PingOne, PingFederate, Agent Gateway, and Authorize readbacks. Keep unsupported Authorize tree parity under the approved waiver only.
9. Run the configured local Docker matrix, prove all required rows and timing gates, and fix configuration-only drift through the approved preview/confirm path. Never edit application source from the readiness reset.
10. Use the user-authorized hosted SE read/execute worker path and run its full matrix; keep remote repair/deployment disabled. Do not claim operational readiness unless both targets pass and the 12/15-minute gates are measured.
11. Remove blockers one by one, updating this plan and `docs/demo-readiness.md` in each task commit. Never claim operational readiness until the complete local+SE run passes.
