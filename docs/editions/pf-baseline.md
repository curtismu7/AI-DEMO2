# PingFederate edition: readiness baseline

Status: FULL PINGFEDERATE RUN, LOCAL TARGET, 2026-10-30 (afternoon). Every PingFederate row was dispatched within the 15-minute limit. Spec: `docs/superpowers/specs/2026-10-03-edition-split-design.md`.

Run: `npm run demo:ready -- --target local --provider pingfederate --json` through the BFF lane, with the main BFF, both lane BFFs, both readiness workers and the `readiness-browser` service on main `7e50ae19a`. Finished in 368 s. A single target and a single provider are diagnostic only, so the run is `NOT READY` by design. Local Docker only: the SE lane was not run.

Real id count: 100 (`demo_api_server/config/auth-requirements.json` `useCases`: 87 use cases + 13 admin steps). 52 have a PingFederate scenario; 48 have none.

Totals (PingFederate, per id): pass 23, fail 8, not-applicable 0, not-run 69 (48 no scenario, 21 blocked).

PingFederate rows: 210. pass 97, fail 12, blocked 101, not-run 0. Same day, morning (main `7e97b5f2d`): pass 57, fail 52, blocked 101.

Configuration audit: all PingFederate checks pass, before and after the (empty) repair preview. The CIMD check now requires only the demo's own documents (#1908) and lists the five other apps' CIMD documents on this PingFederate as `beyondBaseline`. `pingone:policyReadback` stays `blocked` (not required).

## What changed since the morning run

