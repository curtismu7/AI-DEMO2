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
- The active OAuth provider is process-wide today. Run separate provider-configured readiness worker runtimes, or prove an equivalent provider-bound OAuth design. Never toggle the active BFF's provider or relabel one provider's session as the other.
- Missing credentials, unsupported live readback, unavailable targets, unknown drift, failed or untested cases, and timed-out rows are NOT READY.
- The current deployment policy allows local Docker deployment only. The runner may read hosted SE and may repair supported PingOne configuration after confirmation, but it must not update or deploy the hosted SE cluster.
- Do not emit tokens, passwords, cookies, raw session IDs, authorization headers, or unredacted provider responses in reports or logs.
- Maintain `docs/demo-readiness.md` as the living master reference. Every task that adds or changes a check, repair class, provider flow, feature probe, or operator workflow updates it in that same task commit. The document indexes the checked-in sources of truth; it never replaces them. Task 10 reconciles it against the finished implementation.
- Before BFF or UI edits, read their nested `CLAUDE.md` files and `REGRESSION_PLAN.md` §0–§1, invoke `.claude/skills/regression-guard/`, and preserve all listed invariants and the emoji allowlist.
- After every UI change, run `cd demo_api_ui && npm run build`; run the theme contrast auditor for changed pages in light and dark themes.
- After source edits, run `graphify update .`; run focused tests for touched paths. Do not run Docker Compose from this worktree.

## File Map

- `demo_api_server/services/demoReadinessCatalog.js` builds and validates the runtime case matrix from checked-in readiness contract data and existing backend catalogs.
- `demo_api_server/config/demoReadinessInventory.json` is the BFF runtime projection of all five UI lane lists; the contract check fails if the projection and UI diverge.
- `demo_api_server/config/demoReadinessFeatureChecks.json` tracks A2A FM1/FM2/FM3 and UC-LEARN12's PF DaVinci Integration Kit login proof separately from the 46 UI entries; it fails if any referenced UI/BFF test title disappears. UC-LEARN12 is in the backend catalog but not the current Demo Steps UI lists. If it becomes a UI entry, update the inventory and derived rows rather than silently omitting or double-counting it.
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
- `docs/demo-readiness.md` is the living catalog of coverage, sources of truth, readbacks, repair boundaries, evidence rules, and the procedure for adding future checks and fixes.
- Focused Jest/Vitest tests live beside the existing BFF route/service and UI component tests.

---

### Task 1: Lock the 46-case contract and configuration-only build check

**Files:**
- Create: `demo_api_server/config/demoReadinessRepairability.json`
- Create: `demo_api_server/config/demoReadinessInventory.json`
- Create: `demo_api_server/config/demoReadinessFeatureChecks.json`
- Create: `demo_api_server/services/demoReadinessCatalog.js`
- Create: `demo_api_server/tests/demoReadinessCatalog.test.js`
- Create: `scripts/check-demo-readiness-contract.mjs`
- Modify: root `package.json`
- Modify: `demo_api_ui/package.json`
- Create: `demo_api_ui/src/config/__tests__/demoReadinessContract.test.js`
- Modify: `demo_api_server/tests/stepVerification.pingone-admin.test.js` to consume the shared Admin1–12 expected-operation contract
- Modify: `docs/superpowers/specs/2026-09-26-demo-readiness-and-repair-design.md` only if a checked-in UI catalog change alters the case composition
- Update: `docs/demo-readiness.md` with the inventory, feature probes, source-of-truth links, and contract-check behavior

**Interfaces:**
- `demoReadinessInventory.json` stores all five lane arrays copied from the current UI list: `primary`, empty `advanced`, `ciam`, `privilege`, and executable `admin` IDs. The build contract checks this BFF projection against UI ES module exports. It asserts 24 primary entries, five CIAM source entries with UC2 deduped, seven Privilege source entries with UC40 deduped, and 12 executable Admin entries, for 46 unique runnable steps.
- `buildDemoReadinessCatalog({ verticals, includeAdmin })` returns ordered rows `{ id, kind, triggerType, expectedBehavior, expectedBehaviorByVertical, authorizationContractByVertical, runtimePrerequisitesByVertical, runtimeVerticalGroups, alternateBehaviors, auth, verticals, executionMode, providerFlows, providerNotApplicableReasons, repairability, sourceRef }` from that projection and backend catalogs, and throws with all missing/duplicate/unsupported IDs. Per-vertical authorization contracts resolve each selected tool to its Gateway required scopes, canonical scope definitions, resource audience, and applicable vertical Authorize group. Runtime prerequisites preserve required feature flags, A2A credentials, PAR configuration, and group requirements. Runtime groups may combine verticals only when expected behavior, authorization contract, and runtime prerequisites all match.
- `executionMode` follows the actual handler: `admin-mcp` for ADMIN1–ADMIN12, `live-id-jag` for UC40, `a2a` for UC2.5's direct `/api/a2a/init` + `/api/a2a/message` path, `intent-binding-quick` for UC14b's quick result, `agent-chip` for other chip entries, `attack-sim` for attack entries, `page` for links, and `education-panel` for education entries. UC38/UC44 use their existing link-to-chip adaptation. UC14b also declares its full-page live-PAR route variant.
- Each row carries provider-specific flows or a documented provider exclusion: standard PingOne/PF exchange, the internal PF A2A ID-JAG → access-token chain for UC2/UC2.5, UC40's PF-only standalone native ID-JAG, actor-bound workload exchange for UC38/UC44, and Admin MCP calls. UC40's UI launch requires a PF-authenticated session; its PingOne lane is explicitly not applicable and is not counted as a successful PingOne run.
- `demoReadinessFeatureChecks.json` declares A2A FM1/FM2/FM3 plus the PF DaVinci Integration Kit proof separately from the 46 UI entries. It validates that each declared provider has an outcome (shared or provider-specific) and that every referenced UI/BFF test title remains in source.
- `demoReadinessRepairability.json` maps each audited drift class to `{ sourceOfTruth, readback, repairMode }`, where `repairMode` is exactly `automatic`, `release-only`, or `manual`. It includes explicit PingFederate standard exchange, A2A runtime, and native ID-JAG classes. Live source-code repairs remain prohibited.
- `scripts/check-demo-readiness-contract.mjs` exits `0` only when the UI lists resolve to exactly 46 runnable cases, the three A2A wire probes and PF DaVinci proof remain separately registered, and each case has an executable catalog entry, expected result, auth level, handler variant, provider flows, per-vertical Gateway scope/audience parity, applicable Authorize group mapping, and configuration dependency classifications. It also proves the UI and BFF required-flag lists match every case and vertical. Full live Authorize policy readback remains a separate blocker when unsupported.

