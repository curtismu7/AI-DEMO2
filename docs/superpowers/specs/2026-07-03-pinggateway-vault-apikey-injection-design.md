# PingGateway/IG Vault-Sourced API-Key Injection — Design

**Date:** 2026-07-03 (revised 2026-07-04 after codebase exploration)
**Status:** Approved (design) — implementation plans authored per phase
**Branch:** `feat/pinggateway-vault-apikey`

## Goal

Demonstrate **credential mediation through PingGateway/IG**: a fake backend API
key lives encrypted in the vault; **IG pulls it from the vault at request time
and injects it (`X-API-Key`)** when proxying to backend resources
(`mortgage-service` and `mcp-invest`). The user's OAuth token never carries the
backend key — IG mediates it. Each injection is **observable in the Token Chain
Trace Rail**.

## Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Demo point | Credential mediation — IG injects a secret backend key the agent never sees; vault is the secure source |
| 2 | Vault→gateway bridge | Runtime fetch — IG fetches the key from a BFF endpoint at request time (cached) |
| 3 | Backend enforcement | Injected + observable. Mortgage already enforces `X-API-Key`; investment is observe-only |
| 4 | Which gateway | **PingGateway/IG** (`ai-demo-ping-gateway`), the enforcement point when `ff_mcp_gateway_pinggateway=true` (the running-stack default) |
| 5 | Backends | Both mortgage (`mortgage-service:8082`) and investment (`mcp-invest:8081`) |
| 6 | Observability | New Token Chain Trace Rail step per injection |
| 7 | IG→BFF trust | **Mount the mkcert CA into IG + import to the JVM truststore**; IG→BFF stays TLS-verified (approach A) |
| 8 | Delivery | **Three sequential, independently-testable phases** (Foundation → Investment → Mortgage) |

## Gateway reality (confirmed by exploration)

- Two gateways exist. **PingGateway/IG** (`ai-demo-ping-gateway`, ForgeRock IG,
  JSON routes + Groovy in `ping-gateway/`) and a Node **`mcp-gateway`**
  (`demo_mcp_gateway/`, TS, :3005). The flag `ff_mcp_gateway_pinggateway`
  selects which one handles MCP traffic — **they are alternatives, not chained**
  (`configStore.js:311`). The running stack routes through **IG**.
- The existing mortgage "api_key disposition" lives **only in the Node gateway**
  (`demo_mcp_gateway/src/apiKeyDispatch.ts`) and therefore **does not run on the
  IG path**. This design brings that mediation into IG.
- **Routing:** the BFF client always POSTs to `${gateway}/mcp`
  (`demo_api_server/services/mcpGatewayClient.js:58-60`); there is **no per-tool
  path logic**. IG selects routes purely by `request.uri.path`
  (`01-mcp-olb.json` matches `^/mcp(?!/invest)`, `02-mcp-invest.json` matches
  `^/mcp/invest`).
- **Protocol:** `mortgage-service` (`demo_mortgage_service/server.js`) is REST
  (`GET /mortgage`, validates `x-api-key` via SHA-256 + `timingSafeEqual`, 401 on
  mismatch). `mcp-invest` is an MCP server. So the mortgage hop is a REST↔MCP
  translation, not a plain reverse-proxy.
- **TLS:** the BFF serves `/internal/*` **HTTPS-only** in Docker
  (`server.js:2291-2316`, cert files always present). The IG container has **no
  mkcert CA** mounted today; all its internal calls are plain HTTP, all its HTTPS
  calls go to public PingOne CAs. IG→BFF over TLS therefore requires the mkcert CA
  in IG's JVM truststore (decision #7).
- **Trace Rail** is a pure client-side builder
  (`demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`): fixed ordered
  steps keyed off named `tokenEvents`/`phases` in the `tokenChainTraceStore`
  singleton. A new step needs (a) a gateway-emitted event carried in the MCP
  result `_meta.tokenEvents`, (b) store surfacing, (c) a new `LANES`/`TITLES`
  entry + branch in `buildTraceSteps`.

## Architecture

IG becomes the vault-key injector on both backend paths. Investment is a small
header-inject on the existing route; mortgage is a new path + scriptable handler
that also does the REST↔MCP translation.

### Investment (`get_investment_*`) — augment existing IG invest route

