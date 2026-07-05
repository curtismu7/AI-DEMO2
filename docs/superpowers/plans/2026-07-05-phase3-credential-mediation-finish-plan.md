# PingGateway Credential-Mediation Demo — Finish Plan

**Date:** 2026-07-05
**Status:** IG mechanism proven end-to-end; live path blocked by a chain of wiring/config issues (not route-code bugs).
**Goal:** A live signed-in `show_mortgage` / `show_investment` flows through PingGateway/IG → token validated (introspection or JWKS per FF) → PingOne Authorize PERMIT → vault key fetched → `X-API-Key` → `demo_data_service` record → `vault-key-inject` in the Token Chain.

---

## Done and merged (on `main`)

| PR | What |
|----|------|
| #137 | Wired the encrypted `secrets.vault` into the running stack |
| #154 | Phase 1+2: vault bridge (`/internal/vault/service-key`), IG mkcert truststore, invest app + credential-mediation UI evidence, **investment vertical** |
| #173 | Working IG `/mcp/apikey` route + `apikey-dispatch` handler. Fixed: the missing `RsFilterChain` heap object (route never built), a non-compiling handler, the **Vert.x event-loop deadlock** (`McpValidationFilter` now buffers the body before the handler reads `request.entity.string`), the vault-URL host (`demo-api-server` → `api.ping.demo`, matching the mkcert cert SAN), and IG↔BFF `BFF_INTERNAL_SECRET` alignment. **Handler proven end-to-end in isolation (returns the mortgage record in ~0.38s).** |
| #174 | p1az authorization filter on the api-key route + FF-based **JWKS validation variant** (`00-mcp-apikey-jwks.json`, selected by `X-Token-Validation: jwks`; name-based precedence `mcp-apikey-jwks` < `mcp-apikey-primary`). |
| #176 | BFF routes api-key tools (`show_mortgage`, `show_investment`, …) to `/mcp/apikey` when the gateway base is PingGateway (`base === pgUrl`). Required for *any* traffic to reach the api-key routes. |

**The IG route + handler + p1az wiring is correct and verified.** What remains is live-path wiring/config.

---

## Remaining blockers (ordered by how they surface)

### 1. BFF error-classifier masks the real IG rejection (CODE)
`demo_api_server/services/mcpGatewayClient.js:232` builds `expectedAud` from the **Node-gateway** resource
(`pingone_resource_mcp_gateway_uri` = `mcpgateway.ping.demo`) and compares it to the token's **IG** aud
(`https://api.ping.demo:3036/mcp`). The token aud is *correct* for the IG path, but the mismatch makes the BFF
report a false **"Wrong audience … set MCP_SERVER_RESOURCE_URI"** message — hiding whatever IG actually rejected.

### 2. IG's real rejection on `/mcp/apikey` (IG ROUTE) — unknown until #1 is fixed
Candidates: the route reuses the global `rsFilter`; if its audience enforcement differs from the token's aud, IG 401s.
Or `McpValidationFilter` rejects the MCP shape. Or it's the p1az DENY (blocker #3).

### 3. PingOne Authorize policy DENYs the api-key path (PINGONE CONFIG)
Live decision: `DENY` with statements:
- *"MCP tool 'show_mortgage' authorization denied. Token audience 'mcpgateway.ping.demo' or actor chain validation failed."*
- *"Actor client ID 'f4dd707d-f78d-4417-ba56-dc8707d10a1f' is not a registered actor in the RFC 8693 delegation chain."*

The policy is built for the OLB/token-exchange flow; the api-key path's token/actor context doesn't satisfy it.

---

## The plan

### Phase A — Unmask the real error (BFF code, ~15 min) — can do now, no PingOne auth
- In `mcpGatewayClient.js:232-236`, replace the hard-coded `expectedAud` with `resolveExpectedMcpResourceUri()`
  from `services/mcpToolAuthorizationService` (it already returns the IG resource `https://api.ping.demo:3036/mcp`
  when `ff_mcp_gateway_pinggateway` is on). Keep the existing chain as a fallback for the Node-gateway path.