- [ ] Add Jest cases proving the exact 46 IDs, order within each source lane, Admin13 exclusion, duplicate rejection, missing-catalog rejection, and failure for `needs-build` entries or missing behavior contracts. Chip/attack contracts require expected outcomes; admin contracts require the declared expected MCP operation; page contracts require a declared route in the UI route/auth registry and preserve query/hash state; education contracts require a registered panel ID. Assert PF flow metadata distinguishes UC2/UC2.5 internal A2A ID-JAG, UC40 standalone ID-JAG, ordinary exchange, and UC38/UC44 actor-bound workload exchange.
- [ ] Resolve every declared vertical's case tool against the root and Agent Gateway scope topologies; verify required scopes match, each scope resolves to a declared resource audience, and sensitive tools retain that vertical's Authorize group/membership contract. Reject topology drift and group runtime verticals only when prompt/outcome/tool plus scope/audience and Authorize-group contracts match.
- [ ] Store each case's actual runtime prerequisites from `demoStepPrerequisites.js`: required flags, A2A specialist credentials, PAR keys, and group requirement. Compare the UI and BFF required-flag helpers for every case/vertical and fail on drift; classify each prerequisite in `demoReadinessRepairability.json`.
- [ ] Assert UC14b declares both its quick-result endpoint and full-page live-PAR route, and assert resolved UC38/UC44 prompt/tool pairs for every declared vertical. Assert UC2.5 and UC2.6 keep verticals separate when their A2A tools or Authorize group mappings differ.
- [ ] Assert A2A-FM1/FM2/FM3 stay separate from the 46 UI entries, include both provider contexts and configuration dependencies, and match test titles in `a2a-failure-modes.real.spec.js`. Require FM3 to carry a distinct expected result for each provider when the exchange chains differ.
- [ ] Assert UC-LEARN12/PF-DAVINCI-IK is a separate PF-only feature row while it remains outside the current UI lists: a PingOne session may remain present but cannot satisfy PF login proof; verify its dedicated PF client/authentication-policy dependency and preserve existing PingOne tokens/session. If the UI begins launching it, promote its inventory row and recalculate the matrix without duplicating the same login proof.
- [ ] Add the Vitest parity case importing `demoUseCaseSteps.js` and the BFF inventory builder; assert 24 primary, five CIAM source entries with UC2 deduped, seven Privilege source entries with UC40 deduped, twelve executable admin entries, and total 46.
- [ ] Assert every row declares PingOne and PingFederate applicability and maps each applicable flow to configuration dependencies. UC40 must declare a reason for its PingOne exclusion. Keep fixture apply/readback tests in Task 4, where the repair service is implemented.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessCatalog.test.js tests/stepVerification.pingone-admin.test.js --forceExit` and `cd demo_api_ui && npx vitest run src/config/__tests__/demoReadinessContract.test.js`; expected: both pass and report 46 UI entries plus four separate provider feature checks.
- [ ] Run `node scripts/check-demo-readiness-contract.mjs`; expected: exit `0`, print lane totals, feature-probe totals, provider-flow coverage, and repairability classes.
- [ ] Add root script `demo:readiness:contract` and call `node ../scripts/check-demo-readiness-contract.mjs` before `vite build` in `demo_api_ui/package.json`; run `cd demo_api_ui && npm run build`; expected: contract check completes before a successful Vite build.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed files, confirm `git branch --show-current`, and commit as `feat: validate demo readiness contract`.

### Task 2: Define report rows, redaction, and deadline behavior

**Files:**
- Create: `demo_api_server/services/demoReadinessReport.js`
- Create: `demo_api_server/tests/demoReadinessReport.test.js`
- Update: `docs/demo-readiness.md` with row statuses, deadline rules, report fields, and redaction behavior

**Interfaces:**
- `createReadinessReport({ runId, commit, targets, startedAt, deadlineAt })` returns a report with `status`, `ready`, `elapsedMs`, `inventory`, `checks`, `repairs`, and `unfinished`.
- `recordCheck(report, { id, target, userSessionProvider, agentIdentityProvider, tokenIssuer, exchangeService, resourceServer, providerApplicability, useCaseId, status, expected, observed, sourceRef, evidence })` accepts only `pass`, `fail`, `blocked`, or `not-run`; any non-pass required row prevents `ready: true`. Provider roles stay separate. `providerApplicability` maps `userLogin`, `agentIdentity`, `tokenIssuer`, `exchangeService`, and `resourceServer` to `required` or `not-applicable` plus an explicit reason where not applicable. Provider labels are stable identifiers; never store credentials or tokens in these fields.
- `redactReadinessValue(value)` removes bearer/JWT strings, passwords, cookies, authorization headers, and raw session identifiers recursively before persistence or display.
- `remainingBudget(report, now)` returns `max(0, deadlineAt - now)`; deadline expiry marks queued rows `not-run` and active rows `blocked` with reason `deadline_exceeded`.

- [ ] Write Jest tests for each status, aggregate readiness, stable counts, the exact 900,000 ms hard deadline, the 720,000 ms target warning, and expiry while queued or active rows exist.
- [ ] Assert report rows preserve user-session provider, agent-identity provider, token issuer, exchange service, resource server, and per-role applicability independently in both direct reads and serialized output; a generic provider field must not collapse these roles.
- [ ] Test nested redaction using bearer/JWT/password/cookie/session fixtures and assert both direct reads and serialized report output stay sanitized after writes to checks, repairs, unfinished rows, targets, and inventory. Sanitize `defineProperty` data descriptors and reject accessors or prototype changes that would make inherited secrets readable.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessReport.test.js --forceExit`; expected: all report and deadline cases pass without outbound network.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed paths, verify the branch, and commit as `feat: add demo readiness report model`.

