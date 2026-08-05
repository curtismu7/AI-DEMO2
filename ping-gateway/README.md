# PingGateway — alternative MCP gateway (Ping Identity IG)

PingGateway (Ping Identity Identity Gateway, image `ig:latest`) is a **user-selectable
second choice** for the MCP gateway, alongside the default Node `demo_mcp_gateway`. It is
the externally reachable MCP endpoint: the agent/BFF calls PingGateway, which introspects
the inbound token, runs the same PingOne Authorize decision as the Node gateway, performs an
RFC 8693 token exchange to the backend, and reverse-proxies to the MCP servers.

## What it does (per request)

1. **Inbound token validation** — `McpProtectionFilter` + `OAuth2ResourceServerFilter`
   introspect the bearer (PingOne, via the MCP exchanger client) and require the
   `gateway:mcp:invoke` scope (`PG_INBOUND_SCOPE`). No/invalid token -> `401`.
2. **MCP audit** — `McpAuditFilter` (first in every MCP route chain) writes structured
   MCP events to `audit/mcp.audit.json` (who/what/when/where/how) via the heap
   `AuditService` (`JsonAuditEventHandler`, topics `access` + `mcp`).
3. **MCP protocol validation** — `McpValidationFilter` parses the JSON-RPC body; with
   `metricsEnabled: true` it exposes Prometheus counters/gauges (`ig_mcp_*`).
4. **Authorize decision** — `scripts/groovy/p1az-decision.groovy` builds the SAME 18-key
   `parameters` payload as the Node gateway's `buildAuthorizeParameters` and POSTs it to
   `<BASE>/governance/pap/alpha/policy/<P1AZ_WORKER_ID>/decision`. PERMIT continues; DENY /
   INDETERMINATE / error -> `403` (fail closed).
5. **RFC 8693 exchange** — `OAuth2TokenExchangeFilter` exchanges the inbound token for one
   scoped to the backend audience (`mcpserver.ping.demo` / `mcp-invest.ping.demo`), then a
   `HeaderFilter` swaps it onto the `Authorization` header.
6. **Reverse proxy** — to `mcp-server:8080` (`/mcp`) or `mcp-resource-server:8081` (`/mcp/invest`).

## Selecting PingGateway (runtime flag)

Toggle on the **/config** admin page (or via the feature-flags API):

- `ff_mcp_gateway_pinggateway` **ON** -> BFF routes MCP traffic to PingGateway
  (`mcp_pinggateway_url`, internal `http://ping-gateway:8080`).
- **OFF** (default) -> traffic goes through the Node `demo_mcp_gateway` (`:3005`).

The switch lives in `demo_api_server/services/mcpGatewayClient.js` `getMcpGatewayHttpUrl()` —
the single resolver every tool-call path uses.

## Live-switchable authorize backend (mock vs real)

PingGateway's decision backend follows the same **Simulated Authorize**
(`ff_authorize_real`) toggle as the rest of the demo, carried per request via the
`X-Authz-Simulated` header the BFF stamps:

- `ff_authorize_real` **ON** -> `X-Authz-Simulated: true` -> `P1AZ_MOCK_BASE`
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
`http://ping-gateway:8080`. Depends on `mcp-server`, `mcp-resource-server`, `authz-server`.

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

### Local JWKS validation route (`00-mcp-olb-jwks.json`)

When the BFF flag `ff_mcp_gateway_jwks` is ON it stamps `X-Token-Validation: jwks`
on each request; this route (file name sorts before `01-mcp-olb.json`, so it is
matched first) then validates the inbound token **locally** in
`jwks-token-validation.groovy` — RS256 via `PINGONE_JWKS_URI`, mock HS256 via
`AUTHZ_JWT_SECRET` — with `exp`/`nbf`, `iss`, `aud`, and scope checks, instead of
introspecting. Success stamps `X-Token-Validation-Mode: jwks` on the response;
failure returns 401 `{"error":"invalid_token","validation":"jwks","reason":...}` with a
`WWW-Authenticate` Bearer challenge that includes RFC 9728 `resource_metadata`
(derived from `PG_GATEWAY_RESOURCE_ID`) for cosmetic parity with
`McpProtectionFilter` — the JWKS routes still do **not** wrap a native
`OAuth2ResourceServerFilter`. Success stamps `X-Token-Validation-Mode: jwks` on the response.
Any other header value (or none) falls through to the unchanged introspection
route. Tradeoff (educational, by design): no revocation detection until expiry.
The secondary `/mcp/invest` path has the same switch: `00-mcp-resource-server-jwks.json`
is route `02-mcp-resource-server.json` with the shared `rsFilter` stage replaced by the
same Groovy validator, selected by the same header.

