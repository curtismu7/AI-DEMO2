# MCP server standardization — design

Date: 2026-10-13 · Status: **ON HOLD — superseded 2026-10-13** · Path: architectural

> **On hold.** The user decided on 2026-10-13 to **keep all MCP servers for now**
> (the weather server, among others, was missed when the set was chosen). The
> five-server set and the freeze below are **not in effect**. Nothing was
> implemented. If this resumes, two things change before any plan is written: the
> set is re-chosen, and the design cannot reuse `serverInventory.js`, which lists
> only four MCP servers (banking, invest, brave, code-search) — it has no
> OpenSearch, hostile, PingOne or weather entries — so a standalone manifest is
> needed.

## Intent

The repo has accumulated more MCP servers than the demos can honestly support.
Pick a small fixed set, make every demo and test agree on it, and stop the set
quietly growing back.

**Done looks like:** (1) one place says which MCP servers are active; (2) the
default stack, the demo UI, the use-cases and the cross-cutting tests reference
only those; (3) a hygiene gate fails when something else creeps back in; (4) the
A2A demo still runs end to end.

## Decisions (agreed with the user)

| Decision | Choice |
|---|---|
| The set | **Five**: banking, investments, opensearch, hostile (malicious), PingOne |
| A2A | Kept. Ships as one **A2A bundle**: main agent + worker agent + its access-review tool server (`a2a-mcp-tools`). Not a sixth standalone server |
| Everything else | **Frozen**: code stays, but it leaves compose defaults, demos, nav, tests and docs. Reversible |
| Approach | Reuse the existing inventory + one small gate, rolled out as four PRs |

## The set, mapped to what exists

| Role | What it is today | Where it lives |
|---|---|---|
| Banking | `oauth-mcp/` — service key `mcp-server` ("MCP Server (OLB)", :8080) | `serverInventory.js`, compose default |
| Investments | `demo_mcp_resource_server/` — key `mcp-resource-server` ("MCP Invest", :8081) | `serverInventory.js`, compose default |
| OpenSearch | Privilege doors `opensearch`, `opensearch-hitl`; compose `opensearch` + `opensearch-mcp-server` | compose profile `mcpgw` (not default) |
| Hostile | Privilege doors `hostile-mcp`, `hostile-mcp-governed`; Remote Agent `hostile-a2a` | Privilege tenant + `hostile-mcp-server` / `hostile-a2a-agent` deployments |
| PingOne | `demo_mcp_pingone/` — PingOne's own MCP server as a sidecar behind Privilege (`pingone-admin-local` door) | Privilege pod; **no compose service** |
| A2A bundle | `standalone/privilege-a2a-anthropic-demo/` (`main-agent`, `worker-agent`, `mcp-server`) + door `a2a-mcp-tools`, `worker-agent` | k8s deployments `mainagentdemo`, `workeragentdemo`, `mcpdemo` |

**Frozen:** `demo_mcp_brave` (`mcp-brave`), `demo_mcp_weather` (`mcp-weather`),
`demo_mcp_grafana`, `demo_mcp_code_search` (`demo-mcp-code-search`),
`demo_mcp_banking_rest`, `librechat` MCP wiring, tenant doors `brave`, `libre`,
`mcp-brave-search`, `mcp-grafana`. Two more tenant doors were examined in the repo's Privilege docs:
`agent-gateway` fronts the real PingGateway, so it is gateway plumbing and out of
scope (like `ping-gateway`); `banking-openapi` is Ping's OpenAPI adapter sidecar
over the banking REST API, a second banking door. It is proposed **frozen**, and
is open question 5 below. Any other tenant door not named here is classified in
PR 3 before anything is removed.

**Not in scope (not MCP servers):** the gateways and security plumbing —
`demo_mcp_gateway`, `ping-mcpgw`, `demo_mcpgw*`, `demo_mcp_proxy`,
`demo_mcp_audit`, `demo_mcp_promptguard`, `demo_mcp_jwt_verifier` — and the four
aggregate apps in the tenant. Unchanged by this work.

## Design

**Source of truth: the existing `demo_api_server/data/serverInventory.js`.** Its
entries already carry `category: 'mcp'`. Add one field to each MCP entry,
`mcpSet: 'core' | 'a2a-bundle' | 'frozen'`. No new manifest file.

**Gate: one small script**, `scripts/check-mcp-set.js`, added to `hygiene:check`.
It reads `serverInventory.js` as text (same dependency-free approach as
`check-service-map-complete.js`, since CI's hygiene job has no root
`node_modules`) and fails if:

1. an MCP entry has no `mcpSet`;
2. a `frozen` server's compose service has no `profiles:` key (so it starts by
   default);
3. a demo surface names a `frozen` server: `demo_api_ui/src/config/`
   (`pageGuides`, `demoStepGuides`, `navPagePaths`, `useCaseDiagrams/*`, ...),
   `demo_api_ui/src/service-topology.json`, or `demo_api_server/config/`.
   Exceptions go in a short allowlist file with a reason per line.

**Doors:** the existing `npm run demo:preflight` already probes every MCP door.
Point it at the five + A2A bundle instead of adding a probe.

**Tests:** a test that exercises a demo flow or a cross-service wiring check
(`standalone/ai-gateway-client/server/relay.test.js`, `scripts/check-se-*-wiring`,
`scripts/check-mcp-preflight`, `scripts/check-auth-requirements`, and similar) is
retargeted to the five. A unit test that lives inside a frozen server's own
directory stays, untouched: the code is frozen, not deleted.

## Rollout — four PRs, each independently shippable

1. **Inventory + gate, report-only.** Add `mcpSet`, add `check-mcp-set.js`
   printing findings but exiting 0. Produces the real to-do list.
2. **Compose.** Put frozen services behind a `frozen` profile. Decide OpenSearch
   (see open question 3).
3. **UI and demos.** Remove frozen servers from nav, use-cases, page guides, demo
   steps and diagrams. Respect `REGRESSION_PLAN.md` §0–§1 and the emoji
   allowlist; `npm run authz:verify` and `npm run topology:verify` must pass.
4. **Tests and docs.** Retarget cross-cutting tests, update docs, then flip the
   gate from report-only to failing.

After every PR: `./run-tests.sh unit`, `npm run hygiene:check`, and the A2A demo
run (one access-review question through `worker-agent`) still pass.

## Risks

- `oauth-mcp` contains its own code-search tool group and tests. That is a tool
  group of the banking server, not a separate server, so it stays (open question 1).
- Frozen servers' scopes and tokens appear in `ping-gateway/config/scope-topology.json`
  and the token-exchange groovy. Those are token audiences, not demo surfaces:
  **not touched** in this work.
- Several sessions share one running stack. Compose changes land only through the
  documented deploy path; nothing is redeployed as part of the spec.

## Decisions on the open questions (confirmed by the user, 2026-10-13)

1. **Banking's code-search tools:** left untouched inside `oauth-mcp`; only the
   standalone `demo_mcp_code_search` service is frozen.
2. **`hostile-a2a`:** counts with the hostile set, not the A2A bundle.
3. **OpenSearch:** stays under compose profile `mcpgw`; demos state the profile
   they need rather than adding OpenSearch to the default stack.
4. **Frozen servers' own unit tests:** keep running in their own directories.

## Open question

5. **`banking-openapi`:** freeze it (proposed; banking already has `oauth-mcp`),
   or keep it as a sixth door to preserve the OpenAPI-to-MCP pattern demo.

## Out of scope

Deleting frozen code; changing gateways, the token-exchange flow or scopes;
adding any new MCP server; redeploying anything to the SE cluster.
