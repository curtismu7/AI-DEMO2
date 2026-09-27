# Demo Readiness and Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one bounded readiness workflow that audits and repairs confirmed configuration drift, then proves all 46 Demo Steps use cases against local Docker and hosted SE using PingOne and PingFederate sessions, including native PingFederate ID-JAG for UC40.

**Architecture:** The BFF owns the readiness orchestration and sanitized evidence. A build-time contract check ties the UI's actual Demo Steps lists to backend catalogs and proves supported repair classes are configuration-only. The same orchestration is called by a CLI and an admin-only async job started from Admin sidebar Reset Demo; the dashboard reset and existing account reset remain separate.

**Tech Stack:** Node >=22, CommonJS Express BFF, Jest/supertest, React/Vite UI with Vitest, existing PingOne Authorize and Management API services, existing scope topology, Docker read-only inspection, and existing OAuth/use-case execution paths.

**Spec:** `docs/superpowers/specs/2026-09-26-demo-readiness-and-repair-design.md`

## Global Constraints

- Cover local Docker and hosted SE; require a green result for both for the full-ready label.
- Use the 46 executable Demo Steps cases: 24 primary, four unique CIAM additions, six unique Privilege additions, and Admin1–Admin12. Admin13 is navigation and is excluded.
- Verify PingOne user sessions and PingFederate user sessions for every applicable use case; verify native PingFederate ID-JAG for UC40 on both targets.
- Include audit, one administrator confirmation, repair, re-audit, every scenario, cleanup, and report in a 15-minute hard deadline; target 12 minutes and never omit rows to meet the deadline.
- Repair only deterministic, source-backed configuration drift shown in the confirmation preview. Never change application source from the live reset workflow.
- Keep provider selection isolated. Do not flip the process-wide OAuth provider while presenter traffic can be active.
- Missing credentials, unsupported live readback, unavailable targets, unknown drift, failed or untested cases, and timed-out rows are NOT READY.
- The current deployment policy allows local Docker deployment only. The runner may read hosted SE and may repair supported PingOne configuration after confirmation, but it must not update or deploy the hosted SE cluster.
- Do not emit tokens, passwords, cookies, raw session IDs, authorization headers, or unredacted provider responses in reports or logs.
- Before BFF or UI edits, read their nested `CLAUDE.md` files and `REGRESSION_PLAN.md` §0–§1, invoke `.claude/skills/regression-guard/`, and preserve all listed invariants and the emoji allowlist.
- After every UI change, run `cd demo_api_ui && npm run build`; run the theme contrast auditor for changed pages in light and dark themes.
- After source edits, run `graphify update .`; run focused tests for touched paths. Do not run Docker Compose from this worktree.

## File Map

- `demo_api_server/services/demoReadinessCatalog.js` builds and validates the runtime case matrix from checked-in readiness contract data and existing backend catalogs.
- `demo_api_server/config/demoReadinessInventory.json` is the BFF runtime projection of the existing UI lane lists; the contract check fails if the projection and UI diverge.
- `demo_api_server/config/demoReadinessRepairability.json` declares supported drift classes, exact sources of truth, whether each class is auto-repairable, and what readback proves the repair.
- `demo_api_server/services/demoReadinessReport.js` owns stable finding, row, timing, and redaction shapes.
- `demo_api_server/services/demoReadinessAuditService.js` performs read-only source and live-target checks.
- `demo_api_server/services/demoReadinessRepairService.js` plans, fingerprints, applies, and verifies approved repairs.
- `demo_api_server/services/demoReadinessExecutionService.js` creates isolated provider sessions and executes the supported demo entry paths.
- `demo_api_server/services/demoReadinessRunner.js` sequences audit, preview, confirmation, repair, re-audit, matrix execution, final reset, and result status under the deadline.
- `demo_api_server/services/demoReadinessJobStore.js` stores expiring async job state and progress for the admin UI.
- `demo_api_server/routes/demoReadiness.js` exposes admin-only create, read, and confirm operations; it never starts a shell process.
- `scripts/check-demo-readiness-contract.mjs` verifies UI/backend inventory parity and configuration-only repairability during build/CI.
- `scripts/demo-readiness.js` provides the interactive command-line entry point and machine-readable JSON output.
- `demo_api_ui/src/components/AdminSideNav.jsx` starts, confirms, and displays the async readiness/reset job only for Admin sidebar Reset Demo.
- Focused Jest/Vitest tests live beside the existing BFF route/service and UI component tests.

---

### Task 1: Lock the 46-case contract and configuration-only build check

