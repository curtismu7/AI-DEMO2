# PingOne Authorize API Access Management — end-to-end design

Date: 2026-07-27
Status: approved for planning
Related: PR #1025 (`ping-gateway/config/routes/04-aam-api-access.json`)

## Problem

PR #1025 added the stock PingGateway AAM integration — the built-in
`PingAuthorizeFilter` posting to the PingOne Authorize Sideband API — as an IG
route on `/aam`. It enforces correctly and fails closed, but it is invisible:
nothing in the demo's tracing surfaces it, and it only works against a live
PingOne environment.

Three gaps follow from that:

1. **No trace.** The token chain, ProofStrip, and the gateway decisions window
   are all fed by the `X-Gw-Audit-Trail` header that `p1az-decision.groovy`
   stamps. `PingAuthorizeFilter` is a built-in Java filter; it consumes the
   Sideband request/response internally and exposes only 200 or 403. Nothing
   downstream can see the decision, let alone its JSON.
2. **No simulated mode.** Every other authorize path in the demo runs against
   either the real PingOne backend or the `demo_authz_server` mock, switched per
   request. AAM has no mock, so it cannot be demonstrated without live console
   provisioning.
3. **No flag.** AAM cannot be turned off for a demo that does not want it.

## Goals

- AAM decisions carry their real Sideband request and response JSON into the
  existing token chain, rendered the way Agent Gateway rows render today.
- AAM runs against a real PingOne backend or a mock, selected per request, using
  the same switch as the rest of the demo.
- A feature flag turns AAM on and off, defaulting to on.
- No change to `p1az-decision.groovy` or any existing route. AAM is a second,
  coarse-grained capability alongside the fine-grained decision-endpoint path,
  not a replacement.

## Non-goals

- Replacing the `/mcp` routes' authorization. AAM sees only method, path,
  headers, and client IP; it cannot express per-tool rules.
- Reimplementing PingOne Authorize in the mock. The mock exists to make the
  integration demonstrable offline, not to be a policy engine.
- Rule-level explanation of a deny. The Sideband response carries what it
  carries; whatever it omits stays in the PingOne console.

## Architecture

### The switch and the capture are the same filter

`gatewayServiceUri` cannot select a backend per request. It is typed
`configuration expression<url>` in the reference documentation, but IG passes
the raw string to `java.net.URI` — confirmed live in PR #1025, where a `${...}`
expression failed route build with `Illegal character in path at index 1`. It is
a static value, resolved once at config load.

`sidebandHandler` is different: it is a Handler reference, and we own whatever
we put there. A `ScriptableFilter` inside that handler sits directly on the wire
between `PingAuthorizeFilter` and the Sideband API, which makes it the one place
that can both retarget the call and observe it.

```text
04-aam-api-access.json
  PingAuthorizeFilter
    gatewayServiceUri: <static, real PingOne>
    sidebandHandler: Chain
      AamSidebandCapture (ScriptableFilter)      NEW
        - retarget: X-Authz-Simulated true -> AAM_MOCK_BASE
                                     false -> the configured PingOne service URL
        - capture: outbound request JSON, inbound response JSON, elapsed ms
        - store on AttributesContext as attributes['aamTrail']
      -> ClientHandler
  AamTrailStamp (ScriptableFilter)               NEW
    - reads attributes['aamTrail']
    - stamps X-Gw-Audit-Trail: { aam: {...} } on the response
```

This mirrors `P1AZ_MOCK_BASE` / `P1AZ_REAL_BASE` and reuses the existing
`X-Authz-Simulated` header, so there is no second switching mechanism to keep in
sync with the first.

`AamSidebandCapture` trusts `X-Authz-Simulated` under the same rule
`p1az-decision.groovy` already applies: only from a trusted caller, so a
gateway-audience token cannot force the mock. That check is copied, not
re-invented.

### Ordering

`AamTrailStamp` must run on the response path after `PingAuthorizeFilter` has
produced its verdict, and it must stamp the header on both outcomes — the 403
deny as well as the allowed 200. `p1az-decision.groovy` already does exactly
this on both paths and is the reference for the shape.

### Audit trail

Extend the existing header rather than introduce another one.
`p1az-decision.groovy` already composes the trail from sections
(`auditTrail + [mtls: mtlsRes]`), so `aam` becomes one more:

```json
{
  "aam": {
    "decision": "PERMIT",
    "backend": "mock",
    "serviceUri": "http://authz-server:9001/sideband",
    "elapsedMs": 38,
    "request":  { "...": "verbatim Sideband request JSON" },
    "response": { "...": "verbatim Sideband response JSON" }
  }
}
```

`decision` is derived from the Sideband response, not from the HTTP status, so
the trail records what AAM actually said rather than what the gateway did with
it.

