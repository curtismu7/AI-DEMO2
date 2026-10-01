# Demo Readiness Master Guide

This is the living human reference for the demo readiness checks, repairs, operator flow, and extension process. The checked-in inventories, topology, use-case definitions, feature manifests, profile contracts, and implementation are authoritative; this guide explains how they fit together. Every task that changes a check, repair class, provider path, feature probe, or operator flow updates this file in the same commit.

## Goal and current status

The readiness workflow targets local Docker and hosted SE, shows every finding, offers one digest-bound repair preview, applies only approved source-backed configuration changes, re-audits, and executes every required Demo Step and feature probe. A full green result requires every applicable target/provider/scenario row to pass before the 15-minute hard deadline. The target duration is 12 minutes. The run must list unfinished rows and return NOT READY when it cannot complete; it must not skip cases to fit the budget. Current adapters do not yet support a full live-green run; see the blockers and benchmark below.

The workflow also has a separate command users can run directly and an Admin sidebar Reset Demo integration. Only the Admin sidebar action may launch privileged readiness repair. It performs the existing reset/sign-out cleanup only after full readiness. The live readiness path never edits application source. A separate build-time helper may propose a source patch in an isolated worktree for review after focused tests/build pass; it never commits or deploys.

### Pre-demo target and identity setup

Use `npm run demo:ready -- --help` to see target selection. The direct command defaults to both `local` and `se`; selecting only one is diagnostic and cannot return full READY. Admin sidebar Reset Demo always checks both. Once its runtime prerequisites are available, the default run includes the local Docker audit and hosted SE checks. Hosted SE checks are read/execute only and never deploy or update the cluster.

The 47-step plan keeps separate PingOne and PingFederate user sessions wherever each provider applies. PF-only UC40 must use a PF-authenticated session and prove native ID-JAG issuance/redemption; an existing PingOne session cannot stand in for it. Do not reuse a presenter/admin session as a readiness identity or switch the active BFF's process-wide provider. Existing application setting names are listed here for setup reference; this document and readiness reports never contain their values:

| Lane | Existing setting names |
|---|---|
| PingOne user session | `PINGONE_ENVIRONMENT_ID`, `PINGONE_USER_CLIENT_ID`, `PINGONE_USER_REDIRECT_URI` |
| PingFederate user session | `PF_ISSUER`, `PF_USER_CLIENT_ID`, `PF_USER_REDIRECT_URI`; `PF_USER_CLIENT_SECRET` only for a confidential client |
| PingFederate Gateway issuer, ID-JAG, and Exchange #3 | `PF_ISSUER_URI`, `PF_JWKS_URI`, `PF_TOKEN_ENDPOINT`, `PF_TE_CLIENT_ID`, `PF_TE_CLIENT_SECRET`, `PF_TE_AUTH_METHOD` |
| PingOne management/configuration readback | `PINGONE_ADMIN_CLIENT_ID`, `PINGONE_ADMIN_CLIENT_SECRET`, `PINGONE_WORKER_CLIENT_ID`, `PINGONE_WORKER_CLIENT_SECRET` |
| Existing demo account scripts | `DEMO_USER_USERNAME`, `DEMO_USER_PASSWORD`, `DEMO_ADMIN_USERNAME`, `DEMO_ADMIN_PASSWORD` — these are not isolated readiness identities. |

These existing application variables are not readiness worker credentials. The readiness runner now defines an explicit environment contract for target and lane configuration:

| Target settings | Required values |
|---|---|
| `DEMO_READINESS_LOCAL_*` / `DEMO_READINESS_SE_*` | `BFF_URL`, `GATEWAY_URL`, `AUTHORIZE_URL`, and `EXPECTED_REVISION` (7–40 character Git SHA) |
| `DEMO_READINESS_<TARGET>_<PROVIDER>_*` | `WORKER_URL`, `WORKER_TOKEN`, and `IDENTITY_REF` for each of `LOCAL`/`SE` × `PINGONE`/`PINGFEDERATE` |

Target and worker URLs must use HTTPS and contain no embedded credentials, query, or fragment. Each provider lane needs a unique worker URL, worker token, and identity reference. The worker token authenticates the BFF to a readiness worker; `IDENTITY_REF` names the provider test identity held by that worker. Neither value is written to readiness findings. Provider login credentials, cookies, and sessions must remain inside their worker runtime. The runner health-checks each configured worker lane, injects a production worker client into the execution service, passes only the selected target's BFF/Gateway/Authorize URLs and revision into its audit, and disposes worker contexts after the matrix. A missing worker service, unhealthy or mismatched lane, target readback gap, cleanup failure, or incomplete scenario still blocks readiness. A tested Express protocol service now supplies bearer-authenticated, lane-pinned context lifecycle and allowlisted operation dispatch. It is not yet packaged as a worker process and has no real PingOne/PingFederate login or Demo Step adapters, and no local or SE service is configured; configuration presence alone cannot pass readiness. Current worker credentials also cannot read the complete Authorize policy tree; the approved temporary waiver keeps that limitation visible and nonrequired. Do not claim a green run until the worker process and provider adapters, target readbacks, isolated sessions, all other required checks, and scenario execution are supplied.

The worker API contract is `GET /api/demo-readiness/v1/health`, `POST /api/demo-readiness/v1/contexts`, `POST /api/demo-readiness/v1/contexts/{contextId}/operations`, and `DELETE /api/demo-readiness/v1/contexts/{contextId}`. The BFF authenticates every call with that lane's bearer token. `demoReadinessWorkerServer.js` implements the service boundary: it pins one target/provider/identity reference per process, compares bearer-token digests in constant time, caps JSON request and result size at 512 KiB, coalesces same-run context retries, keeps shared login setup alive while any requester is waiting, enforces context capacity and expiry, rejects operation data that differs from checked-in case/feature contracts, rejects provider-crossed operations, and dispatches through a fixed family allowlist. Service overrides are capped at an eight-context maximum, 30-minute context TTL, two-minute session setup and operation timeouts, ten-second cleanup timeout, and one-minute expiry sweep interval. Setup timeout or cancellation aborts the adapter signal and keeps its run/capacity slot reserved until setup settles and any late session is disposed. If cleanup cannot be confirmed within its limit, the service latches unavailable and rejects new sessions; a late session is still disposed if it eventually arrives. Its context handshake requires an authenticated provider session and distinct runtime, cookie-jar, and session-store IDs. An adapter cleanup failure latches the service unavailable; operation timeout is reported only after cleanup is confirmed. The factory accepts a trusted `createSession` adapter; it does not implement provider login, browser isolation, or scenario execution by itself. Contexts are run-bound, deleted in `finally`, and expire if a connection is lost before the BFF receives its context ID. Each operation carries a checked-in case or feature contract and returns redacted structured evidence for existing validators. Worker tokens and context IDs stay inside the worker client; only sanitized pass/block evidence reaches the report.

OAuth provider selection is process-wide in the current BFF. A single process therefore cannot provide isolated simultaneous PingOne and PingFederate sessions by accepting a provider name in a request. The deployable worker design must give each target/provider lane its own provider-configured readiness BFF runtime, with separate browser, cookie, and session stores, all pinned to the expected application revision. The presenter BFF's provider setting must never be changed for readiness.

The existing BFF user-login route now checks the selected provider's own readiness settings: PingOne needs its environment ID and user client ID, while PingFederate needs its issuer and PF user client ID. Neither mode requires a client secret for a public PKCE client. The user redirect URI selects the matching provider setting and uses the canonical public origin when that setting is absent. This local configuration fix does not establish an isolated readiness-worker login, prove the PF redirect registration, or resolve the worker runtime and identity mapping blockers.

The readiness provider login client now starts a fresh user authorization-code login at an explicitly supplied dedicated BFF URL. Its caller must provide the selected provider, identity reference, username, password, expected issuer, and expected subject from protected worker runtime configuration. The client keeps cookies in a private in-memory jar, supports the PingOne flow API and PF hosted form with optional consent, and checks the authenticated BFF status provider, issuer, and subject after callback. The user status response exposes `user.providerSubject` only for an authenticated user OAuth session, derived from the BFF-held verified subject claim; it does not expose tokens. Disposal clears the jar. This protocol client does not supply credentials, private BFF/session-store packaging, or live registration proof. Task 6 must connect it only to dedicated provider-configured lane BFF runtimes.

### Direct CLI runner (Task 6)

Run `npm run demo:ready` to request both local Docker and hosted SE checks. The default prerequisite report names missing target/lane settings; configured lanes are probed at `GET /api/demo-readiness/v1/health` before any audit. `npm run demo:ready -- --target local` and `--target se` select one target; those results are explicitly diagnostic and cannot return full READY or exit 0. `--json` writes the sanitized machine-readable report to stdout. `npm run demo:ready -- --help` lists the options without starting a readiness run.

