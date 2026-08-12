# oauth-mcp: real Dynamic Client Registration (RFC 7591), backed by PingOne

## Context

`oauth-mcp` already ships a spec-compliant embedded OAuth Authorization
Server — `OAuthRouter.ts`, wired into `DemoMCPServer.ts` since PR #1171
(2026-07-31). It advertises `/.well-known/oauth-authorization-server`
(RFC 8414) with a `registration_endpoint`, and implements `/register`
(RFC 7591 DCR), `/authorize`, `/token`, `/introspect`, `/revoke`, `/jwks`.

It is currently orphaned in two ways:

1. **Tokens it issues are never accepted.** `TokenIntrospector.
   verifyTokenSignature()` (`src/auth/TokenIntrospector.ts:319`) only
   builds a JWKS keyset from `PINGONE_*` env vars. `HttpMCPTransport`'s
   RFC 9207 issuer check (`src/server/HttpMCPTransport.ts:900-913`)
   hardcodes `expectedIssuer = PINGONE_ISSUER`. A token minted by
   `TokenIssuer` (iss = `OAUTH_ISSUER`, signed by `SigningKeyManager`'s
   local RSA key) fails both checks even with a valid signature.
2. **`/authorize` doesn't authenticate anyone.** It auto-approves every
   request against a hardcoded `demo-user` subject
   (`OAuthRouter.ts:116-117`) — there's no real login step.

Zero test coverage exists on `OAuthRouter`/`ClientRegistry`/`TokenIssuer`.

This work makes DCR real end to end: a client can `POST /register`,
complete a real PingOne-backed login via `/authorize`, exchange the code
at `/token`, and have the resulting bearer token actually accepted on a
live MCP request.

**Out of scope:** the gateway (`demo_mcp_gateway` / `ping-mcpgw`) is not
changed. `MCP_AUTH_DISABLED=true` stays as-is in the root `.env` — this
work makes self-issued tokens *capable* of authenticating; it does not
make anything in the live demo path call `/register` yet.

## Part A — accept self-issued tokens

**Problem:** the embedded AS's signing key (`SigningKeyManager`) is
created inside `DemoMCPServer.startServer()`. `TokenIntrospector` is
constructed earlier, via `BankingAuthenticationManager`, outside
`DemoMCPServer` entirely — there's no live reference to hand it, and no
reasonable place to thread one through the constructor chain without a
larger bootstrap reorder.

**Fix:** turn `SigningKeyManager` access into a lazy module-level
singleton (e.g. `getEmbeddedSigningKeyManager()` in `src/oauth/`) so
`OAuthRouter` (signing) and `TokenIntrospector` (verifying) resolve the
same keypair without constructor DI.

