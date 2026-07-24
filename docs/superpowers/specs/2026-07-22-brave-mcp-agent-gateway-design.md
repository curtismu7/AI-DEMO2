# Brave Search MCP via Agent Gateway — Design

**Date:** 2026-07-22
**Status:** Approved

## Problem

The demo has one precedent for fronting a genuinely third-party MCP server
through a gateway — the Weather MCP Agent Gateway (spec:
`docs/superpowers/specs/2026-07-21-weather-mcp-agent-gateway-design.md`,
already merged). It shows a stdio-only npm package bridged to HTTP and
geo-scoped by a bespoke rule. We want a second, complementary example: a
**remote-only** third-party MCP server — one that itself makes a live
outbound call to a real external SaaS API (Brave Search) — fronted by the
same gateway, gated by **two different rule types** (a scope-based
allow/deny and a content-based allow/deny), and testable in the existing
Agent Gateway tester UI so the demo can show "here's the tool the gateway
returned, here's why it was allowed or blocked."

## Goal

Add a `brave_news_search` MCP tool, backed by a new small Node service that
calls Brave's real News Search API, routed through `ping-gateway` exactly
like the weather precedent, gated by both an existing-scope check and a
query-content blocklist, and exposed as a new tool in `AgentGatewayTester.jsx`
so a demo can call it live and see the gateway's allow/deny decision plus
audit trail.

## Non-goals

Matching the weather precedent's own non-goals:
- No chat/agent (LLM) wiring — this is a gateway-level capability, not a
  new agent use case.
- No new PingOne resource, scope, or Authorize policy. The scope-based rule
  reuses an **existing** granted scope as a stand-in signal.
- No local/mock mode — every call is a real, live outbound request to
  Brave's API (confirmed explicitly: this feature is remote-only).

## Architecture

```
AgentGatewayTester.jsx (UI, /pinggateway-inspector "tester" tab)
        │  calls the real gateway with a bearer token
        ▼
ping-gateway route  ^/mcp/brave
        │  chain: audit → strip-prefix → shared introspection (rsFilter)
        │         → McpValidationFilter → TxBraveScope (new Groovy)
        │         → ReverseProxyHandler
        ▼
demo_mcp_brave/server.js  (new Node service, MCP Streamable HTTP)
        │  tools/call "brave_news_search" → real HTTPS request
        ▼
https://api.search.brave.com/res/v1/news/search
        (X-Subscription-Token: <BRAVE_SEARCH_API_KEY>)
```

No bridge/child-process is needed (unlike weather, which wrapped an
existing stdio-only npm package) — `demo_mcp_brave/server.js` is a
hand-written MCP-over-HTTP server we author directly, since there is no
existing Brave MCP package to wrap.

## Components

### 1. `demo_mcp_brave/server.js` (new)

A minimal Node HTTP server implementing the MCP Streamable HTTP transport
(`POST /mcp`, JSON-RPC 2.0), matching the wire contract `demo_mcp_server`'s
`HttpMCPTransport.ts` already expects on the gateway side. Handles:
- `initialize` — standard MCP handshake.
- `tools/list` — returns the one tool definition below.
- `tools/call` (`name: "brave_news_search"`) — validates `arguments.query`
  is present, makes a real `GET` request to
  `https://api.search.brave.com/res/v1/news/search?q=<query>&count=<count>`
  with headers `Accept: application/json`, `Accept-Encoding: gzip`,
  `X-Subscription-Token: <BRAVE_SEARCH_API_KEY>` (read from `process.env`),
  and returns the response body as MCP tool content (`type: "text"`, the
  JSON stringified, or a structured `outputSchema` mirroring Brave's
  response shape — decided during planning against Brave's real response
  fields).
- No auth of its own — like weather, the gateway has already validated the
  caller before forwarding, so this service trusts its network boundary
  (only reachable from `ping-gateway` inside the compose network).

**Tool definition:**
```json
{
  "name": "brave_news_search",
  "description": "Search recent news via the Brave Search API.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query" },
      "count": { "type": "number", "description": "Number of results (default 10)" }
    },
    "required": ["query"]
  }
}
```

### 2. `ping-gateway` route (new)

`ping-gateway/config/routes/00-mcp-brave.json` — condition `^/mcp/brave`,
mirroring `00-mcp-weather.json`'s chain shape exactly:
`McpAudit` → `StripBravePrefix` (path rewrite) → `rsFilter` (existing,
shared token introspection — reused, not duplicated) → `McpValidationFilter`
→ `TxBraveScope` (new Groovy, below) → `ReverseProxyHandler` to
`${env['PG_BRAVE_BACKEND_URL']}`.

### 3. `ping-gateway/scripts/groovy/tx-brave-scope.groovy` (new)

