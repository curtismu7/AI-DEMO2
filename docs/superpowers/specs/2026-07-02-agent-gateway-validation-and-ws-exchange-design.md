# Agent Gateway: Full MCP Request Validation + WebSocket Token Exchange

**Date:** 2026-07-02
**Status:** Approved
**Scope:** Both gateways — `demo_mcp_gateway` (Node, default) and `ping-gateway` (PingIdentity IG variant)

## Problem

A capability audit against the demo slides found two of the seven Agent Gateway
claims only partially implemented:

1. **Validate MCP requests** — both gateways validate the JSON-RPC envelope,
   but neither validates `tools/call` arguments against the tool's
   `inputSchema`; the Node gateway also has no formal method allow-list
   (unknown methods fall through to `-32601` implicitly).
2. **Token transformation** — the Node gateway forwards the inbound
   gateway-audience token to the olb/invest backends unchanged on **both**
   transports: the WS proxy path (`demo_mcp_gateway/src/index.ts` ~line 963,
   documented as WR-02) and the HTTP path (`authorizeMcpRequest.ts`, pinned by
   `tests/authorizeMcpRequest-no-exchange.test.ts`). `McpTokenExchangeClient`
   exists but is dead code (only `clearCache()` is called). The passthrough was
   a deliberate workaround for a PingOne `invalid_scope` failure when
   exchanging to backend audiences (see docker-compose.yml comment at the
   mcp-server service). The IG routes have exchange filters configured, but
   the backends only accept the gateway audience, so that exchange is not
   exercised against the live stack.

Constraints discovered during scoping:

- The IG variant handles HTTP (streamable-http) MCP only — it has no WebSocket
  path, so the WS exchange gap exists only in the Node gateway. IG already does
  envelope validation (`McpValidationFilter`) and RFC 8693 exchange natively.
- The backend MCP servers currently accept only `aud=mcpgateway.ping.demo`
  (`demo_mcp_server/src/auth/TokenIntrospector.ts`,
  `demo_mcp_resource_server/src/server/tokenValidator.ts`). Exchanged backend-audience
  tokens would be rejected with 401 until their accepted-audience config changes.
- Tool `inputSchema`s exist only in the backends' live `tools/list` responses;
  the gateway caches nothing, and `ajv` is not a gateway dependency.

## Decisions (user-approved)

- Full per-tool argument schema validation at the gateway (not just shape checks).
- Token exchange on the WS path **fails closed** — never forward the inbound
  token upstream on exchange failure.
- Both gateways get the validation upgrade (Approach A: shared static artifact).

## Design

### 1. Canonical schema artifact — `mcp-tool-schemas.json`

Repo-root file (same pattern as `scope-topology.json`) mapping every tool name
to its `inputSchema` and owning backend (`olb` / `invest` / `gateway`).

- **Generated, not hand-written.** `npm run gen:tool-schemas` (script in
  `demo_mcp_gateway`) imports tool definitions from
  `demo_mcp_server/src/tools/`, `demo_mcp_resource_server/src/tools/investTools.ts`,
  and the gateway-owned tool descriptors, then writes the artifact.
- **Drift test = regenerate and diff.** A test in the gateway suite regenerates
  the artifact and fails on any difference, so a backend tool change cannot
  silently diverge from the checked-in file.

### 2. Node gateway request validation

New module `demo_mcp_gateway/src/validation/mcpRequestValidation.ts`, shared by
both transports (same shared-core pattern as `authorizeMcpRequestCore.ts`),
wired into the WS handler (`index.ts handleMessage`) and the HTTP middleware
(`GatewayServer.ts` / `authorizeMcpRequest.ts`).

- **Method allow-list:** `initialize`, `notifications/initialized`,
  `tools/list`, `tools/call`. Anything else → `-32601`.
- **Shape checks** for `tools/call`: `params.name` is a non-empty string;
  `params.arguments`, when present, is an object.
- **Per-tool argument validation:** Ajv (new dependency) compiles validators
  from the artifact at startup. Runs after token validation/introspection but
  **before** the PingOne Authorize call, so malformed requests are rejected
  without burning a PDP round-trip. Validation runs on the args after
  `_hitl_challenge_id` is stripped (schemas use `additionalProperties: false`).
- **Errors:** `-32602 Invalid params` with a compact list of Ajv errors in
  `data.validationErrors`. **Unknown tool name → fail closed** with `-32602`
  (safe because the drift test guarantees artifact completeness).

### 3. IG gateway validation parity

New `ping-gateway/scripts/groovy/mcp-request-validation.groovy`, added to both
routes (`01-mcp-olb.json`, `02-mcp-resource-server.json`) after the native
`McpValidationFilter` and before `P1AZDecision`.