**`TokenIntrospector.verifyTokenSignature()` changes:** decode the
token's `iss` claim (unverified — cheap, before choosing a verifier). If
it matches the embedded issuer (`OAUTH_ISSUER` / `TokenIssuer.
getIssuer()`'s fallback), verify locally against the singleton's public
key via `jose.jwtVerify(token, publicKey)` — no network call, none of
the JWKS-unreachable retry/last-known-good complexity that the PingOne
path needs. Otherwise, fall through to today's PingOne remote-JWKS path,
unchanged.

**`HttpMCPTransport` RFC 9207 check changes:** accept
`iss ∈ {PINGONE_ISSUER, embedded issuer}` instead of a single value.
Any other issuer still rejects as a mix-up attack — fail-closed behavior
is preserved, just widened to two known-good issuers instead of one.

**Actor-chain claims:** self-issued tokens (client_credentials or the
new PingOne-backed authorization_code grant, see Part B) carry
`client_id`/`scope` — no `act`/`may_act`. Need to confirm
`verifyActorChain` (`src/auth/actorChain.ts`) already treats a token
with no `act` claim as pass-through (client-credentials-shaped grants
have no delegation chain) rather than rejecting it. If it doesn't, scope
the fix narrowly: skip the actor-chain check specifically when
`tokenInfo` came from the embedded issuer.

## Part B — real PingOne-backed `/authorize`

**Problem:** `handleAuthorize` in `OAuthRouter.ts` auto-approves with no
real identity check.

**Fix — two-hop redirect**, replacing the auto-approve:

1. MCP client (already DCR-registered via `/register`) hits oauth-mcp's
   `GET /authorize?client_id=...&redirect_uri=...&state=...&code_challenge=...`
   — validated exactly as today (known client, registered redirect_uri,
   PKCE challenge present).
2. Instead of auto-approving, oauth-mcp stores the pending request
   (`client_id`, `redirect_uri`, `state`, `code_challenge`,
   `code_challenge_method`, `scope`) keyed by a new state value it
   generates itself, and 302s the browser to **PingOne's real
   `/authorize`** using a new dedicated PingOne app (see below) and its
   own callback `redirect_uri`:
   `http://localhost:8080/authorize/callback`.
3. User logs into PingOne for real.
4. PingOne redirects back to oauth-mcp's new
   `GET /authorize/callback?code=...&state=...` endpoint.
5. oauth-mcp exchanges the code at PingOne's `/token` (using the new
   app's client credentials), verifies the returned token via the
   existing `createJwksKeySet()`/`jwtVerify` PingOne path (already
   built, reused as-is).
6. oauth-mcp looks up the pending request by its own `state`, mints its
   own authorization code via the existing `TokenStore.createCode()`
   (subject = the real PingOne-verified user, not `demo-user`), and 302s
   to the *original* client's `redirect_uri` with that code — identical
   to today's response shape.
7. Original client's `POST /token` (authorization_code + PKCE) against
   oauth-mcp is **unchanged** — `TokenIssuer.issueAuthorizationCode`
   already does the right thing once `subject` is real.

**New PingOne app required:** authorization_code grant, PKCE, in env
`01d89b06-66d5-430e-9f28-65636843788b` (this demo's own env — same one
already used for other oauth-mcp-adjacent config), redirect_uri
`http://localhost:8080/authorize/callback`. Creating it is out of scope
for this implementation pass — it must be created via the PingOne
console, `pingcli`, or the PingOne MCP connector (which needs interactive
auth not available in an unattended session) before Part B can be tested
live. The client_id/secret it produces become new env vars, e.g.
`OAUTH_MCP_PINGONE_CLIENT_ID` / `OAUTH_MCP_PINGONE_CLIENT_SECRET`
(naming TBD at implementation time, following the `PINGONE_*` convention
used elsewhere in `oauth-mcp/.env`).

`client_credentials` grants (machine-to-machine, no human) are
unaffected by Part B — they stay self-issued with no PingOne
involvement, which is correct: there's no user identity to federate for
an M2M grant.

## Testing

Currently zero test coverage on `OAuthRouter`/`ClientRegistry`/
`TokenIssuer`. Add:

- **Round trip (Part A):** `POST /register` → `POST /token`
  (client_credentials) → resulting bearer accepted on a real MCP
  request → 200.
- **Issuer rejection:** a forged/third-party `iss` still rejects (RFC
  9207 mix-up protection holds for a third issuer, not just PingOne).
- **Regression:** existing PingOne-token tests stay green — Part A must
  not change behavior for tokens whose `iss` is PingOne.
- **Part B (needs the live PingOne app to exist):** full `/authorize` →
  PingOne login → `/authorize/callback` → `/token` round trip, subject
  on the resulting token matches the real PingOne user.

## Success criteria

- A client can `POST /register`, get `client_id`/`client_secret`.
- With `grant_type=client_credentials`, the resulting token authenticates
  a real MCP request (Part A, testable now, no new PingOne app needed).
- With `grant_type=authorization_code` via `/authorize`, the user
  actually logs into PingOne, and the resulting token's subject reflects
  that real identity (Part B, needs the new PingOne app to exist first).
- `npm run build && npm run test:unit` green in `oauth-mcp/`.
- No change to gateway behavior, `MCP_AUTH_DISABLED`, or any
  PingOne-issued-token code path.