### Task 2A: Complete the in-progress PingGateway PF Exchange #3 contract

**Purpose:** The readiness workflow depends on a working, source-backed PF Exchange #3 path. Current Gateway filters fall back to PingOne when PF endpoint configuration is incomplete, reuse PingOne exchanger credentials when PF credentials are missing, and the local generated environment does not yet emit the PF settings. Complete that feature before the readiness audit and runner claim it can validate it. These are release-time code/configuration changes; the live readiness/reset workflow must never patch source files.

**Files:**
- Modify: `demo_api_server/scripts/refresh-service-envs.js`
- Modify: `ping-gateway/scripts/groovy/olb-token-exchange.groovy`
- Modify: `ping-gateway/scripts/groovy/invest-dispatch.groovy`
- Modify: `ping-gateway/.env.example`
- Modify: `demo_api_server/config/demoReadinessRepairability.json`
- Create: `demo_api_server/tests/refreshServiceEnvsPfGateway.test.js`
- Create: `demo_api_server/src/__tests__/olbTokenExchangeProviderRouting.test.js`
- Modify: focused PingGateway exchange test fixtures if an existing harness is available
- Modify: `docs/demo-readiness.md`

**Interfaces and invariants:**
- Generate `PF_ISSUER_URI`, `PF_TOKEN_ENDPOINT`, `PF_TE_CLIENT_ID`, `PF_TE_CLIENT_SECRET`, and `PF_TE_AUTH_METHOD` in `ping-gateway/.env` from the existing BFF PF source values, including `PF_STANDARD_TOKEN_EXCHANGE_TOKEN_ENDPOINT_AUTH_METHOD`; default the method to `basic` as the PF standard-exchange service does. Support Basic and Post; reject unsupported methods. Do not introduce a second credential source or depend on a hand-edited ignored `.env` file.
- Select the PF branch as soon as the validated subject issuer equals the configured PF issuer, independent of whether optional PF endpoint/credential settings are present. If required PF settings are missing, return stable `pf_exchange_not_configured` failure without contacting PingOne or substituting PingOne exchanger credentials.
- Require the PF endpoint to use HTTPS and the same scheme/authority as the PF issuer while preserving the configured token path. Follow the configured PF Basic/Post client-auth method. Omit PingOne `resource` request parameters for PF because the PF processor policy derives the output audience; the live readiness row must validate the issued audience against the expected backend. Keep PingOne endpoint selection, resource handling, and `access_token` subject typing unchanged.
- For PF subjects, send `subject_token_type=access_token` unless the signed JWT header `typ` is exactly `oauth-id-jag+jwt`, in which case send `id-jag`. The requested token type remains `access_token`. Preserve the original user `sub` and nested A2A `act` claims; do not rewrite identity based on provider selection.
- Never log subject or issued tokens, raw MCP session IDs, request authorization data, raw PingFederate/PingOne response bodies, or unfiltered provider errors. Gateway logs and returned error envelopes expose only status and stable sanitized error categories.
- Add target-scoped repairability entries. A stale local generated Gateway environment is automatically repairable only if Task 4 provides a tested in-process adapter that regenerates it, safely restarts the local Gateway, and verifies the loaded values after the exact preview and confirmation. If that adapter is not supported, classify the drift as release-only/manual. Hosted SE remains read-only/release-only and is never deployed or updated by this workflow. Keep environment-variable secret values out of reports and tests' output.
- These assertions attach to existing PF Gateway rows. They add no Demo Steps entries and do not change the 46-case count or matrix row count.

