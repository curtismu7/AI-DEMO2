# Demo Readiness Master Guide

This is the living human reference for the demo readiness checks, repairs, operator flow, and extension process. The checked-in inventories, topology, use-case definitions, feature manifests, profile contracts, and implementation are authoritative; this guide explains how they fit together. Every task that changes a check, repair class, provider path, feature probe, or operator flow updates this file in the same commit.

## Goal and current status

The readiness workflow will check local Docker and hosted SE, show every finding, offer one digest-bound repair preview, apply only approved source-backed configuration changes, re-audit, and execute every required Demo Step and feature probe. A full green result requires every applicable target/provider/scenario row to pass before the 15-minute hard deadline. The target duration is 12 minutes. The run must list unfinished rows and return NOT READY when it cannot complete; it must not skip cases to fit the budget.

The workflow also has a separate command users can run directly and an Admin sidebar Reset Demo integration. Only the Admin sidebar action may launch privileged readiness repair. It performs the existing reset/sign-out cleanup only after full readiness. The live readiness path never edits application source. A separate build-time helper may propose a source patch in an isolated worktree for review after focused tests/build pass; it never commits or deploys.

The current branch has the 46-case inventory/build contract, report model, two-target audit, and confirmed-repair service. Task 5 adds a mocked execution runner and a provider-isolation boundary, but no separate provider-configured worker BFF/runtime is currently supplied by the local stack. That boundary therefore blocks each unavailable lane instead of reusing a presenter or administrator session or changing the process-wide provider. Task 2A implements PF Exchange #3 source routing and environment generation; its focused source-contract checks do not prove a live PingFederate exchange. No end-to-end green result or 12-minute benchmark has been established.

## Delivery record

Keep this record current in the same commit as each task that changes a check, repair, provider path, feature probe, or operator flow. Record the behavior added, its verification evidence, and unresolved limits so future maintainers can extend the readiness system without reconstructing decisions from code review history.

| Task | Added or changed | Evidence and current limit |
|---|---|---|
| 1 — inventory and contract | Captures all 46 unique runnable Demo Steps, validates inventory/build parity, and records source-backed configuration-only repairability. | Focused contract checks passed in the task commits; no live audit or scenario execution exists yet. |
| 2 — report model | Adds stable readiness status/count/timing/report contracts and redaction for direct reads and serialized output. Provider and service roles are recorded independently (`userSessionProvider`, `agentIdentityProvider`, `tokenIssuer`, `exchangeService`, `resourceServer`) with explicit role applicability. | Focused report suite passed 31/31; this proves report behavior only, not integration with live audit or execution. |
| 2A — PF Exchange #3 source prerequisite | Adds issuer-selected PF exchange with dedicated credentials and configured Basic/Post client auth, fail-closed PF configuration, policy-derived PF audience, exact native ID-JAG typing, PF variables in generated Gateway env, and sanitized failures. Review follow-up preserves only the sanitized JSON-RPC `-32005` scope-denial signal and bounded scope lists, then maps HTTP 200 and HTTP 403 forms into the BFF's existing scope-recovery path. Local and hosted PF Gateway environment drift is explicitly `release-only` until safe readback/repair exists. | Focused static Groovy source-contract and generator tests pass 18/18; BFF mapping tests pass 2/2. No Groovy runtime or live PF/SE exchange is available. The existing `mcpToolPipeline` characterization Jest process exits 134 without output under Node 22 and 26, so its end-to-end mapping assertion could not be rerun; a registered backend tool is checked in source metadata. |
| 4 — preview-bound configuration repair | Builds a digest-bound preview from structured audit candidates. A single administrator confirmation may apply only uniquely identified, source-backed PingOne scope additions and app-scope grants. Apply rereads every object before the first write, passes a digest idempotency key, reads back each write, and records sanitized before/after evidence. | Focused mocked repair and audit suites prove stale targets, expiry, changed values, repeat confirmation, ambiguous IDs, readback, timeout retry, isolated feature-flag cleanup, and blocked Authorize writes. No live services are called. |
| 5 — isolated scenario execution | Adds an execution service that derives and records every core, route-variant, feature, and Attack Lab row. It preserves UC14b’s full-page behavior, validates observations against checked-in catalog and feature contracts, and redacts every report row. Production has no worker factory: only a Jest-only adapter can create empty opaque contexts held by identity in a private map. A copied context, a worker-object collision, or a failed setup blocks its lane. The manifest declares feature provider flow, exchange service, resource, tool, audience, scope, Gateway/Authorize applicability, behavior stages, and provider roles. | Mocked coverage proves feature behavior stages, static contract mismatch blocks, exact PF endpoint/credential-role and hop checks, opaque-context forgery rejection, sticky lanes, and deadline races. The runner emits category counts before dispatch, marks the report non-ready at exactly 12 minutes, aborts in-flight dispatch at 15 minutes, and records remaining rows as `not-run`. No production worker runtime exists, so real provider lanes and unresolved PF endpoint/credential-role contracts remain blocked. |

