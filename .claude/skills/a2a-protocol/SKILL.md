---
name: a2a-protocol
description: >-
  Use when changing UC2/UC2.5 A2A delegation, Agent Cards, A2A JSON-RPC handoff,
  PingOne bearer auth on the A2A hop, Learning Hub A2A copy, or anything that
  claims Agent2Agent protocol compliance. Distinguishes RFC 8693 nested-act
  identity from the Linux Foundation A2A wire protocol (@a2a-js/sdk).
---

# A2A Protocol (this demo)

Two layers share the name "A2A". Do not collapse them.

| Layer | What it proves | Code |
|---|---|---|
| **Identity (PingOne)** | Nested RFC 8693 `act` chain + Authorize over MCP/gateway | `a2aDelegationService.js`, token-chain `a2a-*` events |
| **Wire protocol (A2A)** | Agent Card discovery + JSON-RPC `SendMessage` with a **separate** PingOne bearer | `a2aProtocol*`, routes under `/a2a/specialists/:vertical` |

## Hard rules

1. **A2A use cases only** — UC2 + UC2.5 (delegation is always on; `ff_a2a_delegation` was removed). Never run protocol handoff on ordinary agent runs.
2. **PingOne always** for A2A hop auth (no Keycloak). Pattern mirrors [magic_8_ball_security](https://github.com/a2aproject/a2a-samples/tree/main/samples/java/agents/magic_8_ball_security) (bearer CredentialService → server validates JWT) with PingOne as the IdP.
3. **Nested-act MCP token ≠ A2A wire bearer.** Wire hop uses generalist client_credentials; MCP/gateway still uses Exchange #2 nested-`act` token.
4. **All specialists** in `config/a2aSpecialists.js` get an Agent Card + JSON-RPC mount.
5. Prefer `@a2a-js/sdk` (`client`, `server`, `server/express`) over hand-rolled JSON-RPC.

## Canonical URLs

- Spec / tutorials: https://a2a-protocol.org/dev/tutorials/
- Spec v1.0: https://a2a-protocol.org/v1.0.0/specification/
- Samples repo: https://github.com/a2aproject/a2a-samples
- Security sample (bearer pattern): https://github.com/a2aproject/a2a-samples/tree/main/samples/java/agents/magic_8_ball_security
- JS SDK: https://github.com/a2aproject/a2a-js (`@a2a-js/sdk`)

## Local endpoints (when flag on)

- Card: `GET /a2a/specialists/:vertical/.well-known/agent-card.json`
- JSON-RPC: `POST /a2a/specialists/:vertical` (requires `Authorization: Bearer <PingOne access token>`, `A2A-Version: 1.0`)
- Token Chain: UC2 emits `a2a-protocol-bearer` → `a2a-agent-card` → `a2a-protocol-message` after nested-act exchanges

UC2 handoff defaults to **in-process** `@a2a-js/sdk` `sendMessage` (BFF is HTTPS; avoids loopback TLS issues) after minting the PingOne wire bearer. Set `A2A_PROTOCOL_HTTP=1` or pass `protocolBaseUrl` to force the HTTP client path.

Base URL for cards uses `PUBLIC_APP_URL` (default `https://api.ping.demo:3001`).

## Do not break

- Existing nested-act exchanges and MCP Authorize path
- Session cookie auth on `/api/*`
- Non-A2A agent frameworks / vertical tools

## Learning Hub

Update `demo_api_ui/src/components/education/A2ADelegationPanel.js` when protocol story or URLs change. Keep emoji allowlist. Distinguish wire protocol from RFC 8693 identity in the copy.