The runner starts one 15-minute wall-clock deadline before prerequisite checks. It then checks prerequisites, audits the selected targets, builds and prints the complete repair preview, waits for a single exact plan-digest confirmation, applies only that bound plan, re-audits, and starts the scenario matrix only after a clean audit. Confirmation time counts against the same deadline. Declined or mismatched confirmation, empty required-check inventories, blocked or unresolved audit findings, failed apply/readback, and any failed, blocked, unknown, or unfinished required scenario row produce NOT READY. A repairable initial audit failure is retained as history and is cleared from the readiness gate only after a passing re-audit. Automatic repair also requires a verified administrator assertion from the confirmation adapter; typing the digest alone never authorizes a write. Progress callbacks awaited by the runner are bounded by the deadline, and phase adapters receive the shared deadline and cancellation signal. Scenario-row progress notifications are fire-and-forget and cannot delay the run. If the deadline fires during repair application, the runner waits for that in-flight apply operation to settle. It may still be verifying the administrator assertion, creating an isolated worker, reading the pre-write state, applying the change, reading it back, or restoring the worker. If it fires during scenario execution, the runner drains worker cleanup for at most 10.5 seconds and retains the completed manifest inventory when available; the report remains deadline-exceeded and NOT READY. A scenario adapter that does not settle inside that bounded drain produces a blocker. Every phase is injectable for deterministic tests; the CLI itself does not spawn shell commands to perform its orchestration.

The command exits 0 only when both targets and every required row pass. Blockers, diagnostic-only target selection, and deadline exhaustion exit nonzero. The standalone CLI has no verified administrator identity provider: its terminal prompt records the exact digest but cannot authorize a write. If the preview contains changes, the run blocks before apply; use the Admin sidebar Reset Demo flow for administrator-bound repair. Secrets and bearer credentials are redacted in both terminal text and JSON reports. The command does not reset demo state or sign out the presenter; those effects remain exclusive to the Admin Reset Demo flow after full readiness.

### Admin readiness job API (Task 7)

The BFF exposes `POST /api/admin/demo-readiness/jobs`, `GET /api/admin/demo-readiness/jobs/:jobId`, and `POST /api/admin/demo-readiness/jobs/:jobId/confirm`. All three use the shared `authenticateToken`, `requireAdmin`, and `requireScopes(['admin'])` guards. The shared auth middleware permits either the verified admin role or the `admin` scope to satisfy admin access; an ordinary user without either receives 403. Job creation starts the same in-process runner as the CLI for both targets and returns a job ID immediately. It does not spawn a command or call the demo reset route.

Polling returns the latest sanitized phase/progress, the full repair preview when available, and the sanitized terminal report. A readiness job is bound to the creating administrator's subject; another administrator cannot poll or confirm it. Job state lives in memory for at most 20 minutes and is then removed. Confirmation accepts only `{ "digest": "<displayed digest>" }`; the BFF constructs the administrator assertion from the authenticated `req.user`, binds it to that job owner, and accepts one confirmation for the exact preview digest. A stale digest, declined/failed/expired job, or incomplete readiness result never resets demo state or signs the presenter out. The Admin sidebar Reset Demo integration is responsible for cleanup only after the job reports full READY.

### Admin sidebar Reset Demo flow (Task 8)

The Admin sidebar's Reset Demo confirmation starts a readiness job for both `local` and `se`. The UI polls the job and shows the current phase, all sanitized failing or unfinished check rows, and each proposed or blocked configuration change. The repair-preview progress snapshot includes prerequisite and initial-audit rows so the administrator can see the findings that prompted repairs before confirming. Blocked entries render the target and serialized object details, including object IDs. A proposed repair displays its digest and requires one separate administrator confirmation bound to that exact digest. Declining, a stale digest, a failed required audit, a failed scenario, job expiry, deadline exhaustion, or a polling error leaves demo state and the administrator session intact. The approved temporary Authorize policy-tree waiver remains shown as waived/unverified and does not represent policy parity; endpoint references and runtime decisions remain required.

The UI calls the existing `POST /api/admin/reset-demo` only when the terminal job status is `ready` and its report independently says `ready: true` for both targets. Only after that reset succeeds does the sidebar clear its local history and sign out. If cleanup fails, the report stays visible and the user remains signed in. Dashboard Reset Demo, customer account reset, and logout behavior elsewhere are unchanged. The UI does not call the separate build-time source-fix helper.

The current branch has the 47-case inventory/build contract, report model, two-target audit, confirmed-repair service, an HTTPS worker client, production adapter lifecycle wiring, and provider-aware BFF user-login configuration. The local stack still does not supply the separate provider-configured worker service. Unavailable or mismatched lanes block before audit instead of reusing a presenter or administrator session or changing the process-wide provider. Task 2A implements PF Exchange #3 source routing and environment generation; its focused source-contract checks do not prove a live PingFederate exchange. No end-to-end green result or 12-minute benchmark has been established.

## Delivery record

Keep this record current in the same commit as each task that changes a check, repair, provider path, feature probe, or operator flow. Record the behavior added, its verification evidence, and unresolved limits so future maintainers can extend the readiness system without reconstructing decisions from code review history.

