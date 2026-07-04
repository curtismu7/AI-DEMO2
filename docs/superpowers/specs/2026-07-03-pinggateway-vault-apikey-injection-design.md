# PingGateway Vault-Sourced API-Key Injection — Design

**Date:** 2026-07-03
**Status:** Approved (design) — pending implementation plan
**Branch:** `feat/pinggateway-vault-apikey`

## Goal

Demonstrate **credential mediation** through PingGateway/IG: a fake backend API key
lives encrypted in the vault; **PingGateway/IG pulls it from the vault at request
time and injects it** (`X-API-Key`) when proxying to backend resources
(mortgage-service and mcp-invest). The AI agent/user token never carries the
backend key — IG mediates it. The injection is made **observable in the Token
Chain Trace Rail**.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Demo point | **Credential mediation** — gateway injects a secret backend key the agent never sees; vault is the secure source instead of plaintext config |
| 2 | Vault→gateway bridge | **Runtime fetch** — IG fetches the key from a BFF endpoint at request time (cached), not baked into config |
| 3 | Backend enforcement | **Injected + observable** (not a new hard gate). Mortgage happens to already enforce `X-API-Key`; investment is observe-only |
| 4 | Which gateway | **PingGateway/IG** is the actor (explicitly, not the Node mcp-gateway) |
| 5 | Backends | **Both** mortgage (`mortgage-service:8082`) and investment (`mcp-invest:8081`) |
| 6 | Observability | New **Token Chain Trace Rail** step showing the injection |

## Current-state facts (from codebase exploration)

- The existing "api_key disposition" lives **entirely in the Node `mcp-gateway`**
  (`demo_mcp_gateway/src/apiKeyDispatch.ts`), **not** PingGateway/IG. On
  `show_mortgage` it drops the bearer and calls `mortgage-service` with
  `X-API-Key` + `X-User-Sub`. **This design moves the injection actor to IG.**
- The key is read from **`process.env.DEMO_MORTGAGE_SERVICE_KEY`**
  (`demo_mcp_gateway/src/config.ts:234`, fallback `demo-mortgage-key-0000`) —
  **not** the vault. `DEMO_MORTGAGE_SERVICE_KEY` is in the vault-migration list
  (`demo_api_server/scripts/vault-migrate.js:80`) but **not** in `secrets.vault`.
- **Docker bug (fix as part of this):** the gateway's mortgage base URL defaults
  to `localhost:8082`, unreachable from inside the container. Must resolve to
  `http://mortgage-service:8082`.
- `mortgage-service` (`demo_mortgage_service/server.js`) validates `X-API-Key`
  (constant-time, 401 on mismatch), reads `MORTGAGE_SERVICE_API_KEY`
  (default `demo-mortgage-key-0000`). **No JWT/aud check** — pure shared-secret.
- IG reads secrets via `SystemAndEnvSecretStore` (env). IG routes today:
  `01-mcp-olb` (→ mcp-server), `02-mcp-invest` (→ mcp-invest), JWKS routes,
  `03-oauth-passthrough`. **No route to :8082.**
- Token Chain Trace Rail: `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`
  is a **pure function** emitting a fixed ordered set of steps, keyed off named
  token events / phases held in the client-side singleton `tokenChainTraceStore`.
  The api_key path's own token events (`evt-swap`, `evt-backend`, …) are **not
  currently consumed**. A new step needs: (a) a gateway-emitted event, (b) the
  store surfacing it into `trace.tokenEvents`, (c) a new branch + `LANES`/`TITLES`
  entry in `buildTraceSteps`.

## Architecture

IG becomes a **secret-injecting reverse proxy** in front of each backend. MCP
protocol translation stays in the Node `mcp-gateway` (mortgage-service speaks
REST, not MCP); IG owns the vault-key pull + header injection + backend proxy.

### Mortgage (`show_mortgage`) — new path

```
Agent → BFF → mcp-gateway (Node, MCP entry)
     → [rewire: forward to IG instead of calling the backend directly]
     → PingGateway/IG  ▸ NEW mortgage route (04-mortgage.json)
          1. JWKS-validate user JWT + require mortgage:read scope   [existing IG pattern]
          2. Groovy vault-key-inject filter:
               - GET key from BFF bridge (cached, TTL)
               - remove Authorization (drop bearer)
               - add X-API-Key: <DEMO_MORTGAGE_SERVICE_KEY>
          3. ReverseProxyHandler → http://mortgage-service:8082
     → mortgage-service validates X-API-Key (already does) → demo record
     ← mcp-gateway wraps the REST result into a JSON-RPC MCP result
       + emits a vault-key-inject token event (masked last4 of the injected key)
```

### Investment (`show_investments` etc.) — augment existing IG invest route

