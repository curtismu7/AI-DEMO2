# Weather MCP behind Agent Gateway (IG) — Texas-only showcase

## Purpose

Add a third-party MCP server ([weather-mcp](https://github.com/weather-mcp/weather-mcp)) as a
new Agent Gateway (IG / `ping-gateway`) capability showcase: prove that IG can front an
arbitrary external MCP server and enforce a geographic scoping policy on it, independent of
the banking demo's own MCP servers.

This is **not** a banking flow feature. It is not wired into the AI agent chat, the reason-loop,
or any use-case chip. It is a gateway-level capability, verified via direct route calls
(curl / e2e script), and surfaced on the Agent Gateway capability tour page.

## Non-goals

- No AI agent chat integration (no `AIAgent.js`, reason-loop, or chip changes).
- No new PingOne resource, scope, or Authorize policy. No manual PingOne console
  provisioning is required for this to work.
- No JWKS-variant route, no rate-limit filter, no P1AZDecision call — this route does not
  match full parity with `01-mcp-olb.json` / `02-mcp-invest.json`. It reuses the gateway's
  existing inbound introspection/scope only.
- No support for the 11 tools outside the default preset (saved-location CRUD, air quality,
  marine, imagery, lightning, river, wildfire, historical). Only the weather-mcp default-6
  preset is exposed.

## Architecture

```
Client → ping-gateway :3036
  condition: ^/mcp/weather
    McpAudit → StripWeatherPrefix (^/mcp/weather(.*)$ → /mcp$1)
    → rsFilter (existing gateway-wide introspection/scope — unchanged)
    → McpValidationFilter (existing McpProtocol filter — unchanged)
    → TxWeatherScope (NEW Groovy ScriptableFilter)
    → ReverseProxyHandler
  → weather-mcp-bridge (NEW container, HTTP :8896)
    → spawns `npx -y @dangahagan/weather-mcp@latest` as a long-lived stdio child,
      JSON-RPC passthrough over MCP Streamable HTTP (POST /mcp only, no SSE)
```

`weather-mcp` ships stdio-only (`StdioServerTransport`, spawned via `npx`) — it has no HTTP
transport. `ping-gateway`'s `ReverseProxyHandler` requires an HTTP backend, so a small bridge
sidecar is required in front of it, following the same shape as `demo_mcp_server`'s
`HttpMCPTransport.ts` (`POST /mcp`, JSON-RPC 2.0, no SSE required for basic compliance).

## Components

### 1. `weather_mcp_bridge/` (new, sibling to `demo_mcp_server/`)

- Node HTTP server exposing `POST /mcp` (MCP Streamable HTTP, JSON-RPC 2.0 passthrough).
- Spawns and owns one long-lived stdio child process: `npx -y @dangahagan/weather-mcp@latest`.
- Does **not** set `WEATHER_MCP_TOOLS=all` — leaving it unset means the child registers only
  its own default-6 preset (`get_weather_summary`, `get_forecast`, `get_current_conditions`,
  `get_alerts`, `search_location`, `check_service_status`). This solves the tool-scope
  decision upstream; the gateway does not need a tool-name allowlist.
- Correlates requests/responses to the stdio child by JSON-RPC `id`.
- Ignores the `Authorization` header — the weather-mcp child is not an OAuth resource server,
  so no token exchange or forwarding is needed for the backend call itself (IG already
  validated the caller's token via `rsFilter` before this point).
- Dockerfile + package.json + server.js, matching `demo_mcp_proxy/`'s file layout.

### 2. `ping-gateway/config/routes/03-mcp-weather.json` (new)

New route, condition `^/mcp/weather`. Chain: `McpAudit` → `StripWeatherPrefix`
(`UriPathRewriteFilter`) → `rsFilter` (existing, shared) → `McpValidationFilter` (existing,
shared) → `TxWeatherScope` (new `ScriptableFilter`) → `ReverseProxyHandler` with
`baseURI: ${env['PG_WEATHER_BACKEND_URL']}`.

No JWKS sibling route (`00-mcp-weather-jwks.json`) — not needed since this route doesn't do
its own token exchange or introspection variant.

### 3. `ping-gateway/config/scripts/groovy/tx-weather-scope.groovy` (new)

Runs after `McpValidationFilter` has buffered the body (matching the existing comment in
`00-mcp-invest-jwks.json` about validation needing to run on every route reaching the
backend, not just some).

Logic:
- If JSON-RPC `method` is not `tools/call` (e.g. `tools/list`, `initialize`) → pass through
  unchanged.
- If `tools/call` and `arguments.latitude`/`arguments.longitude` are present → check against
  a Texas bounding box (`lat 25.8–36.5`, `lon -106.6 to -93.5`). Outside the box → deny.
- Else if `arguments.city_name` is present → check (case-insensitive) against a fixed
  allowlist of the 20 largest TX cities by population (Houston, San Antonio, Dallas, Austin,
  Fort Worth, El Paso, Arlington, Corpus Christi, Plano, Laredo, Lubbock, Irving, Garland,
  Frisco, McKinney, Amarillo, Grand Prairie, Brownsville, Killeen, McAllen) OR a `", TX"` /
  `", Texas"` suffix on the string. No match on either → deny.
- Else if `arguments.location_name` is present (a saved alias, opaque to the gateway) → deny.
  The gateway cannot verify what a saved alias resolves to, so the safe default is deny, not
  allow.
- Else (no location argument at all, e.g. `check_service_status`) → pass through unchanged.
- Denial response: JSON-RPC/HTTP 403 with a plain message, e.g. `"Agent Gateway: weather
  scope restricted to Texas (demo policy)"`.

### 4. Compose + env

- New `weather-mcp-bridge` service (compose file(s) that already run `ping-gateway` and its
  sibling MCP backends).
- `ping-gateway/.env.example`: add `PG_WEATHER_BACKEND_URL=http://host.docker.internal:8896`
  (matching the existing `PG_OLB_BACKEND_URL` / `PG_INVEST_BACKEND_URL` convention).

### 5. `demo_api_ui/src/config/capabilityLedgers/agentGatewayCapabilities.js`

New capability card: third-party MCP passthrough + geographic scoping. Evidence field points
at `ping-gateway/config/scripts/groovy/tx-weather-scope.groovy` and
`ping-gateway/config/routes/03-mcp-weather.json`, matching the existing evidence-string
convention in this file (`file:line` references).

## Data flow (happy path)

1. Client sends `tools/call get_current_conditions` with `city_name: "Austin, TX"` (or
   `latitude/longitude` inside the TX box) to `https://.../mcp/weather`, bearer token with
   the gateway's existing inbound scope.
2. `rsFilter` introspects the token (unchanged, existing gateway-wide config) — valid → pass.
3. `McpValidationFilter` validates MCP protocol shape, buffers body.
4. `tx-weather-scope.groovy` parses the buffered body, sees `tools/call` + in-scope location
   → passes through unchanged.
5. `ReverseProxyHandler` forwards to `weather-mcp-bridge`.
6. Bridge forwards the JSON-RPC call to its stdio child, returns the child's response
   verbatim.

## Error handling

- **Bridge**: stdio child crash → respawned lazily on the next request. Request timeout
  (~15s) → JSON-RPC error / HTTP 502, not a hang.
- **Groovy filter**: missing/unparseable location argument on a location-taking tool → deny
  by default (safer than allow). Tools with no location argument (`check_service_status`)
  pass through untouched.
- **Gateway auth** (401/403 on bad/missing token): unchanged, handled by the existing
  `rsFilter` — this design does not touch that path.

## Testing / verification

- `ping-gateway/scripts/validate-config.sh` (existing): run after adding the route file,
  catches route JSON/syntax errors.
- Extend `ping-gateway/scripts/e2e-pinggateway.sh` (existing e2e script) with 2 new cases:
  - Austin (city name or in-box coords) → 200 with real weather data.
  - A non-TX location (e.g. New York) → denied by `tx-weather-scope.groovy`.
- Bridge standalone (before wiring through the gateway): manual curl to its own `/mcp`
  (`tools/list`, then `tools/call get_current_conditions` for Austin) to prove the
  stdio↔HTTP bridge works in isolation first.
- No jest coverage for the Groovy filter itself — IG (Java) runs Groovy, not Node. This
  matches the existing pattern in this repo: static syntax checks + live e2e curl is how
  Groovy filters are verified here, not unit tests.

## Success criteria

- `/mcp/weather` route live and reachable through `ping-gateway`.
- A Texas-scoped request (city name or coordinates) returns real weather data (200).
- A non-Texas request is denied by the new Groovy filter (403), not by upstream weather-mcp.
- `validate-config.sh` passes clean.
- Both new `e2e-pinggateway.sh` cases pass.
- Capability card renders on the Agent Gateway tour page with correct evidence references.