**Files:**
- Create: `demo_api_server/config/demoReadinessRepairability.json`
- Create: `demo_api_server/config/demoReadinessInventory.json`
- Create: `demo_api_server/services/demoReadinessCatalog.js`
- Create: `demo_api_server/tests/demoReadinessCatalog.test.js`
- Create: `scripts/check-demo-readiness-contract.mjs`
- Modify: root `package.json`
- Modify: `demo_api_ui/package.json`
- Create: `demo_api_ui/src/config/__tests__/demoReadinessContract.test.js`
- Modify: `docs/superpowers/specs/2026-09-26-demo-readiness-and-repair-design.md` only if a checked-in UI catalog change alters the case composition

**Interfaces:**
- `demoReadinessInventory.json` stores the four lane arrays copied from the current UI list: `primary`, `ciam`, `privilege`, and executable `admin` IDs. The UI remains the presentation source; the build contract checks this BFF projection against its ES module exports.
- `buildDemoReadinessCatalog({ verticals, includeAdmin })` returns ordered rows `{ id, kind, expectedOutcome, auth, verticals, executionMode, sourceRef }` from that projection and backend catalogs, and throws with all missing/duplicate/unsupported IDs.
- `demoReadinessRepairability.json` maps each audited drift class to `{ sourceOfTruth, readback, repairMode }`, where `repairMode` is exactly `automatic`, `release-only`, or `manual`.
- `scripts/check-demo-readiness-contract.mjs` exits `0` only when the UI lists resolve to exactly 46 runnable cases and each case has an executable catalog entry, expected result, auth level, execution mode, and configuration dependency classification.

- [ ] Add Jest cases proving the exact 46 IDs, order within each source lane, Admin13 exclusion, duplicate rejection, missing-catalog rejection, and failure for `needs-build` entries or missing expected outcomes.
- [ ] Add the Vitest parity case importing `demoUseCaseSteps.js` and the BFF inventory builder; assert 24 primary, five CIAM source entries with UC2 deduped, seven Privilege source entries with UC40 deduped, twelve executable admin entries, and total 46.
- [ ] Add fixture tests proving every declared automatic drift class can produce a deterministic config patch, apply it to an in-memory target fixture, and pass the declared readback without changing a source file. Assert `release-only` and `manual` classes never produce an automatic patch.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessCatalog.test.js --forceExit` and `cd demo_api_ui && npm run test:unit -- --run src/config/__tests__/demoReadinessContract.test.js`; expected: both pass and report 46 rows.
- [ ] Run `node scripts/check-demo-readiness-contract.mjs`; expected: exit `0`, print inventory totals and each repairability class.
- [ ] Add root script `demo:readiness:contract` and call `node ../scripts/check-demo-readiness-contract.mjs` before `vite build` in `demo_api_ui/package.json`; run `cd demo_api_ui && npm run build`; expected: contract check completes before a successful Vite build.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed files, confirm `git branch --show-current`, and commit as `feat: validate demo readiness contract`.

### Task 2: Define report rows, redaction, and deadline behavior

**Files:**
- Create: `demo_api_server/services/demoReadinessReport.js`
- Create: `demo_api_server/tests/demoReadinessReport.test.js`

**Interfaces:**
- `createReadinessReport({ runId, commit, targets, startedAt, deadlineAt })` returns a report with `status`, `ready`, `elapsedMs`, `inventory`, `checks`, `repairs`, and `unfinished`.
- `recordCheck(report, { id, target, provider, useCaseId, status, expected, observed, sourceRef, evidence })` accepts only `pass`, `fail`, `blocked`, or `not-run`; any non-pass required row prevents `ready: true`.
- `redactReadinessValue(value)` removes bearer/JWT strings, passwords, cookies, authorization headers, and raw session identifiers recursively before persistence or display.
- `remainingBudget(report, now)` returns `max(0, deadlineAt - now)`; deadline expiry marks queued rows `not-run` and active rows `blocked` with reason `deadline_exceeded`.

- [ ] Write Jest tests for each status, aggregate readiness, stable counts, the exact 900,000 ms hard deadline, the 720,000 ms target warning, and expiry while queued or active rows exist.
- [ ] Test nested redaction using bearer/JWT/password/cookie/session fixtures and assert report serialization contains none of the input secret values.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessReport.test.js --forceExit`; expected: all report and deadline cases pass without outbound network.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed paths, verify the branch, and commit as `feat: add demo readiness report model`.

### Task 3: Implement read-only audits for both targets

