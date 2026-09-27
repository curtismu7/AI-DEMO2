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