- [x] Add static Groovy source-contract regression tests for both Exchange #3 filters: issuer-first PF routing, fail-closed checks before exchange, PF-only credentials, configured Basic/Post client authentication, PF policy-derived audience behavior, exact JWT `typ` handling, access-token requested type, HTTPS authority/path rules, unchanged subject-token forwarding, and registered-tool names.
- [x] Assert the environment generator maps the existing BFF source values to the five Gateway variables and that missing PF credentials remain missing rather than inheriting PingOne values.
- [x] Assert source logs and stable failure responses do not expose exchange response bodies, access tokens, raw MCP session IDs, or authorization data.
- [ ] Use a registered MCP tool in an end-to-end Exchange #3 success fixture and verify its expected audience/result. The source-contract check confirms the fixture tool is registered; this live proof belongs to Task 5 and cannot pass from a static source check.
- [x] Classify local generated Gateway PF env and hosted SE PF env as `release-only`; Task 4 may upgrade local repair only after proving a safe in-process adapter. Keep secret values out of evidence.
- [x] Run focused generator/source-contract tests, the readiness contract check, `graphify update .`, and `git diff --check`. No Groovy runtime is installed; the registered-tool live exchange proof remains in Task 5.
- Commit only Task 2A paths as `fix: route PF gateway exchanges safely`.

### Task 3: Implement read-only audits for both targets

**Files:**
- Create: `demo_api_server/services/demoReadinessAuditService.js`
- Create: `demo_api_server/tests/demoReadinessAuditService.test.js`
- Create: `demo_api_server/config/demoReadinessPingFederateProfiles.json` with secret-free, role-specific PF contracts for standard exchangers/actors, A2A specialists, UC40 native ID-JAG, DaVinci login, CIMD, third-party authorization-server, and RAR roles
- Modify: `scripts/check-demo-health-gate.js` only to export/reuse read-only probes without changing its existing exit semantics
- Modify: `scripts/check-mcp-preflight.js` only to export/reuse reachability probes without changing its existing exit semantics
- Modify: `demo_api_server/services/pingOneAuthorizeService.js` only if a supported live Authorize policy read path can be added using existing worker credentials and documented API calls
- Update: `docs/demo-readiness.md` with audit families, target-specific readbacks, and current blockers

**Interfaces:**
- `auditTarget({ targetId, targetConfig, deadlineAt, signal })` returns `checks[]` using the report row schema and performs no writes.
- `auditRepositoryContracts()` reads `scope-topology.json`, vertical manifests, route/auth configuration, required-flag/prerequisite parity, registered tool metadata, Agent Gateway configuration, and Authorize endpoint/policy references from checked-in sources.
- `auditPingOneConfiguration({ environmentId, credentials, deadlineAt })` reads resources, audiences, scopes, mirrors, app grants, required flag state, relevant group membership, decision endpoints, and policy definitions only through supported management APIs.
- `auditPingFederateConfiguration({ baseUrl, credentials, deadlineAt })` reads OAuth client grant types and processor-policy references, A2A specialist SP `resourceUris`/ID-JAG fields, token-exchange processor mappings, ATM audience settings, JWT allowed audiences, issuer/JWKS endpoints, DaVinci proof-flow client and authentication-policy adapter, and RAR/CIMD/third-party authorization-server configuration through supported PF Admin APIs.
- `auditRuntimeTarget({ bffUrl, gatewayUrl, authorizeUrl, targetKind, deadlineAt })` checks health, reachable routes, loaded revision/config fingerprint, and the actual audience/scope values consumed at runtime.
- Read required use-case flags, A2A credentials, PAR configuration, and vertical group requirements from the same prerequisite helpers the UI and BFF use; check presence and effective state without exposing secrets. The runner may arm required flags only in an isolated worker and must restore those values after each case.
- PingFederate expectations are role-specific and come from a committed contract plus supported API readback. The A2A specialist clients and the ordinary standard-exchange actor/agent/MCP exchanger clients are distinct profiles; do not apply the standard agent-exchanger ATM or MCP-exchanger processor-policy requirements to every specialist client. For each role, compare grants, processor-policy references, default ATM/restriction settings, SP resource URIs and ID-JAG fields, and exchange mappings against the current checked-in provisioner and the actual protocol hop. If a required value is undocumented or the code, provisioner, and live PF readback disagree, block readiness until those sources are reconciled; do not infer intended settings from handoff notes alone.
- The role-specific contract file is an explicit Task 3 deliverable because no complete, secret-free PF profile contract currently covers every role. If a client/SP role has no authoritative declared expectation, report it as undocumented and block readiness rather than deriving a passing expectation from whatever the live server currently returns.