- **Verify:** re-fire `show_mortgage` via the app; the response no longer says "Wrong audience" — IG's true rejection surfaces (read `docker logs ai-demo-ping-gateway` + the BFF `[GW→PingGateway] RESPONSE`).

### Phase B — Fix IG's real rejection (IG route, ~30 min) — can do now, no PingOne auth
Depending on what Phase A reveals:
- **If audience/scope at `rsFilter`:** give `00-mcp-apikey.json` its **own** `OAuth2ResourceServerFilter` in its
  heap that validates against `${env['PG_GATEWAY_RESOURCE_ID']}` (`https://api.ping.demo:3036/mcp` — the token's
  actual aud, same value the OLB route's `McpProtectionFilter` uses) instead of the shared global `rsFilter`.
  Do the same in `00-mcp-apikey-jwks.json` if applicable.
- **If `McpValidationFilter`:** adjust config for the api-key tools.
- **If p1az DENY:** proceed to Phase C.
- **Verify:** the call reaches `apikey-dispatch` and returns the mortgage record.

### Phase C — PingOne Authorize policy for the api-key path (PingOne config) — needs PingOne access
- **Option 1 (actor):** register the AI-agent actor (`f4dd707d-…`) in the delegation-chain policy for the
  api-key tools.
- **Option 2 (scope branch):** add an api-key branch to the MCP-tool decision policy that PERMITs
  `show_mortgage` / `show_investment` on the presented scope, not actor-chain.
- **How:** hosted **PingOne MCP tools** (requires the connector authorized — run in an *interactive* Claude Code
  session) or the **Management API** with the worker creds.
  Env `01d89b06-66d5-430e-9f28-65636843788b`, decision endpoint `84d45731-4c43-4ab1-ab6a-0350e9dfe8e1`,
  authorization version `b7fc44b0-7615-11f1-9bff-f9665b488a5d`.
- **Cannot** be done from a non-interactive session (PingOne connector not authorized there).

### Phase D — End-to-end verification
Sign in as `demoUser` / `Baseball123!` (from `demo_api_server/.env`), trigger the mortgage/investment feature,
and confirm the full chain: token validated (introspection or JWKS per `ff_mcp_gateway_jwks`) → PERMIT →
vault key → `X-API-Key` → record → `vault-key-inject` token event in the Token Chain Trace Rail.

---

## Config drift to reconcile alongside (`scope-topology.json`)
`PG_GATEWAY_RESOURCE_ID` (`https://api.ping.demo:3036/mcp`) and `PG_GATEWAY_RESOURCE_URI`
(`mcpgateway.ping.demo`) are two names for the PingGateway resource that disagree. Phase B's route-audience fix
should key off the value the **token actually carries** (`PG_GATEWAY_RESOURCE_ID`). Longer term, align these in
`scope-topology.json` so the BFF-minted aud and the IG-validated aud are the same string.

---

## Deployment notes (running stack)
- The running checkout is on `fix/architectural-improvements`; live fixes have been `cp`-deployed into it for
  testing (BFF hot-reloads via `node --watch`; IG hot-reloads `config/routes` + `scripts/groovy`, but truststore/env
  changes need `docker compose -p ai-demo2 up -d --force-recreate --no-deps ping-gateway`).
- IG selects among matching routes by the route **`name`** field, **not** filename — keep `mcp-apikey-jwks` sorting
  before `mcp-apikey-primary` (mirrors the `mcp-olb-jwks` / `mcp-olb-primary` pair).
- The stack was torn down once mid-work (concurrent session `down`/`stop`); restore with
  `docker compose -p ai-demo2 -f docker-compose.yml -f docker-compose.override.yml up -d`.

## Ownership summary
- **Phases A + B**: code/IG — no PingOne auth needed; doable in any session.
- **Phase C**: PingOne Authorize policy — needs an interactive session with the PingOne connector authorized (or Management API access).
