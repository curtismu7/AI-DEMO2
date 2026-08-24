# Agent Gateway MCP OAuth broker — RFC 8414 + RFC 7591 for generic HTTP clients

**Date:** 2026-08-24
**Status:** Implemented + live-verified 2026-08-24 (PR #2353) — see the PR body for the verification transcript

## Context

`demo_mcp_gateway` ("Agent Gateway") is one of two external MCP "front doors"
in this repo. The other, Privilege (`agentless-mcpgw`), already works with
generic third-party clients (LM Studio, proven live this session) because its
`mcpgw` binary brokers OAuth on their behalf: it does its own Dynamic Client
Registration and Authorization Code+PKCE, then internally exchanges for a
real PingOne token.

Agent Gateway has no equivalent. A code audit
(see [[project-external-door-mcp-client-gap-2026-08-24]]) confirmed:

- Its Streamable HTTP transport (`POST/GET/DELETE /mcp` in `GatewayServer.ts`)
  is real and production-tested — nothing wrong with the transport.
- RFC 9728 protected-resource metadata and the `WWW-Authenticate` 401
  challenge already exist.
- There is **no RFC 8414 authorization-server metadata** and **no RFC 7591
  Dynamic Client Registration** anywhere in `demo_mcp_gateway` or
  `demo_authz_server`. PingOne itself does not support open DCR, so every
  client today needs a pre-registered PingOne app + hardcoded `client_id`.
- P1AZ per-tool-call enforcement (`authorizeMcpRequest.ts`, `PingOneAuthorizeClient.evaluate`)
  and the internal RFC 8693 exchange (`McpTokenExchangeClient.ts`,
  `MCP_GW_RESOURCE_URI` audience binding) are both correct today and **must
  not change**.

LM Studio is a fully spec-standard remote MCP client (Streamable HTTP only,
full OAuth 2.1 discovery, PKCE, and — confirmed empirically against
Privilege — it performs RFC 7591 registration automatically when no
`client_id` is pre-configured; LM Studio's `mcp.json` has no field for one).
It cannot be patched (closed source; the locally-installed Electron build's
webpack output is a viable-but-fragile local hack, rejected — see prior
turn). The fix has to be server-side.

**Why not just add DCR to `demo_authz_server`, or reuse `oauth-mcp`'s AS?**
`oauth-mcp` already has a tested, actively-developed embedded OAuth-AS
(`oauth-mcp/src/oauth/{OAuthRouter,ClientRegistry,TokenIssuer,SigningKeyManager,TokenStore}.ts`
— RFC 8414 + RFC 7591 + `/authorize` + `/token`, live since PR #1171,
currently being extended for Enterprise-Managed MCP Auth /ID-JAG per
`2026-08-22-enterprise-managed-mcp-authorization-design.md`). Its own code
draws a deliberate line:

```ts
// TokenIssuer.ts:24-29
/** The ONLY audience this embedded AS is entitled to assert: its own resource
 *  ... OTHER resource servers (the gateway, PingOne's API); this AS has no authority */
```

So the *live instance* cannot be extended to assert the Agent Gateway's
audience — that's a named, deliberate security boundary, not an oversight.
The *pattern* is reusable: `demo_mcp_gateway` is TypeScript (unlike
`demo_authz_server`, plain CommonJS), and `OAuthRouter`/`ClientRegistry` take
raw `http.IncomingMessage`/`ServerResponse` with no Express coupling — a
clean fit to port into the gateway as a **second, independently-keyed
instance** scoped to `MCP_GW_RESOURCE_URI`, rather than writing RFC
8414/7591 handling from scratch in JS.

**Out of scope:** WS transport (unaffected, already coexists on the same
port); LibreChat's Agent Gateway path (WS + static token per its own merged
design spec — a different transport, no interaction with this work); the
Privilege front door (already working); `oauth-mcp`'s live AS instance (not
modified).

## Design

### Architecture

```text
LM Studio                    demo_mcp_gateway (new: broker)          PingOne
    |--- GET .well-known/oauth-authorization-server -->|
    |<---------- AS metadata (this gateway's endpoints) -|
    |--- POST /oauth/register (RFC 7591) --------------->|
    |<---------- synthetic client_id --------------------|
    |--- GET /oauth/authorize (own PKCE, own client_id) ->|
    |                                    |--- GET /as/authorize (broker's PKCE, c8392dc4) --->|
    |                                    |<--------------------- PingOne login, code ----------|
    |                                    |--- POST /as/token (code+verifier) ----------------->|
    |                                    |<--------------------- real PingOne access_token ----|
    |<--- redirect w/ broker's own code -|
    |--- POST /oauth/token (broker's code) -->|
    |<--- the real, unmodified PingOne access_token -|
    |--- POST /mcp  Authorization: Bearer <real PingOne token> ----------------------------->| (unchanged: tokenValidator.ts, authorizeMcpRequest.ts)
```

### What's ported from `oauth-mcp`, and what's deliberately dropped