**Files:**
- Create: `demo_api_server/services/demoReadinessAuditService.js`
- Create: `demo_api_server/tests/demoReadinessAuditService.test.js`
- Modify: `scripts/check-demo-health-gate.js` only to export/reuse read-only probes without changing its existing exit semantics
- Modify: `scripts/check-mcp-preflight.js` only to export/reuse reachability probes without changing its existing exit semantics
- Modify: `demo_api_server/services/pingOneAuthorizeService.js` only if a supported live Authorize policy read path can be added using existing worker credentials and documented API calls

**Interfaces:**
- `auditTarget({ targetId, targetConfig, deadlineAt, signal })` returns `checks[]` using the report row schema and performs no writes.
- `auditRepositoryContracts()` reads `scope-topology.json`, route/auth configuration, registered tool metadata, Agent Gateway configuration, and Authorize endpoint/policy references from checked-in sources.
- `auditPingOneConfiguration({ environmentId, credentials, deadlineAt })` reads resources, audiences, scopes, mirrors, app grants, decision endpoints, and policy definitions only through supported management APIs.
- `auditRuntimeTarget({ bffUrl, gatewayUrl, authorizeUrl, targetKind, deadlineAt })` checks health, reachable routes, loaded revision/config fingerprint, and the actual audience/scope values consumed at runtime.

- [ ] Add mocked Jest tests for healthy local/SE targets and for one failure in each required family: audience, scope, mirror, app grant, registered tool scope, gateway route/auth config, Authorize endpoint reference, policy readback, service health, and revision mismatch.
- [ ] Assert an unavailable or unauthorized Authorize policy read produces a blocking finding and never substitutes a successful decision probe for policy parity.
- [ ] Assert local Docker inspection is read-only and uses `execFile` argument arrays for `docker inspect`/`docker ps`; no shell string may contain a mutation command.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessAuditService.test.js --forceExit`; expected: all probes use mocked dependencies and make zero network calls.
- [ ] Run `npm run topology:verify` and `npm run authz:verify`; expected: existing source checks remain green.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed files, verify branch, and commit as `feat: audit demo target configuration`.

### Task 4: Add preview-bound configuration repair

**Files:**
- Create: `demo_api_server/services/demoReadinessRepairService.js`
- Create: `demo_api_server/tests/demoReadinessRepairService.test.js`
- Modify: `demo_api_server/config/demoReadinessRepairability.json`
- Modify: `demo_api_server/services/demoReadinessAuditService.js` only to emit structured repair candidates

**Interfaces:**
- `planRepairs({ findings, targets, now })` returns `{ planId, digest, expiresAt, changes, blocked }`; every change includes target/object/current/expected/sourceRef/operation.
- `applyRepairs({ digest, confirmedBy, targets, now })` rejects expired or mismatched plans, re-reads every object's current state, applies only `automatic` candidates from that digest, then verifies each write using the source API's readback.
- `repairMode: release-only` and `manual` remain visible in `blocked` with an operator action and cannot be passed to an apply adapter.

- [ ] Test that a changed target set, expired plan, altered current value, repeated confirmation, and ambiguous object ID each stop before the first write.
- [ ] Test that the generated preview includes the exact before/after values and repository source reference, and its digest changes if any field changes.
- [ ] Test a confirmed repair applies once, performs readback, records sanitized before/after evidence, and is safe to retry after a timeout.
- [ ] Test unauthorized/unsupported Authorize policy writes stay blocked and never call a mutation client.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessRepairService.test.js --forceExit`; expected: mocks record writes only after a matching confirmation and pre-write reread.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed paths, verify branch, and commit as `feat: apply confirmed demo config repairs`.

### Task 5: Execute isolated provider sessions and every demo step

**Files:**
- Create: `demo_api_server/services/demoReadinessExecutionService.js`
- Create: `demo_api_server/tests/demoReadinessExecutionService.test.js`
- Modify: `demo_api_server/services/agentMcpTokenService.js` only if a narrow explicit provider/session context is required; preserve normal provider resolution and current token custody invariants
- Modify: `demo_api_server/routes/useCases.js` only to expose a readiness-only execution adapter that reuses the same scenario dispatch and expected-outcome verification
- Create: `demo_api_server/tests/demoReadinessProviderIsolation.test.js`

**Interfaces:**
- `createWorkerContext({ targetId, provider, identityRef, deadlineAt })` returns an opaque context handle; the underlying credential and token values never enter job state or reports.
- `executeReadinessCase({ context, caseRow, vertical, mode, deadlineAt })` returns `{ status, expected, observed, evidence }` from the supported demo execution path and exact declared outcome checks.
- The matrix contains each of the 46 cases for both targets and both user-session providers, plus one native PF ID-JAG row for UC40 per target. It expands only the vertical variants declared applicable by the existing catalog and reports the expanded count before launching.
- Provider sessions are minted into isolated worker sessions. A failed provider setup blocks its entire lane; it must not silently reuse the administrator's current session or change the global `oauth_provider` value.

