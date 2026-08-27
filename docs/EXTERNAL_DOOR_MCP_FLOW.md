# External-door MCP flow — every step, from a client (LM Studio / MCP Inspector / Claude Desktop) to a tool result

This traces the **entire** external-door path end to end: every HTTP call, every
protocol/RFC involved, and which service/file handles each step. Written from
live traffic captured against the real SE cluster (`cmuir-mcp.ping-devops.com`)
via MCP Inspector's network log and `kubectl logs`, cross-referenced against
source. Not a design doc — this is what the code actually does today.

Companion doc: `docs/superpowers/plans/2026-08-23-external-door-token-chain-bridge.md`
has the bug history (4 real bugs found/fixed tracing this flow) and current
deploy status. Read this doc for **how the system works**; read that one for
**what's currently broken/fixed**.

## Cast of services

| Service | Role | Where |
|---|---|---|
| External client (LM Studio, MCP Inspector, Claude Desktop) | The "external agent" — runs outside the cluster, has never talked to this system before | The user's machine |
| `ping-gateway` (PingGateway / ForgeRock IG) | Reverse proxy + authorization enforcement point for the internal `/mcp` path; NOT involved in OAuth AS endpoints | K8s pod, `ping-gateway` Service, port 8080 |
| `mcp-server` (oauth-mcp) | Both the MCP tool server AND its own embedded OAuth 2.1 Authorization Server (DCR, `/authorize`, `/token`, `/jwks`, etc.) | K8s pod, `mcp-server` Service, port 8080 — **same pod/Service** serves both the internal path and the external door |
| PingOne | The real, external identity provider — the actual login the user completes | `auth.pingone.com` / `apps.pingone.com`, tenant `01d89b06-66d5-430e-9f28-65636843788b` |
| `demo_api_server` ("the Banking API") | The BFF — same REST API normal browser sessions use, reached here over Bearer instead of a session cookie | K8s pod, separate Service |

Ingress: `mcp-public-door-ingress` (`k8s/aws/se-ingress.yaml`) routes the public
host `cmuir-mcp.ping-devops.com` — see "Phase 0" below for exactly how paths
split between `mcp-server` and `ping-gateway`.

---

## Phase 0 — network topology (which host handles which path)

The external door's ingress has exactly two routing rules on host
`cmuir-mcp.ping-devops.com`:

```
path: /.well-known/oauth-protected-resource   pathType: Prefix   -> mcp-server:8080
path: /                                        pathType: Prefix   -> ping-gateway:8080
```

So:
- `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/<anything>`
  go straight to `mcp-server` (oauth-mcp), bypassing `ping-gateway` entirely.
- Every other path — `/register`, `/authorize`, `/authorize/callback`, `/token`,
  `/jwks`, `/introspect`, `/revoke`, `/.well-known/oauth-authorization-server`,
  `/mcp`, `/audit` — goes through **`ping-gateway` first**.

`ping-gateway`'s own route config (`ping-gateway/config/routes/00-mcp-external-door.json`)
then decides what to do with what it receives, per path:

- Paths matching `^/mcp` (i.e. the actual MCP JSON-RPC endpoint) run the full
  groovy filter chain below (transaction hop, audit, 401 metadata, resource-server
  token check, MCP protocol validation, request validation, rate limit, **P1AZ
  authorization decision**, tools/list curation) before reverse-proxying to
  `mcp-server`.
- Everything else that reaches `ping-gateway` on this host (the OAuth AS
  endpoints: `/register`, `/authorize`, `/token`, `/jwks`, ...) does **not**
  match that `^/mcp` condition, so none of those filters run — `ping-gateway`
  just passes it straight through, unfiltered, to `mcp-server`. **The OAuth AS
  endpoints are not P1AZ-gated or audited** — by design, since a client can't
  have a token yet at DCR/authorize time.

