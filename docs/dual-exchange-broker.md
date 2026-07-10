# Dual token-exchange broker (`ff_gateway_brokered_exchange`)

Lets the demo show **both** delegation-ownership architectures for the final
RFC 8693 hop that mints the backend MCP-server token (`mcpserver.ping.demo`),
while routing through the **real PingGateway (IG)** in both cases.

## The two modes

Both require `ff_mcp_gateway_pinggateway = ON` (route through the real IG).

| `ff_gateway_brokered_exchange` | Who mints the `mcpserver.ping.demo` token | Flow |
|---|---|---|
| **ON** (default) — *gateway-brokered* | The **IG** (`olb-token-exchange.groovy`) | BFF stops its two-exchange chain at the coarse gateway audience (`gateway:mcp:invoke`). The IG runs Exchange #3 at the edge. Token-exchange-at-the-gateway / phantom-token pattern. |
| **OFF** — *bff-brokered* | The **BFF** | BFF completes the exchange to the mcp-server audience itself (reusing the existing `!usePingGatewayForExchange` branch) and sends the delegated token. The BFF stamps `X-BFF-Exchanged: true`; the IG **skips** Exchange #3 and forwards the token as-is. |

Both are legitimate production patterns. Gateway-brokered centralizes token
brokering + exchange credentials at the enforcement edge; bff-brokered performs
the exchange where the user+agent delegation context is richest. This toggle
demonstrates the tradeoff side by side.

## Using both flags together (the full matrix)

The demo has **two** flags in play — one for routing, one for who brokers the
final exchange. Set both to pick the architecture you want to show:

| `ff_mcp_gateway_pinggateway` (routing) | `ff_gateway_brokered_exchange` (broker) | Result |
|---|---|---|
| **ON** (real PingGateway) | **ON** (default) | Real IG enforces + **IG** mints the backend token (edge token-exchange). The headline "real gateway does it all" demo. |
| **ON** (real PingGateway) | **OFF** | Real IG enforces + **BFF** mints the backend token; IG validates + proxies. Same real gateway, delegation owned by the BFF. |
| **OFF** (Demo Node gateway) | *(ignored)* | Node Demo Agent Gateway path; the BFF always brokers. `ff_gateway_brokered_exchange` has no effect here. |

To showcase the delegation-ownership contrast, hold `ff_mcp_gateway_pinggateway`
**ON** and flip `ff_gateway_brokered_exchange` between runs — the Token Chain
view shows the final RFC 8693 hop landing at the IG (ON) vs. the BFF (OFF).

## What changed

- `demo_api_server/routes/featureFlags.js` — new flag `ff_gateway_brokered_exchange`
  (default `true`, `MCP / Agent` category) + `FF_GATEWAY_BROKERED_EXCHANGE`
  pin-alias.
- `demo_api_server/services/agentMcpTokenService.js` — `usePingGatewayForExchange`
  is now `routeViaPingGateway && gatewayBrokeredExchange`. Unset/true preserves
  today's gateway-brokered flow byte-for-byte; false routes the final exchange to
  the BFF (the existing `!usePingGatewayForExchange` audience/scope branch).
- `demo_api_server/services/mcpGatewayClient.js` — sends `X-BFF-Exchanged: true`
  when the flag is off (PingGateway routing only).
- `ping-gateway/scripts/groovy/olb-token-exchange.groovy` — skips Exchange #3 and
  forwards the inbound token when `X-BFF-Exchanged: true`.

Default behavior (flag unset/true) is unchanged.

## Live-verify checklist (deferred — needs an un-gated cluster + PingOne access)

This wires the code paths; two IG/PingOne items still need live confirmation
against the SE/AWS cluster:

1. **Gateway-brokered path currently returns a downstream 400.** Observed on
   `ping-devops-cmuir`: the IG route matches (`01-mcp-olb`), the exchange env is
   set (`TE_CLIENT_ID/SECRET`, `PG_OLB_RESOURCE_URI=mcpserver.ping.demo`,
   `PG_OLB_SCOPE`), but `olb-token-exchange.groovy` produced **no log** during a
   call and the backend received the un-exchanged token. Raise IG log level and
   confirm the exchange filter actually executes in the route's handler chain
   (the `McpProtectionFilter` introspection runs first — verify it isn't
   short-circuiting before the ScriptableFilter).
2. **BFF-brokered path — IG must accept the pre-delegated audience.** In bff mode
   the inbound token's `aud` is `mcpserver.ping.demo`, not the IG's HTTPS
   resourceId. The IG's `McpProtectionFilter` (introspection, runs before the
   groovy) may reject that audience. Confirm the filter accepts it when
   `X-BFF-Exchanged: true` (or add a skip there mirroring the groovy skip).
   Also note PingOne's multi-resource-token constraint (see the comment at
   `agentMcpTokenService.js` ~L2372): requesting both the gateway and mcp-server
   audiences yields a token PingGateway introspection rejects — bff mode requests
   the mcp-server resource directly, which sidesteps it, but verify live.

## How to demo

Toggle `ff_gateway_brokered_exchange` on the `/config` feature-flags page (or pin
`FF_GATEWAY_BROKERED_EXCHANGE=false` in the BFF env), keep
`ff_mcp_gateway_pinggateway = ON`, and run a banking chip. The Token Chain view
shows the final exchange happening at the IG (gateway-brokered) vs. at the BFF
(bff-brokered).