`parseGwAuditTrail` in `demo_api_server/services/mcpGatewayClient.js` gains one
branch for `aam`. Everything downstream — `agentGatewayDecisions.js`,
`unifiedTrace.js`, the UI stores — already handles trail sections generically.

### The missing caller

`/aam` is reached directly by a client. Nothing in the BFF calls it, so nothing
receives the header, so the chain stays empty no matter how good the trail is.

A BFF route closes the gap:

```text
GET /api/aam/probe
  -> calls the gateway's /aam/health with the caller's bearer
  -> parses X-Gw-Audit-Trail
  -> feeds the aam section into the same pipeline as MCP tool calls
  -> returns { decision, request, response, backend, elapsedMs }
```

This is what the UI calls to produce a chain entry on demand. It is the only new
public surface in the design.

### Feature flag

`ff_aam`, default `'true'`, registered at the three `configStore.js` sites that
`ff_mcp_gateway_jwks` uses (registry entry with default, env alias map, env name
map). The BFF stamps the effective value on requests it makes to `/aam`; the
route honors it.

When off, the AAM filters are bypassed and `/api/aam/probe` returns a disabled
result rather than calling the gateway. The flag governs whether AAM *runs*; it
does not change which authorization path the `/mcp` routes use.

### Mock Sideband endpoint

New route in `demo_authz_server` serving the Sideband contract. The public
PingAuthorize documentation describes the sideband model but does not publish
the full request/response schema, so the mock is written against the request
that `PingAuthorizeFilter` actually emits, recorded in phase 1.

The mock's decision logic stays deliberately thin, because the point is
demonstrating the integration and the trace, not reimplementing PingOne
Authorize. It denies when the caller's token lacks a configured group claim and
permits otherwise, mirroring the group-membership rule the Ping example uses.
The expected group name comes from `AAM_MOCK_REQUIRED_GROUP` (default
`Full access`), so the mock and the console-side API Service can be pointed at
the same rule without editing code.

## Data flow

```text
client -> IG /aam/health
            PingAuthorizeFilter
              -> AamSidebandCapture -> real PingOne | authz-server mock
              <- Sideband response JSON  (captured)
            verdict: continue to backend, or 403
            AamTrailStamp -> X-Gw-Audit-Trail { aam: {...} }
          <- response

UI -> BFF GET /api/aam/probe
        -> IG /aam/health
        <- X-Gw-Audit-Trail
        parseGwAuditTrail -> aam section
        -> token chain / ProofStrip render request + response JSON
```

## Phases

Capture comes before the mock. Capture is how the request schema is discovered,
and the mock has to speak that schema.

| # | Phase | Done when |
| --- | --- | --- |
| 0 | Provision PingOne via the Management API (below) | Group, two test users, API gateway with credential, and a deployed API server exist; `PG_AAM_SERVICE_URL` and `AAM_GATEWAY_SECRET` are set and `/aam/health` returns 200 for the member and 403 for the non-member |
| 1 | `AamSidebandCapture` + `AamTrailStamp` in the IG route | A request to `/aam/health` against a stub returns `X-Gw-Audit-Trail` containing the verbatim Sideband request; the emitted schema is recorded in this spec |
| 2 | Mock Sideband endpoint on `demo_authz_server` | `X-Authz-Simulated: true` produces a PERMIT and a DENY from the mock, both with real request/response JSON in the trail |
| 3 | `aam` trail section parsed by the BFF + `GET /api/aam/probe` | The probe returns decision plus both JSON bodies; jest covers parse and route |
| 4 | `ff_aam` flag | Flag off bypasses AAM and the probe reports disabled; jest covers both states |
| 5 | Token chain and ProofStrip rendering | An AAM entry renders with its request and response JSON, matching how Agent Gateway rows render; vitest covers it |

Each phase is independently verifiable and leaves the demo working.

## Phase 0 — provisioning without the console

AAM's objects are reachable through the PingOne Management API using the worker
credentials already in `demo_api_server/.env`
(`PINGONE_WORKER_CLIENT_ID` / `PINGONE_WORKER_CLIENT_SECRET`). Neither the hosted
PingOne MCP server nor console clicks are required. Verified live on
2026-07-27 against environment `01d89b06`:

| Call | Result |
| --- | --- |
| `POST auth.pingone.com/{envId}/as/token`, `client_secret_basic` | token issued; `client_secret_post` is rejected with `invalid_client` / "Unsupported authentication method" |
| `GET /v1/environments/{envId}/apiServers` | `200` — AAM API Services are named **apiServers** in the Management API |
| `GET /v1/environments/{envId}/gateways` | `200` |
| `POST /v1/environments/{envId}/gateways` | requires `type`; the accepted value is `API_GATEWAY_INTEGRATION` |
| `POST /v1/environments/{envId}/apiServers` | requires `name` and `baseUrls` |
| `DELETE /v1/environments/{envId}/gateways/{id}` | `204` — creations are reversible |

