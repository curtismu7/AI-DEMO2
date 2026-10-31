# PingFederate edition: readiness baseline

Status: FULL PINGFEDERATE RUN, LOCAL TARGET, 2026-10-31 (morning). Every PingFederate row that runs passes; none fails. A2A is covered. Spec: `docs/superpowers/specs/2026-10-03-edition-split-design.md`.

Run: `npm run demo:ready -- --target local --provider pingfederate --json` through the BFF lane, with PingGateway, the main BFF, both lane BFFs, both readiness workers, the two per-lane resource servers and the `readiness-browser` service on main `b1e12cbf7` (#1934). Finished in 641 s. A single target and a single provider are diagnostic only, so the run is `NOT READY` by design. Local Docker only: the SE lane was not run.

Real id count: 100 (`demo_api_server/config/auth-requirements.json` `useCases`: 87 use cases + 13 admin steps). 52 have a PingFederate scenario; 48 have none.

Totals (PingFederate, per id): pass 34, fail 0, not-applicable 0, not-run 66 (48 no scenario, 18 blocked).

PingFederate rows: 210. pass 142, fail 0, blocked 68, not-run 0. Same project, run by run: 2026-10-30 morning 57 pass / 52 fail; afternoon 97 / 12; evening 109 / 0 (101 blocked). 2026-10-31, with the A2A rows unblocked: 107 / 23, 116 / 14, 125 / 5, 128 / 2, then 142 / 0 (68 blocked).

Configuration audit: all PingFederate checks pass, before and after the (empty) repair preview. The CIMD check requires only the demo's own documents (#1908) and lists other apps' CIMD documents on this PingFederate as `beyondBaseline`. `pingone:policyReadback` stays `blocked` (not required).

## What changed on 2026-10-30

Readiness harness:

- **Attack and page steps run (#1904).** The worker runs attack simulations through `/api/demo/attack-sim/run` and loads pages in a headless browser (`readiness-browser`). All 20 rows that returned HTTP 501 get verdicts.
- **Agent consent (#1912).** The worker gives the readiness user's "this agent may act for me" consent before a consent-gated step, as a presenter does. UC7 and UC8 had been denied by `UserConsentMissing`, not a demo defect.
- **Session vertical (#1915).** The worker pins the lane session to each row's vertical, as the UI's vertical picker does.
- **CIMD audit (#1908).** The CIMD baseline requires the demo's own documents and allows other apps'.

Demo fixes found by the runs (presenters can hit each of these):

- **UC46 link (#1906)** opens `/privilege-a2a`, the page the old link redirected to.
- **UC48 booking (#1909)** is consent-gated in `scope-topology.json`, so PingOne Authorize asks for approval; the regenerated snapshot was imported in the PingOne console.
- **Agent account reads keep the vertical (#1914).** `oauth-mcp` forwards the session's `X-Active-Vertical` on its BFF calls, so a token-only `/api/accounts/my` no longer switches the user to the BFF's global vertical.
- **Login re-align (#1916)** switches a user's vertical with a snapshot instead of deleting their accounts and transactions.
- **"show my balance" (#1917)** reads the primary account with `get_account_balance`, as UC1, UC17, UC20 and UC25 declare.
- **Token cache replay (#1918)** carries only the token chain; it no longer replays the previous call's gateway events (UC31 showed UC30's PERMIT audit).
- **Airlines backend exchange (#1919).** PingGateway's `invest-dispatch.groovy` reports its Exchange #3, so the gateway-to-backend hop of airlines and invest calls is visible.

## What changed on 2026-10-31 (A2A)

Unblocking the 34 A2A rows (the `a2a-specialist` role, #1924) exposed these, in the order the runs found them. Several are bugs a presenter on PingFederate hits too.

- **Specialist call held for approval (#1922).** On PingFederate the specialist's tool call reaches real PingOne Authorize, whose `RequiresHitlConsent` holds every `sensitive_*` tool. The A2A path turned the gateway's 428 into a dead-end `hitl_required`, so 10 of 11 verticals failed. A held call now opens the normal approval prompt and the retry carries the receipt (`_hitl_challenge_id`); the worker approves and resends as a presenter does.
- **Per-lane resource server (#1923).** The shared invest/airlines resource server read account data from the presenter's BFF, which rejected the lane's token. Each lane has its own (`readiness-resource-server-{pingone,pingfederate}`); PingGateway stays shared and routes by an `X-Readiness-Lane` header.
- **A2A evidence and role (#1924).** `a2a-specialist` is resolved with its access token manager; the A2A events carry each hop's token type, the endpoint and the roles. Exchange #1's recorded exchanger named the PingOne client on PingFederate; fixed.
- **Portfolio audience (#1926, #1931).** PingFederate's Exchange #3 reuses the persistent grant, so the forwarded token keeps the PingGateway audience. The BFF's investment callbacks (accounts, portfolio, balance, transactions; GET only) now accept it. Banking and write routes still reject it.
- **Banking mismatch routing (#1929).** `a2a_generalist_mismatch` was parsed as a banking action ("I don't recognize that action"); also the one PingOne UC2.6 failure.
- **Missing `account_id` (#1929).** The A2A orchestrator picks an investment tool without arguments; the delegation fills the first portfolio.
- **Runner outcome (#1929).** PERMIT now satisfies `DELEGATE_AND_EXECUTE` through the documented `outcomeConforms`, and nothing looser.
- **Gateway tool fallback (#1931).** PingGateway's audit-trail header sometimes arrives without the filter chain (about 1 call in 8, reproduced); the adapter falls back to the gateway's own audit record of the call.
- **UC2.6 base tool (#1931).** Banking expected `sensitive_holdings`; its Investment Advisor runs `get_portfolio_summary`, as UC2 and UC2.5.
- **UC2.5 on heuristics (#1934).** The A2A page's LLM coordinator picks among the banking specialist's four tools and varies run to run; the worker sends `mode: 'heuristics'`, which is deterministic.


## What is still not verified

Blocked (68 rows):

- 20: the PF feature and attack-lab probes (A2A-FM1-3, CIMD, third-party AS, ID-JAG negatives, RAR, PRIV-*) and UC40, each waiting on its PingFederate role to be recorded as resolved.
- 12: ADMIN1-12, because the catalog has no complete contract for the `pingone-admin` vertical.
- 11: UC22, because CIBA needs an approval on a device.
- 11: UC38, because it needs MFA step-up, which the worker cannot do.
- 11: UC44, because no workload agent is registered for the readiness identity.
- 3: UC14 and UC14b, because the worker cannot verify PAR.

Known gaps outside this run:

- **PingOne lane, airlines:** with #1919 the gateway reports the airlines exchange, but on PingOne its audience is the resource server's own, which the catalog's PingOne contract does not list yet.
- **Lane isolation:** the investment/airlines resource server is now per lane (#1923). The main MCP server (`ai-demo-mcp-server`, the OLB tools) is still shared and calls back to the presenter's BFF for account data.
- **A2A page approval prompt:** a delegation the gateway holds for approval shows as a failed delegation on the A2A orchestrator page; the approval prompt exists on the agent chat only (#1922).
- **Transients under load:** one retail or sporting-goods row (UC1, UC20) returned no result in three of the earlier runs and passed when probed alone; PingOne Authorize rate-limits (HTTP 429) during a run. None recurred in the last run.


Legend: an `X` marks the PingFederate result column. An id is `pass` only if every PingFederate row passed, `fail` if any failed; otherwise `not-run`. No id is not-applicable for PingFederate. The PingOne column is from the 2026-10-29 run (`f0a06855`), for comparison only, and predates every fix above; this run did not include PingOne.

| useCaseId | pass | fail | not-applicable | not-run | PingFederate rows | PingOne, 2026-10-29 |
|---|---|---|---|---|---|---|
| UC1 | X | - | - | - | 11 pass | 9 pass, 2 fail |
| UC2 | X | - | - | - | 11 pass | 10 pass, 1 fail |
| UC2.5 | X | - | - | - | 11 pass | 11 fail |
| UC2.6 | X | - | - | - | 11 pass | 10 pass, 1 fail |
| UC2.7 | X | - | - | - | 1 pass | 1 fail |
| UC-LEARN15 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC3 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC4 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC5 | X | - | - | - | 1 pass | 1 fail |
| UC6 | X | - | - | - | 11 pass | 10 pass, 1 fail |
| UC7 | X | - | - | - | 11 pass | 11 fail |
| UC8 | X | - | - | - | 11 pass | 11 fail |
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
| UC17 | X | - | - | - | 11 pass | 4 pass, 1 fail, 6 not-run |
| UC18 | X | - | - | - | 1 pass | 1 fail |
| UC19 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC20 | X | - | - | - | 11 pass | 9 pass, 2 fail |
| UC21 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC22 | - | - | - | X | 11 blocked: 11× blocked: CIBA needs an out-of-band approval on a device, which this worker cannot give | 11 blocked |
| UC23 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC24 | X | - | - | - | 9 pass | 9 pass |
| UC25 | X | - | - | - | 11 pass | 11 not-run |
| UC26 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC27 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC28 | - | - | - | X | No readiness scenario (no catalog flow). | - |
| UC29 | X | - | - | - | 1 pass | 1 fail |
| UC30 | X | - | - | - | 1 pass | 1 pass |
| UC31 | X | - | - | - | 1 pass | 1 fail |
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

None. No id is not-applicable under PingFederate, and no PingFederate row fails. Do not drop UC40 (the PF-native journey).

## Next steps

In this order (effort in brackets):

1. PAR check in the worker, and a workload agent for the readiness identity (UC14, UC14b, UC44; 14 rows) [small].
2. The PF feature probes and UC40: read each role back from PingFederate, record it as resolved, fix what the first live run shows; A2A-FM1-3 first (20 rows) [medium, per family].
3. An MFA device for the readiness user, with its secret in the vault, so the worker can answer UC38's step-up (11 rows) [medium].
4. A catalog contract for the `pingone-admin` vertical (ADMIN1-12) [medium, mostly decisions].
5. UC22 (CIBA) stays blocked unless a test approver that approves through the API is acceptable, which changes what the row proves.
6. A fresh run with both providers, so the PingOne column reflects the same fixes; then the PingOne airlines audience in the catalog contract.


## What was run

- Main `b1e12cbf7` (#1904-#1934). UI rebuilt in the shared checkout after the merges (a stale build blocks 12 page-step rows); PingGateway recreated for the per-lane backends; both lane BFFs recreated and the presenter BFF, both workers restarted; the two lane resource servers started; healthz 200.
- `demo:ready --target local --provider pingfederate --json` through the BFF lane: exit 1 (diagnostic scope), status `not-ready`, 641 s. The `runtime:revision` check fails if the BFFs run older code than the checkout, so restart them after every merge.
