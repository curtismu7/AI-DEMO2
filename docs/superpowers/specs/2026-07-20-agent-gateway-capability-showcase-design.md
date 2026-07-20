# Agent Gateway — Capability Showcase

## Problem

Ping's Agent Gateway product page claims three capability groups: validate &
audit MCP requests, throttle requests & transform tokens, enforce OAuth,
policy & metadata controls. An audit against this repo confirmed all seven
underlying capabilities are implemented in both
[`demo_mcp_gateway/src`](../../../demo_mcp_gateway/src) (Node reference
gateway) and [`ping-gateway/scripts/groovy`](../../../ping-gateway/scripts/groovy)
(PingGateway/IG parity), and that **PingGateway is already the default live
path** via `ff_mcp_gateway_pinggateway`
([docker-compose.yml:855](../../../docker-compose.yml#L855)) — Node is the
offline/dev fallback, not what runs by default.

Two problems for a presenter today:

1. Coverage is uneven. The scripted walkthrough
   ([`demoUseCaseSteps.js`](../../../demo_api_ui/src/config/demoUseCaseSteps.js))
   gives RAR (UC14b), DPoP (UC12), and policy-deny (UC6) their own beat, but
   **rate limiting has zero walkthrough coverage** and token transformation /
   OAuth fail-closed behavior are never called out on their own.
2. Attribution is invisible. Nothing in the UI tells a viewer *which* gateway
   (real PingGateway product vs. Node dev fallback) actually enforced a given
   check, so the "real product does this" claim is asserted verbally instead
   of shown.

## Why not a live dual-runtime toggle

Considered actually re-routing a demo call through both gateways at runtime
and diffing the two audit trails. Rejected: RAR enforcement differs by
mechanism between the two paths (Node does a local subset pre-check in
`rarEnforce.ts`; PingGateway forwards RAR evidence straight to the PDP, no
Groovy equivalent exists), so a live "identical output" toggle would be
misleading on the one capability where the paths genuinely aren't identical.
A static, honest citation of both paths (including the one asterisk) serves
the goal without engineering a routing feature just to prove a point.

## Design

Single source of truth (a config file) drives both a new standalone tour and
small link-outs on existing panels. No changes to gateway enforcement code,
no new gateway routing, no deletion of Node's fallback logic.

### Capability Ledger

New file `demo_api_ui/src/config/agentGatewayCapabilities.js`, 7 entries:

```js
{
  id: 'rate-limiting',
  group: 'throttle-transform',       // validate-audit | throttle-transform | oauth-policy-metadata
  title: 'Throttle requests',
  oneLiner: '...',
  evidence: {
    node: 'demo_mcp_gateway/src/rateLimit.ts:38-97',
    pingGateway: 'ping-gateway/scripts/groovy/uc18-rate-limit.groovy:1-20', // null for RAR
  },
  enforcedByDefault: 'pinggateway',   // 'pinggateway' | 'node' | 'node-only'
  fallbackNote: 'Node mirrors this for offline/dev — not the live path',
  relatedUCIds: ['UC1'],
}
```

The `enforcedByDefault` pill is computed from the live `ff_mcp_gateway_pinggateway`
flag value at render time (fetched the same way other flag-gated UI already
reads flags), not hardcoded — stays accurate if the flag is flipped before a
demo. The RAR entry is the one `node-only` value; every other entry is
`pinggateway` with a Node fallback note.

### Standalone tour — `/agent-gateway-capabilities`

New page + route, one card per ledger entry grouped under the product's own
three headers. Each card: title, one-liner, "Enforced by" pill, mono
file:line evidence for both paths, "Try it" link that jumps to the related
UC's chip trigger. Nav entry added alongside the existing `/pinggateway-test`
and `/configure?tab=mcp-gateway` links.

### Existing-panel callouts

One reusable `<CapabilityCallout capabilityId="..."/>` component reading from
the ledger, rendering a small link-out chip. Added, purely additively, to:
`AgentGatewayTester.jsx`, `McpGatewayConfig.jsx`,
`UnifiedTokenFlowInspector.jsx`, `AgentGatewayLogPanel.jsx`,
`ScopeAuditPage.js`. No existing logic in these files changes.

### Addendum (found during plan research) — UC29 collapsed, UC30 redesigned

Two corrections against the paragraph originally here, both discovered by
reading the actual current source rather than inferring from the earlier
audit's partial excerpts:

1. **"Throttle burst" already exists as UC18** (`useCaseId: 'rate-limit-defense'`,
   `useCases.js:825-844`), wired to a real, live sim
   (`attackSimulatorService.js` `_runRateLimitBurst`) that pushes real
   rate-limit config to the gateway, fires 5 real calls through it, and
   catches the real 429 — it's just missing from `DEMO_ADVANCED_USE_CASE_IDS`.
   No new UC, no new client-side burst mechanism. The gap is a one-line
   addition.
2. **A real, separate gap**: a rate-limited call today produces no trace in
   any shared panel — not `X-Gw-Audit-Trail`, not `/internal/mcp-audit` —
   because the audit-hook installation in `authorizeMcpRequest.ts` runs
   *after* the rate-limit check's early `return` (confirmed by reading the
   full pipeline, `authorizeMcpRequest.ts:182-272`). UC18's sim works around
   this today by building its own token-chain events client-side inside
   `attackSimulatorService.js`, bypassing the shared audit path entirely.
   Fixing this at the source (recording a minimal audit event directly in the
   rate-limit branch) makes *any* rate-limited call visible in
   `AgentGatewayLogPanel`, not just the ones that go through this one sim.
3. **UC29 — OAuth fail-closed, redesigned (renumbered from UC30 — UC29 no
   longer needs its own id once UC18 absorbed "throttle burst").** The
   original plan (a new cross-container polling mechanism so the gateway
   could learn about a BFF-side sim flag without a restart) is unnecessary.
   The gateway already has a live, in-place-mutable config object and a
   proven push path: `POST /admin/config`
   (`demo_mcp_gateway/src/adminConfig.ts`, `ADMIN_CONFIG_ALLOWED_KEYS`)
   already lets the BFF flip `rateLimitEnabled` live for UC18 with zero
   restart. Adding one more allowed key (`introspectionSimDown`) and one
   check at the top of `GatewayIntrospectionClient.introspect()` reuses that
   exact proven mechanism instead of building a new one. The sim
   (`_runIntrospectionDown` in `attackSimulatorService.js`, mirroring
   `_runRateLimitBurst`) arms the flag, fires one call, captures the 503, and
   **disarms it immediately after** — unlike rate-limiting, leaving this
   armed would block every subsequent call on the container, so auto-disarm
   is not optional.
4. **Token transform needs zero backend changes.** The "before" claim is the
   inbound token's `aud` (already decoded and shown elsewhere in the token
   chain); the "after" value is the backend resource URI for whichever tool
   was routed, and that's already exposed today by the existing `GET
   /admin/config` response (`mcpOlbResourceUri` / `mcpInvestResourceUri` /
   `gatewayResourceUri` in `adminConfig.ts`'s `safeView()`) — the same data
   `GatewayRoutingDiagram.jsx` already fetches. The new tab is pure
   composition of two already-available data sources.

Net effect: one true new UC (UC29, OAuth fail-closed), one real gateway
audit-visibility fix (small, isolated, in the rate-limit branch only), one
small-but-genuine gateway change reusing an existing live-config mechanism
(not a new one), and zero backend changes for token transform.

UC18 (surfaced) and UC29 (new) both join `DEMO_ADVANCED_USE_CASE_IDS` in
`demoUseCaseSteps.js` (not primary — they're gateway-mechanics deep-dives,
same tier as UC20 "Audit trail").

## Out of scope

- No change to gateway enforcement code in either `demo_mcp_gateway` or
  `ping-gateway` — this is UI, config, and one admin-sim addition only.
- No live dual-runtime toggle (see above).
- No trimming of Node's duplicate checks — it stays the full fallback it is
  today.
- No new capability beyond the 7 already audited.

## Testing

- Render test: tour page shows 7 cards, grouped 2 / 2 / 3 to match the
  product's `validate-audit` / `throttle-transform` /
  `oauth-policy-metadata` groups.
- Unit test: `CapabilityCallout` renders correctly for a known
  `capabilityId` and degrades to nothing (not a crash) for an unknown one.
- Unit test: the tour page omits a card's "Try it" link if its
  `relatedUCIds` entry no longer exists in `demoUseCaseSteps.js` (the two
  files can drift).
- UC29: manual — fire the burst chip, confirm the log panel shows a 429
  within the configured window.
- UC30: integration test hitting the new arm endpoint, confirming the
  fail-closed 401/503 shape — follow the convention of existing sim-arming
  tests (`SIMULATED_AUTHORIZE_*`, `SIMULATED_MCP_DENY_TOOLS`) for the
  request/response shape to match.
- Token transform tab: manual — run UC1, open the Token Transform tab,
  confirm the audience claim differs pre/post gateway.
