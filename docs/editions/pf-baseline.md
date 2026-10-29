# PingFederate edition: readiness baseline

Status: LIVE RUN, LOCAL TARGET, 2026-10-29. No PingFederate scenario was executed. The PingFederate configuration matches its committed baseline, but every PingFederate scenario row was blocked before dispatch by the readiness contract itself (see "Why every PingFederate row is blocked"). So no id has a PingFederate pass or fail yet. Spec: `docs/superpowers/specs/2026-10-03-edition-split-design.md`.

Run: `npm run demo:ready -- --target local --json` through the BFF lane (`DEMO_READINESS_BFF_URL` + an admin service token), BFF on main `66d4071f1`. Report run id `299f6de9-e110-46b6-b107-be86f09d3b1d`, scenario matrix 298 s of the 720 s target. One target is diagnostic only, so the run is `NOT READY` by design. The SE lane has no workers or settings yet and was not run.

Real id count: 100 (`demo_api_server/config/auth-requirements.json` `useCases`: 87 use cases + 13 admin steps). The previous baseline listed 84; 16 ids were added since (UC-LEARN14 to UC-LEARN19, UC-LOGIN, UC-LOGIN-PF, UC-LOGIN-AIC, UC-AIC-TX, UC-OBO, UC48, UC46A, UC9A, UC-MUSE1, UC-MUSE2). The scenario matrix has PingFederate rows for 52 of the 100; the other 48 have no readiness scenario.

Totals (PingFederate, per id): pass 0, fail 0, not-applicable 0, not-run 100 (52 blocked before dispatch, 48 with no scenario).

Whole matrix, local target: 411 rows. PingFederate: 210 rows, all `blocked` / `not-dispatched`. PingOne: 87 pass, 66 fail, 48 blocked (shown per id for comparison only; it is not a PingFederate result).

Configuration audit (same run, before and after the repair preview): all 12 PingFederate checks pass, including `pingfederate:profile:cimd`, `third-party-authorization-server` and `rar`, which the previous baseline expected to fail. Both readiness workers were healthy. The repair preview had no changes.

Legend: an `X` marks the PingFederate result column. `not-applicable` is judged against the catalog's per-provider flow data; no id is not-applicable for PingFederate. Role sets in the reason column are the `missingRoleIds` the runner reported:

- A: `standard-agent-exchanger`, `standard-mcp-exchanger`, `ai-agent-actor`, `mcp-service-actor`
- B: `standard-agent-exchanger`, `ai-agent-actor`, `a2a-specialist`
- C: `uc40-native-id-jag`
- D: `standard-agent-exchanger`, `standard-mcp-exchanger`

| useCaseId | pass | fail | not-applicable | not-run | PingFederate reason | PingOne, same run |
|---|---|---|---|---|---|---|
| UC1 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 9 pass, 2 fail |
| UC2 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set B). | 10 pass, 1 fail |
| UC2.5 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set B). | 11 fail |
| UC2.6 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set B). | 10 pass, 1 fail |
| UC2.7 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC-LEARN15 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC3 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC4 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC5 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC6 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 11 pass |
| UC7 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 11 fail |
| UC8 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 11 fail |
| UC9 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC10 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC11 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC12 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC13 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC14 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 blocked |
| UC14b | - | - | - | X | Blocked before dispatch, 2 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 2 blocked |
| UC15 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC16 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC16b | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC17 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 9 pass, 2 fail |
| UC18 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC19 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC20 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 9 pass, 2 fail |
| UC21 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC22 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 11 blocked |
| UC23 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC24 | - | - | - | X | Blocked before dispatch, 9 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 9 pass |
| UC25 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 9 pass, 2 fail |
| UC26 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC27 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC28 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC29 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC30 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 pass |
| UC31 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC32 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC33 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC34 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC35 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC37 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC38 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 11 blocked |
| UC39 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC40 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set C). | - |
| UC-LOGIN | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LOGIN-PF | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LOGIN-AIC | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-AIC-TX | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-OBO | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC41 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC42 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC43 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC44 | - | - | - | X | Blocked before dispatch, 11 rows: `pf_exact_exchange_contract_source_gap` (role set A). | 9 pass, 2 fail |
| UC45 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC48 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC-TOOL1 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 pass |
| UC-TOOL2 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-TOOL3 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC46 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC46A | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC47 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC9A | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-MUSE1 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC-MUSE2 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC-NHI1 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-NHI2 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN1 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN2 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN3 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN4 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN5 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN6 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN7 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN8 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN9 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN10 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN11 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC-LEARN12 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN13 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN14 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-PAM-SETUP | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| UC-PAM-SCRIPT | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set A). | 1 fail |
| ADMIN1 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN2 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN3 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN4 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN5 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN6 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN7 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN8 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN9 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN10 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN11 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN12 | - | - | - | X | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap` (role set D). | 1 blocked |
| ADMIN13 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN16 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN17 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN18 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |
| UC-LEARN19 | - | - | - | X | No readiness scenario in the run (no catalog flow). | - |

## Feature and attack-lab scenarios (not use case ids)

The matrix also runs 20 scenarios that are not ids in `auth-requirements.json`. 19 have a PingFederate row, all blocked the same way; PINGONE-AGENT-IAM-CORE is PingOne only.

| scenario | PingFederate | PingOne, same run |
|---|---|---|
| A2A-FM1 | Blocked before dispatch, 1 row: `pf_exact_credential_contract_source_gap`. | 1 blocked |
| A2A-FM2 | Blocked before dispatch, 1 row: `pf_exact_credential_contract_source_gap`. | 1 blocked |
| A2A-FM3 | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap`. | 1 blocked |
| PINGONE-AGENT-IAM-CORE | No PingFederate row. | 1 blocked |
| PF-CIMD-VALID | Blocked before dispatch, 1 row: `pf_cimd_runtime_source_gap`. | - |
| PF-CIMD-REJECTED | Blocked before dispatch, 1 row: `pf_cimd_runtime_source_gap`. | - |
| PF-THIRD-PARTY-AS-ALLOW | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap`. | - |
| PF-THIRD-PARTY-AS-DENY | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap`. | - |
| PF-ID-JAG-INVALID | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap`. | - |
| PF-ID-JAG-EXPIRED | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap`. | - |
| PF-ID-JAG-WRONG-AUDIENCE | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap`. | - |
| PF-RAR-VALID | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap`. | - |
| PF-RAR-INVALID | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap`. | - |
| UC2-PASSENGER-INVALID-TARGET | Blocked before dispatch, 1 row: `pf_exact_credential_contract_source_gap`. | 1 blocked |
| UC-LEARN11-PROMPT-INJECTION | Blocked before dispatch, 1 row: `pf_exact_credential_contract_source_gap`. | 1 blocked |
| PRIV-TOOL-ABUSE | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap`. | 1 blocked |
| PRIV-TOOL-POISONING | Blocked before dispatch, 1 row: `pf_exact_exchange_contract_source_gap`. | 1 blocked |
| PRIV-SCHEMA-VIOLATION | Blocked before dispatch, 1 row: `pf_exact_credential_contract_source_gap`. | 1 blocked |
| PRIV-INTER-AGENT-ABUSE | Blocked before dispatch, 1 row: `pf_exact_credential_contract_source_gap`. | 1 blocked |
| PRIV-MALICIOUS-CONTENT | Blocked before dispatch, 1 row: `pf_exact_credential_contract_source_gap`. | 1 blocked |