- [ ] Add mocked Jest tests for healthy local/SE targets and for one failure in each required family: audience, scope, mirror, app grant, required flag, A2A specialist credential, PAR setting, Authorize group membership, registered tool scope, gateway route/auth config, Authorize endpoint reference/policy readback, role-specific PF client grant/processor-policy/ATM, PF SP resource URI/ID-JAG setting, PF DaVinci client/adapter setting, PF JWKS audience, service health, and revision mismatch.
- [ ] Audit PingGateway Exchange #3 configuration by read-only source/environment/runtime readback: PF issuer, endpoint authority and configured path, presence of distinct PF exchanger credentials, generated local environment provenance, and the hosted SE equivalent. Do not log credential values. A PF issuer with incomplete configuration is a blocker, not a PingOne-routed success.
- [ ] Assert an unavailable or unauthorized Authorize policy read produces a blocking finding and never substitutes a successful decision probe for policy parity.
- [ ] Assert unavailable PF Admin API readback is a blocker and never substitutes a successful login or demo call for profile parity. Assert each client/SP role matches its committed contract; reject missing or wrong settings required by that role, and do not require ordinary-exchange ATM or processor-policy fields on A2A specialists unless their own contract declares them.
- [ ] Populate and validate the new PF role contract from committed sources and supported readback; include expected client/SP role, grants, processor-policy refs, ATM/restrictions, audiences, issuer/JWKS, resource URIs, ID-JAG fields, DaVinci adapter, CIMD, third-party-AS and RAR processor/detail requirements. Leave undocumented values explicitly unresolved and blocking.
- [ ] Assert local Docker inspection is read-only and uses `execFile` argument arrays for `docker inspect`/`docker ps`; no shell string may contain a mutation command.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessAuditService.test.js --forceExit`; expected: all probes use mocked dependencies and make zero network calls.
- [ ] Run `npm run topology:verify` and `npm run authz:verify`; expected: existing source checks remain green.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed files, verify branch, and commit as `feat: audit demo target configuration`.

### Task 4: Add preview-bound configuration repair

**Files:**
- Create: `demo_api_server/services/demoReadinessRepairService.js`
- Create: `demo_api_server/tests/demoReadinessRepairService.test.js`
- Create: `demo_api_server/services/demoReadinessLocalGatewayEnvRepair.js` only if a supported in-process local regeneration/restart/readback path is available; otherwise keep this drift release-only/manual
- Modify: `demo_api_server/config/demoReadinessRepairability.json`
- Modify: `demo_api_server/services/demoReadinessAuditService.js` only to emit structured repair candidates
- Update: `docs/demo-readiness.md` with preview/confirmation rules and each supported repair class

**Interfaces:**
- `planRepairs({ findings, targets, now })` returns `{ planId, digest, expiresAt, changes, blocked }`; every change includes target/object/current/expected/sourceRef/operation.
- `applyRepairs({ digest, confirmedBy, targets, now })` rejects expired or mismatched plans, re-reads every object's current state, applies only `automatic` candidates from that digest, then verifies each write using the source API's readback.
- `repairMode: release-only` and `manual` remain visible in `blocked` with an operator action and cannot be passed to an apply adapter.
- A local generated Gateway environment repair may be automatic only through a supported in-process adapter that regenerates from the declared source, safely restarts the local Gateway, and proves the loaded config by readback. The BFF route may not spawn shell commands or use `child_process`; if the adapter cannot meet this contract, leave the drift release-only/manual. Hosted SE never receives writes or deployment from this workflow.

- [ ] Test that a changed target set, expired plan, altered current value, repeated confirmation, and ambiguous object ID each stop before the first write.
- [ ] Test that the generated preview includes the exact before/after values and repository source reference, and its digest changes if any field changes.
- [ ] Test a confirmed repair applies once, performs readback, records sanitized before/after evidence, and is safe to retry after a timeout.
- [ ] Test required demo flags are changed only in the isolated readiness worker, restored after each case, and never left changed in the presenter's active runtime.
- [ ] Test unauthorized/unsupported Authorize policy writes stay blocked and never call a mutation client.
- [ ] Keep PF standard/A2A/native-ID-JAG drift manual until supported exact-object writes, idempotency, and readback are proven; no PF mutation can be inferred from a feature label alone. Local Exchange #3 generated-env refresh is automatic only if the in-process local adapter above is proven; otherwise it remains release-only/manual. Hosted SE stays read-only.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessRepairService.test.js --forceExit`; expected: mocks record writes only after a matching confirmation and pre-write reread.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed paths, verify branch, and commit as `feat: apply confirmed demo config repairs`.

### Task 5: Execute isolated provider sessions and every demo step

**Files:**
- Create: `demo_api_server/services/demoReadinessExecutionService.js`
- Create: `demo_api_server/tests/demoReadinessExecutionService.test.js`
- Modify: `demo_api_server/services/agentMcpTokenService.js` only if a narrow explicit provider/session context is required; preserve normal provider resolution and current token custody invariants
- Modify: `demo_api_server/routes/useCases.js` only to expose a readiness-only execution adapter that reuses the same scenario dispatch and expected-outcome verification
- Create: `demo_api_server/tests/demoReadinessProviderIsolation.test.js`
- Update: `docs/demo-readiness.md` with provider lanes, feature probes, scenario evidence, and row-count changes

