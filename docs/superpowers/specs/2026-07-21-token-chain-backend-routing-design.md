# Token Chain: Backend Routing + Exchange Visibility — Design Spec

**Date:** 2026-07-21
**Status:** Approved for implementation

## Context

The demo Agent Gateway routes MCP tool calls to different backend servers by
tool name (`demo_mcp_gateway/src/router.ts`'s `routeTool()`): most tools go to
`demo_mcp_server` ("olb"), investment tools go to `demo_mcp_resource_server`, and the
5 JWT-diagnostic tools (added earlier this session, PR #654/#657/#674) go to
`demo_mcp_jwt_verifier`. This routing, and the RFC 8693 token exchange that
gates access to each backend's audience, both already happen correctly — but
neither is visible anywhere. Today, an `invest` call and an `olb` call
produce byte-identical Token Chain UI output; there is no signal that a
different backend was even involved, let alone what authorized it.

The user wants this made visible: which backend a call was routed to, and the
decision (the RFC 8693 exchange) that permitted reaching it.

## Non-goals

- Not adding a new authorization gate — the exchange already IS the gate
  (fail-closed: on exchange failure, `forward()` is never called and nothing
  reaches the backend). This surfaces an existing decision, it doesn't add one.
- Not limited to jwt-verifier — applies generically to any `BackendTarget`
  (`olb`, `invest`, `jwtverifier`), so olb/banking calls also get a `target:
  'olb'` entry for consistency, rather than only non-default backends
  appearing and banking calls looking unexplained by omission.
- No BFF code change is required (see Architecture) — confirmed by reading
  `_parseGwAuditTrail` (`demo_api_server/services/mcpGatewayClient.js:602-611`),
  which does a generic `JSON.parse` of the `X-Gw-Audit-Trail` header with no
  field allowlist. A new field on the gateway side passes through automatically.

## Architecture

The RFC 8693 exchange for HTTP-transport tool calls (which is all BFF-originated
traffic — confirmed the WS `wss.on('connection')` handler in `index.ts` is a
separate, unrelated path not used by real BFF traffic) happens exactly once,
in `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts:976`:

```ts
const ex = await doExchange(bearerToken, toolName);
upstreamToken = ex.token;
```

`ex` already has the shape `{ token: string; targetAud: string; cached: boolean }`
(`AuthorizeMcpRequestDeps.exchange`'s type, line 122) — `targetAud` is exactly
"which backend audience got granted." The exchange either succeeds (the
caller's token carried a sufficient grant for that backend) or throws, and on
throw the catch block (lines 978-988) fails closed — `forward()` is never
called, matching the fail-closed exchange-failure contract already documented
at line 966.

**Stale comment, fix while here:** lines 962-966 currently read *"The HTTP
upstream is FIXED to the OLB server... there is no per-tool routing on this
transport... invest tools are not reachable over this HTTP path."* This was
true before PR #654/#674 — `doExchange`/`routeTool` now route per-tool to
olb/invest/jwtverifier on this exact path. The comment actively misleads a
reader of code this change touches; correcting it is in scope.

This middleware already builds and emits the `X-Gw-Audit-Trail` response
header (`GwAuditTrail` interface, lines 71-91; `setAuditHeader`, lines
311-317) that the BFF already parses generically and turns into Token Chain
events (`gw-introspection`, `gw-authorize`, `gw-mtls` — `demo_api_server/services/mcpToolPipeline.js:746-833`).
Adding a `backend` field to that same trail, populated from `ex` right after
the exchange call, is the natural, minimal integration point — no new
transport, no new endpoint, reuses the exact channel three sibling fields
already use.

## The two Token Chain steps

1. **Routing fact** (new event id `gw-route`) — "Gateway routed `<tool>` to
   backend: `<target>`" where `target` is `routeTool(toolName)`'s result
   (`'olb' | 'invest' | 'jwtverifier'`). Deterministic, not itself a security
   decision — shown so the routing is visible at all.
2. **Exchange decision** (new event id `gw-exchange`) — on success: "RFC 8693
   exchange: token scoped to audience `<targetAud>`" (+ cache-hit flag from
   `ex.cached`). On failure: the exchange error detail, and the fact that
   nothing was forwarded. This is the actual access-control fact — the
   exchange only succeeds if the caller's token carries a sufficient grant
   for that backend's audience.

## Touch points

1. **`demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`**
   - `GwAuditTrail` interface (lines 71-91): add
     `backend: { target: string; audience: string | null; cached?: boolean; exchanged: boolean; error?: string } | null;`
   - Initialize `auditTrail.backend = null` in the object literal (lines 301-306).
   - After `const ex = await doExchange(bearerToken, toolName); upstreamToken = ex.token;`
     (lines 976-977): set `auditTrail.backend = { target: routeTool(toolName || ''), audience: ex.targetAud, cached: ex.cached, exchanged: true };`
     then call `setAuditHeader(res);` again before `forward(upstreamToken, outBody)`
     (line 990) — `res.setHeader` can be called repeatedly until the response
     is actually flushed, and `forward()` is what triggers the eventual write.
   - In the catch block (lines 978-988, before `sendRpcError(...)`): set
     `auditTrail.backend = { target: routeTool(toolName || ''), audience: null, exchanged: false, error: detail };`
     — no extra `setAuditHeader` call needed here, since `sendRpcError` itself
     already calls `setAuditHeader(res)` internally (line 470) before writing
     the response, so it picks up the mutated `auditTrail` automatically.
   - Correct the stale comment at lines 962-966.
   - `routeTool` is already imported in this file (used at line 275).

2. **`demo_api_server/services/mcpToolPipeline.js`** — two new
   `buildTokenEvent(...)` calls alongside the existing `gw-introspection` /
   `gw-authorize` / `gw-mtls` construction (lines 746-833), reading
   `gwAuditTrail.backend` off the parsed audit trail. Exact event `type`/id
   values: `gw-route`, `gw-exchange`.

3. **`demo_api_ui/src/components/TokenChainDisplay.js`** — mirror the
   existing `gw-mtls` pattern for the two new ids:
   - `STEP_SUB_LABELS` entries (existing map, ~line 2510-2533)
   - `PLACEHOLDER_EVENTS` entries (~line 3598-3666)
   - `getStepExplainer()` branches (~line 3759-3830)
   - Two new `Gw*EduBox` components (`GwRouteEduBox`, `GwExchangeEduBox`),
     gated `if (event.id !== "gw-route") return null;` etc., mirroring
     `GwMtlsEduBox` (lines 1205-1226).

**No change needed** to `demo_api_server/services/mcpGatewayClient.js` (generic
JSON.parse, confirmed above) or to `GatewayServer.ts`'s `forwardToUpstream()`
(it only ever receives the already-exchanged `upstreamToken`, never needs to
know the exchange details itself).

## Error handling

- Exchange failure already fails closed (existing behavior, unchanged) — the
  new `gw-exchange` event on that path shows the failure detail instead of a
  success audience, using the same `detail` string already computed for the
  JSON-RPC error response (line 981).
- If `toolName` is undefined (shouldn't happen for `tools/call` given the
  shape validation earlier in the pipeline, but defensively) —
  `routeTool(toolName || '')` returns `'olb'` (its documented default for
  unknown/empty tool names), so `target` is never undefined in the event.

## Testing

- Gateway: extend `authorizeMcpRequest`'s existing test suite (there are
  several `authorizeMcpRequest-*.test.ts` files already, e.g.
  `authorizeMcpRequest-exchange.test.ts` looks like the natural home) with
  cases asserting `auditTrail.backend` for an olb tool, an invest tool, and
  an exchange-failure case.
- BFF: extend `mcpToolPipeline`'s existing tests (e.g.
  `mcpToolPipeline.characterization.test.js`) with a case asserting the two
  new tokenEvents appear when `gwAuditTrail.backend` is present.
- UI: no existing per-event-id unit test pattern was found for the other
  `Gw*EduBox` components during investigation — matches the precedent from
  the "decode my token" chip work (Tasks 3/4 there had no test harness
  either); verify via `npm run build` (mandatory gate) + manual click-through
  once live, same deferred-verification approach used previously.