| Task | Added or changed | Evidence and current limit |
|---|---|---|
| 1 — inventory and contract | Originally captured 46 unique runnable Demo Steps, validated inventory/build parity, and recorded source-backed configuration-only repairability. | Focused contract checks passed in the task commits; no live audit or scenario execution exists yet. |
| 2 — report model | Adds stable readiness status/count/timing/report contracts and redaction for direct reads and serialized output. Provider and service roles are recorded independently (`userSessionProvider`, `agentIdentityProvider`, `tokenIssuer`, `exchangeService`, `resourceServer`) with explicit role applicability. | Focused report suite passed 31/31; this proves report behavior only, not integration with live audit or execution. |
| 2A — PF Exchange #3 source prerequisite | Adds issuer-selected PF exchange with dedicated credentials and configured Basic/Post client auth, fail-closed PF configuration, policy-derived PF audience, exact native ID-JAG typing, PF variables in generated Gateway env, and sanitized failures. Review follow-up preserves only the sanitized JSON-RPC `-32005` scope-denial signal and bounded scope lists, then maps HTTP 200 and HTTP 403 forms into the BFF's existing scope-recovery path. Local and hosted PF Gateway environment drift is explicitly `release-only` until safe readback/repair exists. | Focused static Groovy source-contract and generator tests pass 18/18; BFF mapping tests pass 2/2. No Groovy runtime or live PF/SE exchange is available. The existing `mcpToolPipeline` characterization Jest process exits 134 without output under Node 22 and 26, so its end-to-end mapping assertion could not be rerun; a registered backend tool is checked in source metadata. |
| 3 — read-only configuration audit | Compares checked-in case, authorization, tool, and repairability contracts with PingOne, PingFederate, runtime, local Docker, and hosted SE audit adapters. It blocks on missing membership/grant/readback evidence and keeps hosted Gateway configuration read-only. | Focused audit suites passed 4 suites / 76 tests; topology and authz checks passed. Mocked contract coverage only: Authorize policy-tree parity remains unverified under the approved temporary waiver; supported hosted/PF admin readback, isolated worker execution, and live targets remain blockers. |
| 4 — preview-bound configuration repair | Builds a digest-bound preview from structured audit candidates. A single administrator confirmation may apply only uniquely identified, source-backed PingOne scope additions and app-scope grants. Apply rereads every object before the first write, passes a digest idempotency key, reads back each write, and records sanitized before/after evidence. | Focused mocked repair and audit suites prove stale targets, expiry, changed values, repeat confirmation, ambiguous IDs, readback, timeout retry, isolated feature-flag cleanup, and blocked Authorize writes. No live services are called. |
| 5 — isolated scenario execution | Adds an execution service that derives and records every core, route-variant, feature, and Attack Lab row. It preserves UC14b’s full-page behavior, validates observations against checked-in catalog and feature contracts, and redacts every report row. The checked-in manifest currently registers 21 feature checks separately from the UI list. Production has no worker factory: only a Jest-only adapter can create empty opaque contexts held by identity in a private map. A copied context, a worker-object collision, or a failed setup blocks its lane. | At this task's original scope, the contract derived 184 behavior/authorization groups, 734 core rows, four alternate-behavior rows, and 62 provider-feature rows (800 total). Mocked coverage proves feature behavior stages, static contract mismatch blocks, exact PF endpoint/credential-role and hop checks, opaque-context forgery rejection, sticky lanes, and deadline races. The runner emits category counts before dispatch, marks the report non-ready at exactly 12 minutes, aborts in-flight dispatch at 15 minutes, and records remaining rows as `not-run`. No production worker runtime exists, so real provider lanes and unresolved PF endpoint/credential-role contracts remain blocked. |
| 6 — orchestration and CLI | Adds the 15-minute phase coordinator and `demo:ready` CLI with preview-bound confirmation, re-audit, nonempty required prerequisite/audit inventories, a strict expected-manifest matrix gate, JSON output, and diagnostic target labeling. Progress callbacks awaited by the runner stop waiting at expiry; scenario-row progress is fire-and-forget. A repair apply already in flight is drained through administrator verification, isolated-worker setup, pre-write reads, mutation, readback, and restoration; failed readback evidence retains the observed value. | Focused BFF tests pass 48/48 and CLI tests pass 5/5; CLI help and the 46-entry/800-row contract pass. A manifest-ID uniqueness check found 800 unique IDs. The standalone CLI has no verified administrator identity, so typed digest confirmation cannot authorize writes; administrator-bound repair remains in the Admin Reset Demo flow. Any repair apply or cleanup call that ignores cancellation can delay the final NOT READY report beyond 15 minutes. No live readiness run, provider login, hosted target, reset, or repair was used. |
| 7 — admin job API | Adds owner-bound in-process jobs around the same readiness runner, with progress/report polling, digest-only one-time confirmation, shared admin auth/scope guards, redacted payloads, and a 20-minute in-memory TTL. Job routes do not reset demo state. | Route suite proves 401/403 guards, same-runner invocation, owner isolation, digest mismatch/replay rejection, TTL expiry, redaction, and no shell/reset call. No live target or provider is contacted by the test. |
| 8 — Admin sidebar reset gate | Starts the two-target job from Admin Reset Demo, polls progress and sanitized findings, displays every repair preview entry, and binds one confirmation to the preview digest. The preview progress snapshot includes initial audit findings before confirmation, and blocked object details include their IDs. The existing reset and logout run only after the job and report both prove READY for local and hosted targets. | Focused BFF runner/route suites pass 35/35 and the Admin sidebar reset suite passes 10/10. The UI build passes; the rendered finding/preview text has zero contrast failures in either theme (minimum 6.80:1 light, 8.47:1 dark). The full UI `npm run test:unit` attempt did not finish after seven minutes with one worker still active, so it was stopped without a suite result. Dashboard and customer reset paths remain separate. |
| 9 — disposable configuration proof and source candidates | Adds configuration-only fixture recovery proof and an offline build-time patch helper. Patch paths come only from exact catalog `codeRefs`; checks are separate trusted argv entries with `shell:false`; candidates run in a disposable Git worktree and are returned uncommitted for review. The helper is not reachable from `demo:ready` or Admin Reset Demo. | Commit `b903e32b5`; focused BFF readiness suites passed 4/4 and 101/101, CLI suites 10/10, and a real disposable UI build passed. Fresh scoped review passed. Caller preservation covers tracked and nonignored untracked files/content/modes plus HEAD/index; Git excludes the protected ADMIN7 fixture from enumeration and service filesystem reads. Ignored paths are outside the snapshot; the detached worktree is not an OS sandbox. Its final full-cluster refresh stalled after AST extraction; Task 10 later refreshed the combined graph with clustering skipped. |
| 10 — operator guide and final contract | Reconciles the master guide with current provider login/session setting names, local/SE selection, supported repairs, hard blockers, source-fix workflow, and recovery steps. Adds the README command link, corrects the stale UI contract snapshot to 21 feature checks/800 rows, and records the benchmark result without claiming a live green run. | At Task 10, checks covered its 46-step/800-row baseline; BFF 9 suites, 258 passed/1 skipped; UI 3 files, 12/12 tests; UI build passed; topology, authz, hygiene, CLI help, and Graphify AST update passed with clustering skipped. Full-size local/SE run and timing remain unmeasured because production provider workers/identity mappings, target runtime settings, and full Authorize readback are unavailable. |
| 11 — Privilege A2A Demo Step | Adds `UC46` as numbered Demo Step 25, a user-session-gated page link into Demo mode's A2A tab. The link does not send a chat prompt and ADMIN13's existing route is preserved. Current inventory: 47 steps, 185 behavior groups, 738 core rows, and 804 total rows. | Focused BFF readiness and use-case catalog/API suites pass 138/138; focused UI tests pass 64/64; authz contract and readiness build contract pass. UI production build and stable light/dark rendered contrast audit pass. No three-process A2A execution or full live readiness run was performed. |
| 12 — production runtime configuration contract | Defines and validates explicit local/SE target URLs and revision plus a unique URL, service token, and identity reference for each PingOne/PingFederate lane. The runner lists missing/invalid setting names without emitting configured values. | Focused config and runner suites pass 5/5 and 26/26. The CLI reports all missing settings and `provider-workers` without starting audit or execution. This does not provide the worker protocol/executor or target audit adapters; all live lanes remain blocked until those later tasks and dedicated identities are supplied. |
| 13 — worker client and runner integration | Adds authenticated HTTPS worker health/context/operation/cleanup calls; validates target/provider/identity, capability and isolated session identifiers; injects the production-only adapter; health-checks selected target lanes; passes target-specific runtime URLs/revision into audit; and blocks the affected matrix rows if context cleanup fails. | Focused checks passed: 4 suites, 97 passed/1 skipped. The CLI returned NOT READY in 13 ms with 12 missing-configuration blockers and did not start audit or matrix execution. The client protocol has no server implementation in the stack, and live identities, full target audit readbacks, all 800 live rows, and the timing gate remain unverified. |
| 14 — worker process and lane runtime (local PingOne lane) | `scripts/demo-readiness-worker.js` runs the worker service as a standalone HTTPS process for one lane. `demoReadinessWorkerRuntime.js` loads lane settings (`DEMO_READINESS_WORKER_{TARGET,PROVIDER,IDENTITY_REF,BFF_URL,EXPECTED_ISSUER}`) and supplies the `createSession` adapter over the provider login client. The bearer token and identity credentials (`DEMO_READINESS_<TARGET>_<PROVIDER>_{WORKER_TOKEN,USERNAME,PASSWORD,EXPECTED_SUBJECT}`) are read from the vault by name; env is used only when no `VAULT_PASSWORD` is set, and settings errors name variables, never values. `docker-compose.readiness.yml` is an opt-in overlay defining `readiness-bff-pingone` (presenter BFF definition with its own data volume, no published ports, no `api.ping.demo` alias, `OAUTH_PROVIDER=pingone`) and `readiness-worker-pingone`. | Focused Jest: worker runtime, worker server and login client suites 41/41. `docker compose config` of the overlay confirms the lane BFF and worker share no data volume, ports, or network alias with the presenter BFF, which is unchanged. **Not yet run:** the containers were never started, no real login was attempted, and the worker implements no case/feature operations (they return `unsupported-operation`, so readiness still blocks). Prerequisites not done here: add `https://readiness-bff-pingone:3001/api/auth/oauth/user/callback` as a redirect URI on the PingOne user app, and `vault:set` the four lane secrets. PingFederate and SE lanes are not defined. |
| 15 — first live PingOne lane login | Two login-client fixes found by the first real run. (1) PingOne redirects `/as/authorize` on `auth.pingone.*` to the sign-on page on `apps.pingone.*`; the client required one origin and stopped. The redirect now only has to be HTTPS — only its `flowId` is read, and credentials still go to the flow API on the authorize origin. (2) A never-signed-in identity is asked for `AGREEMENT_CONSENT_REQUIRED`; the client accepts once (`application/vnd.pingidentity.user.consent+json`, `{"accept": true}`) when the `agreement.accept` link is the same flow URL. | Live, 2026-10-01, local PingOne lane: login → authorize → flow check → consent → resume → lane-BFF callback → status reports authenticated with matching provider, issuer and subject for the dedicated `readiness-pingone-local` user. Focused Jest 45/45. The fix was exercised from a patched copy inside the worker container; the running worker picks it up only after this merges and the container restarts. Case/feature operations are still unimplemented. |
| 16 — agent-chip case operations | `demoReadinessCaseAdapter.js` gives the worker `verify-case-prerequisites` and `execute-case` for `agent-chip` steps. Prerequisites arm required flags through the lane BFF's own `/api/demo-flags/enable` (its config store is separate from the presenter's); A2A credentials, PAR configuration and group membership are reported `blocked`, not assumed. Execute posts the chip's trigger to `/api/agent/invoke` as the readiness identity and maps the response's token events onto the runner's evidence contract. A field the run did not produce is omitted so the contract check fails it. Runner fix: the resource-server check compared an object with `===`, which can never hold for evidence returned over HTTP; it now compares by value. | Live, 2026-10-01, local PingOne lane, Super Sports, validated with the runner's own `evidenceFailures`: **5 of 16 pass** — UC1, UC6 (DENY), UC17, UC20, UC25. Not passing: UC7/UC8/UC22 (no gateway audit; Authorize `INDETERMINATE`; UC22 returned STEP_UP where PERMIT is declared), UC30/UC31 (correct gateway verdict, but no route or Authorize reference in the events), UC24 (no token exchange in the response), UC-TOOL1 (outcome not recognised; audience differs from the contract), UC38/UC44 (actor-bound exchange, no adapter), UC2/UC2.6 (blocked on A2A credentials). Each needs its own investigation; some may be demo defects rather than adapter gaps. Focused Jest 115/115 across the adapter, worker runtime, worker server, execution service and runner suites. Exercised from an overlay copy in the worker container, not through the worker's HTTP API. Other execution modes and all feature probes remain unimplemented. |
| 17 — local target wiring | `npm run demo:ready:local` (`scripts/demo-readiness-local.sh`) supplies the local target's settings and runs `demo:ready --target local`: BFF `https://api.ping.demo:3001`, PingGateway `https://api.ping.demo:3036`, the PingOne decision-endpoints URL for the configured environment, expected revision = the main checkout's HEAD, and the PingOne worker at `https://api.ping.demo:4444` with its bearer token read from the vault (never printed). The readiness compose overlay publishes the worker on `127.0.0.1:4444` only. | Live, 2026-10-01: prerequisites went from 12 blocked checks to one. `worker-health:local:pingone` passes from the host; the only remaining blocker is `worker:local:pingfederate` (no PingFederate lane exists). The runner requires every prerequisite, including that lane, before it audits, and a clean audit before it runs any Demo Step, so the scenario matrix is still not reached through `demo:ready`. Also seen: the BFF's `/api/healthz` reports no revision, so the audit's `runtime:revision` check cannot pass yet. |
| 18 — local PingFederate lane | `scripts/pingfederate/provision-readiness-lane.js` (dry run by default, `--apply` to change) prepares the local PingFederate: it adds the lane BFF's redirect URI to the `ai-demo-pf-user` client, adds one user (`readiness-pingfederate-local`) to the `aiDemoPfSimplePcv` browser-login table, and writes the lane's four vault entries. The client's secret and the other users' rows are sent back as the admin API returned them. The compose overlay adds `readiness-bff-pingfederate` (`OAUTH_PROVIDER=pingfederate`, own data volume) and `readiness-worker-pingfederate` (loopback port 4445); the launcher supplies its worker settings. Login-client fix: the BFF sends `login_hint=demouser` in PingFederate mode, PingFederate then makes the username read-only and signs in as that user, so the client drops `login_hint` from the authorize URL it follows. | Live, 2026-10-01: PingFederate login completes for the readiness user — form, resume, lane-BFF callback, and status reports `pingfederate` with matching issuer and subject; the PingOne lane still signs in with the same client. `npm run demo:ready:local`: both `worker-health` prerequisites pass and the runner reaches the audit for the first time — 49 checks pass, 33 are blocked (PingOne Management API credentials unavailable to the audit ×11, PingFederate Admin API readback ×15, A2A/PAR target readback ×5, `runtime:health` HTTP 401, Gateway Exchange #3 expectation). The audit gate stops the run, so no Demo Step is executed through `demo:ready` yet. Login-client Jest 26/26. PingFederate case operations were not exercised: the exchange rows carry `pf_exact_exchange_contract_source_gap` and block before dispatch. |
| 19 — agent-chip steps: held outcomes and triage | Adapter: when PingOne Authorize answers `INDETERMINATE` with a step-up or approval obligation, the BFF records its reading in `mcpAuthorizeEvaluation.outcome` and the gateway's Authorize filter holds the call without writing an audit event. The adapter now reports that interpreted outcome (keeping the raw decision as `rawDecision`) and takes the route and actors for a held call from the challenge and the recorded decision request. An `INDETERMINATE` the BFF did not interpret is not promoted. CIBA steps are `blocked` in prerequisites: they complete only after a person approves on a device. | Live, 2026-10-01, local PingOne lane, Super Sports, stack unchanged before and after the run: **7 of 16 pass** — UC1, UC6, UC7, UC8, UC17, UC20, UC25. Blocked: UC22 (CIBA), UC2 and UC2.6 (A2A credentials). Failing, with the demo behaving correctly: UC30/UC31 (enforced by the gateway's Texas-scope policy on `/mcp/weather`; PingOne Authorize is not called, but the contract requires an Authorize decision and names the OLB server), UC24 (served from the public catalog with no token exchange; the contract expects one), UC-TOOL1 (outcome PERMIT; the contract's audience `mcpserver.ping.demo` belongs to the gateway's own downstream exchange, which the BFF response does not report). Not yet handled: UC38/UC44 (actor-bound exchange). Environment finding: UC-TOOL1 failed with "fetch failed" until the Compose `rag` services (weaviate, embeddings, tika, demo-mcp-code-search, llamaindex-agent) were started; the search index in the persisted volume is stale and is not rebuilt while chunks exist. Two earlier runs were discarded because another session redeployed the stack mid-run. Adapter and execution-service Jest 63/63. |
| 20 — enforcement profiles for tool steps | The catalog's authorization contract gains `enforcement`, derived from the use case's own declared evidence (`config/useCases.js` `evidence.tokenChain`): `public-catalog` when the chain declares only `tool-dispatched` (UC24), `gateway-policy` when it declares only `user-token` and `tool-dispatched` (UC30, UC31), otherwise `authorize`. The chain is a floor, not a full list (UC17 and UC25 omit `authorize-decision` but are Authorize-backed), so a step is narrowed only on an exact match. Runner: a `public-catalog` step must show the tool ran on the public path with exchange and Authorize skipped, and claim no Gateway or Authorize evidence; a `gateway-policy` step keeps every exchange check and the Gateway verdict, and must report Authorize as not applicable. Adapter: recognises the public path from the BFF's skipped events; for a gateway-policy audit that names no caller it takes the actors from the tokens sent to the gateway, and it reads the route from `where.route`. | Live, 2026-10-01, local PingOne lane, Super Sports, stack unchanged before and after: **10 of 16 pass** — UC1, UC6, UC7, UC8, UC17, UC20, UC24, UC25, UC30, UC31. Still blocked: UC22, UC2, UC2.6. Still failing: UC-TOOL1 (audience of the gateway's downstream exchange is not reported), UC38, UC44 (actor-bound exchange). All 15 readiness Jest suites pass (347 tests, plus the new enforcement tests: 22 in the adapter suite); `npm run demo:readiness:contract` still derives 804 rows. Known inaccuracy left in place: the contract names the OLB server as the weather tool's resource server, while the gateway audit reports backend `weather-mcp`; the resource-server check is satisfied by tool ownership and does not catch it. |
| 21 — workload-agent steps blocked; A2A cause found | Adapter: UC38 and UC44 are chips adapted from a page link, and both need a workload agent registered for the signed-in customer (UC38 also needs that customer to pass MFA). Run live they returned `agent_not_registered` (UC44) and `step_up_required` (UC38), so prerequisites now report them `blocked` with that reason instead of running them into a wrong outcome. A2A (UC2, UC2.6), cause found, not fixed: Exchange #1 succeeds but its token has no `act` (`act chain depth 0, expected exactly 1`). The A2A intermediate resource copies `act` from the user token's `may_act`, which PingOne projects from the user's `mayAct` attribute, and the bearer gate also needs the `a2a_tenant_id` claim, projected from `a2aTenantId`. The readiness user has neither. Both are writes to the PingOne user record (`POST /api/agent-authorization/grant` as that user, and `a2aTenantId` as the provisioner sets it on the demo users) and were not made by the worker. The steps stay blocked. | Adapter suite 24/24 with the two new cases. No live re-run: nothing that passes or fails changed, only two failures became blocks. Still open: UC-TOOL1's audience and the weather resource server both come from `config/useCases.js` and `scope-topology.json`, which the Demo Steps UI also reads. |
| 22 — audiences: declared mirrors (UC-TOOL1) | The contract compared the user token's audience with the audience of the resource that owns each required scope. That only held for scopes the user token carries (`read` on `enduser.ping.demo`). `code:search` is never on the user token: PingOne mints it at Exchange #1 on `agentgateway.ping.demo`, which `scope-topology.json` declares as a mirror of that scope. Catalog: each `scopeResources` entry gains `mirrorAudiences`, the resources whose `mirroredScopes` list the scope. Adapter: reports, per required scope, the audience of the token that actually held it (the user token, else Exchange #1). Runner: every required scope must be seen on its owning audience or a declared mirror, and no other audience may be reported. | Live, 2026-10-01, local PingOne lane, Super Sports, stack unchanged before and after: **11 of 16 pass** — UC-TOOL1 joins UC1, UC6, UC7, UC8, UC17, UC20, UC24, UC25, UC30, UC31. Blocked: UC22, UC2, UC2.6, UC38, UC44. All 15 readiness Jest suites pass (357 tests, 1 skipped); `npm run demo:readiness:contract` still derives 804 rows. |
| 23 — UC44 runs and fails on the actor chain | Setup, done through the lane BFF's own Agent Builder routes as the readiness user: registered workload agent `AI Agent - readiness-pingone-local` (AI_AGENT, `CLIENT_CREDENTIALS` + `TOKEN_EXCHANGE`) and granted it `agent:invoke` and `read` on the Agent Gateway resource. Without the grant the run stops at `actor_token_invalid` (PingOne `invalid_scope`). Adapter: UC38 is blocked on its MFA flag alone; UC44 is blocked only when `/api/agent-builder/state` shows no agent, otherwise it runs. Evidence gains `exchangeHops` (each exchanged token's subject and the actors in its own `act` claim) and reports the `actor-bound-standard-two-exchange` path when the BFF's `personal-agent-lookup` succeeded. | Live, 2026-10-01, local PingOne lane, Super Sports: UC44 returns PERMIT with the workload agent as the client of Exchange #1, and **fails the contract**: neither exchanged token carries an `act` claim, and the gateway audit and the Authorize request name the built-in AI Agent Actor (from the user's `may_act`), not the workload agent that acted. This is a product finding, not an adapter gap. UC38 blocked (MFA). 11 of 16 unchanged. All 15 readiness Jest suites pass (358 tests, 1 skipped). |
| 25 — MFA health behind STEP_UP steps | Found from a live demo failure ("Passkey registration failed — MFA operation failed", no OTP email) in a PingFederate session: the MFA, email and user-attribute services resolved the provider-aware token endpoint, so with the login provider on PingFederate they sent PingOne worker credentials to PingFederate and were rejected (`invalid_client`). They now use `getPingOneTokenEndpoint()`. Adapter: a step whose expected outcome is `STEP_UP` first calls `GET /api/auth/mfa/devices` as the lane identity and is `blocked` unless it answers 200, so a step-up that could never be completed no longer passes on the verdict alone. Not checked, because it needs a person: the passkey ceremony and entering a code. | Probe run before the fix, 2026-10-01: PingOne lane device list 200; PingFederate lane 500 (`list_devices_failed`) and challenge 502 (`mfa_service_unavailable`), the same failure the presenter hit. Readiness suites 15/15 (359 tests, 1 skipped); MFA/email/user-service suites 17/17 (100 tests). Open: a PingFederate session's subject is not a PingOne user id, so in-app PingOne MFA has no user to act on in that lane even with the token fix. |
| Provider-aware user login configuration | Selects PingOne or PingFederate readiness fields and user redirect URI for the existing BFF login route; public PKCE clients need no secret. | Focused provider, redirect, and user-login suites passed 4/4 and 57/57. No live PF registration or isolated worker login was tested; target/provider workers and private session stores remain missing. |

