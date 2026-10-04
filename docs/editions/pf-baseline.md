# PingFederate edition: readiness baseline

Status: STATIC BASELINE ONLY. No live PingFederate result exists yet. The readiness lanes were not running, so every row is `not-run`. Spec: `docs/superpowers/specs/2026-10-03-edition-split-design.md`.

Real id count: 84 (`demo_api_server/config/auth-requirements.json` `useCases`: 71 use cases + 13 admin steps). The plan's earlier "82" and "83" are stale (UC47 was added on main 2026-10-04). The readiness catalog (`demoReadinessCatalog.js`) lists only 48 of them (36 Demo Steps + ADMIN1-12); the other 36 have no readiness flow at all.

Totals: pass 0, fail 0, not-applicable 0, not-run 84.

Legend: an `X` marks the result column. `not-applicable` is judged against the catalog's per-provider flow data for PingFederate; none of the 84 ids is marked not-applicable for PingFederate (only UC40 is not-applicable, for PingOne).

| useCaseId | pass | fail | not-applicable | not-run | reason |
|---|---|---|---|---|---|
| UC1 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC2 | - | - | - | X | Catalog flow `pingfederate-a2a` applicable under PF; lane not up, no live result. Expected-fail candidate: act claim (see Known failures). |
| UC2.5 | - | - | - | X | Catalog flow `pingfederate-a2a` applicable under PF; lane not up, no live result. Expected-fail candidate: act claim (see Known failures). |
| UC2.6 | - | - | - | X | Catalog flow `pingfederate-a2a` applicable under PF; lane not up, no live result. Expected-fail candidate: act claim (see Known failures). |
| UC2.7 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC3 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC4 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC5 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC6 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC7 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC8 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC9 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC10 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC11 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC12 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC13 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC14 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC14b | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC15 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC16 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC16b | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC17 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC18 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC19 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC20 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC21 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC22 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC23 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC24 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC25 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC26 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC27 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC28 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC29 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC30 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC31 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC32 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC33 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC34 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC35 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC37 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC38 | - | - | - | X | Catalog flow `pingfederate-workload` applicable under PF; lane not up, no live result. |
| UC39 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC40 | - | - | - | X | Catalog flow `pingfederate-native-id-jag` applicable under PF; lane not up, no live result. PF-only journey (PingOne n/a). |
| UC41 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC42 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC43 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC44 | - | - | - | X | Catalog flow `pingfederate-workload` applicable under PF; lane not up, no live result. |
| UC45 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC-TOOL1 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC-TOOL2 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-TOOL3 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC46 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC47 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF (and `pingone-standard` under PingOne); lane not up, no live result. Added on main 2026-10-04. |
| UC-NHI1 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-NHI2 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN1 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN2 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN3 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN4 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN5 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN6 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN7 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN8 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN9 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN10 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN11 | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC-LEARN12 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-LEARN13 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |
| UC-PAM-SETUP | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| UC-PAM-SCRIPT | - | - | - | X | Catalog flow `pingfederate-standard` applicable under PF; lane not up, no live result. |
| ADMIN1 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN2 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN3 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN4 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN5 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN6 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN7 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN8 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN9 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN10 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN11 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN12 | - | - | - | X | Catalog flow `pingfederate-admin-mcp` applicable under PF; lane not up, no live result. |
| ADMIN13 | - | - | - | X | No entry in demoReadinessCatalog.js (not an executable Demo Step); not exercised by the readiness runner. |

## Known failures and causes

None confirmed: nothing was run live. Candidates to confirm when the PF lane is up:

- UC2 / UC2.5 / UC2.6 (flow `pingfederate-a2a`): A2A is expected to lose the `act` claim under PingFederate. UNCONFIRMED; no log or token evidence collected. The catalog gives these three their own flow and credential roles (`standard-agent-exchanger`, `ai-agent-actor`, `a2a-specialist`), which is consistent with it being a known special case.
- PingGateway introspection of PF-issued tokens (all MCP-tool use cases): expected to reject them unless `FF_MCP_GATEWAY_JWKS=true`. The PF readiness BFF lane already sets it (`docker-compose.readiness.yml` line 161, `readiness-bff-pingfederate`), so the PF edition's compose/env must set it too. UNCONFIRMED live.
- Readiness profile note: `demoReadinessPingFederateProfiles.json` says roles `davinci-login`, `cimd`, `third-party-authorization-server`, `rar` have nothing behind them in the local PF and "fail until provisioned". Those are likely failures for any use case depending on them (not mapped per id here).

## Catalog cross-check

Built the catalog with `buildDemoReadinessCatalog` (read-only, node, no stack contact): 47 rows, 0 validation issues. PingFederate flow per row: `pingfederate-standard` (most), `pingfederate-a2a` (UC2, UC2.5, UC2.6), `pingfederate-workload` (UC38, UC44), `pingfederate-native-id-jag` (UC40), `pingfederate-admin-mcp` (ADMIN1-12). The only explicit not-applicable reason is UC40 for PingOne. The runner never got far enough to produce its own applicability, so runner-vs-catalog disagreement cannot be assessed; no disagreement observed.

## Proposed dropUseCases for the PF edition

Derived from the catalog: none. No id is not-applicable under PingFederate. Do not drop UC40 (it is the PF-native journey). Pending a live run, the only candidates to drop are ids that fail for a cause not fixable in PF-edition config; none can be named without evidence. Caveat: the 36 ids with no catalog entry (UC3, UC4, UC9, UC15, UC16, UC16b, UC19, UC21, UC23, UC26-29, UC33-35, UC37, UC39, UC41, UC42, UC-TOOL2, UC-NHI1, UC-NHI2, UC-LEARN1-10, UC-LEARN12, UC-LEARN13, ADMIN13) have no readiness verdict under either provider, so this baseline says nothing about them.

## What I ran vs what I could not run

Ran:
- `npm run serve:worktree` (no argument, read-only): BFF and UI both served from the main checkout; no other worktree claimed the stack. Exit 0.
- `npm run -s stack:generation` before; `npm run -s stack:generation -- --check <value>` after: "stack unchanged, the run stands".
- `npm run demo:ready:local -- --json` (from main checkout, stdin closed): exit 1, status `not-ready`, 37 ms. Both `worker-health:local:pingone` and `worker-health:local:pingfederate` were `blocked`: "Readiness worker request failed." No rows, no repair preview, nothing mutated. (A flag to scope the runner to PingFederate only does not exist: `--target` selects local/se/both, not provider.)
- A read-only node script building the catalog and listing the 84 ids.

Could not run (lane not up; `docker ps` shows only `ai-demo-pingfederate` of the PF pieces, no `ai-demo-readiness-*` containers): the readiness workers on :4444 (PingOne) and :4445 (PingFederate) and `readiness-bff-pingfederate`. To get the live baseline, the user starts them (not done here, by ruling):

```
docker compose -f docker-compose.yml -f docker-compose.readiness.yml up -d readiness-bff-pingone readiness-worker-pingone readiness-bff-pingfederate readiness-worker-pingfederate
node scripts/pingfederate/provision-readiness-lane.js --apply   # PF lane provisioning, per header of docker-compose.readiness.yml
npm run demo:ready:local -- --json
```

(Check the header comments of `docker-compose.readiness.yml` for the exact service list and prerequisites before running.) Then re-run this table.