```text
Agent → BFF → IG  ▸ 02-mcp-invest route (existing RFC 8693 token-exchange, unchanged)
     + NEW Groovy filter (vault-key-inject): GET vault key from BFF bridge (cached),
       add header  X-API-Key: <DEMO_INVEST_SERVICE_KEY>
     → ReverseProxy → mcp-invest:8081   (observe-only; mcp-invest logs "received key ✓")
     + IG augments the response _meta.tokenEvents with a `vault-key-inject` event
```

### Mortgage (`show_mortgage`) — new BFF path + new IG route + scriptable handler

```text
Agent → BFF (NEW: tool→path map routes show_mortgage to `${gateway}/mcp/mortgage`)
     → IG  ▸ NEW 04-mcp-mortgage route (condition ^/mcp/mortgage)
          1. inbound rsFilter/introspection + require mortgage:read scope   [existing IG filters]
          2. Scriptable HANDLER (mortgage-apikey-dispatch.groovy):
               - GET vault key from BFF bridge (cached, TLS-verified)
               - GET http://mortgage-service:8082/mortgage  with X-API-Key (no bearer)
               - build the MCP JSON-RPC result: content[].text = JSON.stringify(record),
                 _meta.credentialPath='api_key', _meta.tokenEvents=[evt-inbound, evt-scope,
                 evt-swap(masked last4), evt-backend, vault-key-inject]
     → returns MCP result to the BFF/agent
```

Mortgage uses a **handler**, not a `ReverseProxyHandler`, because it converts a
REST record into an MCP JSON-RPC result. It reuses the JSON-RPC shape currently
produced by `demo_mcp_gateway/src/apiKeyDispatch.ts` so the UI is unchanged.

## Components (by phase)

### Phase 1 — Foundation (vault + BFF bridge + IG↔BFF trust)