**Interfaces:**
- `createWorkerContext({ targetId, provider, identityRef, deadlineAt })` returns an opaque context handle backed by a separate provider-configured worker BFF/runtime or equivalent provider-bound login transaction. Browser cookies, BFF sessions, and OAuth config are isolated; credentials and tokens never enter job state or reports.
- `executeReadinessCase({ context, caseRow, vertical, mode, deadlineAt })` returns `{ status, expected, observed, evidence }` from the supported demo execution path and exact declared outcome checks. It verifies the row's `runtimePrerequisitesByVertical` before dispatch. Each report row records user-session provider, agent-identity provider, token issuer, exchange service, resource server, and per-role applicability independently; never collapse these into one provider label. For each tool call, evidence includes sanitized subject/actor, audience and scope summaries, selected tool, exchange provenance, Agent Gateway route/verdict, and Authorize decision reference/result; it never stores a bearer token. Cases without a tool exchange declare why Gateway/Authorize evidence is not applicable.
- The base has 45 non-UC40 Demo Steps entries × both targets × both user-session providers, plus UC40's PF-only native ID-JAG row per target (182 applicable case/target/provider rows before vertical expansion). The catalog statically validates every business vertical's selected tool, Gateway scopes, scope-to-resource audience, and applicable Authorize group mapping. Runtime verticals may be combined only when the expected prompt/outcome/tool and the complete authorization contract match. It dispatches each row using the real UI handler semantics: agent chip, attack simulation, route navigation, education panel, Admin PingOne MCP, UC2.5's direct A2A endpoints, UC14b quick-result and full-page variants, or UC40 native ID-JAG.
- At this revision, those exact behavior-plus-authorization signatures produce 184 runtime vertical groups and 734 core target/provider rows: 183 non-UC40 groups × four target/provider combinations, plus UC40's two PF-only rows. UC14b's full-page variant adds four rows; A2A FM1/FM2/FM3 add 12 rows and PF-DAVINCI-IK adds two PF-only target rows, for 752 current rows. Add the five current Privilege LLM Attack Lab scenarios as separate feature probes for both targets and user-session providers (20 rows), bringing that baseline to 772 before PingOne Agent IAM Core and the remaining PF CIMD, third-party authorization-server, invalid/expired/wrong-audience ID-JAG, and RAR probes. UC-LEARN11 must also prove its prompt-injection route opens with the expected attack selected and payload prefilled; the separate probe submits it and checks the declared denial/provider-not-reached outcome. The runner prints the exact derived count by category before execution and must benchmark the complete manifest; no rows may be dropped to make the timing pass. Any source or manifest change recalculates the count and requires reviewing the timing gate.
- PF flow assertions are case-specific: ordinary PF cases use standard access-token exchange; UC2/UC2.5 use the A2A intermediate ID-JAG → access-token Exchange #2 chain; UC38/UC44 preserve actor-bound standard two-exchange behavior and do not invoke native ID-JAG; UC40 proves the standalone native ID-JAG journey. Do not fail a correct A2A internal ID-JAG hop as if it were UC40 provenance.
- For each exchange-backed row, compare observed issuer, subject/actor, audience set, and granted scopes with the provider-role and tool contract; prove required scopes reach the selected Gateway tool and the expected Authorize decision is returned. Record any permitted scope superset explicitly in the source contract instead of accepting arbitrary extras. Never put raw tokens in evidence or reports.
- Provider sessions are minted into separate worker runtimes. A failed provider setup blocks its entire lane; it must not silently reuse the administrator's current session or change the active global `oauth_provider` value. If current BFF routing cannot support both providers without that toggle, provider isolation is an implementation blocker, not a waived check.