The allow/deny rule, combining both requested rule types in one filter
(mirroring weather's combined feature-flag-check + geo-check pattern):

- **Scope check:** reads the bearer token's granted scopes (already
  available to the filter via the same introspection result weather's
  script reads). Denies any `tools/call` unless the token's scopes include
  `invest:read`. This scope was chosen because it has a genuinely mixed
  spread across the demo's real PingOne apps (confirmed against
  `scope-topology.json`): granted to **"Super Banking User App"** and
  **"Super Banking Investment Advisor Agent"** only, and absent from every
  other app (Admin App, all other specialist agents, MCP
  Server/Gateway/Exchanger, plain AI Agent, Worker) — so the demo can call
  through as the Investment Advisor Agent (or User App) to show PERMIT, and
  as e.g. the Records Specialist Agent to show DENY, with zero new PingOne
  provisioning.
- **Content check:** denies any `tools/call` whose `query` argument
  contains a term from a small hardcoded blocklist (mirrors weather's
  20-city allowlist, same fail-closed-on-ambiguous-input posture). Exact
  blocklist terms to be chosen during planning (e.g. a couple of
  obviously-sensitive demo terms) — this is a demo device, not a real
  content-safety system.
- Both checks must pass (order: scope check first — cheaper, no query
  parsing needed — then content check) for the request to proceed to
  `ReverseProxyHandler`; either failing returns the same
  `Gateway Policy Denied`-shaped response the existing gateway error
  vocabulary already uses (per `agent-demo-triage`), so existing triage
  knowledge covers it without a new failure signature.

### 4. Feature flag

`ff_brave_mcp_showcase`, mirroring `ff_weather_mcp_showcase` exactly:
`demo_api_server/routes/braveMcpFlag.js` (new, ~40 lines, same shape as
`weatherMcpFlag.js`), registered in `featureFlags.js`, exposed at
`GET /internal/feature-flags/brave-mcp-showcase` gated by the same
`x-internal-gateway-secret`/`BFF_INTERNAL_SECRET` pattern. The Groovy script
checks this flag the same way `tx-weather-scope.groovy` does, before
running the scope/content checks.

### 5. `docker-compose.yml`

New `mcp-brave` service (mirrors `mcp-weather`'s service block), plus
`PG_BRAVE_BACKEND_URL` env var wired onto `ping-gateway` (mirrors
`PG_WEATHER_BACKEND_URL`). `mcp-brave` itself reads `BRAVE_SEARCH_API_KEY`
via an `env_file:` pointing at a new, gitignored `demo_mcp_brave/.env` —
**no dev-fallback default** in the compose file (unlike the
`MORTGAGE_SERVICE_API_KEY` pattern, which is a shared demo key safe to
default; Brave's key is a real third-party secret with no safe default
value).

### 6. Secret handling

`BRAVE_SEARCH_API_KEY` lives only in `demo_mcp_brave/.env` (new file,
covered by the repo's existing blanket `.gitignore` `.env` rule — same
convention every other service already uses, e.g. `langchain_agent/.env`).
Never appears in any committed file, any compose `environment:` block, or
any log line.

### 7. `AgentGatewayTester.jsx`

Add `brave_news_search` to the existing `FALLBACK_TOOLS` list and
`TOOL_GROUPS` (a new group, e.g. "External Services"), with a generated
args template (`{ query: "", count: 10 }`) via the existing
`buildArgsTemplate` mechanism. Calling it drives the real gateway path
above; the existing response/auth-decision/audit-trail tabs display the
result — no new UI chrome needed, this is additive data only.

**Planning-time verification task (not a design uncertainty, just needs
confirming against the real component before writing test steps):** whether
the tester's "real" gateway mode already performs a live `tools/list`
round-trip against the gateway (so a newly-gated tool's visibility
genuinely reflects live allow/deny), or only shows a static client-side
catalog. If static, a small addition may be needed so "show the tools that
are returned" is literally live, not just the new tool appearing in a
hardcoded list.

## Testing

- Direct: call `demo_mcp_brave/server.js`'s `POST /mcp` directly (curl,
  matching the confirmed real Brave API contract) to prove the service
  itself works, independent of the gateway.
- Through the gateway, PERMIT case: call via a token scoped as the
  Investment Advisor Agent (`invest:read` present) with a clean query —
  expect the real Brave response to come back through the gateway.
- Through the gateway, scope DENY case: call via a token scoped as e.g. the
  Records Specialist Agent (`invest:read` absent) — expect
  `Gateway Policy Denied`.
- Through the gateway, content DENY case: call with a blocklisted query
  term using an otherwise-permitted token — expect denial from the content
  check specifically (distinguish from the scope-denial case in the audit
  trail/response).
- Through `AgentGatewayTester.jsx`: all three cases above, driven from the
  UI, confirming response/auth-decision/audit-trail render correctly for a
  non-banking, real-remote-API tool.

## Out of scope

- Local/mock mode for Brave (explicitly not wanted).
- Any change to the Weather MCP integration (kept as-is).
- Real PingOne scope/resource provisioning (reuses `invest:read`).
- Any chat/agent (LLM) integration for this tool.