The upshot: `mcp-server` (oauth-mcp) is one single process wearing two hats —
it's both the MCP tool server for internal/BFF traffic *and* its own OAuth 2.1
Authorization Server for the external door. `OAUTH_ISSUER` env var
(`https://cmuir-mcp.ping-devops.com`) is what makes it answer as an AS on this
host; the exact same process also validates and executes tool calls.

---

## Phase 1 — discovery (RFC 9728 + RFC 8414)

A spec-compliant MCP client doesn't know anything about this server yet. It
finds out how to authenticate via two `.well-known` documents.

### 1a. `GET /.well-known/oauth-protected-resource/mcp`

RFC 9728 §3.1: the client constructs this URL by inserting the well-known path
before the resource's own path (`/mcp`) — **not** the bare
`/.well-known/oauth-protected-resource`. (This distinction mattered a lot —
see the companion doc's bug #4.)

Handled by `oauth-mcp/src/server/HttpMCPTransport.ts`'s `handleMetadata()`.
Live response:

```json
{
  "resource": "https://cmuir-mcp.ping-devops.com/mcp",
  "authorization_servers": ["https://cmuir-mcp.ping-devops.com"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["accounts:read", "transactions:read", "transactions:write", "sensitive:read"],
  "resource_name": "Demo MCP Server",
  "resource_documentation": "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
}
```

The critical field is `authorization_servers` — it names oauth-mcp's own
embedded issuer, **not** PingOne. This is what tells the client where it can
actually self-register (PingOne has no dynamic client registration; oauth-mcp
does).

### 1b. `GET /.well-known/oauth-authorization-server`

RFC 8414. The client now asks the named authorization server (from 1a) how to
talk to it. Handled by `OAuthRouter.ts`'s `case '/.well-known/oauth-authorization-server'`.
Live response:

```json
{
  "issuer": "https://cmuir-mcp.ping-devops.com",
  "authorization_endpoint": "https://cmuir-mcp.ping-devops.com/authorize",
  "token_endpoint": "https://cmuir-mcp.ping-devops.com/token",
  "registration_endpoint": "https://cmuir-mcp.ping-devops.com/register",
  "jwks_uri": "https://cmuir-mcp.ping-devops.com/jwks",
  "introspection_endpoint": "https://cmuir-mcp.ping-devops.com/introspect",
  "revocation_endpoint": "https://cmuir-mcp.ping-devops.com/revoke",
  "scopes_supported": ["mcp:invoke", "read", "write"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "client_credentials"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
  "code_challenge_methods_supported": ["S256"],
  "client_id_metadata_document_supported": true
}
```

Everything from here on uses these five endpoints.

---

## Phase 2 — Dynamic Client Registration (RFC 7591)

### `POST /register`

No auth required (`MCP_OPEN_CLIENT_REGISTRATION=true` — deliberately open,
since ChatGPT/Claude/LM Studio can't be pre-registered and carry no initial
access token). Handled by `OAuthRouter.ts`'s `handleRegister()`
(`oauth-mcp/src/oauth/OAuthRouter.ts:456`).

Request body (whatever the client sends — honored close to verbatim):

```json
{
  "client_name": "MCP Inspector",
  "redirect_uris": ["http://127.0.0.1:6274/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "none",
  "scope": "mcp:invoke read"
}
```

The server generates `client_id` (`crypto.randomUUID()`) and `client_secret`
(random 32 bytes), stores the whole `OAuthClient` record in `ClientRegistry`
(persisted to disk if `TOKEN_STORAGE_PATH`/`ENCRYPTION_KEY` are set — survives
a pod restart), and returns 201:

```json
{
  "client_id": "5487e831-6f0f-4d47-b3c7-402e277ebfe3",
  "client_secret": "<random 32 bytes, base64url>",
  "client_name": "MCP Inspector",
  "grant_types": ["authorization_code", "refresh_token"],
  "redirect_uris": ["http://127.0.0.1:6274/oauth/callback"],
  "token_endpoint_auth_method": "none",
  "scope": "mcp:invoke read"
}
```

Note: `scope` is **pinned server-side** to `openRegistrationScope()`
(`mcp:invoke read` by default), never taken from the request — the open-DCR
gate would otherwise let any anonymous caller mint itself write access.

The client now has a `client_id`/`client_secret` it will use for every
subsequent OAuth call against this server.

---

## Phase 3 — Authorization (PKCE, two nested OAuth flows)

This is the most involved part: the external client's OAuth flow against
oauth-mcp, with oauth-mcp *itself* federating out to a second, real OAuth flow
against PingOne, in the middle.

### 3a. `GET /authorize` (client → oauth-mcp)

The client builds its own PKCE challenge and redirects the user's browser
here:

```
GET /authorize
  ?response_type=code
  &client_id=5487e831-6f0f-4d47-b3c7-402e277ebfe3
  &code_challenge=<client's own S256 challenge>
  &code_challenge_method=S256
  &redirect_uri=http://127.0.0.1:6274/oauth/callback
  &state=<client's own state>
  &scope=accounts:read transactions:read transactions:write sensitive:read
  &resource=https://cmuir-mcp.ping-devops.com/mcp
```

Handled by `OAuthRouter.ts`'s `handleAuthorize()` (line 108). It validates
`client_id`/`redirect_uri` against the registered client, requires
`code_challenge` (no non-PKCE flows), then does something a normal
authorization endpoint doesn't: **it federates**. It:

1. Generates its **own, separate** PKCE pair for its own outbound hop to
   PingOne (`pingOneCodeVerifier`/`pingOneCodeChallenge`) — this is entirely
   independent of the downstream client's PKCE. Two flows, two verifiers.
2. Stores a `PendingAuthorization` record (`TokenStore.ts`) keyed by a
   freshly-generated `relayState` — holding the original client's
   `clientId`/`redirectUri`/`scope`/`codeChallenge`/`clientState`, plus its own
   `pingOneCodeVerifier`. 10-minute TTL (a real PingOne login takes longer
   than a code exchange).
3. 302-redirects the browser to PingOne's **real** `/authorize` endpoint:

```
Location: https://auth.pingone.com/01d89b06-.../as/authorize
  ?client_id=<OAUTH_MCP_PINGONE_CLIENT_ID>
  &redirect_uri=https://cmuir-mcp.ping-devops.com/authorize/callback
  &response_type=code
  &scope=openid profile email
  &state=<the relayState oauth-mcp generated — NOT the client's own state>
  &code_challenge=<oauth-mcp's own PingOne-facing challenge>
  &code_challenge_method=S256
  &resource=enduser.ping.demo    (only when BANKING_API_RESOURCE_URI is configured)
```

The original client's `state` is deliberately **not** sent to PingOne (a
malicious `redirect_uri` must not be able to observe or replay it) — it's
recovered from the stored `PendingAuthorization` later, at 3c.

