# PingGateway MCP filter audit — McpProtectionFilter gap

## Context

User asked whether three native PingGateway MCP filters are turned on:
`McpAuditFilter`, `McpProtectionFilter`, `McpValidationFilter`
(docs.pingidentity.com/pinggateway/2026/reference/). Audit of
`ping-gateway/config/routes/*.json` (7 MCP routes) found `McpAuditFilter` and
`McpValidationFilter` wired into every route, but `McpProtectionFilter` wired
into only **1 of 7** — `01-mcp-olb.json` (`mcp-olb-primary`, filter name
`McpGatewayProtection`). User asked for a fix plan to close that gap. Mid-plan,
user redirected: don't implement the fix yet — just want this investigation
written up as a doc, committed, and pushed, with a link back.

**This plan's deliverable is the doc below, not the code fix.** The fix itself
(§3) is documented for a future session, not applied now.

## 1. Current filter status (verbatim findings)

| Route file | Route name | McpAudit | McpProtection | McpValidation (`McpProtocol`) | Token validation used |
|---|---|---|---|---|---|
| `01-mcp-olb.json` | mcp-olb-primary | yes | **yes** (`McpGatewayProtection`) | yes | introspection via local `OlbResourceServerFilter` |
| `00-mcp-olb-jwks.json` | mcp-olb-jwks | yes | no | yes | `jwks-token-validation.groovy` (custom script) |
| `00-mcp-apikey.json` | mcp-apikey-primary | yes | no | yes | introspection via local `ApikeyResourceServerFilter` |
| `00-mcp-apikey-jwks.json` | mcp-apikey-jwks | yes | no | yes | `jwks-token-validation.groovy` |
| `02-mcp-invest.json` | mcp-invest-secondary | yes | no | yes | introspection via global `rsFilter` (config.json) |
| `00-mcp-invest-jwks.json` | mcp-invest-jwks | yes | no | yes | `jwks-token-validation.groovy` |
| `00-mcp-weather.json` | mcp-weather-primary | yes | no | yes | introspection via global `rsFilter` |

`McpAuditFilter` writes to `audit/mcp.audit.json` (topics `access`+`mcp`) via
the shared `AuditService` heap object (`config/config.json:74`).
`McpValidationFilter` (named `McpProtocol` everywhere) validates the JSON-RPC
body and buffers it for downstream filters (`mcp-request-validation.groovy`,
`p1az-decision.groovy`), with `metricsEnabled: true` exposing `ig_mcp_*`
Prometheus counters.

`README.md:11-13` already documents step 1 of the MCP flow as
"`McpProtectionFilter` + `OAuth2ResourceServerFilter`" — the README describes
the intended design, which only the OLB route actually implements today.

## 2. Why the gap exists (root cause, not just symptom)

`McpProtectionFilter.resourceServerFilter` must reference a heap object of
type `OAuth2ResourceServerFilter` — it wraps that filter to add RFC 9728
protected-resource-metadata behavior (a `WWW-Authenticate` header carrying a
`resource_metadata` link on 401s), it doesn't replace the validation logic.

- **3 routes have a compatible object today** and just aren't wrapping it:
  `mcp-apikey-primary` (`ApikeyResourceServerFilter`), `mcp-invest-secondary`
  and `mcp-weather-primary` (both use the shared global `rsFilter` from
  `config/config.json:36`). These call the resource-server filter as a bare
  chain entry instead of through `McpProtectionFilter` — mechanical gap.
- **3 routes have no compatible object at all**: the JWKS-variant routes
  (`mcp-olb-jwks`, `mcp-apikey-jwks`, `mcp-invest-jwks`) validate tokens with
  `jwks-token-validation.groovy`, a custom script, not an
  `OAuth2ResourceServerFilter` heap object. `.env.example:20-23` documents
  this as an intentional "educational tradeoff" (local JWKS validation can't
  see revocation). Wiring `McpProtectionFilter` here needs a *new* IG-native
  resource-server-filter object that reproduces the script's dual RS256
  (PingOne JWKS)/HS256 (mock authz-server) branch — a design decision, not a
  mechanical fix. Out of scope for the mechanical pass below.

Also relevant: `.env.example:38-44` already flags a **known open item** on the
one route that does have `McpProtectionFilter` today — whether it accepts the
bare `aud` (`mcpgateway.ping.demo`) the Node gateway issues, or requires the
full resource URL (`PG_GATEWAY_RESOURCE_ID`) as `aud`. Any new wiring inherits
this same open question and must be live-verified per route, not assumed.

## 3. Proposed fix (not applied — future work)

Wrap the 3 mechanical-gap routes' existing resource-server filter in
`McpProtectionFilter`, mirroring `01-mcp-olb.json:94-102` exactly — insert
right after `McpAudit`, before `McpProtocol`:

```json
{
  "name": "McpGatewayProtection",
  "type": "McpProtectionFilter",
  "config": {
    "resourceId": "${env['PG_GATEWAY_RESOURCE_ID']}",
    "authorizationServerUri": "${env['PINGONE_ISSUER_URI']}",
    "resourceServerFilter": "<route's existing filter name>"
  }
}
```

| File | Bare filter entry removed | `resourceServerFilter` value |
|---|---|---|
| `00-mcp-apikey.json` (~line 52) | `"ApikeyResourceServerFilter"` | `ApikeyResourceServerFilter` |
| `02-mcp-invest.json` (~line 24) | `"rsFilter"` | `rsFilter` |
| `00-mcp-weather.json` (~line 20) | `"rsFilter"` | `rsFilter` |

Reuses the same `PG_GATEWAY_RESOURCE_ID`/`PINGONE_ISSUER_URI` env vars already
set for OLB — one gateway resource identity, shared across sub-paths.

**Verification when this is implemented:** per route, no-token request should
403→401 with a `WWW-Authenticate` header containing `resource_metadata`
(RFC 9728); valid-token request must still succeed exactly as before; check
`audit/mcp.audit.json` for the new McpProtection events; resolve the aud
bare-vs-URL open item live per `.env.example:38-44` before calling any route
done.

**Explicitly not touched:** `mcp-olb-jwks`, `mcp-apikey-jwks`,
`mcp-invest-jwks` — needs a separate design pass for a JWKS-capable
`OAuth2ResourceServerFilter` equivalent first.

## Summary

- `McpAuditFilter`: deployed all 7 routes, working.
- `McpValidationFilter`: deployed all 7 routes, working.
- `McpProtectionFilter`: deployed 1 of 7 routes (OLB only); 3 routes fixable mechanically; 3 routes (JWKS variants) need design work for JWKS-capable equivalent.
- README §1 documents the intended design; current state is partial.