1. **Vault entries** (`secrets.vault`, via vault CLI + `VAULT_PASSWORD`):
   - `DEMO_MORTGAGE_SERVICE_KEY = demo-mortgage-key-0000` (must match
     `mortgage-service`'s `MORTGAGE_SERVICE_API_KEY`).
   - `DEMO_INVEST_SERVICE_KEY = demo-invest-key-0000` (observe-only).
   - Add `DEMO_INVEST_SERVICE_KEY` to the `vault-migrate.js` allow-list
     (`DEMO_MORTGAGE_SERVICE_KEY` is already there, line 80).
2. **BFF bridge** `demo_api_server/routes/vaultServiceKey.js`, mounted
   `app.use('/internal', require('./routes/vaultServiceKey'))`:
   - `GET /internal/vault/service-key?name=<NAME>`.
   - Guard: `x-internal-gateway-secret` header === `BFF_INTERNAL_SECRET`
     (`crypto.timingSafeEqual`, mirroring `routes/mcpAuditIngest.js`). 403 on miss.
   - **Allow-list** `{DEMO_MORTGAGE_SERVICE_KEY, DEMO_INVEST_SERVICE_KEY}`; other
     names → 404 (never leak a real secret).
   - Reads `configStore.get('<name lowercased>')`; 404 if unset.
   - Response `{ name, value }`.
3. **IG↔BFF trust + env wiring** (`docker-compose.yml` `ping-gateway`):
   - Mount `./certs:/certs:ro`; override `entrypoint` to
     `keytool -importcert` the mkcert root into `$JAVA_HOME/lib/security/cacerts`
     (idempotent) before `start.sh`.
   - Add IG env: `BFF_INTERNAL_SECRET`, `BFF_VAULT_KEY_URL`
     (`https://demo-api-server:3001/internal/vault/service-key`),
     `PG_MORTGAGE_BACKEND_URL` (`http://mortgage-service:8082`).
   - Teach `demo_api_server/scripts/refresh-service-envs.js` to write
     `BFF_INTERNAL_SECRET` + the mortgage vars into `ping-gateway/.env` (it is
     auto-generated; hand edits are overwritten).

### Phase 2 — Investment injection on IG

4. `ping-gateway/scripts/groovy/vault-key-inject.groovy` — GET
   `System.getenv('BFF_VAULT_KEY_URL')?name=DEMO_INVEST_SERVICE_KEY` with header
   `x-internal-gateway-secret: System.getenv('BFF_INTERNAL_SECRET')`, TLS-verified
   (`HttpURLConnection`, GET, `conn.inputStream.text`), cache in `globals` with a
   60s TTL, then `request.headers.put('X-API-Key', [key])`. On fetch failure: log
   and proceed without the header (observe-only).
5. Add the filter to `ping-gateway/config/routes/02-mcp-invest.json` before the
   `ReverseProxyHandler`.
6. IG augments the invest MCP response `_meta.tokenEvents` with a
   `vault-key-inject` event (masked last4).
7. **Trace Rail:** add `vault-key-inject` to `LANES` (`GATEWAY`) + `TITLES`, a
   `steps.push(makeStep('vault-key-inject', …))` branch after `gateway` in
   `buildTraceSteps.js`, and surface the event via `ingestTokenEvents`. Update the
   empty-trace test (now 12 ids) and add an evidence test.

### Phase 3 — Mortgage injection on IG

8. **BFF tool→path routing** — `demo_api_server/services/mcpGatewayClient.js`:
   a tool→path map so `show_mortgage` posts to `${base}/mcp/mortgage`
   (default `${base}/mcp` for all others). Thread the existing `tool` arg into the
   URL build at line 60.
9. `ping-gateway/config/routes/04-mcp-mortgage.json` — condition `^/mcp/mortgage`,
   inbound rsFilter + `mortgage:read` scope, then the scriptable handler.
10. `ping-gateway/scripts/groovy/mortgage-apikey-dispatch.groovy` — fetch vault
    key (reuse the Phase-2 cache helper), `GET PG_MORTGAGE_BACKEND_URL/mortgage`
    with `X-API-Key`, build the MCP JSON-RPC result (shape from
    `apiKeyDispatch.ts:153-199`) incl. `_meta.tokenEvents` with `vault-key-inject`.
11. **Trace Rail:** mortgage path now emits the same `vault-key-inject` event;
    covered by the Phase-2 builder change. Add a mortgage evidence test.
12. **Topology/env:** register `PG_MORTGAGE_BACKEND_URL` /
    `MORTGAGE_SERVICE_URL` in `service-topology.json` (`mortgage-service` already
    in `services`) so `npm run topology:check` stays green.

## Error handling

- **Bridge unreachable / key missing:**
  - Mortgage (key-gated backend): **fail closed** — return an MCP JSON-RPC error
    (`-32500`), never call the backend un-keyed.
  - Investment (observe-only): log and proceed without the `X-API-Key` header.
- **Cache:** per-key in-memory in IG `globals`, 60s TTL; on refresh error within a
  grace window serve last-known-good, else per the rule above.
- **Allow-list violation / unknown name:** bridge returns 404; IG treats as
  key-missing.
- **Secret guard:** bridge 403 on missing/wrong `x-internal-gateway-secret`.

## Testing & drift

- **Phase 1:** unit — bridge returns the key for an allow-listed name, 403 without
  the secret, 404 for a non-allow-listed name, 404 when the key is unset
  (`supertest`, pattern from `agentIdToken.integration.test.js`); vault entries
  present via `vault:list`. Live — from inside `ai-demo-ping-gateway`, an HTTPS GET
  to the bridge returns the key (proves the truststore import).
- **Phase 2:** unit — `buildTraceSteps` emits the `vault-key-inject` step given the
  event; the empty-trace id list updates to 12. Integration — an invest tool call
  carries `X-API-Key` to `mcp-invest` and the Rail shows the step.
- **Phase 3:** unit — `mcpGatewayClient` builds `/mcp/mortgage` for `show_mortgage`
  and `/mcp` otherwise. Integration — `show_mortgage` end-to-end returns the record,
  `mortgage-service` saw a valid `X-API-Key`, the Rail shows the step.
- **Drift:** `npm run topology:check` green after the mortgage backend var is added.
- **Live demo check** on the running Docker stack each phase.

## Test frameworks / commands

- BFF: Jest — `cd demo_api_server && npx jest <pattern>`.
- UI: Vitest — `cd demo_api_ui && npx vitest run <pattern>`.
- Node gateway (reference only; not modified): Jest — `cd demo_mcp_gateway && npx jest`.
- Topology gate: `npm run topology:check` (repo root).

## Out of scope

- Rotating or changing any real secret.
- Making `mcp-invest` hard-enforce the injected key (stays observe-only).
- api_key dispositions for other verticals (healthcare/retail/etc.).
- Removing the Node gateway's existing api_key path (left intact for the
  flag-false route).
