# Privilege MCP Client — Auth & Tool Flow

---

## Flow 1: Login (PKCE + client_secret_post)

User clicks **Sign In with Privilege** — browser never holds a token.
BFF owns the OAuth exchange end-to-end.

| Phase | Steps | What happens |
|-------|-------|-------------|
| Initiate | 1–4 | BFF starts PKCE flow, returns redirect URL to browser |
| Authenticate | 5–7 | Browser redirects to PingOne; user signs in |
| Exchange | 8–10 | PingOne calls back with auth code; BFF swaps it for tokens |
| Complete | 11–12 | Tokens stored server-side; browser gets session cookie only |

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#0a1628', 'primaryColor': '#0d2b4a', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#4a90d9', 'lineColor': '#7fb3e0', 'signalColor': '#7fb3e0', 'signalTextColor': '#e0e8ff', 'noteBkgColor': '#2a2a4a', 'noteTextColor': '#e0e0e0', 'activationBkgColor': '#1e4a7c', 'activationBorderColor': '#4a90d9', 'sequenceNumberColor': '#ffffff'}}}%%
sequenceDiagram
    autonumber
    participant B as Browser
    participant BFF as BFF Relay<br/>demo-api-server:3001
    participant P1 as PingOne SSO<br/>auth.pingone.com/01d89b06

    Note over B,BFF: PHASE 1 — Initiate login

    B->>BFF: POST /auth/start
    Note over BFF: Fetches OIDC metadata from PingOne<br/>to get authorize + token endpoint URLs
    BFF->>BFF: OIDC discovery<br/>.well-known/openid-configuration
    Note over BFF: Generates a random code_verifier,<br/>hashes it to S256 challenge.<br/>PKCE prevents auth-code interception attacks.
    BFF->>BFF: Generate PKCE verifier<br/>+ S256 challenge + state
    BFF-->>B: { authUrl }
    Note over B: Browser receives a redirect URL.<br/>No token or secret is ever sent to the browser.

    Note over B,P1: PHASE 2 — User authenticates with PingOne

    B->>P1: Redirect → /as/authorize<br/>client_id=6586d3de<br/>code_challenge (S256)
    Note over P1: PingOne validates client_id and<br/>stores the challenge for later verification.
    P1-->>B: Sign-in page
    B->>P1: User credentials
    Note over P1: PingOne validates credentials,<br/>generates a one-time auth code,<br/>and redirects back to the BFF callback URL.

    Note over BFF,P1: PHASE 3 — BFF exchanges auth code for tokens

    P1-->>BFF: GET /auth/callback?code=...&state=...
    Note over BFF: BFF verifies state matches (CSRF protection),<br/>then exchanges the auth code immediately.
    BFF->>P1: POST /as/token<br/>grant_type=authorization_code<br/>client_id + client_secret (POST body)<br/>code + code_verifier
    Note over P1: PingOne re-hashes the verifier and compares<br/>to the stored challenge — proves the same<br/>party that started the flow is finishing it.
    P1-->>BFF: access_token + refresh_token (JWT RS256)

    Note over B,BFF: PHASE 4 — Session created, browser stays token-free

    BFF->>BFF: Store tokens in session
    Note over BFF: Tokens live only in server-side session.<br/>Browser gets a session cookie — never a token.
    BFF-->>B: Redirect /privilege-mcp-client?auth=success
    Note over B: Login complete. Browser holds a session<br/>cookie only. All API calls go through BFF.