### Task 5 repair round 4: contract and dispatch boundary

The runner emits the derived category counts to its concrete inventory sink before
it creates a worker or dispatches any row. Provider setup itself is raced against
the same 15-minute hard deadline as dispatch. A setup timeout records the timed
out row and every queued row as `not-run`; the exact 12-minute boundary remains
`not-ready`.

Report applicability comes only from the checked-in feature row
`providerRoleApplicability` or the catalog row contract. A worker observation
can produce a sanitized mismatch finding, but cannot overwrite the report's
declared roles.

Feature dispatch is family-specific. A2A FM1/FM2/FM3, the five Attack Lab
effects, Agent IAM, CIMD, third-party AS, native ID-JAG, RAR, UC2 passenger
`invalid_target`, and UC-LEARN11 each call a dedicated worker adapter and
validate structured results. UC-LEARN11 compares the actual
`/llm-gateway?attack=prompt_injection` route, selected attack, exact prefilled
payload, submission denial code, and `reachedProvider: false`; manifest labels
alone cannot pass the probe.

The checked-in PF sources establish configuration-key and credential-role
references, including ordinary exchange, UC2/UC2.5's ordered ID-JAG then
Exchange #2 path, UC40 native ID-JAG, and UC38/UC44 actor-bound exchange. They
do **not** contain a committed literal PF issuer, token endpoint, or registered
client readback. The affected exchange-backed core and feature rows therefore
carry `pf_exact_exchange_contract_source_gap` with a remediation to commit a
supported provisioner or PF Admin API readback. At fix round 4, the two non-exchange PF
feature rows `PRIV-MALICIOUS-CONTENT` and `UC-LEARN11-PROMPT-INJECTION` did not
yet carry credential contracts. Fix round 5 below adds
`pf_exact_credential_contract_source_gap` to both and blocks them before worker
setup or dispatch. PF runtime coverage remains incomplete until these source
gaps close.