## Coverage inventory

The current executable Demo Steps list has 46 unique actions:

| Source lane | Source entries | Unique runnable entries | Notes |
|---|---:|---:|---|
| Primary | 24 | 24 | All remain in the executable inventory. |
| CIAM | 5 | 4 | UC2 is already present in Primary. |
| Privilege | 7 | 6 | UC40 is already present in Primary. |
| Admin | 13 | 12 | Admin1–Admin12 execute MCP operations; Admin13 is navigation. |
| **Total** | **49** | **46** | UC2 and UC40 are cross-lane duplicates; Admin13 is excluded. |

The catalog currently derives 184 behavior-plus-authorization vertical groups and 734 core target/provider rows. UC14b's full-page live-PAR variant adds four rows. A2A FM1/FM2/FM3 add 12 provider/target rows, and PF-DAVINCI-IK adds two PF-only target rows, for the original 752-row baseline. The five Privilege LLM Attack Lab probes add 20 rows. Agent IAM Core, PF CIMD valid/rejected, third-party AS allow/deny, invalid/expired/wrong-audience ID-JAG, valid/invalid RAR, UC2 passenger `invalid_target`, and UC-LEARN11 prompt injection add 28 rows. The runner derives 800 current rows by category rather than preserving a hand-maintained total.

The 46-step count and separate feature-probe count are distinct. Adding assertions to an existing PF session row, including PingGateway Exchange #3 checks, does not add a Demo Steps entry or a matrix row. A newly exposed UI action must be added to the UI list and inventory, receive a backend behavior/auth/config contract, and trigger fresh row-count and timing review.

Runnable IDs in source order:

- Primary (24): `UC24`, `UC1`, `UC8`, `UC7`, `UC14b`, `UC14`, `UC12`, `UC6`, `UC2`, `UC2.5`, `UC2.7`, `UC22`, `UC5`, `UC10`, `UC13`, `UC11`, `UC20`, `UC18`, `UC30`, `UC31`, `UC32`, `UC40`, `UC38`, `UC-TOOL1`.
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

Feature probes are registered alongside the 46 UI entries and state their provider roles and expected outcomes explicitly.

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
- Task 3 will add a secret-free, role-specific PingFederate profile contract. Until a role has a reconciled, authoritative expectation, that role is undocumented and blocks READY.

The build/CI contract verifies all 46 unique runnable entries, exact source-lane order, no Admin13 execution, registered behavior/handler variants, vertical scope/resource/audience parity, group mapping, prerequisite parity, provider applicability, and repairability classification. It also catches any newly introduced UI step that lacks an expected outcome or dependency map.

### Local and hosted audits

The read-only audit covers every setting consumed by Agent Gateway and Authorize, including:

- resource audiences, scopes and mirrors, app grants, registered tool scopes, feature flags, A2A credentials, PAR settings, and vertical group membership;
- Gateway routes/auth configuration, loaded revision and config fingerprints, route health, effective audiences/scopes, and the expected Authorize decision endpoint references;
- complete live Authorize policy definitions when a supported read path exists. A successful decision call does not prove policy-tree parity. Current worker credentials cannot read the complete policy tree, so full READY remains blocked until supported readback is available;
- PingFederate role-specific OAuth grants, processor-policy refs, ATMs/restrictions, service-provider resource URIs, ID-JAG settings, exchange mappings, issuer/JWKS routing, DaVinci client/adapter, CIMD, third-party authorization-server, and RAR configuration through supported PF Admin APIs;
- local Docker health/config inspection through read-only commands. Hosted SE is audited and exercised, never deployed or updated by this workflow.

Missing credentials, unavailable targets, unsupported readback, source/live disagreement, unknown drift, revision mismatch, or incomplete checks are blockers. Never substitute a successful tool call for missing configuration readback.

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

Code review found the current Gateway filters fell through to PingOne when PF endpoint configuration was incomplete and could reuse PingOne exchanger credentials for PF; the local environment generator omitted the PF variables. The OLB filter also sent `subject_token_type=id-jag` for every PF subject, including ordinary PF access tokens, while Exchange #3 must choose `id-jag` only for a JWT header whose `typ` is exactly `oauth-id-jag+jwt`. The filters logged raw provider response bodies, and the OLB filter logged the MCP session ID. The first code review also found that PF's configured endpoint-auth method and processor-policy audience contract must be preserved. A follow-up review found that generic error sanitization would erase `-32005`, and a second review found the BFF discarded the preserved code on both HTTP status paths. Task 2A now keeps only that stable code and filtered scope lists, and the BFF maps both HTTP 200 and HTTP 403 envelopes to the existing scope-recovery outcome. Focused source-contract, generator, and BFF client tests pass; the existing full pipeline characterization test could not run because its Jest process exits 134 without output. PF Exchange #3 readiness remains blocked until Task 3 can read back generated/local and hosted configuration and Task 5 proves a registered tool call with the expected audience/result. These assertions attach to existing rows and do not change the 46-step count.

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
| Full Authorize policy tree | Block READY until a supported read path exists; do not infer policy correctness from observed decisions. |
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