- [ ] Add contract tests showing the base inventory is 184 provider/target/use-case executions plus two UC40 ID-JAG executions, and each declared vertical expansion adds explicit rows rather than overwriting another lane.
- [ ] Add mocked execution tests for PERMIT, DENY, STEP_UP, HITL_REQUIRED, expected Admin tool output, standard PF exchange provenance, UC40 native ID-JAG provenance, and wrong-provenance failures.
- [ ] Add concurrency tests proving provider worker state and cookies are separate, `oauth_provider` is unchanged, one worker failure does not hide other lane results, and the deadline launches no new rows after expiry.
- [ ] Add a provider-login integration test using the existing real-login helper contracts for both providers and dedicated readiness identities; it must assert PingOne sessions identify PingOne and PF sessions identify PingFederate before any demo case runs.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessExecutionService.test.js tests/demoReadinessProviderIsolation.test.js --forceExit`; expected: mocks verify correct session, route, outcome, audience, and provenance per row.
- [ ] Run the dedicated local integration test only when its explicitly named readiness test credentials are present; expected: both fresh session lanes authenticate and the test cleans up its own sessions. Never run it against hosted SE from this worktree.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed files, verify branch, and commit as `feat: run isolated demo readiness scenarios`.

### Task 6: Orchestrate the run and expose the CLI

**Files:**
- Create: `demo_api_server/services/demoReadinessRunner.js`
- Create: `demo_api_server/tests/demoReadinessRunner.test.js`
- Create: `scripts/demo-readiness.js`
- Create: `scripts/demo-readiness.test.js`
- Modify: root `package.json`

**Interfaces:**
- `startReadinessRun({ targets, confirmRepairs, onProgress, clock, adapters })` runs prerequisites, audit, preview, confirmation, apply, re-audit, matrix, final status, and CLI-only report under a single 15-minute timer.
- The CLI supports `--target local|se|both` for diagnostic runs, `--json` for machine output, and defaults to both targets; a single-target success is explicitly not full READY.
- The CLI prints the complete preview before asking once for confirmation, applies nothing unless the operator confirms the exact plan digest, exits `0` only for full READY, and exits nonzero on blockers, failed rows, or deadline.

- [ ] Test phase ordering and that the confirmation timer starts before prerequisite checks and includes user confirmation wait.
- [ ] Test confirmation refusal exits without writes, safe repair success triggers re-audit before any scenario starts, audit failure prevents scenario execution, and any failed/untested row yields NOT READY.
- [ ] Test CLI output redaction, `--json`, default both-target behavior, target-only labeling, and exit codes using injected adapters and a fake clock.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessRunner.test.js --forceExit` and `node --test scripts/demo-readiness.test.js`; expected: deterministic mocked end-to-end run passes and failure codes match the report.
- [ ] Add root script `demo:ready`, run `npm run demo:ready -- --help`, and run `npm run demo:readiness:contract`; expected: help names both targets and the safe preview/confirm flow.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed files, verify branch, and commit as `feat: add demo readiness command`.

### Task 7: Add the admin-only asynchronous BFF job

**Files:**
- Create: `demo_api_server/services/demoReadinessJobStore.js`
- Create: `demo_api_server/routes/demoReadiness.js`
- Create: `demo_api_server/tests/demoReadiness.route.test.js`
- Modify: `demo_api_server/server.js`

**Interfaces:**
- `POST /api/admin/demo-readiness/jobs` requires `authenticateToken`, `requireAdmin`, and `requireScopes(['admin'])`; it starts audit and returns `{ jobId, status }`.
- `GET /api/admin/demo-readiness/jobs/:jobId` requires the same admin guards and returns sanitized progress/report state.
- `POST /api/admin/demo-readiness/jobs/:jobId/confirm` requires `{ digest }`, verifies the job owner/admin and displayed digest, then resumes the same runner after one confirmation.
- Jobs expire after 20 minutes, store no secrets, and use in-process orchestration; they do not launch a shell command.

