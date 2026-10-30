# PingFederate edition: readiness baseline

Status: FULL PINGFEDERATE RUN, LOCAL TARGET, 2026-10-30. Every PingFederate row was dispatched; nothing was cut off by the 15-minute limit. Spec: `docs/superpowers/specs/2026-10-03-edition-split-design.md`.

Run: `npm run demo:ready -- --target local --provider pingfederate --json` through the BFF lane, with the main BFF, both lane BFFs and both readiness workers restarted on main `7e97b5f2d` (includes #1888 provider filter, #1891 per-provider audience contract, #1899 CIMD baseline). Finished in 255 s. A single target and a single provider are diagnostic only, so the run is `NOT READY` by design. Local Docker only: the SE lane was not run.

Real id count: 100 (`demo_api_server/config/auth-requirements.json` `useCases`: 87 use cases + 13 admin steps). 52 have a PingFederate scenario; 48 have none.

Totals (PingFederate, per id): pass 3, fail 28, not-applicable 0, not-run 69 (48 no scenario, 21 blocked).

PingFederate rows: 210. pass 57, fail 52, blocked 101, not-run 0. Previous run (2026-10-29, `f0a06855`, both providers, cut off at 15 minutes): pass 9, fail 79, blocked 69, not-run 53.

Configuration audit: all 12 PingFederate checks pass, before and after the (empty) repair preview. `pingone:policyReadback` stays `blocked` (not required).

## What the PingFederate failures mean

The per-provider audience contract (#1891) worked live: the 36 contract-shape failures from the last run are gone, and the token-exchange path now passes in 9 of 11 verticals for UC1, UC17, UC20 and UC25. Grouped by cause (52 failed rows):

- **20 rows: no worker adapter** (UC2.7, UC5, UC10-13, UC18, UC29, UC32, UC43, UC45-48, UC-MUSE1, UC-MUSE2, UC-TOOL3, UC-LEARN11, UC-PAM-SETUP, UC-PAM-SCRIPT). The readiness worker returns HTTP 501 for `attack` and `page` steps. PingOne fails the same ids the same way.
- **20 rows: UC7 and UC8 return DENY** (expected STEP_UP and HITL_REQUIRED) in 10 of 11 verticals. PingOne fails them the same way, so this is demo-wide, not PingFederate.
- **7 rows: banking vertical** (UC1, UC6, UC7, UC8, UC17, UC20, UC25). The agent picks `get_my_accounts` (or `transfer`) instead of the catalog tool, and the resource server and scopes do not match; UC6, UC7 and UC8 come back UNKNOWN with no gateway or Authorize evidence. PingOne failed UC1, UC6, UC17 and UC20 in banking the same way on 2026-10-29, so this is demo-wide (banking tool mapping), not PingFederate.
- **4 rows: airlines vertical** (UC1, UC17, UC20, UC25). Outcome is right (PERMIT), but the gateway reports no exchange for the MCP server audience. PingOne failed UC1 and UC20 in airlines with the same message on 2026-10-29, so this is demo-wide too (the airlines MCP path skips the gateway-to-backend exchange), not PingFederate.
- **1 row** (UC31): gateway returns DENY where the declared outcome differs. PingOne fails it too.

PingFederate passes: UC24 (9 of 9 verticals), UC30 and UC-TOOL1, plus 9 of 11 verticals for UC1, UC17, UC20 and UC25, and 10 of 11 for UC6.

Blocked (101 rows):

- 34: UC2, UC2.5, UC2.6 and UC40, which need the A2A specialist and UC40 native ID-JAG roles, still unresolved.
- 19: all PF feature and attack-lab probes (A2A, CIMD, third-party AS, ID-JAG, RAR, PRIV-*), also waiting on unresolved roles.
- 12: ADMIN1-12, because the catalog has no complete contract for the `pingone-admin` vertical.
- 33: UC22 (CIBA needs a device approval), UC38 (needs MFA step-up) and UC44 (no workload agent registered for the readiness identity).
- 3: UC14 and UC14b, because the worker cannot verify PAR.

Legend: an `X` marks the PingFederate result column. An id is `pass` only if every PingFederate row passed, `fail` if any failed; otherwise `not-run`. No id is not-applicable for PingFederate. The PingOne column is from the 2026-10-29 run (`f0a06855`), for comparison only; this run did not include PingOne.

| useCaseId | pass | fail | not-applicable | not-run | PingFederate rows | PingOne, 2026-10-29 |
|---|---|---|---|---|---|---|
| UC1 | - | X | - | - | 9 pass, 2 fail: 1× observed PERMIT; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; audience set does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway token for the MCP server does not carry exactly the tool scopes<br>1× observed PERMIT; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes | 9 pass, 2 fail |
| UC2 | - | - | - | X | 11 blocked: 11× blocked: `pf_exact_exchange_contract_source_gap` | 10 pass, 1 fail |
| UC2.5 | - | - | - | X | 11 blocked: 11× blocked: `pf_exact_exchange_contract_source_gap` | 11 fail |
| UC2.6 | - | - | - | X | 11 blocked: 11× blocked: `pf_exact_exchange_contract_source_gap` | 10 pass, 1 fail |
| UC2.7 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC-LEARN15 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC3 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC4 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC5 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC6 | - | X | - | - | 10 pass, 1 fail: 1× observed UNKNOWN; observed outcome does not match declared outcome; actor chain is missing; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; Gateway evidence is required for an exchanged tool call; Authorize evidence is required for an exchanged tool call; Gateway verdict does not match declared outcome; Authorize decision does not match declared outcome | 10 pass, 1 fail |
| UC7 | - | X | - | - | 11 fail: 10× observed DENY; observed outcome does not match declared outcome; Gateway verdict does not match declared outcome; Authorize decision does not match declared outcome<br>1× observed UNKNOWN; observed outcome does not match declared outcome; actor chain is missing; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; Gateway evidence is required for an exchanged tool call; Authorize evidence is required for an exchanged tool call; Gateway verdict does not match declared outcome; Authorize decision does not match declared outcome | 11 fail |
| UC8 | - | X | - | - | 11 fail: 10× observed DENY; observed outcome does not match declared outcome; Gateway verdict does not match declared outcome; Authorize decision does not match declared outcome<br>1× observed UNKNOWN; observed outcome does not match declared outcome; actor chain is missing; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; Gateway evidence is required for an exchanged tool call; Authorize evidence is required for an exchanged tool call; Gateway verdict does not match declared outcome; Authorize decision does not match declared outcome | 11 fail |
| UC9 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC10 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC11 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC12 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC13 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC14 | - | - | - | X | 1 blocked: blocked: worker cannot yet verify: PAR configuration | 1 blocked |
| UC14b | - | - | - | X | 2 blocked: 2× blocked: worker cannot yet verify: PAR configuration | 1 blocked, 1 not-run |
| UC15 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC16 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC16b | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC17 | - | X | - | - | 9 pass, 2 fail: 1× observed PERMIT; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; audience set does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway token for the MCP server does not carry exactly the tool scopes<br>1× observed PERMIT; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes | 4 pass, 1 fail, 6 not-run |
| UC18 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC19 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC20 | - | X | - | - | 9 pass, 2 fail: 1× observed PERMIT; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; audience set does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway token for the MCP server does not carry exactly the tool scopes<br>1× observed PERMIT; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes | 9 pass, 2 fail |
| UC21 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC22 | - | - | - | X | 11 blocked: 11× blocked: CIBA needs an out-of-band approval on a device, which this worker cannot give | 11 blocked |
| UC23 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC24 | X | - | - | - | 9 pass | 9 pass |
| UC25 | - | X | - | - | 9 pass, 2 fail: 1× observed PERMIT; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; audience set does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway token for the MCP server does not carry exactly the tool scopes<br>1× observed PERMIT; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes | 11 not-run |
| UC26 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC27 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC28 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC29 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC30 | X | - | - | - | 1 pass | 1 pass |
| UC31 | - | X | - | - | 1 fail: observed DENY; Gateway verdict does not match declared outcome | 1 fail |
| UC32 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC33 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC34 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC35 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC37 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC38 | - | - | - | X | 11 blocked: 11× blocked: needs the customer to pass MFA step-up, which this worker cannot do | 11 blocked |
| UC39 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC40 | - | - | - | X | 1 blocked: blocked: `pf_exact_exchange_contract_source_gap` | - |
| UC-LOGIN | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LOGIN-PF | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LOGIN-AIC | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-AIC-TX | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-OBO | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC41 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC42 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC43 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC44 | - | - | - | X | 11 blocked: 11× blocked: no workload agent is registered for the readiness identity | 7 pass, 3 fail, 1 blocked |
| UC45 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC48 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC-TOOL1 | X | - | - | - | 1 pass | 1 pass |
| UC-TOOL2 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-TOOL3 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 not-run |
| UC46 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC46A | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC47 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC9A | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-MUSE1 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC-MUSE2 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC-NHI1 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-NHI2 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN1 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN2 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN3 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN4 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN5 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN6 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN7 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN8 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN9 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN10 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN11 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 not-run |
| UC-LEARN12 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN13 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN14 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-PAM-SETUP | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 not-run |
| UC-PAM-SCRIPT | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 not-run |
| ADMIN1 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN2 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN3 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN4 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN5 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN6 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN7 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN8 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN9 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN10 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN11 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN12 | - | - | - | X | 1 blocked: blocked: catalog has no complete contract for vertical pingone-admin | 1 not-run |
| ADMIN13 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN16 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN17 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN18 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN19 | - | - | - | X | No readiness scenario (no catalog flow). | - |

## Feature and attack-lab scenarios (not use case ids)

| scenario | PingFederate rows | PingOne, 2026-10-29 |
|---|---|---|
| A2A-FM1 | 1 blocked: blocked: `pf_exact_credential_contract_source_gap` | 1 not-run |
| A2A-FM2 | 1 blocked: blocked: `pf_exact_credential_contract_source_gap` | 1 not-run |
| A2A-FM3 | 1 blocked: blocked: `pf_exact_exchange_contract_source_gap` | 1 not-run |
| PINGONE-AGENT-IAM-CORE | No readiness scenario (no catalog flow). | 1 not-run |
| PF-CIMD-VALID | 1 blocked: blocked: `pf_cimd_runtime_source_gap` | - |
| PF-CIMD-REJECTED | 1 blocked: blocked: `pf_cimd_runtime_source_gap` | - |
| PF-THIRD-PARTY-AS-ALLOW | 1 blocked: blocked: `pf_exact_exchange_contract_source_gap` | - |
| PF-THIRD-PARTY-AS-DENY | 1 blocked: blocked: `pf_exact_exchange_contract_source_gap` | - |
| PF-ID-JAG-INVALID | 1 blocked: blocked: `pf_exact_exchange_contract_source_gap` | - |
| PF-ID-JAG-EXPIRED | 1 blocked: blocked: `pf_exact_exchange_contract_source_gap` | - |
| PF-ID-JAG-WRONG-AUDIENCE | 1 blocked: blocked: `pf_exact_exchange_contract_source_gap` | - |
| PF-RAR-VALID | 1 blocked: blocked: `pf_exact_exchange_contract_source_gap` | - |
| PF-RAR-INVALID | 1 blocked: blocked: `pf_exact_exchange_contract_source_gap` | - |
| UC2-PASSENGER-INVALID-TARGET | 1 blocked: blocked: `pf_exact_credential_contract_source_gap` | 1 not-run |
| UC-LEARN11-PROMPT-INJECTION | 1 blocked: blocked: `pf_exact_credential_contract_source_gap` | 1 not-run |
| PRIV-TOOL-ABUSE | 1 blocked: blocked: `pf_exact_exchange_contract_source_gap` | 1 not-run |
| PRIV-TOOL-POISONING | 1 blocked: blocked: `pf_exact_exchange_contract_source_gap` | 1 not-run |
| PRIV-SCHEMA-VIOLATION | 1 blocked: blocked: `pf_exact_credential_contract_source_gap` | 1 not-run |
| PRIV-INTER-AGENT-ABUSE | 1 blocked: blocked: `pf_exact_credential_contract_source_gap` | 1 not-run |
| PRIV-MALICIOUS-CONTENT | 1 blocked: blocked: `pf_exact_credential_contract_source_gap` | 1 not-run |

## Proposed dropUseCases for the PF edition

None. No id is not-applicable under PingFederate, and no failure above is PingFederate-specific: every failing cause also fails under PingOne. Do not drop UC40 (the PF-native journey).

## Next steps

1. Banking vertical, both providers: find why the agent selects `get_my_accounts` / `transfer` instead of the catalog tool (7 PF rows).
2. Airlines vertical, both providers: the gateway does not exchange for the MCP server audience (4 PF rows).
3. Worker adapters for `attack` and `page` steps (20 rows, both providers).
4. UC7 / UC8 return DENY instead of STEP_UP / HITL_REQUIRED (20 rows, both providers).
5. Evidence paths for the A2A, UC40, CIMD, third-party AS and RAR roles, then resolve them (53 blocked rows).
6. A catalog contract for the `pingone-admin` vertical (ADMIN1-12).

## What was run

- #1888 (merged `de838a4fa`): `--provider pingone|pingfederate|both` on `demo:ready`, so one provider fits inside the 15-minute limit.
- #1891 (merged `edef24267`): `providerOverrides.pingfederate` in the catalog authorization contract (PF access-token-manager audiences, tool scopes on the gateway hop).
- #1899 (merged `7e97b5f2d`): the CIMD baseline lists the two `poppy-agent-tester` client documents (ports 5450 and 8453). Without it the audit stopped every PF run before any scenario.
- Main BFF, both readiness lane BFFs and both readiness workers restarted on `7e97b5f2d`; healthz 200.
- `demo:ready --target local --provider pingfederate --json` through the BFF lane: exit 1 (diagnostic scope), status `not-ready`, 255 s.
