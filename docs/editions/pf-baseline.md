# PingFederate edition: readiness baseline

Status: LIVE RUN WITH PINGFEDERATE VERDICTS, LOCAL TARGET, 2026-10-29. This is the first run in which PingFederate scenarios were actually sent (PR #1882 resolved the four standard-exchange roles). Spec: `docs/superpowers/specs/2026-10-03-edition-split-design.md`.

Run: `npm run demo:ready -- --target local --json` through the BFF lane, BFF, both lane BFFs and both readiness workers on main `fb07b62ca`. Report run id `f0a06855-97e7-455e-8d3d-ea2c7693edfe`. The run hit the 15-minute hard limit (`deadline-exceeded`): with PingFederate rows now executing, one local run no longer fits, and 98 rows (53 PingFederate) were never dispatched. A single target is diagnostic only, so the run is `NOT READY` by design. The SE lane is not built and was not run.

Real id count: 100 (`demo_api_server/config/auth-requirements.json` `useCases`: 87 use cases + 13 admin steps). 52 have a PingFederate scenario; 48 have none.

Totals (PingFederate, per id): pass 1, fail 25, not-applicable 0, not-run 74 (48 no scenario, 26 blocked or not dispatched).

PingFederate rows: 210. pass 9, fail 79, blocked 69, not-run 53. PingOne rows, same run: pass 70, fail 61, blocked 25, not-run 45 (comparison only).

Configuration audit: all 12 PingFederate checks pass, before and after the (empty) repair preview.

## What the PingFederate failures mean

Most PingFederate failures are not PingFederate problems. Grouped by cause (79 failed rows):

- **36 rows: right outcome, PingOne-shaped contract** (UC1, UC6, UC17, UC20, UC30). The tool ran and the decision matched, but the catalog's audience and scope contract is written in PingOne names. PingFederate mints scope `accounts:read` where PingOne mints `read`, and audience `https://api.ping.demo:3036/mcp` where the contract expects `mcpserver.ping.demo`; its gateway token also carries the tool scope. Fix: per-provider audience and scope expectations in the catalog, not a PingFederate change.
- **16 rows: no worker adapter** (UC2.7, UC5, UC10-13, UC18, UC29, UC32, UC43, UC45-48, UC-MUSE1, UC-MUSE2). The readiness worker returns HTTP 501 for `attack` and `page` steps. PingOne fails the same ids the same way.
- **23 rows: wrong outcome.** UC7 (expected STEP_UP) and UC8 (expected HITL_REQUIRED) return DENY in every vertical, and PingOne fails them the same way, so this is demo-wide. UC-TOOL1 returned UNKNOWN in one vertical where PingOne returned PERMIT: the only PingFederate-specific outcome difference.
- **3 rows: a different tool ran** (UC1, UC17, UC20, one vertical each).
- **1 row** (UC31): gateway verdict differs from the declared outcome, plus the contract-shape failures above.

The only PingFederate pass is UC24 (the public path, no exchange), 9 of 9 verticals.

Blocked (69 rows): UC2, UC2.5, UC2.6 and UC40 (roles still unresolved, no evidence path yet); UC14 and UC14b (worker cannot verify PAR); UC22 (CIBA needs a device approval); UC38 (needs MFA step-up); UC44 (no workload agent registered for the readiness identity).

Legend: an `X` marks the PingFederate result column. An id is `pass` only if every PingFederate row passed, `fail` if any failed; otherwise `not-run`. No id is not-applicable for PingFederate.

| useCaseId | pass | fail | not-applicable | not-run | PingFederate rows | PingOne, same run |
|---|---|---|---|---|---|---|
| UC1 | - | X | - | - | 11 fail: 9× observed PERMIT; audience set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway did not report an exchange for the MCP server audience<br>1× observed PERMIT; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; audience set does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes<br>1× observed PERMIT; audience set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes | 9 pass, 2 fail |
| UC2 | - | - | - | X | 11 blocked: 11× blocked: `pf_exact_exchange_contract_source_gap` | 10 pass, 1 fail |
| UC2.5 | - | - | - | X | 11 blocked: 11× blocked: `pf_exact_exchange_contract_source_gap` | 11 fail |
| UC2.6 | - | - | - | X | 11 blocked: 11× blocked: `pf_exact_exchange_contract_source_gap` | 10 pass, 1 fail |
| UC2.7 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC-LEARN15 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC3 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC4 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC5 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC6 | - | X | - | - | 11 fail: 11× observed DENY; audience set does not match catalog contract; gateway token audience or scope does not match the gateway resource | 10 pass, 1 fail |
| UC7 | - | X | - | - | 11 fail: 11× observed DENY; observed outcome does not match declared outcome; audience set does not match catalog contract; gateway token audience or scope does not match the gateway resource; Gateway verdict does not match declared outcome; Authorize decision does not match declared outcome | 11 fail |
| UC8 | - | X | - | - | 11 fail: 11× observed DENY; observed outcome does not match declared outcome; audience set does not match catalog contract; gateway token audience or scope does not match the gateway resource; Gateway verdict does not match declared outcome; Authorize decision does not match declared outcome | 11 fail |
| UC9 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC10 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC11 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC12 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC13 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC14 | - | - | - | X | 1 blocked: blocked: worker cannot yet verify: PAR configuration | 1 blocked |
| UC14b | - | - | - | X | 1 blocked, 1 not-run: 1× blocked: worker cannot yet verify: PAR configuration<br>1× not dispatched: 15-minute deadline reached | 1 blocked, 1 not-run |
| UC15 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC16 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC16b | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC17 | - | X | - | - | 5 fail, 6 not-run: 6× not dispatched: 15-minute deadline reached<br>4× observed PERMIT; audience set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway did not report an exchange for the MCP server audience<br>1× observed PERMIT; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; audience set does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes | 4 pass, 1 fail, 6 not-run |
| UC18 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC19 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC20 | - | X | - | - | 11 fail: 9× observed PERMIT; audience set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway did not report an exchange for the MCP server audience<br>1× observed PERMIT; resource server does not match catalog contract; PF registered-tool call did not return the expected result; selected tool does not match catalog contract; audience set does not match catalog contract; scope set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes<br>1× observed PERMIT; audience set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes | 9 pass, 2 fail |
| UC21 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC22 | - | - | - | X | 11 blocked: 11× blocked: CIBA needs an out-of-band approval on a device, which this worker cannot give | 11 blocked |
| UC23 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC24 | X | - | - | - | 9 pass | 9 pass |
| UC25 | - | - | - | X | 11 not-run: 11× not dispatched: 15-minute deadline reached | 11 not-run |
| UC26 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC27 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC28 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC29 | - | X | - | - | 1 fail: worker has no adapter for this step type (HTTP 501) | 1 fail |
| UC30 | - | X | - | - | 1 fail: observed PERMIT; audience set does not match catalog contract; gateway token audience or scope does not match the gateway resource | 1 pass |
| UC31 | - | X | - | - | 1 fail: observed DENY; audience set does not match catalog contract; gateway token audience or scope does not match the gateway resource; Gateway verdict does not match declared outcome | 1 fail |
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
| UC-TOOL1 | - | X | - | - | 1 fail: observed UNKNOWN; observed outcome does not match declared outcome; audience set does not match catalog contract; gateway token audience or scope does not match the gateway resource; gateway did not report an exchange for the MCP server audience; gateway token for the MCP server does not carry exactly the tool scopes; Gateway verdict does not match declared outcome; Authorize decision does not match declared outcome | 1 pass |
| UC-TOOL2 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-TOOL3 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
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
| UC-LEARN11 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| UC-LEARN12 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN13 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN14 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-PAM-SETUP | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| UC-PAM-SCRIPT | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN1 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN2 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN3 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN4 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN5 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN6 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN7 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN8 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN9 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN10 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN11 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN12 | - | - | - | X | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| ADMIN13 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN16 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN17 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN18 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC-LEARN19 | - | - | - | X | No readiness scenario (no catalog flow). | - |

## Feature and attack-lab scenarios (not use case ids)

| scenario | PingFederate rows | PingOne, same run |
|---|---|---|
| A2A-FM1 | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| A2A-FM2 | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| A2A-FM3 | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| PINGONE-AGENT-IAM-CORE | No readiness scenario (no catalog flow). | 1 not-run |
| PF-CIMD-VALID | 1 not-run: not dispatched: 15-minute deadline reached | - |
| PF-CIMD-REJECTED | 1 not-run: not dispatched: 15-minute deadline reached | - |
| PF-THIRD-PARTY-AS-ALLOW | 1 not-run: not dispatched: 15-minute deadline reached | - |
| PF-THIRD-PARTY-AS-DENY | 1 not-run: not dispatched: 15-minute deadline reached | - |
| PF-ID-JAG-INVALID | 1 not-run: not dispatched: 15-minute deadline reached | - |
| PF-ID-JAG-EXPIRED | 1 not-run: not dispatched: 15-minute deadline reached | - |
| PF-ID-JAG-WRONG-AUDIENCE | 1 not-run: not dispatched: 15-minute deadline reached | - |
| PF-RAR-VALID | 1 not-run: not dispatched: 15-minute deadline reached | - |
| PF-RAR-INVALID | 1 not-run: not dispatched: 15-minute deadline reached | - |
| UC2-PASSENGER-INVALID-TARGET | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| UC-LEARN11-PROMPT-INJECTION | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| PRIV-TOOL-ABUSE | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| PRIV-TOOL-POISONING | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| PRIV-SCHEMA-VIOLATION | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| PRIV-INTER-AGENT-ABUSE | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |
| PRIV-MALICIOUS-CONTENT | 1 not-run: not dispatched: 15-minute deadline reached | 1 not-run |

## Proposed dropUseCases for the PF edition

None. No id is not-applicable under PingFederate, and no failure above is caused by PingFederate itself except one UC-TOOL1 vertical. Do not drop UC40 (the PF-native journey).

## Next steps

1. Split the run: the 15-minute limit now cuts off 98 rows (ADMIN1-12, UC17, UC25, UC-PAM-*, UC-LEARN11, UC-TOOL3 and all feature probes). A provider filter or a longer limit for diagnostic runs would let the rest run.
2. Per-provider audience and scope contract in the catalog (clears the 36 contract-shape rows).
3. Worker adapters for `attack` and `page` steps (both providers).
4. UC7 / UC8 return DENY instead of STEP_UP / HITL_REQUIRED on both providers.
5. Evidence paths for the A2A, UC40, CIMD, third-party AS and RAR roles, then resolve them.

## What was run

- PR #1882 (merged `fb07b62ca`): the four PF standard-exchange roles resolved, with the local issuer, in-Docker token endpoint and its alias recorded.
- Main BFF, both readiness lane BFFs and both readiness workers restarted on `fb07b62ca`. A first attempt with only the BFFs restarted was all `blocked`: the workers still held the old catalog and rejected every case with HTTP 400.
- `demo:ready --target local --json` through the BFF lane: exit 1, status `deadline-exceeded`, 900 s.
- `pingone:policyReadback` stays `blocked` (not required): the worker credentials cannot read the full PingOne Authorize policy tree.
