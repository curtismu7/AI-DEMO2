# Who brokers the final token exchange

**Status: settled. The gateway brokers it. There is no switch.**

This document used to describe `ff_gateway_brokered_exchange`, a flag that chose
between two delegation-ownership architectures. That flag was removed on
2026-07-26 because one of its two paths could never work. The reasoning is kept
here so nobody rebuilds it.

## The chain today

| # | Who | Subject → Audience |
|---|---|---|
| 1 | **BFF** | user token + AI Agent Actor (actor) → Agent Gateway (`agentgateway.ping.demo`) |
| 2 | **BFF** | intermediate + MCP Exchanger (actor) → PingGateway (`PG_GATEWAY_RESOURCE_ID`) |
| 3 | **PingGateway** | gateway-scoped token → backend MCP server (`PG_OLB_RESOURCE_URI`) |

P1AZ then authorizes; the MCP server validates. Neither mints tokens.

Exchange #1 must stay on the BFF — it is the only component holding both the
user session and the agent identity, which is what makes the `act` chain
meaningful. Exchange #3 is at the edge: the phantom-token pattern, where the
resource-scoped token is minted by the gateway and never leaves it.

## Why "BFF-brokered" could not work

The removed flag's OFF path had the BFF perform Exchange #2 all the way to the
MCP-server audience, then signal `X-BFF-Exchanged` so the gateway skipped
Exchange #3.

That fails at PingOne, every time:

```
invalid_scope: "May not request scopes for multiple resources"
```

Scope vocabularies in PingOne are **per resource** and do not cascade
(ARCHITECTURE-TRUTHS T-10). A single RFC 8693 request may narrow to exactly one
resource. Completing the chain from the BFF means asking for tool scopes that
live on several resources at once, which PingOne refuses outright. The user saw
the opaque `"That step couldn't be completed"`.

The same constraint shapes the rest of the design: it is why Exchange #2 exists
as a separate hop rather than being folded into #1, and why PingGateway's
Exchange #3 needs its own token-exchange client — an app cannot hold two scopes
of the same *name* across different resource grants.

## What was removed

- `ff_gateway_brokered_exchange` from `FLAG_REGISTRY` and its `FF_*` env alias
- the `gatewayBrokeredExchange` branch in `services/agentMcpTokenService.js`
- the `X-BFF-Exchanged` request header in `services/mcpGatewayClient.js`
- the skip branch, and its `BFF_INTERNAL_SECRET` trusted-caller gate, in
  `ping-gateway/scripts/groovy/olb-token-exchange.groovy`
- the flag from `MCP_GATEWAY_RUNTIME_FLAGS` in `services/demoStepPrerequisites.js`
  and its UI mirror `demo_api_ui/src/utils/requiredDemoFlags.js`

Dropping the header also closed an attack surface: it suppressed Exchange #3, so
any caller reaching the IG port could have forwarded its inbound
gateway-audience token straight to the MCP server instead of a re-scoped one.
The gate that guarded it is gone along with the thing it guarded.

## If you want to demo delegation-ownership tradeoffs

Talk about **where Exchange #3 happens** — at the edge (today) versus at the
resource server — rather than trying to move Exchange #2. The MCP-spec hop
(Step 9, the MCP server exchanging for a resource-scoped token before calling
the backend API) is the live example of that discussion.