## Coverage inventory

The current executable Demo Steps list has 47 unique actions:

| Source lane | Source entries | Unique runnable entries | Notes |
|---|---:|---:|---|
| Primary | 25 | 25 | UC46 is numbered step 25 in the main Demo Steps sequence. |
| CIAM | 5 | 4 | UC2 is already present in Primary. |
| Privilege | 7 | 6 | UC40 is already present in Primary. |
| Admin | 13 | 12 | Admin1–Admin12 execute MCP operations; Admin13 is navigation. |
| **Total** | **50** | **47** | UC2 and UC40 are cross-lane duplicates; Admin13 is excluded. |

`UC46` is step 25 in the primary Demo Steps sequence. It opens `/privilege-mcp-client?view=demo&tab=a2a` behind the user session, selects the A2A tab without submitting a question, and leaves the three-process MainAgent → WorkerAgent → MCP flow for the presenter to start manually. Its A2A message carries the question and result, not a browser token or RFC 8693 delegation. The existing ADMIN13 destination remains `/privilege-mcp-client`.

The catalog currently derives 185 behavior-plus-authorization vertical groups and 738 core target/provider rows. UC46 adds four core rows. UC14b's full-page live-PAR variant adds four rows. A2A FM1/FM2/FM3 add 12 provider/target rows, and PF-DAVINCI-IK adds two PF-only target rows, for the original 756-row baseline. The five Privilege LLM Attack Lab probes add 20 rows. Agent IAM Core, PF CIMD valid/rejected, third-party AS allow/deny, invalid/expired/wrong-audience ID-JAG, valid/invalid RAR, UC2 passenger `invalid_target`, and UC-LEARN11 prompt injection add 28 rows. The runner derives 804 current rows by category rather than preserving a hand-maintained total.

The 47-step count and separate feature-probe count are distinct. Adding assertions to an existing PF session row, including PingGateway Exchange #3 checks, does not add a Demo Steps entry or a matrix row. A newly exposed UI action must be added to the UI list and inventory, receive a backend behavior/auth/config contract, and trigger fresh row-count and timing review.

### Task 5 repair round 5: PF feature contracts and independent family evidence

Every feature row that declares PingFederate applicability must carry either an
exact source-backed credential contract or a blocked contract with a named
source gap, including non-exchange probes. The checked-in PF profile does not
resolve the user-session role needed by `PRIV-MALICIOUS-CONTENT` or
`UC-LEARN11-PROMPT-INJECTION`; each therefore carries a
`pf_exact_credential_contract_source_gap`. Catalog validation rejects either
row if its credential contract is removed. Execution records the affected row
as blocked before worker creation, prerequisite setup, or family dispatch. No PF
issuer, endpoint, or credential literal is inferred from the source gap.

Family validator tests now use independent behavior observations and mutate or
remove each family's decision-specific facts to prove rejection. The
UC-LEARN11 test opens the checked-in `/llm-gateway?attack=prompt_injection`
route, reads the selected payload from the UI attack catalog, submits it
through the page's send handler, and feeds the structured response into the
family validator. It rejects a changed route, selected attack, payload, or
provider-reached outcome. Other family fixtures cover their own route,
authorization, schema, lifecycle, registration, exchange, or reachability
evidence instead of copying all `familyContract` values into a fake worker
observation.

Runnable IDs in source order:

- Primary (25): `UC24`, `UC1`, `UC8`, `UC7`, `UC14b`, `UC14`, `UC12`, `UC6`, `UC2`, `UC2.5`, `UC2.7`, `UC22`, `UC5`, `UC10`, `UC13`, `UC11`, `UC20`, `UC18`, `UC30`, `UC31`, `UC32`, `UC40`, `UC38`, `UC-TOOL1`, `UC46`.
- CIAM-only additions (4): `UC43`, `UC44`, `UC45`, `UC2.6`. `UC2` is already in Primary.
- Privilege-only additions (6): `UC17`, `UC25`, `UC-PAM-SETUP`, `UC-PAM-SCRIPT`, `UC-LEARN11`, `UC-TOOL3`. `UC40` is already in Primary.
- Admin executable entries (12): `ADMIN1` through `ADMIN12`. `ADMIN13` is listed in source but is navigation-only and excluded.

### Required provider and protocol lanes

- Establish dedicated PingOne user sessions and dedicated PingFederate user sessions for every applicable step, on both targets. Use isolated identities and sessions; never relabel one provider's session or flip the active BFF's process-wide OAuth provider.
- UC40 is PF-only. Its PingOne lane is explicitly not applicable because the native ID-JAG journey requires a PingFederate-authenticated session. UC40 proves the standalone native PF ID-JAG issuance and redemption path.
- PF UC2 and UC2.5 A2A use the internal ID-JAG Exchange #1 followed by access-token Exchange #2. UC2.5 uses its direct A2A endpoints. This is distinct from UC40. UC2.5 and UC2.6 verticals remain separate when A2A tools or Authorize groups differ.
- UC38/UC44 retain actor-bound standard two-exchange behavior, preserve the nested `act` chain and user subject, and do not use native ID-JAG. Their existing link-to-chip behavior remains part of the actual trigger contract.
- UC14b has two paths: its quick result is labeled simulated; the full-page flow proves the live PAR/RAR route.
- PF DaVinci Integration Kit login is a separate PF-only proof. A pre-existing PingOne session cannot satisfy the PF proof, and the PF callback must preserve PingOne tokens/session state.
- Keep the passenger A2A `invalid_target` failure as UC2 A2A evidence. It is not evidence for PingGateway Exchange #3 or UC40.

### Separate feature probes

Feature probes are registered alongside the 47 UI entries and state their provider roles and expected outcomes explicitly.

