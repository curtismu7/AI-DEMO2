# PingGateway — alternative MCP gateway (Ping Identity IG)

PingGateway (Ping Identity Identity Gateway, image `ig:latest`) is a **user-selectable
second choice** for the MCP gateway, alongside the default Node `demo_mcp_gateway`. It is
the externally reachable MCP endpoint: the agent/BFF calls PingGateway, which introspects
the inbound token, runs the same PingOne Authorize decision as the Node gateway, performs an
RFC 8693 token exchange to the backend, and reverse-proxies to the MCP servers.

## What it does (per request)

1. **Inbound token validation** — `McpProtectionFilter` + `OAuth2ResourceServerFilter`
   introspect the bearer (PingOne, via the MCP exchanger client) and require the
   `banking:mcp:invoke` scope. No/invalid token -> `401`.
2. **MCP protocol validation** — `McpValidationFilter` parses the JSON-RPC body.
3. **Authorize decision** — `scripts/groovy/p1az-decision.groovy` builds the SAME 18-key
   `parameters` payload as the Node gateway's `buildAuthorizeParameters` and POSTs it to
   `<BASE>/governance/pap/alpha/policy/<P1AZ_WORKER_ID>/decision`. PERMIT continues; DENY /
   INDETERMINATE / error -> `403` (fail closed).
4. **RFC 8693 exchange** — `OAuth2TokenExchangeFilter` exchanges the inbound token for one
   scoped to the backend audience (`mcpserver.ping.demo` / `mcp-invest.ping.demo`), then a
   `HeaderFilter` swaps it onto the `Authorization` header.
5. **Reverse proxy** — to `mcp-server:8080` (`/mcp`) or `mcp-invest:8081` (`/mcp/invest`).

## Selecting PingGateway (runtime flag)

Toggle on the **/config** admin page (or via the feature-flags API):

- `ff_mcp_gateway_pinggateway` **ON** -> BFF routes MCP traffic to PingGateway
  (`mcp_pinggateway_url`, internal `http://ping-gateway:8080`).
- **OFF** (default) -> traffic goes through the Node `demo_mcp_gateway` (`:3005`).

The switch lives in `demo_api_server/services/mcpGatewayClient.js` `getMcpGatewayHttpUrl()` —
the single resolver every tool-call path uses.

## Live-switchable authorize backend (mock vs real)

PingGateway's decision backend follows the same **Simulated Authorize**
(`ff_authorize_simulated`) toggle as the rest of the demo, carried per request via the
`X-Authz-Simulated` header the BFF stamps:

- `ff_authorize_simulated` **ON** -> `X-Authz-Simulated: true` -> `P1AZ_MOCK_BASE`
  (`demo_authz_server`, no worker token).
- **OFF** -> `X-Authz-Simulated: false` -> `P1AZ_REAL_BASE` (real PingOne Authorize; the
  Groovy filter fetches a worker token via `client_credentials`).
- Header absent -> mock (default).

Security note (demo): the header is trusted because the BFF is the sole intended caller.
The host port (3036) is for curl/testing — a request hitting the gateway directly could
spoof `X-Authz-Simulated` to force the mock backend. Acceptable for a teaching demo; in
production strip the header at the edge or replace it with a server-side toggle.

## Running it

### In the main stack (recommended)

```bash
COMPOSE_PROJECT_NAME=ai-demo docker compose up -d ping-gateway
```

Published on host **3036** (`http://localhost:3036`) for curl/testing — **not 3006**, which
OrbStack reserves on macOS. In-stack the BFF reaches it by service DNS
`http://ping-gateway:8080`. Depends on `mcp-server`, `mcp-invest`, `authz-server`.

### Standalone

```bash
cd ping-gateway
cp .env.example .env   # fill in secrets
docker compose up -d   # also publishes 3036:8080
```

## PingOne prerequisite for the exchange

The RFC 8693 exchange targets backend audiences (`mcpserver.ping.demo`,
`mcp-invest.ping.demo`). These must exist as **PingOne Resource Servers**, and the MCP
exchanger client (`TE_CLIENT_ID`) must be permitted to request them — otherwise the
exchange returns `invalid_target`. The MCP servers accept the exchanged audience over the
HTTP transport; the gateway-audience token (`mcpgateway.ping.demo`) the Node gateway
forwards is handled on the WebSocket path. See `.env.example` for the full env contract and
the MCP-server-side reconciliation vars.

## Error states (all fail closed)

| Condition | Response |
|---|---|
| No / invalid inbound token | `401` (resource-server filter) |
| Authorize DENY / INDETERMINATE / decision error | `403 {"error":"access_denied", ...}` (Groovy) |
| Decision backend not configured | `403` (Groovy fails closed) |
| Token exchange failure (e.g. `invalid_target`) | `401 {"error":"token_exchange_failed"}` |

## Files

- `config/admin.json` — IG admin (PRODUCTION mode, streaming on).
- `config/routes/01-mcp-olb.json` — primary route (`/mcp`).
- `config/routes/02-mcp-invest.json` — secondary route (`/mcp/invest`, strips prefix).
- `scripts/groovy/p1az-decision.groovy` — the authorize decision filter.
- `scripts/validate-config.sh` — route JSON validity + placeholder<->env cross-check.
- `scripts/check-groovy-params.sh` — static 18-key parity + decision-path check.
- `scripts/e2e-pinggateway.sh` — live e2e (401 enforcement + live authz decision; full
  token-bearing PERMIT needs `BANKING_TEST_TOKEN`).
- `.env.example` — committed source of truth for the env contract (`.env` is gitignored).
