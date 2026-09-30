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

## Remaining tasks

1. Implement the provider-specific worker service for the Task 2 HTTPS protocol. It must provide distinct local/SE × PingOne/PF service identities, private cookie/session stores, bounded run contexts with expiry on lost connections, actual provider login paths, and dispatch of existing case/family-specific contracts through real demo paths without mutating the active BFF provider.
2. Wire target-specific PingOne, PingFederate, Gateway, and Authorize readbacks. Keep unsupported Authorize tree parity under the approved waiver only.
3. Configure local Docker workers and the authorized SE read/execute workers, then run all 800 expected rows, capture the live PingOne/PF/UC40 ID-JAG sessions, and measure the 12/15-minute gates.
4. Remove blockers one by one, updating this plan and `docs/demo-readiness.md` in each task commit. Never claim operational readiness until the complete local+SE run passes.