## API Access Management route (`04-aam-api-access.json`)

A **second, coarse-grained** PingOne Authorize capability, running alongside the
decision-endpoint path above rather than replacing it. The stock
[`PingAuthorizeFilter`](https://docs.pingidentity.com/pinggateway/2026/pingone/aam.html)
posts method / path / headers / client IP to the PingOne Authorize **Sideband
API**, which matches them against an **API Service**'s operations and returns
allow or deny. It never sees an MCP tool name or its arguments — the `/mcp`
routes keep using `p1az-decision.groovy` for that, and neither route touches the
other.

The route protects `GET /aam/health` and, on allow, proxies to
`demo_api_resource_server`'s unauthenticated `/health`, so a permit is observable
without introducing another credential. Only the AAM verdict is being shown.

**`ff_aam`** (default `true`) governs whether AAM runs at all. Off, the route's
Groovy filters are bypassed and `GET /api/aam/probe` (below) reports
`{ disabled: true }` without calling the gateway. It does not change which
authorization path the `/mcp` routes use — that stays on
`p1az-decision.groovy` regardless.

### Provisioning — PingOne Management API, not the console

Every object below can be created with the worker credentials already in
`demo_api_server/.env` (`PINGONE_WORKER_CLIENT_ID` / `_SECRET`,
`client_secret_basic`). No console clicks and no PingOne MCP server needed.
AAM's "API Services" are named **`apiServers`** in the Management API.

| Step | Call |
| --- | --- |
| Group | `POST /groups` `{"name":"Full access",...}` — add one test user to it, leave a second out |
| Gateway | `POST /gateways` `{"type":"API_GATEWAY_INTEGRATION","name":...}` |
| Credential | `POST /gateways/{id}/credentials` `{}` — the secret is returned **only** in this response; the list view omits it |
| Resource | `POST /resources` — required first; `POST /apiServers` fails with `authorizationServer.resource.id must be provided` otherwise |
| API server | `POST /apiServers` `{"name":...,"baseUrls":["http://api.ping.demo:3036"],"authorizationServer":{"resource":{"id":...},"type":"PINGONE_SSO"}}` |
| Operation | `POST /apiServers/{id}/operations` `{"name":...,"methods":["GET"],"paths":[{"pattern":"/aam/health","type":"EXACT"}]}` |
| Rule | `PUT` the operation with `accessControl` — `{"group":{"groups":[{"id":...}]}}`, or `{"scope":{"matchType":"ANY" (or "ALL"),"scopes":[{"id":...}]}}` (`matchType` is required, no default), or `{"permission":{...}}` |
| Deploy | `POST /apiServers/{id}/deployment` with `Content-Type: application/vnd.pingidentity.apiServer.deploy+json` — plain JSON returns `415` |

Copy the gateway's **Service URL** — `https://http-access-api.pingone.{region}/v1/environments/{envId}`, **not** returned by any of the above — and the credential from the `POST /credentials` response into `ping-gateway/.env`:

```bash
PG_AAM_SERVICE_URL=https://http-access-api.pingone.com/v1/environments/<envId>
AAM_GATEWAY_SECRET=<credential verbatim — NOT base64, see .env.example>
AAM_MOCK_BASE=http://authz-server:9001
```

then `docker restart` the gateway (env changes need a restart; route files hot-reload). Until `PG_AAM_SERVICE_URL` is set the route's condition fails, nothing matches `/aam`, and the gateway returns `404` — inert, not fail-open.

Full working values (steps, error messages, request/response schemas) are recorded in
[`docs/superpowers/specs/2026-07-27-aam-end-to-end-design.md`](../docs/superpowers/specs/2026-07-27-aam-end-to-end-design.md).

### Simulated mode

AAM has the same mock/real split as the decision endpoint. The BFF's
`GET /api/aam/probe` sends `X-Authz-Simulated` (mirroring the effective
`ff_authorize_real`) together with `X-BFF-Internal`; the gateway trusts
the header only alongside that secret, so a gateway-audience token cannot force
the mock. `true` retargets the Sideband call to `AAM_MOCK_BASE`
(`demo_authz_server`'s `POST /sideband/request` and `/sideband/response`);
absent or `false` calls real PingOne.

**Verify** (works against either backend):

```bash
# simulated, group present -> 200, api-resource-server health JSON, decision PERMIT
curl -i -H "X-Authz-Simulated: true" -H "X-Demo-Groups: Full access" \
     http://api.ping.demo:3036/aam/health
# simulated, no group -> 403, decision DENY, request never reaches the backend
curl -i -H "X-Authz-Simulated: true" \
     http://api.ping.demo:3036/aam/health
# real PingOne (once provisioned)
curl -i -H "Authorization: Bearer $PERMITTED_TOKEN" http://api.ping.demo:3036/aam/health
curl -i -H "Authorization: Bearer $DENIED_TOKEN"    http://api.ping.demo:3036/aam/health
```

### Tracing — `X-Gw-Audit-Trail` and the token chain

`PingAuthorizeFilter` is a built-in Java filter: it consumes the Sideband
request/response internally and exposes only `200`/`403` to the client. Two
Groovy filters recover the JSON for the trace:

- `aam-sideband-capture.groovy` sits inside `PingAuthorizeFilter`'s
  `sidebandHandler` — the one place that can both retarget the call (real vs
  mock) and observe its JSON — and records the exchange, redacting
  `Authorization`/`CLIENT-TOKEN` at capture.
- `aam-trail-stamp.groovy` **wraps** `PingAuthorizeFilter` rather than
  following it (a deny returns its own 403 without calling downstream filters)
  and stamps `X-Gw-Audit-Trail` with an `aam` section on both outcomes.

`/aam` is called directly by clients, so nothing in the BFF normally sees that
header. `GET /api/aam/probe` (mounted behind `authenticateToken`) closes that
gap: it calls `/aam/health` itself, parses the trail, and returns
`{ ok, httpStatus, decision, backend, serviceUri, elapsedMs, request, response }`.
A `403` is a successful probe, not an error — the deny is the decision worth
showing, so the route never throws on gateway status.

The UI renders this as a `gw-aam` event in the token chain
(`TokenChainDisplay.js`), alongside — not instead of — the `gw-authorize`
event: AAM sees only method/path/headers/client IP, so the fine-grained
per-tool decision still runs behind it.

**`streamingEnabled: true`** (global, `admin.json`) means IG streams entity
content; reading the Sideband JSON directly from a `ScriptableFilter` blocks a
Vert.x event-loop thread and the request never completes (curl exit `28`,
not a fast failure). The `/mcp` routes avoid this only because
`McpValidationFilter` buffers first. `04-aam-api-access.json` fixes it with a
`CaptureDecorator` (`captureEntity: true`) scoped to this route's sideband
chain only — `/mcp` streaming is untouched. The decorator value must be a
capture-point string (`"all"`); `true` fails route build.

## Files

- `config/admin.json` — IG admin (PRODUCTION mode, streaming on).
- `config/routes/01-mcp-olb.json` — primary route (`/mcp`).
- `config/routes/02-mcp-resource-server.json` — secondary route (`/mcp/invest`, strips prefix).
- `config/routes/00-mcp-olb-jwks.json` — local (no-introspection) JWKS validation route, selected
  per request via the `X-Token-Validation: jwks` header (effective `ff_mcp_gateway_jwks`).
- `config/routes/00-mcp-resource-server-jwks.json` — same JWKS switch for the `/mcp/invest` path
  (route 02 with the `rsFilter` stage replaced by the Groovy validator).
- `config/routes/04-aam-api-access.json` — PingOne Authorize **API Access Management** route
  (`/aam`), stock `PingAuthorizeFilter` against the Sideband API, plus the `CaptureDecorator` and
  `sidebandHandler` chain that make the exchange traceable. Inert until `PG_AAM_SERVICE_URL` is set.
- `scripts/groovy/aam-sideband-capture.groovy` — inside `sidebandHandler`: retargets real vs mock
  and captures the Sideband request/response JSON, redacted, onto the shared `AttributesContext`.
- `scripts/groovy/aam-trail-stamp.groovy` — wraps `PingAuthorizeFilter`; stamps `X-Gw-Audit-Trail`
  with the `aam` section on both outcomes (the deny only reaches this filter, not a later one).
- `scripts/groovy/p1az-decision.groovy` — the authorize decision filter.
- `scripts/groovy/jwks-token-validation.groovy` — local inbound token validation for the JWKS
  route: RS256 against the PingOne JWKS, HS256 against the mock demo_authz_server secret.
- `scripts/validate-config.sh` — route JSON validity + placeholder<->env cross-check.
- `scripts/check-groovy-params.sh` — static 18-key parity + decision-path check.
- `scripts/e2e-pinggateway.sh` — live e2e (401 enforcement + live authz decision; full
  token-bearing PERMIT needs `BANKING_TEST_TOKEN`).
- `.env.example` — committed source of truth for the env contract (`.env` is gitignored).