```

---

## Flow 2: Load Tools (authenticated)

After login — browser requests tools, BFF relays to MCP server.
`ping-mcpgw` is **not** in this path. BFF calls `mcp-server` directly.

| Phase | Steps | What happens |
|-------|-------|-------------|
| Token check | 1–3 | BFF silently refreshes access token if it expires within 60s |
| MCP handshake | 4–7 | BFF opens an MCP session: initialize → acknowledged |
| Tool discovery | 8–10 | BFF fetches the full tool list; returns it to browser |

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#0a1628', 'primaryColor': '#0d2b4a', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#4a90d9', 'lineColor': '#7fb3e0', 'signalColor': '#7fb3e0', 'signalTextColor': '#e0e8ff', 'noteBkgColor': '#2a2a4a', 'noteTextColor': '#e0e0e0', 'activationBkgColor': '#1e4a7c', 'activationBorderColor': '#4a90d9', 'sequenceNumberColor': '#ffffff'}}}%%
sequenceDiagram
    autonumber
    participant B as Browser
    participant BFF as BFF Relay<br/>demo-api-server:3001
    participant P1 as PingOne SSO<br/>(refresh only)
    participant MCP as mcp-server:8080<br/>MCP_AUTH_DISABLED=true

    Note over B,BFF: PHASE 1 — Token freshness check

    B->>BFF: POST /tools/list
    Note over BFF: BFF checks the access token expiry.<br/>If it expires within 60s, refreshes silently<br/>before touching MCP — browser never waits.

    alt token expiring within 60s
        BFF->>P1: POST /as/token<br/>grant_type=refresh_token<br/>client_id + client_secret
        Note over P1: Issues a new access_token using<br/>the stored refresh_token. No user interaction needed.
        P1-->>BFF: new access_token
    end

    Note over BFF,MCP: PHASE 2 — MCP session handshake

    BFF->>MCP: POST /mcp<br/>Authorization: Bearer token<br/>mcp-protocol-version: 2024-11-05<br/>{ method: "initialize" }
    Note over MCP: MCP_AUTH_DISABLED=true — bearer token<br/>is forwarded but not validated.<br/>Server returns its protocol version<br/>and a session ID for this connection.
    MCP-->>BFF: { protocolVersion, capabilities }<br/>MCP-Session-Id header

    BFF->>MCP: POST /mcp<br/>{ method: "notifications/initialized" }
    Note over BFF: Required MCP handshake step —<br/>tells the server the client is ready to send requests.
    MCP-->>BFF: 202 Accepted

    Note over BFF,MCP: PHASE 3 — Fetch tool list

    BFF->>MCP: POST /mcp<br/>{ method: "tools/list" }
    Note over MCP: Returns all 238 tools registered<br/>in the Privilege MCP server — each with<br/>name, description, and input schema.
    MCP-->>BFF: { tools: [...238 tools...] }

    BFF-->>B: { tools }
    Note over B: Browser renders the tool list.<br/>User can now browse and invoke tools<br/>through the Privilege MCP Client UI.
```

---

## Flow 3: Tool Invocation (via Privilege MCP Gateway)

User selects a tool and clicks **Run** — the BFF sends a `tools/call` to the **Privilege MCP Gateway**, not directly to the MCP server. The gateway sits in the middle on purpose: it applies just-in-time least-privilege policy, records the session, and only then forwards the call to the real MCP server. The MCP server itself has no Privilege-specific code.

> **Key concept:** The browser is never an MCP client. The BFF speaks MCP on behalf of the user. The gateway is both an MCP server (to the BFF) and an MCP client (to mcp-server) — a security proxy by design.

| Phase | Steps | What happens |
|-------|-------|-------------|
| Invoke | 1 | Browser sends tool name + args to BFF over plain HTTPS |
| Token guard | 2–3 | BFF refreshes access token if needed before calling the gateway |
| Gateway policy | 4–6 | BFF calls gateway; gateway evaluates Privilege policy — permit or deny |
| MCP relay | 7–8 | Gateway forwards permitted call to mcp-server; gets result back |
| Response | 9–10 | Result flows back through gateway → BFF → browser; session recorded |

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#0a1628', 'primaryColor': '#0d2b4a', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#4a90d9', 'lineColor': '#7fb3e0', 'signalColor': '#7fb3e0', 'signalTextColor': '#e0e8ff', 'noteBkgColor': '#2a2a4a', 'noteTextColor': '#e0e0e0', 'activationBkgColor': '#1e4a7c', 'activationBorderColor': '#4a90d9', 'sequenceNumberColor': '#ffffff'}}}%%
sequenceDiagram
    autonumber
    participant B as Browser
    participant BFF as BFF Relay<br/>demo-api-server:3001
    participant P1 as PingOne SSO<br/>(token refresh only)
    participant GW as Privilege MCP Gateway<br/>ping-mcpgw (cloud-enrolled)
    participant MCP as mcp-server:8080<br/>the protected resource

    Note over B,MCP: PHASE 1 — Browser invokes a tool

    B->>BFF: POST /api/privilege-mcp/tools/call<br/>{ tool: "listAccounts", args: {...} }
    Note over B: Browser sends tool name and arguments.<br/>It never speaks MCP directly — only<br/>the BFF holds the MCP session and credentials.

    Note over BFF,P1: PHASE 2 — Token freshness check

    opt access token expiring within 60s
        BFF->>P1: POST /as/token<br/>grant_type=refresh_token
        Note over P1: Silent refresh — user sees no interruption.<br/>On a 401 from the gateway, BFF retries<br/>exactly once after refreshing.
        P1-->>BFF: new access_token
    end

    Note over BFF,GW: PHASE 3 — BFF calls Privilege MCP Gateway

    BFF->>GW: POST /mcp<br/>Authorization: Bearer user-token<br/>MCP-Session-Id: <session><br/>x-procyon-session-id: <procyon-id><br/>mcp-protocol-version: 2024-11-05<br/>{ method: "tools/call", params: { name, arguments } }
    Note over BFF: Three headers are required by the gateway<br/>on every request: MCP-Session-Id (from initialize),<br/>mcp-protocol-version, and x-procyon-session-id.<br/>Missing any one returns 400 or silent drop.
    Note over GW: The gateway is a SECURITY PROXY — it is<br/>both an MCP server (to the BFF) and<br/>an MCP client (to mcp-server).<br/>It evaluates PingOne Privilege policy now:<br/>— Is this user allowed to call this tool?<br/>— Does the token carry the right scopes?<br/>— Is there a just-in-time approval required?

    alt Policy DENY or scope mismatch
        GW-->>BFF: { error: "insufficient_privilege" } or 403
        BFF-->>B: { blocked: true, reason: "..." }
        Note over B: UI shows "Access Blocked" modal.<br/>Session is still recorded in Privilege<br/>console as a denied attempt.
    end

    Note over GW,MCP: PHASE 4 — Gateway relays permitted call to MCP server

    GW->>MCP: POST /mcp<br/>{ method: "tools/call", params: { name, arguments } }
    Note over MCP: mcp-server has ZERO Privilege-specific code.<br/>It sees a normal MCP tools/call from a client.<br/>Policy and session recording happen entirely<br/>inside the gateway — invisible to this server.
    MCP-->>GW: { result: { content: [...] } }
    Note over GW: Gateway records the session result<br/>to PingOne Privilege cloud (via gRPC to<br/>grpc.privilege.pingone.com:443).<br/>Audit trail is created regardless of outcome.

    Note over B,GW: PHASE 5 — Result flows back to browser

    GW-->>BFF: { result: { content: [...] } }
    Note over BFF: Response may arrive as plain JSON<br/>or as SSE-framed data: lines.<br/>BFF decodes both formats and<br/>streams the result to the browser via SSE.
    BFF-->>B: SSE event: tool result
    Note over B: Browser displays result in the terminal pane.<br/>Every step (request, policy check, response)<br/>was mirrored live to the Events tab via SSE<br/>so the user can see the full protocol trace.