### 3b. Real PingOne login

The browser is now on `apps.pingone.com`, a genuine PingOne-hosted login page
for tenant `01d89b06-...`. The user enters username/password. **This is a real
login against the real identity provider** — nothing about this step is
mocked or simulated. On success, PingOne 302-redirects the browser back to
`https://cmuir-mcp.ping-devops.com/authorize/callback?code=<pingone-code>&state=<relayState>`.

### 3c. `GET /authorize/callback` (PingOne → oauth-mcp)

Handled by `handleAuthorizeCallback()` (`OAuthRouter.ts:187`). Looks up the
`relayState` in `TokenStore`, consuming the `PendingAuthorization` record (one
use only). Then:

1. **`POST` to PingOne's own token endpoint** (`PINGONE_TOKEN_ENDPOINT`) —
   this is oauth-mcp acting as an OAuth *client* of PingOne, exchanging
   PingOne's code for a real PingOne access token:
   ```
   grant_type=authorization_code
   &code=<pingone-code>
   &redirect_uri=https://cmuir-mcp.ping-devops.com/authorize/callback
   &client_id=<OAUTH_MCP_PINGONE_CLIENT_ID>
   &client_secret=<OAUTH_MCP_PINGONE_CLIENT_SECRET>
   &code_verifier=<oauth-mcp's own PingOne-facing verifier from 3a>
   &resource=enduser.ping.demo    (only when BANKING_API_RESOURCE_URI is configured)
   ```
