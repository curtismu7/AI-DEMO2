# Task 5 execution report

## Status

Implemented the readiness execution contract and mocked provider-isolation
coverage. The implementation is intentionally fail closed for live provider
execution: the existing BFF has a process-wide `oauth_provider` and does not
provide a separate provider-configured worker runtime. The service accepts only
an injected worker that proves a matching provider plus isolated session and
cookie storage. It neither reads nor mutates the presenter BFF's provider
configuration, sessions, browser cookies, tokens, or administrator session.

## Delivered

- `demoReadinessExecutionService` derives every matrix row from the catalog and
  feature manifest, validates runtime prerequisites before dispatch, and returns
  sanitized outcome, provider-role, token/provenance, Gateway, and Authorize
  evidence.
- The committed inventory derives 182 unexpanded applicable rows, 184 runtime
  behavior-and-authorization groups, 734 core rows, four UC14b full-page rows,
  14 A2A/DaVinci feature rows, and 20 separately declared Privilege Attack Lab
  rows: 772 rows total.
- The five Attack Lab probes are registered separately from the 46 UI Demo
  Steps. Their contracts retain the catalog's distinct effects rather than
  treating each probe as a Privilege block.
- The readiness-only adapter in `routes/useCases.js` maps every supported
  scenario kind to an injected worker dispatcher and reuses the existing agent
  outcome classification.
- Mock coverage verifies separate provider sessions, no provider-setting
  mutation, prerequisite blocks, deadline behavior, lane-failure visibility,
  outcome/provenance mismatch failures, UC40 PF-only handling, and evidence
  redaction.

## Evidence

`CI=true npx jest tests/demoReadinessCatalog.test.js
tests/demoReadinessExecutionService.test.js
tests/demoReadinessProviderIsolation.test.js --forceExit`

Result: 3 suites passed, 31 tests passed, 1 dedicated local integration test
skipped because neither `READINESS_PINGONE_TEST_IDENTITY` nor
`READINESS_PINGFEDERATE_TEST_IDENTITY` was present.

`node --check` passed for the execution service and readiness adapter;
`git diff --check` passed. `graphify update .` completed its AST update and
reported pre-existing partial extraction warnings for unsupported Terraform and
unrelated syntax-error files.

## Remaining blocker

No safe provider-isolation runtime is implemented in current BFF configuration.
Creating one by changing global `oauth_provider`, borrowing a browser/admin
session, or relabeling a session would violate the readiness contract. Until a
separate provider-configured worker BFF/runtime is supplied, provider setup
blocks and live lanes cannot be reported as passing. The dedicated integration
test was not run because the two explicitly named readiness identities are not
configured.

## Fix round 1

The execution loop now consumes every derived category: core rows, UC14b
full-page variants, ordinary feature probes, and Attack Lab probes. Each
derived row produces one sanitized result and one `demoReadinessReport` check,
including sticky lane blocks and deadline `not-run` rows. The runner returns
the exact category counts, applies the 12-minute target and 15-minute hard
limit, and never drops later rows to make the timing result look green.

Worker isolation now requires distinct worker-owned `runtimeId`, `cookieJarId`,
and `sessionStoreId`; a collision or provider setup failure blocks the whole
target/provider lane. Execution no longer supplies missing evidence from the
requested provider. Required observations include user-session and agent
identity providers, issuer, subject, actor chain, exchange service and
provenance, resource server, role applicability, audiences/scopes, tool,
Gateway and Authorize evidence. PF rows additionally validate HTTPS
issuer/endpoint authority, PF-only credential reference, fail-closed
configuration, subject-token type, and registered-tool result. Case-specific
paths distinguish ordinary exchange, A2A’s internal ID-JAG hop, native UC40,
and UC38/44’s actor-bound standard flow.

The feature manifest now registers PingOne Agent IAM Core, PF CIMD
valid/rejected, third-party AS allow/deny, native ID-JAG invalid/expired/wrong
audience, RAR valid/invalid, UC2 passenger `invalid_target`, and the
UC-LEARN11 prefill/send/deny/provider-not-reached probe. Together with the
existing entries, the derived full matrix is 800 rows. These remain strict
mocked contracts until a safe isolated provider runtime and named readiness
identities are available.

Fix-round focused evidence:

`CI=true npx jest tests/demoReadinessCatalog.test.js
tests/demoReadinessExecutionService.test.js
tests/demoReadinessProviderIsolation.test.js --forceExit`

Result: 3 suites passed, 37 tests passed, 1 named-identity integration test
skipped. No hosted services, Docker Compose, deployment, or provider login was
used.

## Fix round 2

Worker isolation now requires a factory explicitly marked by the readiness
adapter and opaque, object-identity-distinct `runtime`, `cookieJar`, and
`sessionStore` handles. String identifiers are not accepted. Reusing any
handle across lane creation, including for a matching provider, blocks setup;
a setup failure remains sticky for that target/provider lane. No local worker
adapter is configured, so the actual provider lanes remain blocked rather than
claiming isolation from a self-asserted runtime.

Core evidence is compared with static catalog contracts for provider roles,
issuer, exchange service/provenance, resource server, Authorize role,
audiences, scopes, selected tool, Gateway, and Authorize decision. UC2/UC2.5
PF rows require an intermediate ID-JAG then Exchange #2 access token. UC38/44
require the same observed user subject and full actor chain at both exchange
hops. PF requires `configurationComplete === true`, a `pf:` credential
reference, HTTPS issuer/endpoint on one authority, correct token type, and a
registered-tool result where applicable.

