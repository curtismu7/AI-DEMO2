# Privilege MCP — what it is, how it works, and how it is wired here

PingOne Privilege is Ping's privileged-access product. Its **MCP Gateway (MCPGW)** is an
inline security gateway for the Model Context Protocol: an MCP client points at the
gateway instead of at the MCP server, and the gateway applies just-in-time,
least-privilege authorization to every `tools/call`, records the session, and forwards
what it permits to an **unchanged** MCP server.

That last part is the demo's whole point. `demo_mcp_server` needs no Privilege-specific
code. Policy and session recording are authored in the PingOne Privilege console, and the
gateway enforces them on the wire.

This repo contains a **client** for that gateway (`/privilege-mcp-client`), a **BFF relay**
that drives the OAuth and MCP protocol on the client's behalf, and Compose/K8s wiring for
running the gateway itself.

> Status as of 2026-08-02: the client, the relay and the protocol handling all work.
> The live path to Privilege is **down** — the gateway's enrollment token has expired and
> the client is pointed at the Privilege cloud API rather than at a gateway. See
> [Current state](#current-state-verified-2026-08-02).

---

## Moving parts

| Component | Where it runs | Identity | Notes |
|---|---|---|---|
| Privilege MCP Client page | Browser, `/privilege-mcp-client` | the signed-in demo user | React page; drives everything through the BFF |
| BFF relay | `demo-api-server`, `/api/privilege-mcp/*` | express session | [`routes/privilegeMcpClient.js`](../demo_api_server/routes/privilegeMcpClient.js) — OAuth PKCE, MCP JSON-RPC relay, SSE event stream |
| Privilege MCP Gateway (MCPGW) | `ping-mcpgw` container, `:8680` | enrollment JWT | image `public.ecr.aws/s7q1z8z4/privilege-proxy`, binary `/procyon/bin/cyonproxy`; Compose profile `mcpgw` |
| PingOne authorization server | `auth.pingone.com/<envId>/as` | OAuth client | mints the user's access token |
| PingOne Privilege control plane | `grpc.privilege.pingone.com:443` | enrollment JWT | the gateway dials **out**; no inbound firewall holes |
| Privilege cloud API | `privilege.pingone.com/api/mcp` | Privilege session | tenant API — **not** the gateway frontend (see [Current state](#current-state-verified-2026-08-02)) |
| MCP server | `mcp-server:8080/mcp` | audience `mcpserver.ping.demo` | the protected resource; Privilege-unaware |

"Procyon" appears throughout the gateway's wire protocol and binary names — it is the
product Privilege was built from, so `x-procyon-session-id` and `cyonproxy` are expected,
not stray artifacts.

---

## Protocols on each hop

**1. Browser to BFF** — ordinary HTTPS + the demo's express session cookie. One extra
channel: `GET /api/privilege-mcp/events` is a **Server-Sent Events** stream. Every OAuth
phase, every relayed request and every upstream response is mirrored to the page live, so
the demo can show the protocol rather than describe it.

**2. BFF to PingOne — OAuth 2.0 authorization code + PKCE.** The relay generates a 48-byte
verifier, sends `code_challenge_method=S256`, and pins `state`. Credentials go in the body
(`client_secret_post`). `login_hint` is set from `PRIVILEGE_LOGIN_HINT` so the operator
lands on the Privilege user rather than whoever the browser last used. Tokens are refreshed
one minute before expiry, and a `401` from the gateway triggers exactly one refresh-and-retry.

**3. BFF to gateway — MCP over HTTP, JSON-RPC 2.0.** The handshake is mandatory and ordered:

```
initialize                    → server returns its protocolVersion
notifications/initialized     → no response expected
tools/list  / tools/call      → the actual work
```

Three headers carry the session:

| Header | Set by | Purpose |
|---|---|---|
| `MCP-Session-Id` | server, echoed by client | MCP session, captured from the `initialize` response |
| `mcp-protocol-version` | client | required by Privilege on every non-`initialize` request |
| `x-procyon-session-id` | client | required by Privilege on **every** request, including discovery |

Responses arrive as JSON **or** as an SSE-framed body (`data:` lines). `decodeMcpBody()`
handles both, taking the last parsable `data:` frame — a plain `JSON.parse` breaks against
a streaming gateway.

**4. Gateway to MCP server** — plain MCP to `http://mcp-server:8080/mcp`. The gateway is a
proxy, so the MCP server sees a normal client.

**5. Gateway to Privilege control plane** — outbound gRPC to `grpc.privilege.pingone.com:443`,
authenticated by the enrollment JWT from the console's gateway wizard. This is how policy
reaches the gateway and how session recordings leave it.

---

## Architecture

```mermaid
graph TB
    subgraph browser["Browser"]
        UI["/privilege-mcp-client<br/>React page"]
    end

    subgraph demo["Demo stack (Docker Compose)"]
        BFF["demo-api-server<br/>/api/privilege-mcp/*"]
        GW["ping-mcpgw :8680<br/>cyonproxy"]
        MCP["mcp-server :8080<br/>Privilege-unaware"]
    end

    subgraph ping["PingOne (cloud)"]
        AS["Authorization server<br/>auth.pingone.com/{envId}/as"]
        CP["Privilege control plane<br/>grpc.privilege.pingone.com:443"]
        API["Privilege cloud API<br/>privilege.pingone.com/api/mcp"]
    end

    UI -->|"HTTPS + session cookie"| BFF
    BFF -.->|"SSE: live relay events"| UI
    BFF -->|"OAuth 2.0 code + PKCE"| AS
    BFF -->|"MCP JSON-RPC over HTTP"| GW
    GW -->|"MCP JSON-RPC"| MCP
    GW <-->|"outbound gRPC<br/>enrollment JWT"| CP
    BFF -.->|"currently configured here<br/>instead of the gateway"| API

    classDef broken stroke-dasharray: 5 5
    class API broken
```

## Sign-in and one tool call

```mermaid
sequenceDiagram
    autonumber
    participant U as Operator
    participant P as Client page
    participant B as BFF relay
    participant A as PingOne AS
    participant G as MCP Gateway
    participant M as MCP server

    U->>P: Sign In with Privilege
    P->>B: POST /auth/start
    B->>G: GET mcpUrl (discover auth metadata)
    G-->>B: authorization_uri + token_uri<br/>(or 401 → PingOne OIDC fallback)
    B-->>P: authUrl (PKCE S256, state, login_hint)
    U->>A: hosted sign-on
    A-->>B: GET /auth/callback?code&state
    B->>A: POST token (code + verifier + client_secret)
    A-->>B: access_token (+ refresh_token)
    B-->>P: redirect ?auth=success

    U->>P: Load Tools
    P->>B: POST /tools/list
    B->>G: initialize
    G-->>B: protocolVersion + MCP-Session-Id
    B->>G: notifications/initialized
    B->>G: tools/list (Bearer + session headers)
    G->>M: tools/list
    M-->>G: tools
    G-->>B: tools (JSON or SSE frames)
    B-->>P: { tools }

    U->>P: Run a tool
    P->>B: POST /tools/call
    B->>G: tools/call
    Note over G: Privilege decides:<br/>JIT least-privilege policy<br/>+ session recording
    alt permitted
        G->>M: tools/call
        M-->>G: result
        G-->>B: result
    else denied by policy
        G-->>B: 4xx — relayed with its own status
    end
    B-->>P: result or error
```

---

## BFF endpoint reference

All mounted at `/api/privilege-mcp` ([`server.js`](../demo_api_server/server.js)).

| Method | Path | Purpose |
|---|---|---|
| GET | `/events` | SSE stream of OAuth, relay and error events |
| GET | `/state` | config, whether OAuth is authenticated, cached tools |
| POST | `/config` | set `mcpUrl`, `clientId`, `scopes`, LLM settings; resets MCP state |
| POST | `/auth/start` | discovery + PKCE, returns `authUrl` |
| GET | `/auth/callback` | code exchange, stores tokens, redirects to the page |
| POST | `/tools/list` | `initialize` if needed, then `tools/list` |
| POST | `/tools/call` | invoke one tool by name |
| POST | `/rpc` | raw JSON-RPC passthrough |
| POST | `/chat` | LLM loop that picks tools and calls them |
| GET/PUT | `/env` | read/write the gateway's own OIDC settings file (allowlisted keys) |

Relay handlers surface the **upstream** status: an upstream 4xx passes through, anything
else becomes 500. A Privilege policy DENY therefore reaches the page as a 4xx with its
reason, not as an opaque server error.

## Configuration

| Variable | Set in | Meaning |
|---|---|---|
| `PRIVILEGE_MCPGW_URL` | `docker-compose.yml` | MCP URL the client page defaults to — should be the **gateway frontend** |
| `PRIVILEGE_SSO_CLIENT_ID` / `_SECRET` | `docker-compose.yml` | OAuth client for the user sign-in |
| `PRIVILEGE_SSO_ENV_ID` | `docker-compose.yml` | env used for OIDC discovery fallback |
| `PRIVILEGE_LOGIN_HINT` | `docker-compose.yml` | pre-fills the Privilege user at sign-on |
| `PRIVILEGE_MCP_CALLBACK_HOST` | env, optional | overrides the callback host (default `local.ping-devops.com:4000`) |
| `PRIVILEGE_PROXY_TOKEN` | root `.env` | enrollment JWT passed to the gateway as `ENV_PROXY_TOKEN` |
| `ping-mcpgw/config/proxy-token` | file, gitignored | same JWT, mounted at `/procyon/ssl/proxy-token.data` (preferred — the proxy writes back to it) |

Gateway setup — registering it, attaching an MCP Server application, authoring the DENY
rule, enabling recording — is in [`ping-mcpgw/README.md`](../ping-mcpgw/README.md). Those
console steps cannot be covered by any test in this repo: every check here can pass while
the demo still shows nothing.

---

## Current state (verified 2026-08-02)

The client and relay are healthy. The gateway now enrolls and holds a command stream to the
Privilege control plane. Two blockers remain before the end-to-end path works, and both are
console-side. Items 1 and 2 below are fixed and kept for the record — they explain why this
never ran before.

**1. The enrollment token expired — RESOLVED 2026-08-02.** The previous token expired
`2026-08-01T13:23:48Z` and the hand-run container had started six minutes *after* that, so
it never enrolled. A fresh token from the console wizard is installed and the gateway now
reaches the control plane:

```
Node e40f4540-… established command stream to CB3FD36F-…
node e40f4540-… received watch event: MedusaLinkEvent
Sending reachable objects update
```

Renewal is a console step: [`ping-mcpgw/RENEW-TOKEN.md`](../ping-mcpgw/RENEW-TOKEN.md).

**2. The Compose service could never start — RESOLVED 2026-08-02.** It mounted the
enrollment token as a **read-only single file**, but `cyonproxy` rewrites
`/procyon/ssl/proxy-token.data` at startup and writes its generated cert material beside it.
Every boot ended:

```
Error getting proxy cert: ProxyToken write to /procyon/ssl/proxy-token.data failed.
error: open /procyon/ssl/proxy-token.data: read-only file system
fatal: Error creating edge proxy
```

The token now arrives only via `ENV_PROXY_TOKEN` and `/procyon/ssl` is the writable
`mcpgw-ssl` volume — matching the vendor's own `docker run -v /var/lib/procyon/ssl:/procyon/ssl`.
That is also why a hand-run container was up instead of the Compose service: the Compose
one crash-looped.

**3. The gateway is enrolled but not yet serving `:8680`** — `https://local.ping-devops.com:8680`
does not answer, and the control plane reports `Error sending update to mesh controller:
rpc error: code = Unknown desc = not found`. Two console-side items remain:

- No **MCP Server application** is attached to cluster `ai-demo-se` yet — README step 4
  (Frontend URL `https://local.ping-devops.com:8680`, MCP Server URL `http://mcp-server:8080/mcp`).
  Until an application exists there is no MCP frontend for the proxy to serve.
- A **stale duplicate node** is still registered: `9a8bddf5-1dc6-4d3c-93c9-69fc2e2df587`
  (created 2026-08-01T22:55Z) claims the same `ProxyURL local.ping-devops.com:8680` as the
  live node `e40f4540-…`, which the proxy logs as a node conflict. Delete the old node in
  the console.

**4. The client pointed at the Privilege cloud API, not a gateway — RESOLVED 2026-08-02.**
`PRIVILEGE_MCPGW_URL` now defaults to the gateway frontend
`https://local.ping-devops.com:8680/mcp` (still overridable, so the SE cluster can use
`https://ai-demo.ping-devops.com/mcpgw`). Discovery also no longer dies when that gateway is
unreachable: the initial metadata fetch was unguarded, so a socket error threw before the
PingOne OIDC fallback could run and `/auth/start` answered `500 {"error":"fetch failed"}` —
sign-in was impossible whenever the gateway was down. The fallback now also applies to any
unrecognised host, since the gateway wizard is configured with this environment's OIDC
endpoints. Kept for the record, the reason the old value could never work:
`PRIVILEGE_MCPGW_URL` is `https://privilege.pingone.com/api/mcp`, while
`ping-mcpgw/README.md` specifies the gateway frontend `https://local.ping-devops.com:8680`.
Every call therefore returns:

```
401  User is not authorized for privilege.pingone.com/api/mcp
```

That endpoint 401s **every** unauthenticated path, including its own
`.well-known/oauth-protected-resource`, and sends no `WWW-Authenticate`. So `discoverAuth()`
never learns Privilege's real authorization server and silently falls back to the demo
environment's PingOne — every token is minted by env `01d89b06` for the app
`6586d3de` ("Demo AI App - MCP Gateway"). Confirmed dead end: the environment's dedicated
"Privilege Cloud MCP Gateway" app (`873cc9e4`) mints `aud: mcpserver.ping.demo`,
`scope: mcp:invoke` — the demo's own audience — and Privilege rejects it identically. No
token from this PingOne environment satisfies `privilege.pingone.com`.

The signed-in user is not the problem: `cmuir+ssoEndUser@pingone.com` authenticates
successfully (`authenticated: true`) and still receives the same 401.

### Order to fix

1. ~~Renew the enrollment token and start the gateway via Compose~~ — done 2026-08-02;
   the gateway is enrolled and holds a command stream to the control plane.
2. In the Privilege console: delete the stale node `9a8bddf5-…`, then attach an **MCP Server
   application** to cluster `ai-demo-se` (README step 4). Confirm
   `https://local.ping-devops.com:8680` starts answering.
3. Point `PRIVILEGE_MCPGW_URL` at that gateway frontend instead of the cloud API.
4. Re-run sign-in and `tools/list`. Discovery should now read the gateway's own
   `authorization_uri`/`token_uri` instead of falling back to the demo environment.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Not authenticated — click Sign In with Privilege` | no access token in the relay session | run the OAuth flow |
| `401 User is not authorized for privilege.pingone.com/api/mcp` | pointed at the cloud API, or the gateway is not enrolled | the three items above |
| `Failed to discover OAuth metadata from MCP URL` | MCP URL unreachable and no OIDC fallback resolved | check `PRIVILEGE_MCPGW_URL` and the gateway |
| `MCP gateway returned 502 Bad Gateway` | gateway up, upstream MCP server down or the user lacks tool entitlement | check `mcp-server`, then console policy |
| Tools load but a call is denied | Privilege policy DENY — the demo working as intended | inspect the decision in the console |
| Page shows nothing and no error | policy/recording never authored in the console | `ping-mcpgw/README.md` setup steps |