- **Attack and page steps run (#1904).** The worker now runs attack simulations through `/api/demo/attack-sim/run` and loads pages in a headless browser (`readiness-browser`). All 20 rows that returned HTTP 501 now get verdicts: attacks 7 of 7 pass; pages 12 of 12 pass after UC46's link was moved to `/privilege-a2a` (#1906).
- **Agent consent (#1912).** UC7 and UC8 were not a demo-wide defect: PingOne Authorize denied them with `UserConsentMissing` because the readiness identity had never said "this agent may act for me". The worker now gives that consent, as a presenter does, before a consent-gated step. UC7 (STEP_UP) and UC8 (HITL_REQUIRED) pass in 10 of 11 verticals.
- **UC48 asks for approval (#1909).** `book_airline_flight` had no `challengeType`, so the cloud policy permitted any booking. It is now consent-gated like `pay_airline_fee`; the regenerated snapshot was imported into PingOne Authorize on 2026-10-30. UC48 returns HITL_REQUIRED and passes.

## What the PingFederate failures mean

No remaining failure is PingFederate-specific: both causes also fail on the PingOne lane (2026-10-29). Grouped by cause (12 failed rows):

- **7 rows: banking vertical tool mapping** (UC1, UC6, UC7, UC8, UC17, UC20, UC25). The agent selects `get_my_accounts` (UC1, UC17, UC20, UC25) or `transfer` (UC6, UC7, UC8) instead of the catalog tool, so the resource server and scopes miss the contract; the three `transfer` rows come back UNKNOWN with no gateway or Authorize evidence.
- **1 row: UC31 (banking).** The right tool (`get_weather`) runs, but the gateway's verdict (DENY) differs from the declared outcome.
- **4 rows: airlines vertical** (UC1, UC17, UC20, UC25). Outcome is right (PERMIT), but the gateway reports no exchange for the MCP server audience.

Blocked (101 rows):

- 34: UC2, UC2.5, UC2.6 and UC40, which need the A2A specialist and UC40 native ID-JAG roles, still unresolved.
- 19: all PF feature and attack-lab probes (A2A, CIMD, third-party AS, ID-JAG, RAR, PRIV-*), also waiting on unresolved roles.
- 12: ADMIN1-12, because the catalog has no complete contract for the `pingone-admin` vertical.
- 33: UC22 (CIBA needs a device approval), UC38 (needs MFA step-up) and UC44 (no workload agent registered for the readiness identity).
- 3: UC14 and UC14b, because the worker cannot verify PAR.

Legend: an `X` marks the PingFederate result column. An id is `pass` only if every PingFederate row passed, `fail` if any failed; otherwise `not-run`. No id is not-applicable for PingFederate. The PingOne column is from the 2026-10-29 run (`f0a06855`), for comparison only, and predates the attack, page and consent fixes; this run did not include PingOne.

| useCaseId | pass | fail | not-applicable | not-run | PingFederate rows | PingOne, 2026-10-29 |
|---|---|---|---|---|---|---|
| UC1 | - | X | - | - | 9 pass, 2 fail: 1× observed PERMIT; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; audience set does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway token for the MCP server does not carry exactly the tool scopes<br>1× observed PERMIT; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes | 9 pass, 2 fail |
| UC2 | - | - | - | X | 11 blocked: 11× blocked: `pf_exact_exchange_contract_source_gap` | 10 pass, 1 fail |
| UC2.5 | - | - | - | X | 11 blocked: 11× blocked: `pf_exact_exchange_contract_source_gap` | 11 fail |
| UC2.6 | - | - | - | X | 11 blocked: 11× blocked: `pf_exact_exchange_contract_source_gap` | 10 pass, 1 fail |
| UC2.7 | X | - | - | - | 1 pass | 1 fail |
| UC-LEARN15 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC3 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC4 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC5 | X | - | - | - | 1 pass | 1 fail |
| UC6 | - | X | - | - | 10 pass, 1 fail: 1× observed UNKNOWN; observed outcome does not match declared outcome; actor chain is missing; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; Gateway evidence is required for an exchanged tool call; Authorize evidence is required for an exchanged tool call; Gateway verdict does not match declared outcome; Authorize decision does not match declared outcome | 10 pass, 1 fail |
| UC7 | - | X | - | - | 10 pass, 1 fail: 1× observed UNKNOWN; observed outcome does not match declared outcome; actor chain is missing; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; Gateway evidence is required for an exchanged tool call; Authorize evidence is required for an exchanged tool call; Gateway verdict does not match declared outcome; Authorize decision does not match declared outcome | 11 fail |
| UC8 | - | X | - | - | 10 pass, 1 fail: 1× observed UNKNOWN; observed outcome does not match declared outcome; actor chain is missing; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; Gateway evidence is required for an exchanged tool call; Authorize evidence is required for an exchanged tool call; Gateway verdict does not match declared outcome; Authorize decision does not match declared outcome | 11 fail |
| UC9 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC10 | X | - | - | - | 1 pass | 1 fail |
| UC11 | X | - | - | - | 1 pass | 1 fail |
| UC12 | X | - | - | - | 1 pass | 1 fail |
| UC13 | X | - | - | - | 1 pass | 1 fail |
| UC14 | - | - | - | X | 1 blocked: blocked: worker cannot yet verify: PAR configuration | 1 blocked |
| UC14b | - | - | - | X | 2 blocked: 2× blocked: worker cannot yet verify: PAR configuration | 1 blocked, 1 not-run |
| UC15 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC16 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC16b | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC17 | - | X | - | - | 9 pass, 2 fail: 1× observed PERMIT; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; audience set does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway token for the MCP server does not carry exactly the tool scopes<br>1× observed PERMIT; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes | 4 pass, 1 fail, 6 not-run |
| UC18 | X | - | - | - | 1 pass | 1 fail |
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
| UC29 | X | - | - | - | 1 pass | 1 fail |
| UC30 | X | - | - | - | 1 pass | 1 pass |
| UC31 | - | X | - | - | 1 fail: observed DENY; Gateway verdict does not match declared outcome | 1 fail |
| UC32 | X | - | - | - | 1 pass | 1 fail |
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
| UC43 | X | - | - | - | 1 pass | 1 fail |
| UC44 | - | - | - | X | 11 blocked: 11× blocked: no workload agent is registered for the readiness identity | 7 pass, 3 fail, 1 blocked |
| UC45 | X | - | - | - | 1 pass | 1 fail |
| UC48 | X | - | - | - | 1 pass | 1 fail |
| UC-TOOL1 | X | - | - | - | 1 pass | 1 pass |
| UC-TOOL2 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-TOOL3 | X | - | - | - | 1 pass | 1 not-run |
| UC46 | X | - | - | - | 1 pass | 1 fail |
| UC46A | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC47 | X | - | - | - | 1 pass | 1 fail |
| UC9A | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-MUSE1 | X | - | - | - | 1 pass | 1 fail |
| UC-MUSE2 | X | - | - | - | 1 pass | 1 fail |
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
| UC-LEARN11 | X | - | - | - | 1 pass | 1 not-run |
| UC-LEARN12 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN13 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN14 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-PAM-SETUP | X | - | - | - | 1 pass | 1 not-run |
| UC-PAM-SCRIPT | X | - | - | - | 1 pass | 1 not-run |
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

None. No id is not-applicable under PingFederate, and no failure above is PingFederate-specific. Do not drop UC40 (the PF-native journey).

## Next steps

1. Banking vertical, both providers: find why the agent selects `get_my_accounts` / `transfer` instead of the catalog tool (7 PF rows); separately, UC31's gateway verdict (1 row).
2. Airlines vertical, both providers: the gateway does not exchange for the MCP server audience (4 PF rows).
3. Evidence paths for the A2A, UC40, CIMD, third-party AS and RAR roles, then resolve them (53 blocked rows).
4. A catalog contract for the `pingone-admin` vertical (ADMIN1-12).
5. A fresh run with both providers, so the PingOne column reflects the same fixes.

## What was run

- #1904: worker adapters for attack and page steps, and the `readiness-browser` service (Playwright 1.59.1).
- #1906: UC46 opens `/privilege-a2a`.
- #1908: the CIMD baseline requires the demo's own documents and allows other apps'.
- #1909: `book_airline_flight` requires consent; P1AZ snapshot regenerated and imported in the PingOne console.
- #1912: the worker gives the readiness user's agent consent before consent-gated steps.
- UI rebuilt in the shared checkout (the build had been from 2026-10-13); main BFF, both lane BFFs and both readiness workers restarted on `7e50ae19a`; healthz 200.
- `demo:ready --target local --provider pingfederate --json` through the BFF lane: exit 1 (diagnostic scope), status `not-ready`, 368 s.