```

---

## Flow 4: Tool Invocation — Simple Path (machine token, no gateway)

Alternative path used when `MCP_AUTH_DISABLED=true` or for testing without the Privilege gateway. BFF acts as its own OAuth client using `client_credentials` grant — no user login needed.

| Phase | Steps | What happens |
|-------|-------|-------------|
| Machine token | 1–2 | BFF mints its own token with client_credentials — no user involved |
| Direct MCP call | 3–6 | BFF calls mcp-server directly, bypassing the gateway |

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#0a1628', 'primaryColor': '#0d2b4a', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#4a90d9', 'lineColor': '#7fb3e0', 'signalColor': '#7fb3e0', 'signalTextColor': '#e0e8ff', 'noteBkgColor': '#2a2a4a', 'noteTextColor': '#e0e0e0', 'activationBkgColor': '#1e4a7c', 'activationBorderColor': '#4a90d9', 'sequenceNumberColor': '#ffffff'}}}%%
sequenceDiagram
    autonumber
    participant B as Browser
    participant BFF as BFF Relay<br/>demo-api-server:3001
    participant P1 as PingOne SSO
    participant MCP as mcp-server:8080<br/>MCP_AUTH_DISABLED=true

    Note over B,MCP: Simple path — BFF uses its own machine identity (no gateway, no user token)

    B->>BFF: POST /api/privilege-mcp-simple/tools/call<br/>{ tool: "listAccounts", args: {...} }
    Note over BFF: Simple route — no stored session or user token.<br/>BFF acts as its own OAuth client.

    BFF->>P1: POST /as/token<br/>grant_type=client_credentials<br/>client_id + client_secret
    Note over P1: Issues a machine access token scoped to<br/>the BFF application — no user context.<br/>Used for service-to-service calls and testing.
    P1-->>BFF: access_token (machine token)

    BFF->>MCP: POST /mcp — initialize<br/>Authorization: Bearer machine-token
    MCP-->>BFF: { protocolVersion, capabilities }<br/>MCP-Session-Id header

    BFF->>MCP: POST /mcp<br/>{ method: "tools/call", params: { name, arguments } }
    Note over MCP: MCP_AUTH_DISABLED=true — token is not<br/>validated. Call proceeds directly.<br/>No policy enforcement, no session recording.<br/>Useful for development and smoke testing.
    MCP-->>BFF: { result: { content: [...] } }

    BFF-->>B: { result }
    Note over B: Result returned directly.<br/>No Privilege policy was applied.<br/>No audit trail in the Privilege console.
```

---

## Current Config

| Setting | Value |
|---------|-------|
| PRIVILEGE_MCPGW_URL | `http://mcp-server:8080/mcp` |
| PRIVILEGE_SSO_ENV_ID | `01d89b06-...` |
| PRIVILEGE_SSO_CLIENT_ID | `6586d3de-...` |
| Token auth method | `client_secret_post` |
| MCP_AUTH_DISABLED | `true` |
| ping-mcpgw role | Sidecar — not in call path |