2. **Verifies the returned PingOne access token's JWT signature** against
   PingOne's own JWKS (`createJwksKeySet()`), binding to `PINGONE_ISSUER` when
   configured — a valid signature alone only proves "some key in PingOne's
   JWKS signed this"; the issuer check is what proves it's *this* tenant.
3. Extracts `sub` from the verified token — this **is the real PingOne user
   id** (e.g. `1aee74ae-3d09-4bcf-a69f-7e1bc225b761` for `demouser`), stable
   across logins.
4. Mints its **own** authorization code (`TokenStore.createCode()`), bound to
   the *original* client's `clientId`/`redirectUri`/`scope`/`codeChallenge`
   and this real `subject` — plus (as of the `resource=` fix) the real
   PingOne access token itself, stashed for Step 9 later (Phase 7).
5. 302-redirects the browser to the **original client's** `redirect_uri`:
   `http://127.0.0.1:6274/oauth/callback?code=<oauth-mcp's own code>&state=<original client's own state>`.

The client sees exactly what it expects from a normal OAuth authorization
code response — the PingOne federation hop is invisible to it.

---

## Phase 4 — Token exchange

### `POST /token` (client → oauth-mcp)

```
grant_type=authorization_code
&code=<oauth-mcp's code from 3c>
&redirect_uri=http://127.0.0.1:6274/oauth/callback
&client_id=5487e831-6f0f-4d47-b3c7-402e277ebfe3
&client_secret=...
&code_verifier=<client's own verifier, matching the challenge from 3a>
```

Handled by `handleToken()` (`OAuthRouter.ts:275`). Validates PKCE, then calls
`TokenIssuer.issueAuthorizationCode(client, subject, scope, pingOneAccessToken)`
(`oauth-mcp/src/oauth/TokenIssuer.ts:81`), which mints a **self-signed JWT**:

```json
{
  "iss": "https://cmuir-mcp.ping-devops.com",
  "sub": "1aee74ae-3d09-4bcf-a69f-7e1bc225b761",
  "aud": "mcpserver.ping.demo",
  "client_id": "5487e831-6f0f-4d47-b3c7-402e277ebfe3",
  "scope": "mcp:invoke read",
  "jti": "<random>",
  "iat": ..., "exp": ... (1 hour)
}
```

Signed with oauth-mcp's own RSA key (`SigningKeyManager`) — this is **not** a
PingOne token; `iss` names oauth-mcp itself. `TokenStore.trackToken()` records
this JWT's `jti` alongside the real PingOne access token from Phase 3c-4 — the
lookup Step 9 (Phase 7) uses later. Response:

```json
{ "access_token": "<the JWT above>", "token_type": "Bearer", "expires_in": 3600, "scope": "mcp:invoke read" }
```

**This JWT — not the real PingOne token — is what the client uses as its
Bearer for every MCP call from here on.** The real PingOne token is held
server-side only, keyed by this JWT's `jti`.

---

## Phase 5 — MCP session establishment

Every request from here on goes to `POST /mcp`, which — per Phase 0 — routes
through `ping-gateway` and its full groovy filter chain first.

### `ExternalDoorResourceServerFilter` (ping-gateway, built-in IG filter type)

Introspects the presented Bearer against `TokenIntrospectionAccessTokenResolver`
→ `mcp-server:8080/introspect` (RFC 7662) — oauth-mcp's own introspection
endpoint, since this token was self-issued, not PingOne's. Requires scope
`mcp:invoke` (env `PG_EXTERNAL_INBOUND_SCOPE`). This populates the
`OAuth2Context` the P1AZ groovy script reads later.