- [ ] Add contract tests showing 182 unexpanded applicable case/target/provider rows, 184 current behavior-plus-authorization vertical groups, and 734 core target/provider rows. Add UC14b's four full-page rows, 12 A2A FM1/FM2/FM3 rows, and two PF-DAVINCI-IK PF-only target rows for a current baseline of 752; keep UC40 only in its PF lane. Derive future counts from the inventory and feature manifest, and fail if a new row is omitted or silently merged.
- [ ] Add mocked execution tests for PERMIT, DENY, STEP_UP, HITL_REQUIRED, expected Admin tool output, page route load, education panel registration/open, attack simulation verdicts, UC2.5 direct A2A route evidence, UC14b quick-result and full-page route, UC38/UC44 chip adaptation, PF standard exchange provenance, PF A2A internal ID-JAG/exchange provenance, UC40 native ID-JAG provenance, wrong-provenance failures, and mismatched issuer/subject/audience/scopes or Gateway/Authorize evidence.
- [ ] On existing PingFederate rows that reach PingGateway Exchange #3, assert issuer-based endpoint selection, PF-only exchanger credentials, endpoint/issuer scheme-authority and path rules, exact subject-token typing, fail-closed behavior for incomplete PF configuration, and a successful registered-tool call with the expected audience/result. Assert PingOne rows retain the PingOne endpoint/credentials and access-token typing. Keep UC2's passenger `invalid_target` A2A failure as separate UC2 evidence; never count it for Exchange #3 or UC40.
- [ ] Add focused order-independence regressions from the spec: UC5 and UC18 must not pass on a Gateway audience-mismatch response; derive UC38's route assertion from its catalog trigger; for steps that share mutable flags/vertical state, test normal and reverse sequence and restore only the test-changed state in `finally`, failing if cleanup fails.
- [ ] For every PF-authenticated worker lane, verify the provider's real user subject is used for policy and token attribution; cover subject claim normalization, synthetic demo-store IDs, allowlisted and denied identities, and subject mismatch. UC38/UC44 must retain the user subject and actor chain through both standard exchanges.
- [ ] Add provider-feature tests for the approved PingOne Agent IAM Core baseline and PingFederate CIMD valid/rejected metadata, third-party authorization-server allow/deny exchange, native ID-JAG invalid/expired/wrong-audience rejection, and RAR valid/invalid detail processing. Extend the feature-check manifest with each test and provider-role declaration; keep them separate from the 46 UI step count.
- [ ] Add separate feature probes for the five Privilege LLM Attack Lab scenarios linked by UC-TOOL3 and UC-LEARN11: Tool Abuse, Tool Poisoning, Schema Violation, Inter-Agent Abuse, and Malicious Content. Derive each expected effect and attribution from the current attack catalog, run both provider sessions on both targets, and never label every case a Privilege block. Cover UC-LEARN11's prefilled prompt plus the actual send/deny outcome. Register each probe in the manifest with its user-session provider roles and observed model/backend reachability.
- [ ] Add concurrency tests proving worker runtimes, cookies, and session stores are separate; active `oauth_provider` is unchanged; one worker failure does not hide other lane results; and the deadline launches no new rows after expiry.
- [ ] Add provider-login integration coverage for both login routes against dedicated identities. UC40 must prove its PF login path and report its PingOne session as explicitly not applicable. Test simultaneous provider contexts without toggling or mutating the active BFF's process-wide setting; if this cannot be implemented safely, fail the provider-isolation test and keep readiness blocked.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/demoReadinessExecutionService.test.js tests/demoReadinessProviderIsolation.test.js --forceExit`; expected: mocks verify correct session, route, outcome, audience, and provenance per row.
- [ ] Run the dedicated local integration test only when its explicitly named readiness test credentials are present; expected: both isolated provider runtimes authenticate and the test cleans up its own sessions. Never run it against hosted SE from this worktree.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed files, verify branch, and commit as `feat: run isolated demo readiness scenarios`.

### Task 6: Orchestrate the run and expose the CLI

**Files:**
- Create: `demo_api_server/services/demoReadinessRunner.js`
- Create: `demo_api_server/tests/demoReadinessRunner.test.js`
- Create: `scripts/demo-readiness.js`
- Create: `scripts/demo-readiness.test.js`
- Modify: root `package.json`
- Update: `docs/demo-readiness.md` with runner phases, deadline behavior, CLI usage, and exit conditions

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
- Update: `docs/demo-readiness.md` with job lifecycle, auth requirements, and report polling behavior

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
- Update: `docs/demo-readiness.md` with the Reset Demo confirmation and post-ready cleanup flow

**Interfaces:**
- Admin sidebar Reset Demo starts the new job, polls status, renders every failing row and repair preview, then presents one explicit confirmation bound to the returned digest.
- After full READY only, the existing admin reset action runs cleanup and signs out. A failed, blocked, expired, or timed-out job leaves the report visible and does not call reset or sign out.
- Dashboard Reset Demo, customer account reset, logout behavior elsewhere, and the existing `/api/admin/reset-demo` route semantics remain unchanged.

- [ ] Add Vitest tests for start → audit progress → preview → one confirmation → full ready → cleanup/sign-out.
- [ ] Add negative UI tests for decline, stale digest, failed audit, missing Authorize readback, scenario failure, deadline expiry, and job polling errors; assert cleanup and sign-out are not called.
- [ ] Read `THEMING.md` and style the job panel using existing theme tokens; use `<DraggableModal>` and `ConfirmModal`, `apiClient`, and approved emoji only.
- [ ] Run focused UI tests with `cd demo_api_ui && npx vitest run src/components/__tests__/AdminSideNav.resetDemo.test.jsx`, then run `cd demo_api_ui && npm run build` and the §1.4 contrast auditor in both themes.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed files, verify branch, and commit as `feat: gate admin reset on demo readiness`.

### Task 9: Validate configuration-only recovery and isolated source fixes

**Files:**
- Create: `demo_api_server/services/demoReadinessBuildRepairService.js`
- Create: `demo_api_server/tests/demoReadinessBuildRepairService.test.js`
- Create: `scripts/demo-readiness-build-fix.js`
- Create: `scripts/demo-readiness-build-fix.test.js`
- Modify: `package.json`
- Update: `docs/demo-readiness.md` with the configuration-only proof and isolated source-fix boundary

**Interfaces:**
- `validateConfigOnlyRecovery({ caseRow, driftFixture, adapters })` creates a deterministic live-config mismatch in a disposable fixture, previews/applies the supported configuration repair, reruns the affected scenario, and proves the application source tree hash is unchanged.
- `prepareSourceFix({ caseRow, sanitizedFailure, baseRevision, patchProvider, testPlan })` creates a separate temporary git worktree, asks the injected patch provider for a patch limited to that case's declared `codeRefs`, applies it only inside that worktree, and runs the focused service/UI tests and build.
- A successful source-fix run returns an uncommitted patch, diff, test/build evidence, and a suggested reviewer action. It never changes the caller's checkout, commits, deploys, calls live configuration APIs, or runs from `demo:ready` or Admin → Reset Demo.
- If configuration alone fixes the fixture, the source patch provider is not called. If a source patch fails its focused checks, discard its worktree and keep the case blocked.