## Report, deadline, and operator flow

The report has stable check statuses (`pass`, `fail`, `blocked`, `not-run`), required/optional aggregation, counts, repairs, unfinished work, timing, and sanitized evidence. Each check records `userSessionProvider`, `agentIdentityProvider`, `tokenIssuer`, `exchangeService`, and `resourceServer` independently, with `providerApplicability` mapping `userLogin`, `agentIdentity`, `tokenIssuer`, `exchangeService`, and `resourceServer` roles to `required` or `not-applicable` and a source-contract reason for every exclusion. These fields contain stable nonsecret provider/service/resource identifiers; a generic provider label cannot represent cross-domain token flows. Deadline expiry is terminal: ready stays false, queued work becomes not-run, active work becomes blocked, and the report lists remaining rows. Redaction covers bearers/JWTs, credentials, cookies, authorization data, and session identifiers before persistence or display, including direct report reads and serialized output.

One run timer starts before prerequisites and includes audit, preview/confirmation wait, repair, re-audit, all applicable scenario rows, cleanup, and report. The target warning starts at 12 minutes; expiry is 15 minutes. The CLI and Admin job use the same runner. Admin routes require authentication, admin role, and admin scope. The job confirmation is bound to the exact repair digest. Failed, blocked, stale, or expired jobs do not reset demo state or sign the administrator out.

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

- **Authorize policy-tree readback:** unavailable with current worker permissions; full READY remains impossible until supported.
- **PF Exchange #3:** Task 2A source changes and focused tests are complete, but no live PF exchange has been proved. Readiness remains blocked until Task 3 can read back both generated/local and hosted configuration and Task 5 proves the registered-tool audience/result. Local generated-environment repair is release-only unless Task 4 proves a safe in-process restart/readback adapter.
- **PF profile contracts:** complete secret-free per-role expectations do not yet exist; Task 3 must add and reconcile them before live parity can pass.
- **Hosted SE:** read/execute only; remote repair/deploy is not permitted by repository policy.
- **Isolation, full matrix, timing:** the runner requires a separate provider-configured worker BFF/runtime with its own cookie jar and session store. The current BFF cannot create that safely while its OAuth provider is process-wide, so provider setup blocks rather than toggling it. All 46 live step executions, remaining feature probes, and a complete ≤12-minute benchmark remain unproved.
- **Implementation sequence:** Tasks 1, 2, and the Task 2A PF source prerequisite are committed. Tasks 3–10 and final integration review remain. The live PF Exchange #3 readback and registered-tool proof remain in Tasks 3 and 5.

Update this status table as each task is committed. Do not label the readiness workflow operational until audit, repair, execution, CLI, admin UI, all intended probes, and final timing/security checks are implemented and reviewed.


## Task 3 audit implementation

Task 3 adds the read-only audit service and a secret-free, role-specific
PingFederate contract. The service records repository, PingOne, PingFederate,
runtime, and local Docker findings using the readiness report row shape. It
uses argument-array `docker ps` and `docker inspect` only; it never starts,
stops, provisions, repairs, or deploys a target. The existing health and MCP
preflight probes can now be imported without running their CLIs.

The audit recognizes an incorrect declared value as a failed required check and
an unavailable or unauthorized management read as a blocked required check.
The current PingOne worker can list decision endpoints but cannot read the
complete live Authorize policy tree. A successful decision is never accepted
as proof of policy parity, so `policyReadback` remains blocking.

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
unsupported SP, ID-JAG, DaVinci, RAR, CIMD, and policy-tree reads as required
blocked findings. Neither adapter makes a write or uses a successful runtime
call as configuration parity.

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

Each of the 46 repository rows now records its checked-in UI/BFF prerequisite
relationship: flags, A2A/PAR requirements, registered tool, scope/audience,
vertical authorization contract, and static prerequisite parity. A2A credential
and PAR application parity stay blocked until their declared target objects can
be read. PingOne reader errors produce blocking PingOne family rows while the
other target audits continue.

The PF profile contract no longer derives object names or grants from handoff
notes. Every role maps to a committed code/config reference and stays required
and blocked until an exact declared object contract and supported PF Admin API
field readback exist. The complete PingOne Authorize policy tree and PF
grant/processor/ATM, specialist, ID-JAG, DaVinci, CIMD, third-party AS, RAR,
and JWT-audience fields remain explicit blockers where committed sources do not
define an exact supported comparison.

### Task 3 Fix Round 3

`runtime:revision` accepts only the caller/target's declared expected revision;
an adapter-reported expectation cannot confirm its own observed revision. Root
and Gateway scope maps compare semantically, so source JSON object key order
does not cause drift. All 46 repository rows now include the twelve Admin rows:
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