| Probe family | Coverage |
|---|---|
| A2A FM1 | Out-of-allowlist tool is refused before exchange. |
| A2A FM2 | Act-less bearer is refused and returns no protected tool data. |
| A2A FM3 | Nested delegation succeeds; expected exchange chain differs by provider. |
| PF-DAVINCI-IK | Dedicated PF login proof succeeds while any existing PingOne session is preserved. |
| Privilege Attack Lab | Tool Abuse, Tool Poisoning, Schema Violation, Inter-Agent Abuse, and Malicious Content. Derive outcome/attribution from the attack catalog; do not assume every case is a block. UC-LEARN11 checks both its prefilled prompt and the actual send/deny result. |
| PingOne Agent IAM Core | Identity, lifecycle, and delegated-token-exchange baseline. |
| PingFederate agent features | CIMD valid/rejected metadata, third-party authorization-server allow/deny exchange, valid ID-JAG issuance/redemption by the existing mock resource server plus invalid/expired/wrong-audience rejection, and RAR valid/invalid detail processing. Declare applicability by provider role. |

PAR is tested where a flow needs it; it is not a PF-only capability. All AI-agent feature paths use OAuth/JWT, not API keys.

## Check layers and sources of truth

### Checked-in contract

- `demo_api_ui/src/config/demoUseCaseSteps.js` supplies the five source lane lists and their executable action IDs.
- `demo_api_server/config/demoReadinessInventory.json` is the backend projection; the build check rejects divergence from the UI list.
- `demo_api_server/services/demoReadinessCatalog.js` joins those IDs to the backend use-case catalog, actual UI trigger/route semantics, expected outcomes, provider flows, and per-vertical authorization signatures.
- `demo_api_server/services/demoStepPrerequisites.js` supplies required feature flags, A2A credentials, PAR settings, and group prerequisites; the UI and BFF prerequisite helpers must agree.
- `scope-topology.json`, `ping-gateway/config/scope-topology.json`, vertical manifests, route/auth configuration, and registered MCP tool metadata define resource audiences, required scopes, and applicable Authorize group relationships.
- `demo_api_server/config/demoReadinessFeatureChecks.json` declares separate provider feature probes and expected results.
- `demo_api_server/config/demoReadinessRepairability.json` classifies drift by source, supported readback, repair mode, and operation.
- `demo_api_server/config/demoReadinessPingFederateProfiles.json` supplies the secret-free, role-specific PF key and role references. Until a committed provisioner or supported PF Admin API readback reconciles a role's literal registration, that row blocks READY.

The build/CI contract verifies all 47 unique runnable entries, exact source-lane order, no Admin13 execution, registered behavior/handler variants, vertical scope/resource/audience parity, group mapping, prerequisite parity, provider applicability, and repairability classification. It also catches any newly introduced UI step that lacks an expected outcome or dependency map.

### Local and hosted audits

The read-only audit covers every setting consumed by Agent Gateway and Authorize, including:

- resource audiences, scopes and mirrors, app grants, registered tool scopes, feature flags, A2A credentials, PAR settings, and vertical group membership;
- Gateway routes/auth configuration, loaded revision and config fingerprints, route health, effective audiences/scopes, and the expected Authorize decision endpoint references;
- complete live Authorize policy definitions when a supported read path exists. A successful decision call does not prove policy-tree parity. Current worker credentials cannot read the complete policy tree, so the check is reported as blocked and explicitly waived for now; the report must never describe the tree as verified. Decision endpoint references and every runtime Authorize decision remain required, and a reported mismatch or unexpected read failure still blocks READY;
- PingFederate role-specific OAuth grants, processor-policy refs, ATMs/restrictions, service-provider resource URIs, ID-JAG settings, exchange mappings, issuer/JWKS routing, DaVinci client/adapter, CIMD, third-party authorization-server, and RAR configuration through supported PF Admin APIs;
- local Docker health/config inspection through read-only commands. Hosted SE is audited and exercised, never deployed or updated by this workflow.

Missing credentials, unavailable targets, unsupported required readback, source/live disagreement, unknown drift, revision mismatch, or incomplete checks are blockers. The sole exception is the known full Authorize policy-tree read gap documented above. Never substitute a successful tool call for missing configuration readback.

### PingGateway Exchange #3: current release prerequisite

The active feature work adds PF Exchange #3 routing to existing PF session rows. Its contract is:

1. Select the exchange provider from the validated subject token's signed issuer. A PF issuer selects `PF_TOKEN_ENDPOINT` and the PF standard MCP exchanger; a PingOne issuer keeps `PINGONE_TOKEN_ENDPOINT` and `TE_CLIENT_*`.
2. If the subject issuer is PF but the PF endpoint or dedicated exchanger credentials are missing, fail closed with `pf_exchange_not_configured`. Never send that subject to PingOne or substitute PingOne credentials.
3. Generate Gateway `PF_ISSUER_URI`, `PF_TOKEN_ENDPOINT`, `PF_TE_CLIENT_ID`, `PF_TE_CLIENT_SECRET`, and `PF_TE_AUTH_METHOD` from the existing BFF PF config values. Default the auth method to `basic`, matching the PF standard-exchange service and setup contract; support Basic or Post only and fail closed on unsupported methods. Do not rely on a hand-edited ignored Gateway `.env`.
4. Require an HTTPS PF token endpoint whose scheme and authority match the issuer while retaining the configured token path. Follow the configured Basic or Post endpoint-auth method. Omit PingOne's `resource` request parameter for PF; PF derives the result audience from its processor policy, and the readiness runner must compare the issued audience to the expected backend.
5. Send `subject_token_type=access_token`, except use `id-jag` only when the JWT header `typ` is exactly `oauth-id-jag+jwt`. The requested token type remains access token. Preserve the user `sub` and nested A2A `act` claims.
6. Prove the end-to-end path with a registered backend MCP tool and its expected audience/result. An unregistered UI intent alias is an unknown-tool result, not proof of Exchange #3 success/failure.
7. Preserve JSON-RPC error code `-32005` as the stable `insufficient_scope` category. Gateway filters forward only bounded scope-name lists (`requiredScopes`, derived `missingScopes`, and `availableScopes`); discard backend messages and arbitrary error data. Apply this sanitization to HTTP 200 envelopes and HTTP 403 bodies. The BFF maps both HTTP forms to `mcp_insufficient_scope`, which the existing tool pipeline returns as the structured `mcp_scope_denied` response. Map every other MCP error to a fixed generic failure.
8. Keep logs free of raw subject/access tokens, authorization data, MCP session IDs, provider/backend response bodies, endpoint/resource values, and scope values. Returned errors contain only stable categories plus the bounded scope lists allowed by item 7.

Code review found the current Gateway filters fell through to PingOne when PF endpoint configuration was incomplete and could reuse PingOne exchanger credentials for PF; the local environment generator omitted the PF variables. The OLB filter also sent `subject_token_type=id-jag` for every PF subject, including ordinary PF access tokens, while Exchange #3 must choose `id-jag` only for a JWT header whose `typ` is exactly `oauth-id-jag+jwt`. The filters logged raw provider response bodies, and the OLB filter logged the MCP session ID. The first code review also found that PF's configured endpoint-auth method and processor-policy audience contract must be preserved. A follow-up review found that generic error sanitization would erase `-32005`, and a second review found the BFF discarded the preserved code on both HTTP status paths. Task 2A now keeps only that stable code and filtered scope lists, and the BFF maps both HTTP 200 and HTTP 403 envelopes to the existing scope-recovery outcome. Focused source-contract, generator, and BFF client tests pass; the existing full pipeline characterization test could not run because its Jest process exits 134 without output. PF Exchange #3 readiness remains blocked until supported readback verifies generated/local and hosted configuration and a production isolated worker proves a registered-tool call with the expected audience/result. These assertions attach to existing rows and do not change the 46-step count.

## Expected outcomes and step independence

Each row uses the catalog's declared expected result and the same trigger-specific action the UI invokes. Tool rows compare the real token issuer, policy subject, actor chain, resource audience, granted scopes, Gateway route/verdict, and Authorize decision. Store sanitized claim summaries, never tokens. Navigation and education rows prove the registered page/panel loads and state why Gateway/Authorize evidence does not apply. Admin1–12 assert the declared MCP operation and result.

Keep these regressions explicit:

- UC5's declared `DENY_403` and UC18's `DENY_429` cannot pass because an unrelated Gateway audience mismatch occurred.
- Derive UC38's page-route check from its declared trigger and verify the workload-agent page loads.
- For steps sharing mutable feature-flag or vertical test state, run a small standalone/normal/reverse sequence comparison and restore only test-changed state in `finally`. A cleanup failure fails readiness. Do not permute every case or reset presenter/live user data.

## Repair and source-fix boundaries

| Drift | Live readiness action |
|---|---|
| Missing, uniquely mapped PingOne scope or required app grant | May regenerate/apply only after a full exact preview, one admin confirmation, a pre-write reread, and successful API readback. |
| A required feature flag for one scenario | Arm only inside an isolated readiness worker; restore in `finally` and fail if restore fails. |
| Local generated PingGateway PF Exchange #3 env | `release-only` today. Task 4 may change this only if a tested in-process adapter regenerates from declared BFF values, safely restarts the local Gateway, and verifies loaded config after preview/confirmation. Never hand-edit the generated file or shell out from the BFF. |
| Hosted SE Gateway configuration | `release-only`, read-only. No cluster update or deployment. |
| PF client/SP profile, DaVinci adapter, or native ID-JAG config | Manual/release-only unless a supported exact-object write, idempotency, and readback have been proven and declared. |
| Full Authorize policy tree | Report blocked and waived/unverified under the user-approved temporary exception; never infer parity from observed decisions. Keep decision endpoint references and runtime decisions required. Any observed mismatch or unexpected read failure blocks READY. Remove the waiver when supported exact readback is available. |
| Unknown/ambiguous drift, missing credentials, or application code defect | Block the run and identify the exact fix. Never guess or broaden access. |
| Source-code defect | Separate build-time helper may produce an uncommitted patch in an isolated worktree, limited to declared code refs. Require focused tests/build and review. Never call it from readiness or Reset Demo. |