```
… IG 02-mcp-invest route (existing RFC 8693 token-exchange unchanged)
   + run the same Groovy to ALSO add X-API-Key: <DEMO_INVEST_SERVICE_KEY>
   → mcp-invest observes/logs "received key ✓"  (observe-only, no enforcement)
```

### Consequences called out

1. **Node-gateway rewire:** `show_mortgage` is handled *locally* today and never
   reaches IG. `router.ts` / `apiKeyDispatch.ts` must forward it to IG's mortgage
   route and stop holding the key. This is the core change on the Node side.
2. **Docker base-URL bug fixed here** — IG proxies to `http://mortgage-service:8082`.
3. **The key never lives in gateway config** — IG fetches it from the vault via
   the BFF bridge at request time, cached briefly.

## Components

### 1. Vault entries
- Add to `secrets.vault` (via vault CLI + `VAULT_PASSWORD`):
  - `DEMO_MORTGAGE_SERVICE_KEY = demo-mortgage-key-0000` (must match
    `mortgage-service`'s `MORTGAGE_SERVICE_API_KEY`)
  - `DEMO_INVEST_SERVICE_KEY = demo-invest-key-0000` (observe-only; value need not
    match anything the backend checks)
- They load into the BFF `configStore` at boot via the existing vault loader.

### 2. BFF bridge endpoint
- `GET /internal/vault/service-key?name=<KEY_NAME>`
- Auth: existing `BFF_INTERNAL_SECRET` shared-secret header.
- **Hard allow-list:** returns only `{DEMO_MORTGAGE_SERVICE_KEY, DEMO_INVEST_SERVICE_KEY}`.
  Any other name → `404` (never leak a real secret). Missing/bad secret → `401`.
- Response: `{ name, value }`. Reads from `configStore` (vault-fed).

### 3. IG route + Groovy
- `ping-gateway/config/routes/04-mortgage.json` — JWKS validate + `mortgage:read`
  + `vault-key-inject` Groovy + `ReverseProxyHandler → PG_MORTGAGE_BACKEND_URL`.
- `ping-gateway/scripts/groovy/vault-key-inject.groovy` — fetch key from BFF
  bridge (with `BFF_INTERNAL_SECRET`), in-memory cache with TTL, drop
  `Authorization`, add `X-API-Key`. Parameterized by which key name to fetch.
- Modify `ping-gateway/config/routes/02-mcp-invest.json` — after token-exchange,
  run the Groovy to add `X-API-Key: <DEMO_INVEST_SERVICE_KEY>` (observe-only).

### 4. Node mcp-gateway
- `router.ts` / `apiKeyDispatch.ts` — route `show_mortgage` through IG's mortgage
  route; wrap the REST response into the JSON-RPC result; emit the
  `vault-key-inject` token event with the **actually-injected** key's last4.

### 5. Token Chain Trace Rail
- `buildTraceSteps.js` — add `vault-key-inject` to `LANES` (gateway lane) and
  `TITLES`, plus a branch that renders the step from the new event.
- `tokenChainTraceStore.js` — surface the event into `trace.tokenEvents`.
- Card copy: "PingGateway injected vault API key ••••0000 → mortgage-service".

### 6. Compose / env wiring
- IG: `PG_MORTGAGE_BACKEND_URL=http://mortgage-service:8082`, enable
  `04-mortgage.json`, ensure `BFF_INTERNAL_SECRET` + BFF bridge URL reachable
  from the IG container.
- mcp-gateway: point the mortgage path at IG's route; ensure the Docker base URL
  is correct (fixes the `localhost:8082` bug).

## Error handling

- **Bridge unreachable / key missing:** IG Groovy fails closed for mortgage
  (return `502`/`503` — no un-keyed call to a key-gated backend). For invest
  (observe-only) it logs and proceeds without the `X-API-Key` header.
- **Cache:** short TTL (e.g. 60s); on fetch error serve last-known-good if within
  a grace window, else fail per above.
- **Allow-list violation:** bridge returns `404`; IG treats as key-missing.

## Testing & drift

- **Unit:** vault entries present and readable; bridge returns key for
  allow-listed name, `401` unauth, `404` non-allow-listed; `buildTraceSteps`
  emits the new step given the event.
- **Integration:** `show_mortgage` end-to-end returns the record and the backend
  received `X-API-Key`; invest call carries the injected header; Rail shows the
  new step.
- **Drift gate:** update `scope-topology.json` / service-topology as needed so the
  `topology:verify` no-drift gate stays green (routing changes touch topology).
- **Live demo check** on the running Docker stack.

## Out of scope

- Rotating or changing any real secret.
- Making `mcp-invest` enforce the injected key (stays observe-only).
- Adding api_key dispositions for other verticals (healthcare/retail) — those
  tool names exist but are not part of this change.