### `POST /mcp` — `initialize`

```json
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{...},"clientInfo":{"name":"mcp-inspector","version":"0.0.0"}}}
```

Required header: `MCP-Protocol-Version` (e.g. `2025-06-18` or `2025-11-25`) —
its absence is a 400 (`Missing, malformed or unsupported MCP-Protocol-Version
header`).

Before reaching the tool logic, `p1az-decision.groovy` runs a **P1AZ
authorization decision** even for `initialize` (`DecisionContext:
"McpRequest"`) — a real call to PingOne Authorize's decision endpoint
(`api.pingone.com/.../decisionEndpoints/...`), `PERMIT`/`DENY`. Every
subsequent MCP method gets its own P1AZ decision call too — this is not a
one-time gate, it's per-request.

`mcp-server` responds with `Mcp-Session-Id` header (a session UUID) and
negotiated protocol version:

```json
{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2026-07-28","capabilities":{"tools":{"listChanged":false},"logging":{}},"serverInfo":{"name":"AI Demo MCP Server","version":"1.0.0"}}}
```

Every subsequent call on this session must carry `Mcp-Session-Id: <that uuid>`.

### `POST /mcp` — `notifications/initialized`

The client confirms handshake completion. Another P1AZ decision call
(`DecisionContext: "McpRequest"`, `McpMethod: "notifications/initialized"`).

---

## Phase 6 — `tools/list`

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

Another P1AZ decision (`DecisionContext: "McpToolsList"`). On `PERMIT`, the
request reverse-proxies to `mcp-server`, which by default returns **all ~44**
banking tools (deliberately unfiltered at the MCP-server layer — scope/vertical
filtering is meant to happen at the gateway, not double-filtered).

Before the response reaches the client, **`external-door-tools-filter.groovy`**
intercepts it (runs on the *response*, not the request, to avoid a
request-entity-read deadlock — see the companion bug-history doc) and trims
the tool list to a curated 9:

```
get_my_accounts, get_account_balance, get_sensitive_account_details,
get_my_transactions, create_deposit, create_withdrawal, create_transfer,
query_user_by_email, sequential_think
```

This matches oauth-mcp's own documented `publicAccess`/`restrictedAccess`
split — the full internal 44-tool surface (admin tools, vertical actions,
etc.) is not exposed to a self-registered, less-trusted external client.

---