| oauth-mcp file | Fate |
| --- | --- |
| `ClientRegistry.ts` | Ported near-verbatim — DCR storage/lookup is audience-agnostic. |
| `OAuthRouter.ts` | Heavily adapted: `/authorize` gains the two-hop real-PingOne redirect (the pattern already designed in `2026-08-12-oauth-mcp-dcr-design.md` Part B, not yet built there either); `/token` looks up a stored real PingOne token instead of calling a self-issuing `TokenIssuer`. |
| `TokenStore.ts` | Adapted: maps broker's own authorization code → the real PingOne token (short TTL, single-use), not a self-issued-token store. |
| `TokenIssuer.ts` | **Not ported.** Its job (mint a locally-signed JWT) is unnecessary — see below. |
| `SigningKeyManager.ts` | **Not ported.** Only needed to sign self-issued tokens; dropped along with `TokenIssuer`. |
| `IdJagGrantHandler.ts` | **Not ported.** ID-JAG/Enterprise-Managed-Auth grant handling is unrelated to this work. |

**Key simplification vs. the oauth-mcp pattern: the token handed back to the
external client is the real, unmodified PingOne access token**, not a
locally re-signed one. oauth-mcp's `TokenIssuer` exists because oauth-mcp's
*own* resource server needed to accept self-issued tokens (`TokenIntrospector`
was taught to verify them locally). Agent Gateway's `tokenValidator.ts`
already validates real PingOne tokens today for every internal call — passing
the real token straight through means **zero changes** to `tokenValidator.ts`
or `authorizeMcpRequest.ts`. This is why `TokenIssuer`/`SigningKeyManager`
aren't needed: there's nothing to sign.

### Endpoints (new, in `demo_mcp_gateway`)

- `GET /.well-known/oauth-authorization-server` (RFC 8414) — advertises this
  gateway's own `authorization_endpoint`, `token_endpoint`,
  `registration_endpoint`.
- `POST /oauth/register` (RFC 7591) — issues a UUID `client_id` and stores the
  caller's declared `redirect_uris`. **Loopback only**
  (`127.0.0.1`/`localhost`) — mirrors the MCP native-app OAuth requirement and
  prevents open-redirect abuse. No PingOne involvement; this is entirely
  broker-local (ported `ClientRegistry`).
- `GET /oauth/authorize` — validates the external client's PKCE
  `code_challenge` + registered `redirect_uri`, stores the pending request,
  redirects to PingOne's real `/as/authorize` using the broker's own PKCE
  pair and the existing PingOne app `c8392dc4-2d82-4e49-92a8-79a78401faf5`
  ("Claude Code - Banking Gateway", public client, no secret,
  `pkceEnforcement: S256_REQUIRED`).
- `GET /oauth/callback` — PingOne's redirect target. Exchanges the code at
  PingOne's real `/as/token` (broker's PKCE verifier), gets the real access
  token, mints the broker's own authorization code mapped to that token
  (`TokenStore`, single-use, short TTL), 302s to the *original* external
  client's `redirect_uri`.
- `POST /oauth/token` — external client trades its code for the real,
  unmodified PingOne access token. Single-use; consuming a code clears the
  map entry.

### Required non-code change

Add `demo_mcp_gateway`'s real `/oauth/callback` URL as an additional redirect
URI on PingOne app `c8392dc4-2d82-4e49-92a8-79a78401faf5` — a console/API
action, same shape as the multi-redirect-URI pattern already on the
"PingOne MCP Server" app (`eec33861-...`, five redirect URIs for five known
clients). No new PingOne app; this one is already scoped as a public PKCE
client for "banking-gateway MCP (gateway audience)". This repo runs the
gateway behind multiple hosts (local Docker, SE K8s cluster); add the entry
for whichever one implementation is first tested against, and add the others
the same way when that environment is exercised — do not pre-add every
possible host speculatively.

### Why this doesn't collide with LibreChat's work

LibreChat's Agent Gateway path (per its merged design spec) is WS + a static
bearer token — a different transport, unaffected by anything here. If
LibreChat's OAuth-capable path is ever pointed at the gateway's HTTP
transport instead, it goes through these same generic endpoints for free —
nothing here is LM-Studio-specific; it's standard MCP OAuth discovery,
client-agnostic by construction. See prior turn's full reasoning.

## Testing

- Unit: `POST /oauth/register` → validates redirect_uri is loopback, rejects
  non-loopback.
- Unit: `GET /oauth/authorize` with an unregistered `client_id` → error, per
  RFC 6749 §4.1.2.1.
- Integration (mocked PingOne): full `/oauth/authorize` → `/oauth/callback`
  → `/oauth/token` round trip, resulting token is the exact token the mock
  PingOne endpoint returned (proves pass-through, not re-signing).
- Regression: `demo_mcp_gateway`'s existing 14 `gateway-*.test.ts` files stay
  green unchanged — this work adds routes, does not touch
  `authorizeMcpRequest.ts`, `McpTokenExchangeClient.ts`, or `tokenValidator.ts`.
- Live (needs the PingOne redirect-URI change applied first): LM Studio
  `mcp.json` pointed at the gateway's HTTP URL, full connect + tool call,
  confirm P1AZ decision fires exactly as it does for BFF-originated calls.

## Success criteria

- LM Studio can add the Agent Gateway as an MCP server by URL alone (no
  manual client_id/token), same zero-touch experience it already has with
  Privilege.
- A resulting tool call carries the real signed-in user's PingOne identity
  and is subject to the same P1AZ per-tool-call decision as every other path.
- `tokenValidator.ts`, `authorizeMcpRequest.ts`, `McpTokenExchangeClient.ts`
  unchanged.
- `oauth-mcp`'s live AS instance and its audience boundary unchanged.
- LibreChat's WS path unaffected.
- `demo_mcp_gateway`'s existing test suite green.