Two traps worth carrying into the plan. `demo_api_server/.env` contains a
malformed line that breaks shell sourcing, silently leaving
`PINGONE_ENVIRONMENT_ID` empty and sending requests to a bare
`auth.pingone.com//as/token`, which answers with an AWS API Gateway error rather
than a PingOne one — read the values with a targeted `grep`, not `.` sourcing.
And an unrecognised `type` on `POST /gateways` returns a validation error while a
recognised one creates the object immediately, so enum probing leaves artifacts
that must be deleted.

Still undiscovered: the gateway credential sub-resource, the operations and rules
schema on an API server, and the deploy action. Phase 0 discovers these the same
way, deleting probe artifacts as it goes.

## Risks

**The real PingOne response schema is unverified until phase 0 runs.** It is no
longer blocked, only unfinished: phase 0 provisions the environment and phase 1's
capture then records the real response verbatim. If the shape surprises us,
phase 2's mock is corrected — the capture and trail plumbing are unaffected,
because they treat both bodies as opaque JSON.

**Phase 0 mutates a live PingOne environment.** Every object it creates is
additive and individually deletable (`DELETE /gateways/{id}` returns 204,
verified). Schema discovery for the remaining shapes — the gateway credential
sub-resource, API server operations and rules, and the deploy action — proceeds
by create-and-delete probing, so the environment must be left in a known state
after each session.

**`AttributesContext` sharing across the nested handler.** `AamSidebandCapture`
runs inside `sidebandHandler`, a nested chain; `AamTrailStamp` runs on the outer
route. The design assumes both see the same `AttributesContext` for the
exchange. Phase 1 proves this or forces a different hand-off (for example,
capturing into a response header on the inner chain and promoting it outward).
This is the single largest structural unknown and is deliberately phase 1.

**Body capture cost.** The Sideband exchange carries request headers and
possibly bodies. Capturing them on every request adds latency and log volume.
The trail is stamped only on `/aam` routes, which carry demo traffic only, so
the exposure is bounded.

## Security

The Sideband request contains the caller's `Authorization` header, because that
is what AAM evaluates. The captured JSON therefore contains a bearer token, and
it travels in a response header to the BFF and then to a browser.

The capture filter redacts `Authorization`, `Cookie`, and any `access_token`
field before the JSON reaches `attributes['aamTrail']`. Redaction happens at
capture, not at render, so no downstream consumer can leak what it never
received. `agentGatewayLogs.js` already has the redaction patterns to reuse.

`/api/aam/probe` mounts behind `authenticateToken` like the other admin gateway
routes.

## Testing

- Phases 1–2 have no Groovy unit harness in this repo. They verify live on an
  isolated IG container — the method used for PR #1025: worktree config mounted,
  distinct container name and port, joined to the compose network, never
  repointing the running stack.
- Phase 3–4: jest in `demo_api_server` for trail parsing, the probe route, and
  both flag states.
- Phase 5: vitest in `demo_api_ui` for chain rendering, then
  `cd demo_api_ui && npm run build` as the gate.
- Regression: `npm run topology:verify` before merge, and confirmation that
  `/mcp` and `/health` behavior is unchanged.

## Files

New:

- `ping-gateway/scripts/groovy/aam-sideband-capture.groovy`
- `ping-gateway/scripts/groovy/aam-trail-stamp.groovy`
- `demo_authz_server/routes/sideband.js`
- `demo_api_server/routes/aamProbe.js`
Phase 5 adds a `gw-aam` event to the chain rather than a new component.
`demo_api_ui/src/components/TokenChainDisplay.js` already carries the pattern for
`gw-authorize`: a dedicated renderer guarded by `event.id`, an entry in the
ordered event-id list, and a label-map entry (`"gw-authorize": "Policy
Decision"`). `gw-aam` follows all three, labelled `API Access Management`, and
renders the captured request and response JSON with the same viewer the
`gw-authorize` renderer uses.

Modified:

- `ping-gateway/config/routes/04-aam-api-access.json` — `sidebandHandler` and the
  stamp filter
- `ping-gateway/.env.example` — `AAM_MOCK_BASE`
- `demo_api_server/services/mcpGatewayClient.js` — `parseGwAuditTrail` gains `aam`
- `demo_api_server/services/configStore.js` — `ff_aam` at three sites
- `demo_api_ui/src/components/TokenChainDisplay.js` — `gw-aam` renderer, event-id
  list entry, label-map entry
- `ping-gateway/README.md` — simulated mode and the flag