## Phase 7 — `tools/call` (the actual work)

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_my_accounts","arguments":{}}}
```

### 7a. P1AZ decision (per-call, real)

`p1az-decision.groovy` builds a request to PingOne Authorize's decision
endpoint:

```json
{
  "parameters": {
    "DecisionContext": "McpToolCall",
    "McpMethod": "tools/call",
    "ToolName": "get_my_accounts",
    "ClientId": "5487e831-...",
    "UserId": "1aee74ae-...",
    "TokenScopes": "mcp:invoke read",
    "TokenIss": "https://cmuir-mcp.ping-devops.com",
    "TokenAudActual": "mcpserver.ping.demo",
    ...
  }
}
```

Response: `{"decision": "PERMIT", "payload": "{...authorized: true...}"}`.
`UserId` here is the JWT's `sub` (Phase 4) — the real PingOne user id when the
grant was `authorization_code`, or the client's own `client_id` when it was
`client_credentials` (no real user — the demo can't attribute this to anyone).

### 7b. Reverse proxy to `mcp-server`, tool dispatch

`BankingToolProvider.executeTool()` → `executeSpecificTool()` →
`TokenResolver.resolve()` (`oauth-mcp/src/tools/TokenResolver.ts`) decides
which bearer to actually present to the downstream Banking API call:

- `isSelfIssuedToken(agentToken)` — is `iss` this server's own embedded
  issuer? (Every external-door token is, by construction — Phase 4.) If so,
  **skip Step 9** (attempting it would fail: PingOne's real token-exchange
  endpoint can't parse a foreign-issuer JWT as a `subject_token`).
- Instead, `resolveFederatedSubjectToken()` decodes the agentToken's `jti` and
  looks it up in `TokenStore` — if a real PingOne access token was stashed
  against it (Phase 3c-4, only true for `authorization_code` sessions), use
  **that** instead of the self-issued JWT. `source: 'agent-federated-passthrough'`.
- If nothing was stashed (a `client_credentials` session — no real user ever
  federated), fall back to forwarding the raw self-issued JWT.
  `source: 'agent-passthrough'`.

### 7c. Call the Banking API (`demo_api_server`)

Whichever token Phase 7b resolved is sent as `Authorization: Bearer <token>`
to `demo_api_server`'s REST API (`get_my_accounts` → some `/api/accounts`-shaped
endpoint) — the same BFF a normal browser session talks to via cookie, just
authenticated differently here. It validates the bearer expects a PingOne
token **audienced for `enduser.ping.demo`** (`BANKING_API_RESOURCE_URI`).

This is where the token must have been obtained with `resource=enduser.ping.demo`
requested at the PingOne `/authorize`/`/token` steps (Phase 3a/3c) — a
federated token that only ever asked for `openid profile email` is real and
signature-valid but wrong-audience, and this call 401s (`invalid_token`) even
though every earlier step succeeded correctly.

### 7d. Response

On success, the Banking API returns account data; `BankingToolProvider` wraps
it as the MCP tool result:

```json
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"..."}],"structuredContent":{...}}}
```

which flows back through `mcp-server` → `ping-gateway` → the client.

---

## Everything that gets recorded along the way (for the movie-reel bridge)

Independent of the response above, **every** tool execution (any entry point)
gets logged by `oauth-mcp/src/tools/TokenChainAuditor.ts` →
`AuditLogger.logTokenChain()` into an in-memory, per-pod event store, tagged
with the caller's `userToken.sub` (the JWT's `sub` — real PingOne user id for
`authorization_code` sessions). `demo_api_server`'s BFF polls
`GET /api/token-chain` (browser side, ~15s interval) →
`tokenChainService.js`'s `getMCPToolCalls(userId, req)` → fetches
`GET /audit?eventType=token_chain` from this **same** `mcp-server` pod (same
Deployment/Service as the external door — see Phase 0) → filters for
`event.details.userToken.sub === req.user.id` (the browser session's own
PingOne sub). If a user is logged into Personal Agent Studio in a browser and
also completes an external-door `authorization_code` login as themselves,
their external tool call should appear in their own movie reel within one
poll cycle — no bridge code required, the identity match is what does it.

---

## Summary — the whole chain in one line each

1. `GET .well-known/oauth-protected-resource/mcp` → discover oauth-mcp is the AS (not PingOne)
2. `GET .well-known/oauth-authorization-server` → discover oauth-mcp's endpoints
3. `POST /register` → DCR, get a fresh `client_id`/`client_secret`
4. `GET /authorize` → oauth-mcp redirects to real PingOne, with its own separate PKCE
5. Real PingOne login (username/password, actual IdP)
6. PingOne → `GET /authorize/callback` → oauth-mcp verifies PingOne's token, extracts real `sub`, mints its own code
7. oauth-mcp → client's `redirect_uri` → client has an authorization code
8. `POST /token` → oauth-mcp mints a **self-signed** JWT (not PingOne's), stashes the real PingOne token server-side against its `jti`
9. `POST /mcp initialize` / `notifications/initialized` → P1AZ decision per call, session established
10. `POST /mcp tools/list` → P1AZ decision, full 44 tools, trimmed to 9 by response-filter groovy
11. `POST /mcp tools/call` → P1AZ decision → `TokenResolver` finds the stashed real PingOne token (if `authorization_code`) → Banking API call, audience-gated on `enduser.ping.demo`
12. Result flows back; the call is separately logged for the token-chain movie reel, keyed by the real user's `sub`