- [ ] Test a supported config drift fixture and an isolated-worker feature-flag mismatch are repaired, each scenario passes on retry, temporary flags are restored, and hashes of application source files are unchanged.
- [ ] Test source-defect fixtures generate an isolated patch limited to declared code references; reject path traversal, secret/config files, generated files, shell commands, or patches outside the allowlist.
- [ ] Test a failing focused test/build discards the candidate; a passing candidate returns the diff and evidence but does not commit, deploy, or alter the active checkout.
- [ ] Test `demo:ready` never invokes the source patch provider and the Admin reset route cannot invoke this build-time workflow.
- [ ] Run the focused BFF/CLI tests and UI build from the temporary worktree fixture; expected: only verified candidate patches are returned for review.
- [ ] Run `graphify update .`, `git diff --check`, stage only the listed paths, verify branch, and commit as `feat: validate isolated demo source fixes`.

### Task 10: Prove timing, operator recovery, and the complete contract

**Files:**
- Update: `docs/demo-readiness.md`
- Modify: `README.md` only to add the command link
- Modify: existing readiness tests only for measured concurrency defaults and deadlines
- Modify: `REGRESSION_PLAN.md` §4 only if the implementation fixes a real regression or adds a protected invariant

**Interfaces:**
- The operator guide documents prerequisites, target selection, identity environment variable names (never values), repair preview, confirmation, report interpretation, supported automatic repairs, hard blockers, and recovery actions.
- A benchmark report includes exact matrix row count, target/provider concurrency, phase times, p50/p95 scenario duration, and total duration without storing credentials or tokens.

- [ ] Run the build-time contract check, focused BFF tests for every readiness module/route, focused UI tests, `cd demo_api_ui && npm run build`, `npm run topology:verify`, `npm run authz:verify`, and `npm run hygiene:check`.
- [ ] Run the complete local Docker readiness command only after the operator explicitly selects local integration and supplies isolated readiness identities; record all rows and elapsed time.
- [ ] Run the hosted SE audit/readiness command only as a read/execute check against the explicitly configured SE target; do not deploy or mutate the SE cluster. PingOne API repairs remain gated by the preview and confirmation contract.
- [ ] Verify the combined measured run finishes within 12 minutes against the exact runtime-derived row count, including every case/vertical authorization signature and every approved feature-manifest probe; the 772-row baseline includes the five LLM Attack Lab probes and precedes PingOne Agent IAM Core and remaining PF CIMD/third-party/ID-JAG/RAR checks. If it exceeds 12 minutes, tune bounded concurrency and repeat without dropping rows; if it cannot complete by 15 minutes, preserve NOT READY and list unfinished rows. Report the measured result honestly; do not claim 12-minute readiness without a full-size run.
- [ ] Review the final docs and reports for secret leakage, run `git diff --check`, stage only task-owned paths, verify branch, and commit as `docs: document demo readiness operation`.

Every task's file list above includes `docs/demo-readiness.md` where applicable; its additions are committed with that task. Task 10 reconciles the guide with the actual supported checks, repairs, known blockers, exact feature manifest, operator workflow, and timing evidence before committing the final documentation.

## Self-review against spec

- Both targets and provider modes: Tasks 3, 5, 6, and 10.
- Every executable Demo Steps case and explicit 46-count parity: Task 1 and Task 5.
- UC40 native PF ID-JAG and standard exchange evidence elsewhere: Task 5.
- Agent Gateway, Authorize, audiences, scopes, grants, and live policy readback: Task 3; unavailable policy readback blocks full READY.
- In-progress PF PingGateway Exchange #3 routing and local generated-environment mapping: Task 2A prerequisite, Task 3 read-only audit, Task 4 repair classification, and Task 5 provider/step assertions.
- UC5/UC18 expected-denial correctness, catalog-derived UC38 route, and stateful sequence cleanup: Task 5 focused regression cases.
- Source-of-truth configuration-only repairability check: Task 1; fixture-based repair proof and source immutability are required in Tasks 4 and 9.
- Separate safe source-fix workflow: Task 9; never called by live readiness/reset, verified in an isolated worktree, and returned for review after focused tests/build pass.
- Exact preview, one confirmation, stale-plan reread, safe apply, readback: Task 4 and Tasks 6–8.
- 15-minute hard deadline, 12-minute target, no skipped rows: Tasks 2, 5, 6, and 10.
- Local Docker/hosted SE isolation and no shared OAuth provider flip: Tasks 3 and 5.
- CLI and admin-only async job, Admin sidebar only, delayed reset/logout: Tasks 6–8.
- Reports, sanitized evidence, operator steps: Tasks 2, 7, and 10.
- Living master reference and future extension procedure: updated in each task commit, reconciled in Task 10.
- Hosted SE deploy/update is prohibited by current repository policy; any cluster mismatch remains NOT READY until fixed through the approved release process.