Feature probes now call a mocked prerequisite verifier and compare its exact
configuration dependency set, required evidence set, and provider-role
applicability with the declared feature manifest. Mock coverage executes every
new family: Agent IAM, CIMD valid/rejected, third-party AS allow/deny, native
ID-JAG invalid/expired/wrong-audience, RAR valid/invalid, UC2
`invalid_target`, and UC-LEARN11 prefill/send/deny/provider-not-reached.
Exchange-backed feature probes require Gateway and Authorize observations.

The final report exposes exact category counts, `targetWarning`, and a
non-ready state after the 12-minute target; the 15-minute cutoff still records
all remaining rows as `not-run`.

Fix-round focused evidence:

`CI=true npx jest tests/demoReadinessExecutionService.test.js
tests/demoReadinessProviderIsolation.test.js --forceExit`

Result: 2 suites passed, 24 tests passed, 1 named-identity integration test
skipped. The named readiness identities were absent; no login integration,
other identity, hosted service, Docker Compose, deployment, or provider call
was used.

Final focused verification after report-category serialization:

`CI=true npx jest tests/demoReadinessReport.test.js
tests/demoReadinessCatalog.test.js tests/demoReadinessExecutionService.test.js
tests/demoReadinessProviderIsolation.test.js --forceExit`

Result: 4 suites passed, 75 tests passed, 1 named-identity integration test
skipped.

## Fix round 3

The production execution service no longer exports or accepts a worker-factory
registration helper. It has no production worker factory, so it blocks provider
setup. Jest alone can supply a test adapter during unit tests. Returned contexts
are empty opaque objects stored in a private `WeakMap`; an object copied from a
known context is rejected. Worker runtime, cookie-jar, and session-store object
identity remains collision-checked, and no request data can enable a test
adapter.

The feature manifest now has checked-in contracts for every probe: provider
flow, exchange service, resource, tool, audience, scopes, Gateway/Authorize
applicability, expected decision, and behavior stages. Execution compares
observations with these declarations and stores the declared provider-role map
on the report row. There are no generic readiness tool/resource/role defaults.
PF token-exchange rows require an exact issuer, endpoint, and credential role;
unresolved production PF contracts block rather than pass.

PF A2A verifies ordered `exchange1-id-jag` then
`exchange2-access-token` hops with the same subject and ordered actor chain.
UC38/44 uses the same strict ordered-chain comparison. The runner emits the
category inventory before dispatch, marks the exact 12-minute boundary
non-ready, races worker calls with an abort signal at the 15-minute deadline,
and records the timed-out and queued rows as `not-run` even if a worker ignores
the signal.

Focused evidence:

`CI=true npx jest tests/demoReadinessExecutionService.test.js
tests/demoReadinessProviderIsolation.test.js --forceExit`

Result: 2 suites passed, 27 tests passed, 1 named-identity integration test
skipped. The named readiness identities remain absent; no provider login,
hosted service, Docker Compose, deployment, or push was used.

Final scoped verification:

`CI=true npx jest tests/demoReadinessReport.test.js
tests/demoReadinessCatalog.test.js tests/demoReadinessExecutionService.test.js
tests/demoReadinessProviderIsolation.test.js --forceExit`

Result: 4 suites passed, 78 tests passed, 1 named-identity integration test
skipped. `graphify update .` completed after the change; it reported the
repository's existing Terraform-parser dependency warning and partial
extraction warnings for unrelated malformed files.

## Fix round 4

The execution report now takes provider-role applicability only from the
checked-in row contract: `row.check.providerRoleApplicability` for a feature,
or the catalog's `providerRoleApplicability` for a core row. A worker's map is
retained only as sanitized observed evidence and cannot rewrite the report row.

The catalog attaches a PF key-and-role contract to every PF core row. Ordinary
PF exchange, UC2/UC2.5's ordered ID-JAG then access-token Exchange #2 path,
UC40 native ID-JAG, and UC38/UC44 actor-bound standard exchange all identify
the source configuration keys and profile roles. Each PF exchange-backed
feature contract does the same. The checked-in profile explicitly marks those
roles unresolved, and the runtime sources contain keys rather than literal
issuer, token endpoint, or registration values. Therefore these contracts use
`status: "blocked"` and `pf_exact_exchange_contract_source_gap`, with a
specific remediation to commit a supported PF provisioner or Admin API
readback. The runner blocks those rows before dispatch. This is an unresolved
source contract gap, so PF runtime coverage is not described as complete.

Feature execution no longer calls a generic feature adapter. Each family has a
dedicated worker method and structured validator: A2A FM1–FM3; all five Attack
Lab effects; PingOne Agent IAM; CIMD valid/rejected; third-party AS allow/deny;
native ID-JAG invalid/expired/wrong-audience; RAR valid/invalid; UC2 passenger
`invalid_target`; and UC-LEARN11. UC-LEARN11 parses the selected route, compares
the prefilled prompt injection payload, submits the probe, and verifies
`llm_policy_denied` with the provider not reached. Test-only ready PF fixtures
exercise the behavior validators without enabling a production provider or
claiming that the blocked checked-in PF lanes passed.

The runner writes category counts to a concrete token-free inventory sink before
worker setup. It races worker-context creation and row dispatch against the
15-minute limit, aborts both on expiry, and returns the timed-out plus queued
rows as `not-run`. At exactly 12 minutes, the run is still `not-ready`.
Production remains fail closed: it has no provider worker factory and does not
toggle `oauth_provider`, borrow browser/admin sessions, or expose tokens.

Focused evidence after this repair:

`CI=true npx jest tests/demoReadinessCatalog.test.js
tests/demoReadinessExecutionService.test.js
tests/demoReadinessProviderIsolation.test.js
tests/demoReadinessReport.test.js --forceExit --runInBand`

Result: 4 suites passed, 88 tests
passed, 1 named-identity integration test skipped. No provider login, live
service, Docker Compose, deployment, or push was used.