Every automatic change is bound to one digest of the displayed preview. Before writing, reread each object and reject changed, ambiguous, stale, or repeated plans. Record sanitized before/after evidence and verify through the source API. The live reset flow does not fix application code.

Task 4 represents repair candidates as `repairClass`, `target`, exact `object`,
`current`, `expected`, `sourceRef`, and `operation`. The plan digest includes the
selected target set plus every preview and blocked row, so an altered before/after
value or repair instruction requires a new preview and confirmation. A plan
expires after fifteen minutes. The apply path performs all candidate rereads
before calling any mutation adapter, then gives every automatic mutation the
digest as its idempotency key and requires source-API readback. A post-timeout
retry can finish without a second write when that pre-write reread already
matches the expected value.

The route that invokes apply must pass an authenticated administrator assertion
to the repair service's trusted confirmation verifier. A display name, email,
or other caller string is never confirmation. Automatic source classes select a
fixed `contractReader` from `demoReadinessRepairability.json`; that trusted
reader supplies the target object, expected value, source reference, and
operation from the declared configuration. Candidate fields must match that
contract, so an audit result cannot redirect a repair to another object or
source. The future route must construct these readers from checked-in target
configuration after its existing admin auth and scope checks.

Supported automatic repair classes are deliberately narrow:

- uniquely mapped missing PingOne resource scopes;
- uniquely mapped missing PingOne application grants; and
- required feature flags only through an isolated readiness worker that restores
  the prior worker value in `finally`.

Feature-flag adapters create opaque worker contexts themselves. The repair
service never accepts a worker label from a finding, restores the original
worker value after success, retry, or failure, and rereads that worker to prove
the restore before it reports success. Presenter runtime configuration is never
an eligible adapter target.

`manual` and `release-only` classes remain displayed as blocked rows with their
operator action. This includes PingOne Authorize policies, every PingFederate
profile, the local generated Gateway environment, application source defects,
and hosted SE Gateway configuration. Readiness does not create a local Gateway
adapter until an in-process regenerate, safe restart, and loaded-config readback
implementation exists. Hosted SE is read-only in every repair path.

## Disposable configuration proof and source candidates

Task 9 adds `demoReadinessBuildRepairService` as a separate build-time helper.
`validateConfigOnlyRecovery` accepts deterministic fixture adapters, creates a
temporary fixture directory, reproduces a supported scope/grant or isolated-worker
flag mismatch, and uses the existing exact-preview, apply, and readback repair
service. It requires the scenario to fail before repair and pass on retry. A flag
scenario retries while its isolated worker is armed; restoration and readback
finish before success is returned. Fixture disposal and directory removal run
after success and failure. Hashes of tracked and nonignored untracked application
source, including configuration code, must match before and after. The caller's
tracked/nonignored checkout, HEAD, and index are also verified. This proof supplies no live
PingOne/PingFederate adapters or presenter-state reset.

`prepareSourceFix` accepts an unresolved `source-defect`, a committed base
revision, an injected unified-diff provider, and a separately trusted test plan.
A recorded passing configuration recovery prevents a provider call. Case IDs and
`codeRefs` must match `config/useCases.js`; only existing declared application
source paths are eligible. Configuration, secrets, generated/build output,
traversal, symlinks, paths outside that allowlist, command payloads, binary diffs,
renames, and mode changes are rejected. Failure text cannot supply references or
test commands.

The candidate lives in a detached temporary git worktree. Trusted checks use
`{ command, args, cwd? }` argv entries with `shell: false`; `cwd` stays inside
that worktree. Choose meaningful focused tests for every affected service, UI
tests when applicable, and its build. The helper verifies the supplied plan; the
reviewer must assess whether that plan proves the case. Child processes receive
basic tool environment variables and `CI=true`, without inherited demo credentials.
The worktree is a source-isolation boundary, not an operating-system sandbox for
arbitrary code: use trusted local disposable checks.

Any failed test/build, changed candidate revision/index, unexpected source
mutation, or cleanup/preservation failure blocks the candidate. Success returns
only an uncommitted sanitized patch/diff, changed paths, check evidence, and a
suggested review action. Both passing and failed worktrees are removed. The
caller's source hash, HEAD, and index hash must remain unchanged. Redaction can
alter a hunk containing sensitive data; inspect the review output before applying
it through the normal reviewed change workflow.

Both interfaces verify the caller's tracked and nonignored untracked file contents,
paths, modes, HEAD, and index, and return that explicit preservation scope. The
Git enumeration receives an explicit literal exclusion for the protected Admin
fixture, and returned paths are filtered again before service filesystem stats
or reads. Git-ignored dependency/build/cache artifacts are excluded. Symlinks,
unsupported file types, unreadable files, or failed snapshots block rather than
claim preservation.

The offline CLI accepts explicit patch data and a separate trusted JSON plan:

```sh
npm run demo:build-fix -- --help
npm run demo:build-fix -- --case UC2.5 --base HEAD \
  --patch-file /path/to/candidate.diff --test-plan /path/to/trusted-checks.json
```

The JSON plan is an array of argv entries, for example
`[{"command":"npm","args":["run","build"],"cwd":"demo_api_ui"}]`; add the
focused service/UI test entries before the build. Exit 0 means the supplied
candidate checks passed and review evidence was captured; exit 1 is blocked and
exit 2 is invalid input. There is no model SDK or network patch provider. This
helper is never imported by `demo:ready`, the readiness runner, or Admin Reset
Demo, and never commits, stages, deploys, or repairs live configuration.

## Report, deadline, and operator flow

The report has stable check statuses (`pass`, `fail`, `blocked`, `not-run`), required/optional aggregation, counts, repairs, unfinished work, timing, and sanitized evidence. Each check records `userSessionProvider`, `agentIdentityProvider`, `tokenIssuer`, `exchangeService`, and `resourceServer` independently, with `providerApplicability` mapping `userLogin`, `agentIdentity`, `tokenIssuer`, `exchangeService`, and `resourceServer` roles to `required` or `not-applicable` and a source-contract reason for every exclusion. These fields contain stable nonsecret provider/service/resource identifiers; a generic provider label cannot represent cross-domain token flows. Deadline expiry is terminal: ready stays false, queued work becomes not-run, active work becomes blocked, and the report lists remaining rows. Redaction covers bearers/JWTs, credentials, cookies, authorization data, and session identifiers before persistence or display, including direct report reads and serialized output.

One run timer starts before prerequisites and includes audit, preview/confirmation wait, repair, re-audit, all applicable scenario rows, cleanup, and report. The target warning starts at 12 minutes; expiry is 15 minutes. Progress callbacks awaited by the runner and read-only phases stop waiting at expiry; scenario-row progress notifications are fire-and-forget. An apply operation already in flight is drained through administrator verification, isolated-worker setup, pre-write reads, mutation, readback, and restoration. Any of those calls without an enforced request timeout can keep the process pending past expiry. Such a run remains deadline-exceeded and NOT READY, and reset stays gated. The CLI and Admin job use the same runner. Admin routes require authentication, admin role or admin scope according to the shared auth middleware, and admin scope checks. The job confirmation is bound to the exact repair digest. Failed, blocked, stale, or expired jobs do not reset demo state or sign the administrator out.

## Current contract benchmark snapshot

The checked-in contract currently derives **804 expected rows**: 738 core rows, four alternate-behavior rows, and 62 provider-feature rows across the 47 Demo Steps and 21 separately registered feature checks. This is an expected inventory, not a count of live rows that passed.

The scenario scheduler currently processes one row at a time across targets and providers (effective scenario concurrency: one). The runner audits target families in parallel within a target and visits targets sequentially. No target/provider concurrency tuning is configured. The full local Docker plus hosted SE run was not executed: no production provider-isolated worker service or named readiness identity map is supplied, and other required readbacks remain incomplete. The runner now consumes configured target URLs/revision, but complete runtime audience/scope expectations and several supported readbacks are still missing. Complete Authorize policy-tree parity is also unavailable, but is explicitly waived as an unverified limitation for now. No live target login, repair, Reset Demo, or hosted cluster operation was attempted.

| Measurement | Result |
|---|---|
| Contract-derived expected matrix | 804 rows; 47 UI steps; 21 feature checks; 185 behavior/authorization groups |
| Active scenario rows | Not run; no live pass count |
| Target/provider scenario concurrency | 1 row globally; sequential target/provider lanes |
| Phase durations | Not measured (no end-to-end target run) |
| Scenario duration p50 / p95 | Not measured (no scenario rows executed) |
| Total readiness duration | Not measured (no end-to-end target run) |
| Timing gates | 12-minute target warning; 15-minute hard deadline |