- [ ] Test 401/403 for unauthenticated, non-admin, and missing-scope callers on all three routes.
- [ ] Test job ownership, expiry, confirmation digest mismatch, duplicate confirmation, polling progress, and secret redaction.
- [ ] Test job creation invokes the same runner service as the CLI and does not call `child_process`, mutate `/api/admin/reset-demo`, or clear demo state before a green readiness result.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadiness.route.test.js --forceExit`; expected: route tests prove admin-only access and reset gating.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed files, verify branch, and commit as `feat: expose admin demo readiness job`.

### Task 8: Wire Admin sidebar Reset Demo to readiness

**Files:**
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`
- Modify: `demo_api_ui/src/components/__tests__/AdminSideNav.resetDemo.test.jsx`

**Interfaces:**
- Admin sidebar Reset Demo starts the new job, polls status, renders every failing row and repair preview, then presents one explicit confirmation bound to the returned digest.
- After full READY only, the existing admin reset action runs cleanup and signs out. A failed, blocked, expired, or timed-out job leaves the report visible and does not call reset or sign out.
- Dashboard Reset Demo, customer account reset, logout behavior elsewhere, and the existing `/api/admin/reset-demo` route semantics remain unchanged.

- [ ] Add Vitest tests for start → audit progress → preview → one confirmation → full ready → cleanup/sign-out.
- [ ] Add negative UI tests for decline, stale digest, failed audit, missing Authorize readback, scenario failure, deadline expiry, and job polling errors; assert cleanup and sign-out are not called.
- [ ] Read `THEMING.md` and style the job panel using existing theme tokens; use `<DraggableModal>` and `ConfirmModal`, `apiClient`, and approved emoji only.
- [ ] Run focused UI tests with `cd demo_api_ui && npm run test:unit -- --run src/components/__tests__/AdminSideNav.resetDemo.test.jsx`, then run `cd demo_api_ui && npm run build` and the §1.4 contrast auditor in both themes.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed files, verify branch, and commit as `feat: gate admin reset on demo readiness`.

### Task 9: Prove timing, operator recovery, and the complete contract

**Files:**
- Create: `docs/demo-readiness.md`
- Modify: `README.md` only to add the command link
- Modify: existing readiness tests only for measured concurrency defaults and deadlines
- Modify: `REGRESSION_PLAN.md` §4 only if the implementation fixes a real regression or adds a protected invariant

**Interfaces:**
- The operator guide documents prerequisites, target selection, identity environment variable names (never values), repair preview, confirmation, report interpretation, supported automatic repairs, hard blockers, and recovery actions.
- A benchmark report includes exact matrix row count, target/provider concurrency, phase times, p50/p95 scenario duration, and total duration without storing credentials or tokens.

- [ ] Run the build-time contract check, focused BFF tests for every readiness module/route, focused UI tests, `cd demo_api_ui && npm run build`, `npm run topology:verify`, `npm run authz:verify`, and `npm run hygiene:check`.
- [ ] Run the complete local Docker readiness command only after the operator explicitly selects local integration and supplies isolated readiness identities; record all rows and elapsed time.
- [ ] Run the hosted SE audit/readiness command only as a read/execute check against the explicitly configured SE target; do not deploy or mutate the SE cluster. PingOne API repairs remain gated by the preview and confirmation contract.
- [ ] Verify the combined measured run finishes within 12 minutes to claim the target; if it exceeds 12 minutes, tune bounded concurrency and repeat without dropping rows; if it cannot complete by 15 minutes, preserve NOT READY and list unfinished rows.
- [ ] Review the final docs and reports for secret leakage, run `git diff --check`, stage only task-owned paths, verify branch, and commit as `docs: document demo readiness operation`.

## Self-review against spec

- Both targets and provider modes: Tasks 3, 5, 6, and 9.
- Every executable Demo Steps case and explicit 46-count parity: Task 1 and Task 5.
- UC40 native PF ID-JAG and standard exchange evidence elsewhere: Task 5.
- Agent Gateway, Authorize, audiences, scopes, grants, and live policy readback: Task 3; unavailable policy readback blocks full READY.
- Source-of-truth configuration-only repairability check: Task 1; fixture-based repair proof and source immutability are required.
- Exact preview, one confirmation, stale-plan reread, safe apply, readback: Task 4 and Tasks 6–8.
- 15-minute hard deadline, 12-minute target, no skipped rows: Tasks 2, 5, 6, and 9.
- Local Docker/hosted SE isolation and no shared OAuth provider flip: Tasks 3 and 5.
- CLI and admin-only async job, Admin sidebar only, delayed reset/logout: Tasks 6–8.
- Reports, sanitized evidence, operator steps: Tasks 2, 7, and 9.
- Hosted SE deploy/update is prohibited by current repository policy; any cluster mismatch remains NOT READY until fixed through the approved release process.