## Why every PingFederate row is blocked

Every role in `demo_api_server/config/demoReadinessPingFederateProfiles.json` is marked `unresolved: true`. The audit compares live PingFederate with the committed `baseline`, and that comparison passes. But `unresolved` still gates execution: the runner will not dispatch a PingFederate scenario until the role records the literal PF issuer, token endpoint and registered credential roles. The runner's remediation text: "Record the readback in demoReadinessPingFederateProfiles.json, including the resolved issuer, endpoint, and role registration, then mark the role resolved."

Three gap codes appear:

- `pf_exact_exchange_contract_source_gap`: the token-exchange roles are unresolved. This blocks all 52 ids and 10 of the 20 extra scenarios.
- `pf_exact_credential_contract_source_gap`: 7 attack-lab and A2A failure-mode scenarios.
- `pf_cimd_runtime_source_gap`: PF-CIMD-VALID and PF-CIMD-REJECTED.

To get real PingFederate pass and fail results, resolve role sets A to D (for the ids) in the profiles file, then re-run this table. That is a change to the readiness contract, so it is the owner's call.

## Known failures and causes

None confirmed: no PingFederate scenario was executed. Candidates to confirm once the roles are resolved:

- UC2 / UC2.5 / UC2.6 (flow `pingfederate-a2a`, role set B): A2A is expected to lose the `act` claim under PingFederate. UNCONFIRMED.
- PingGateway introspection of PF-issued tokens (all MCP-tool use cases): expected to reject them unless `FF_MCP_GATEWAY_JWKS=true`. UNCONFIRMED live.

The previous candidate "roles `davinci-login`, `cimd`, `third-party-authorization-server`, `rar` fail until provisioned" no longer holds for the configuration audit: all 12 PingFederate profile checks passed in this run.

## Catalog cross-check

The runner now produced its own applicability. Every PingFederate row for the 52 ids reports `providerApplicability.pingfederate: applicable`, which agrees with the catalog: no id is not-applicable under PingFederate. The 20 extra scenarios carry no applicability. `buildDemoReadinessCatalog()` returns exactly those 52 ids; the 48 ids with no row in the run are the ones with no catalog entry.

## Proposed dropUseCases for the PF edition

None. No id is not-applicable under PingFederate, and no id failed under PingFederate. Do not drop UC40 (it is the PF-native journey). The 48 ids with no readiness scenario get no verdict from this baseline under either provider.

## What was run

- PR #1856 / #1861 / #1864 (merged): the CLI can run readiness inside the BFF with a PingOne service identity ("Readiness CLI", `admin` scope), one target at a time.
- BFF restarted on main `66d4071f1`, which includes the CIMD baseline fix from #1868. Health check revision matched.
- `demo:ready --target local --json` through the BFF lane: exit 1 (single target is diagnostic), status `not-ready`, 298 s. The CLI never confirms repairs; the preview was empty.
- First attempt on `5ce3519a0` stopped at the audit: `pingfederate:profile:cimd` failed (live PF had the two negative CIMD policies from #1868 before its baseline line merged) and `runtime:revision` failed (main moved after the BFF restart). Both cleared on the second run.
- `pingone:policyReadback` stays `blocked` (not required): the worker credentials cannot read the full PingOne Authorize policy tree.