There is no 12-minute readiness claim. A full-size run must execute and report every expected row, target/provider concurrency, completed phase times, p50/p95 scenario duration, and total duration before that claim can be made. Missing or unfinished rows remain NOT READY; do not skip rows to meet the budget.

The 12/15-minute gate covers readiness checks and only the narrow, confirmed configuration repairs listed above. It does not promise that an arbitrary application defect can be fixed within that window. `demo:build-fix` is a separate offline proposal that still requires focused tests/build and human review; it is never an automatic Reset Demo action. Unsupported configuration and source defects remain blockers until a reviewed fix is available.

## How to add a future check

1. Decide whether the new behavior is an existing UI step, a separate provider feature probe, or a configuration audit. Keep these categories distinct.
2. Link the exact source of truth: UI trigger, backend handler, expected-outcome catalog, topology/profile contract, live API readback, and test fixture. Do not copy an expectation only from a handoff note or current live state.
3. Declare target and provider roles, explicit non-applicability reasons, vertical applicability, auth/session requirements, token/exchange path, and expected positive or negative result.
4. Declare the evidence required to prove the result: actual registered route/tool, issuer/subject/actor summary, audience/scopes, Gateway decision, Authorize result, or page/panel behavior. Define why evidence is not applicable for non-tool rows.
5. Add the check to the appropriate inventory/feature manifest, include a focused failure test and a source/live drift test, recalculate the derived row count, and review impact on the 12/15-minute limits.
6. Add a repairability classification even if it is manual or release-only. Name the exact object, source, readback, operation, confirmation boundary, idempotency, and cleanup/restore behavior. If any is unknown, keep it blocked.
7. Ensure failure output and logs are redacted. Test serialized output and direct report reads for token, credential, cookie, authorization, and session values.
8. Update this guide and the implementation plan in the same task commit. Run the focused checks, inspect the staged paths, and commit the task separately.

## Current blockers and plan status

- **Authorize policy-tree readback:** unavailable with current worker permissions; explicitly waived and shown as unverified for now. Endpoint-reference and runtime decision checks remain required; a reported mismatch or unexpected read error still blocks READY.
- **PF Exchange #3:** Task 2A source changes and focused tests are complete, but no live PF exchange has been proved. Readiness remains blocked until supported readback verifies generated/local and hosted configuration and a production isolated worker proves the registered-tool audience/result. Local generated-environment repair remains release-only unless a safe in-process restart/readback adapter is proven.
- **PF profile contracts:** secret-free per-role source expectations are checked in, but live registration readback through a supported PF Admin API adapter is unavailable; live parity remains blocked.
- **Hosted SE:** read/execute only; remote repair/deploy is not permitted by repository policy.
- **Isolation, full matrix, timing:** the runner requires a separate provider-configured worker runtime with its own cookie jar and session store. The current BFF cannot create that safely while its OAuth provider is process-wide, so provider setup blocks rather than toggling it. The BFF user-login readiness and redirect settings now follow that process-wide provider, but no isolated worker login follows from this fix. The BFF-side HTTPS worker client, health checks, production adapter injection, target URL/revision wiring, and context cleanup gate are implemented. The corresponding worker runtime, all target readback adapters, live identities, all 800 live matrix rows, and a complete ≤12-minute benchmark remain unproved.
- **Authorize/PF readback:** complete Authorize policy-tree readback is unavailable with current worker permissions and covered only by the explicit temporary waiver. PF role expectations are checked in, but supported PF Admin API/hosted Gateway readback and live PF Exchange #3 registered-tool proof remain unavailable.
- **Local and hosted adapters:** the runner now passes configured BFF/Gateway/Authorize URLs and expected revisions to the runtime audit. Expected audience/scope contracts and supported live read paths remain incomplete, so both targets remain blocked.
- **Implementation sequence:** Tasks 1–10 are committed. Task 11 defines the target/lane configuration contract; Task 12 adds the BFF-side worker client, health preflight, target runtime wiring, and cleanup gating. Do not label readiness operational until the compatible worker service, target readbacks, all other required checks, full scenario execution, and final timing/security checks are proven. Keep the Authorize policy-tree waiver visible and remove it when supported readback is available.

Update this status table as each task is committed. Do not label the readiness workflow operational until audit, repair, execution, CLI, admin UI, all intended probes, and final timing/security checks are implemented and reviewed.


## Task 3 audit implementation

Task 3 adds the read-only audit service and a secret-free, role-specific
PingFederate contract. The service records repository, PingOne, PingFederate,
runtime, and local Docker findings using the readiness report row shape. It
uses argument-array `docker ps` and `docker inspect` only; it never starts,
stops, provisions, repairs, or deploys a target. The existing health and MCP
preflight probes can now be imported without running their CLIs.

The audit recognizes an incorrect declared value as a failed required check and
an unavailable or unauthorized management read as a blocked required check. The
known limitation that current worker credentials cannot read the complete live
Authorize policy tree is the sole user-approved exception: `policyReadback`
remains visible as blocked/unverified with `required: false`. A successful
decision is never accepted as proof of policy parity. Decision endpoint
references, scenario decisions, unexpected read errors, and any observed policy
mismatch remain required/blocking.

No committed PingFederate Admin API client or role-complete provisioner supplies
exact settings for every role. The new contract lists standard exchangers and
actors, A2A specialists, UC40 ID-JAG, DaVinci, CIMD, third-party AS, and RAR,
with unresolved fields marked explicitly. PingFederate readiness remains
blocked until each role has a committed expectation and supported API readback.

### Task 3 Fix Round 1

The audit now performs read-only PingOne Management API GET requests for
resources, applications, groups, and decision endpoints when target credentials
are supplied. It performs PingFederate Admin API GET requests for OAuth clients,
access-token managers, and authentication policies at the target's declared
PF Admin API base. It compares documented client role fields and records
unsupported SP, ID-JAG, DaVinci, RAR, and CIMD reads as required blocked
findings. The complete Authorize policy-tree read is explicitly unverified
under the temporary waiver; endpoint references and runtime decisions remain
required. Neither adapter makes a write or uses a successful runtime call as
configuration parity.

Local Gateway inspection parses docker ps and docker inspect output to compare
the PF issuer, endpoint authority/path, PF exchanger credential presence, and
generated-environment mount provenance. Hosted Gateway evidence must be
supplied by a supported target runtime read; omitted evidence blocks. Runtime
checks require declared BFF, Gateway, Authorize URLs and a revision, and never
default an expected revision to the observed value.

### Task 3 Fix Round 2

Gateway Exchange #3 checks require a checked-in expectation for the HTTPS PF
issuer, full token endpoint including path, client identifier, and generated
environment provenance. Local checks compare that expectation against parsed
read-only `docker ps`/`docker inspect` output without recording credential
values. Hosted SE checks require a target-specific supported readback adapter;
a configuration boolean, reachability response, or nonempty environment cannot
pass. A Gateway 5xx, missing audience/scope readback, missing revision, or
deadline-expired read blocks or marks the required row unfinished.

Each of the 47 repository rows now records its checked-in UI/BFF prerequisite
relationship: flags, A2A/PAR requirements, registered tool, scope/audience,
vertical authorization contract, and static prerequisite parity. A2A credential
and PAR application parity stay blocked until their declared target objects can
be read. PingOne reader errors produce blocking PingOne family rows while the
other target audits continue.

The PF profile contract no longer derives object names or grants from handoff
notes. Every role maps to a committed code/config reference and stays required
and blocked until an exact declared object contract and supported PF Admin API
field readback exist. The complete PingOne Authorize policy tree remains
explicitly unverified under the temporary waiver. PF grant/processor/ATM,
specialist, ID-JAG, DaVinci, CIMD, third-party AS, RAR, and JWT-audience fields
remain explicit blockers where committed sources do not define an exact
supported comparison.

### Task 3 Fix Round 3

`runtime:revision` accepts only the caller/target's declared expected revision;
an adapter-reported expectation cannot confirm its own observed revision. Root
and Gateway scope maps compare semantically, so source JSON object key order
does not cause drift. All 47 repository rows now include the twelve Admin rows:
they use their committed Admin auth, action, provider-flow, and expected-tool
contract rather than a nonexistent vertical prerequisite map.

The concrete PingOne Management API adapter reads exact declared resource
audiences, resource scopes, application grants, decision endpoints, and subject
group memberships. It calls `GET /users/{id}/memberOfGroups` for each declared
subject membership contract. Missing declared grant or subject/group contracts
block their family rows; declared exact sets fail on unexpected extras. The PF
Admin adapter continues to read clients, access-token managers, and
authentication policies, but its broad families remain blocked until a
committed exact field contract exists.

All injected read adapters receive a deadline-derived abort signal and are
wrapped by the audit deadline, including repository, PingOne, PF, runtime,
hosted Gateway, and local Docker adapters. `docker ps`/`docker inspect` retain
their read-only argument-array calls and bounded child-process timeouts. The
health-gate JSON helper combines its existing 10-second timeout with a caller
signal, preserving direct CLI behavior while allowing the audit deadline to
cancel the health read.