- The artifact is bind-mounted into the container alongside existing config.
- The Groovy validator implements a **documented subset of JSON Schema** —
  `type`, `required`, per-property primitive types, `additionalProperties` —
  which fully covers the flat schemas the demo tools use.
- Failures return HTTP 400 with a JSON-RPC `-32602` body.
- No other IG changes (envelope validation and exchange are already native).

### 4. Gateway token exchange (Node gateway, both transports — closes WR-02)

**Amended after discovery** (user-approved 2026-07-02): the original spec
assumed the Node HTTP path already exchanged; it does not. Scope is now the
full fix, gated on a live PingOne verification.

- **PingOne provisioning (prerequisite, self-healing):** the two backend
  resource servers (`mcpserver.ping.demo`, `mcp-resource-server.ping.demo`) get
  `mirroredScopes` in `scope-topology.json`, and the exchanging client gets
  grants on them — the exact pattern used for the Agent Gateway resource in
  the June two-exchange hardening. The startup `twoExchangeReconciler` in
  `demo_api_server` is extended to diff + heal these, so provisioning drift
  self-repairs. No secret rotation.
- **Explicit-scope exchange:** `McpTokenExchangeClient` sends an explicit
  `scope` parameter (the subject token's scopes filtered to the target
  resource's registered scopes, via scope-topology) — this is what fixes the
  historical `invalid_scope` failure. It also gets a per-backend entry point
  so `tools/list` proxying can exchange for each backend.
- **Live verification gate:** before wiring exchange into the request paths, a
  spike script performs a real RFC 8693 exchange against the live PingOne env
  (01d89b06) for both backend audiences and asserts scopes survive. If it
  fails after the provisioning fixes, STOP and surface — do not ship
  passthrough removal on top of a broken exchange.
- **WS path:** in the `olb`/`invest` proxy branch of `handleMessage`, replace
  `const backendToken = token` with the exchange call. `proxyToolsList`
  exchanges per backend.
- **HTTP path:** `authorizeMcpRequest.ts` exchanges before invoking the
  forward callback. The `authorizeMcpRequest-no-exchange.test.ts` pinning test
  is replaced by a test asserting the exchanged token (not the inbound one) is
  forwarded.
- **Fail closed (both transports):** exchange failure → `-32500` with
  `data.error: 'token_exchange_failed'` (HTTP: status 502 with the same
  JSON-RPC body); the inbound gateway-audience token is never forwarded
  upstream.
- **Token Chain UI:** replace the `gw-passthrough` event with a real
  `gw-exchange` event (target audience + cache hit/miss);
  `tokenExchangeCached` gets a real value instead of `null`.
- **Backends:** accepted audience becomes a comma-separated list
  (`demo_mcp_server` TokenIntrospector, `demo_mcp_resource_server` tokenValidator).
  docker-compose sets each backend to `[own backend URI, gateway URI]` during
  rollout so the stack cannot break mid-transition (mTLS already prevents
  direct backend access, so the transitional second audience is low-risk).
  Tightening to own-URI-only is an explicit follow-up, out of scope here.
- **Untouched:** dispatch paths A/B/C (`apikey` / `dualtoken` / `bankingdata`)
  keep their current credential handling; only the olb/invest MCP proxy paths
  gain exchange.
- **Claims note:** exchanged tokens lose nothing the backends rely on today —
  inbound TX tokens already lack `act`/`may_act` (PingOne cannot emit them on
  exchanged tokens; the BFF bridges via headers), and tool scopes survive via
  the mirroredScopes pattern.

## Error handling summary

| Condition | Response |
| --- | --- |
| Unknown JSON-RPC method | `-32601 Method not found` |
| Bad `tools/call` shape | `-32602 Invalid params` |
| Arguments fail tool schema | `-32602` + `data.validationErrors` |
| Unknown tool name | `-32602` (fail closed) |
| RFC 8693 exchange failure (WS) | `-32500` + `data.error: 'token_exchange_failed'`; nothing forwarded |
| RFC 8693 exchange failure (HTTP) | 502 with the same JSON-RPC `-32500` body; nothing forwarded |
| IG validation failure | HTTP 400 with JSON-RPC `-32602` body |

## Testing / success criteria

- **Unit:** validation module — valid args, each failure class, unknown tool,
  unknown method; exchange failure path with mocked token endpoint (assert
  fail-closed, no upstream call).
- **Drift:** regenerate-and-diff test wired into the gateway test run.
- **Integration (running stack):** bad-args `tools/call` → `-32602` on both
  gateways; good call succeeds end-to-end; Token Chain UI shows the real
  exchange event with correct audience; forced exchange failure → `-32500`
  and no upstream forward.
- **Regression:** existing demo scenarios (HITL approval, scope denial,
  tool greying) still pass.

**Done =** all seven slide capabilities are fully backed on both gateways for
their supported transports, with the above tests green.
