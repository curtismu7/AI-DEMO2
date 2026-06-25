# Super Banking — Architecture Walkthrough

> **Who this is for:** Engineers and architects who want to understand the Super Banking 3-layer stack end-to-end — what token exists where at each step of each auth flow, and which RFCs govern each hop.
>
> **Companion diagrams:** See the draw.io files in this `docs/` directory for visual sequence diagrams of each flow.

---

## 1. Component Map

Super Banking is a three-layer stack. Each layer has a clear responsibility boundary:

| Layer | Name | Role | Codebase location |
|-------|------|------|-------------------|
| **Browser** | React SPA (`banking_api_ui`) | Renders dashboard, admin panel, education panels, AI agent FAB | `banking_api_ui/src/` |
| **BFF** | Express server (`banking_api_server`) | OAuth flows, session management, token custodian, MCP proxy, CIBA gateway | `banking_api_server/server.js`, `routes/`, `services/` |
| **MCP Server** | TypeScript WebSocket server (`banking_mcp_server`) | Tool registry, tool execution, auth challenge gating | `banking_mcp_server/src/` |

**External systems:**

| System | Role |
|--------|------|
| PingOne (`auth.pingone.com`) | Identity provider — issues tokens for all OAuth/OIDC flows |
| Upstash Redis (Vercel) / LMDB (local) | Session store — persists BFF sessions across serverless invocations |

**OAuth clients (up to five PingOne apps):**

| Client | Used for | Config key |
|--------|----------|-----------|
| Admin OIDC app | Staff login to `/admin`; initiates RFC 8693 token exchange to MCP | `PINGONE_ADMIN_CLIENT_ID` |
| End-user OIDC app | Customer login to `/dashboard` | `PINGONE_USER_CLIENT_ID` |
| Worker app | PingOne Management API calls (user lookups, MFA) | `PINGONE_WORKER_TOKEN_CLIENT_ID` |
| MCP Token Exchanger | RFC 8693 token exchange to MCP-audience tokens | `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` |
| AI Agent actor app (optional) | Client credentials actor token for 2-exchange delegation | `PINGONE_AI_AGENT_CLIENT_ID` |

---

## 2. Why the BFF Holds All Tokens

### The BFF Token Custodian Pattern

In this architecture, **the browser never receives an access token or refresh token**. The BFF is the sole token custodian: all OAuth tokens are stored server-side in the session.

This means a compromised browser session only exposes the session cookie — an attacker cannot replay the access token directly, because the access token is never sent to the browser.

**Token location after login:**

| What | Where | Notes |
|------|-------|-------|
| `access_token` (user) | BFF session store (Redis / LMDB) | Used by BFF for all downstream API calls |
| `refresh_token` | BFF session store | Used by BFF to renew access tokens silently |
| `id_token` | BFF session store | Validated on receipt (signature + nonce); not stored in browser |
| `session_id` | Browser cookie (httpOnly, SameSite=Lax) | The only credential the browser holds |
| MCP token | Derived via RFC 8693 exchange — BFF only | Created on demand; never stored in browser |

**Code pointers:**
- Token storage: `banking_api_server/services/oauthService.js`
- Token exchange to MCP: `banking_api_server/services/agentMcpTokenService.js`
- Session store: `express-session` backed by Upstash Redis on Vercel; LMDB or in-memory locally

### Security rationale

| Threat | Mitigated by |
|--------|-------------|
| XSS steals access token | Token never in browser — only session cookie |
| Session cookie stolen | `httpOnly` prevents JS access; `SameSite=Lax` blocks CSRF |
| Replay of stolen session | Session backed by server-side store; rotation on re-auth |
| MCP token abuse | MCP token is narrow-scoped (audience=MCP server) and derived per-request |

---

## 3. Flow 1: Authorization Code + PKCE (User Login)

**Reference diagram:** [Super-Banking-AuthCode-PKCE-Flow.drawio](Super-Banking-AuthCode-PKCE-Flow.drawio)

**Standards:** [RFC 6749 — OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc6749) · [RFC 7636 — PKCE](https://datatracker.ietf.org/doc/html/rfc7636) · [RFC 9700 — OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/html/rfc9700)

### 3.1 What the user does

1. Visit `/marketing` → click **Log In**
2. Browser is redirected to PingOne login page
3. User enters credentials → browser returns to `/dashboard`

### 3.2 What the BFF does (under the hood)

| Step | Actor | Action | RFC / Note |
|------|-------|--------|-----------|
| 1 | React SPA | `GET /api/auth/oauth/start` | |
| 2 | BFF | Generate `code_verifier` (32 random bytes), `code_challenge = SHA256(verifier)`, `state`, `nonce` | RFC 7636 §4.1 |
| 3 | BFF | Redirect browser to PingOne `/authorize?response_type=code&code_challenge=...&state=...` | RFC 6749 §4.1.1 |
| 4 | PingOne | User authenticates; redirects back to `/api/auth/oauth/callback?code=...&state=...` | |
| 5 | BFF | Validate `state`; retrieve `code_verifier` from session | RFC 9700 §2.1 (state CSRF protection) |
| 6 | BFF | `POST /token: grant=authorization_code, code=..., code_verifier=...` | RFC 7636 §4.5 |
| 7 | PingOne | Issue `access_token`, `id_token`, `refresh_token` | |
| 8 | BFF | Store all tokens in server-side session; set session cookie | BFF Token Custodian Pattern |
| 9 | BFF | Redirect browser to `/dashboard` | |

### 3.3 Token state after Flow 1

| Token | Location | Scope | Notes |
|-------|----------|-------|-------|
| `code` (authorization code) | BFF memory (transient) | — | One-time use; exchanged in step 6 |
| `access_token` (user) | BFF session store | `openid profile email offline_access banking:general:read banking:general:write banking:ai:agent...` | Server-side only |
| `refresh_token` | BFF session store | Same resource | Used by BFF for silent renewal |
| `id_token` | BFF session store | `openid` | Validated on receipt; sub used for local user lookup |
| Session cookie | Browser | — | Only credential the browser holds |

### 3.4 PKCE explains itself

PKCE ensures the party that receives the authorization code at the callback is the same party that initiated the flow. The `code_verifier` (stored in BFF session) proves this — even if the callback URL was intercepted, the `code` is useless without the matching `code_verifier`.

---

## 4. Flow 2: CIBA (Client-Initiated Backchannel Authentication)

**Reference diagram:** [Super-Banking-CIBA-Flow.drawio](Super-Banking-CIBA-Flow.drawio)

**Standards:** [OpenID CIBA Core 1.0](https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html) · [RFC 9700 — OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/html/rfc9700)

### 4.1 When CIBA is used

CIBA triggers when the AI agent attempts a **high-value operation** (amount ≥ `STEP_UP_AMOUNT_THRESHOLD`, default $250). Unlike Flow 1, there is no browser redirect — the request goes directly from the BFF to PingOne on a backchannel.

**Activation:** `CIBA_ENABLED=true`, `STEP_UP_METHOD=ciba`

### 4.2 What happens

| Step | Actor | Action |
|------|-------|--------|
| 1 | AI Agent | Initiates tool call that requires elevated scope |
| 2 | BFF | `POST /bc-authorize`: `login_hint=user@email`, `binding_message="Approve transfer $X"` |
| 3 | PingOne → BFF | `auth_req_id`, `expires_in=120` |
| 4 | PingOne → User Device | Push notification or email: "Approve transfer?" |
| 5 | BFF → AI Agent | `{ cibaRequired: true, auth_req_id }` — agent waits |
| 6 | AI Agent → BFF | Poll `GET /api/ciba/status?auth_req_id=...` every 5 s |
| 7 | User | Taps Approve on device |
| 8 | PingOne → BFF | On next poll: elevated `access_token` |
| 9 | BFF → AI Agent | `{ approved: true }` — agent retries tool call |

### 4.3 Token state during CIBA

| Token | Location | Notes |
|-------|----------|-------|
| `auth_req_id` | BFF session | Temporary identifier from `bc-authorize`; expires in 120–300 s |
| Elevated `access_token` | BFF session | Issued after user approval; replaces or augments existing session token |
| Session cookie | Browser | Unchanged — CIBA does not touch the browser |

**Environment variables:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `CIBA_POLL_INTERVAL_MS` | 5000 | Polling interval (ms) |
| `CIBA_AUTH_REQUEST_EXPIRY` | 300 | Max wait time (seconds) |
| `STEP_UP_AMOUNT_THRESHOLD` | 250 | Amount above which CIBA is triggered |

---

## 5. Flow 3: RFC 8693 Token Exchange (MCP Agent Delegation)

**Reference diagram:** [Super-Banking-TokenExchange-Flow.drawio](Super-Banking-TokenExchange-Flow.drawio)

**Standards:** [RFC 8693 — OAuth 2.0 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693) · [RFC 9700 §2.8 — Token Exchange Security](https://datatracker.ietf.org/doc/html/rfc9700)

**Detailed PingOne setup guides:**

- **1-exchange delegated chain:** [docs/PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md](PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md)
- **2-exchange delegated chain (with act claim):** [docs/PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md](PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md)

### 5.1 Why token exchange is needed

When the AI agent calls an MCP tool, the BFF must present a token to the MCP server. This token must:
1. Be scoped to the MCP server audience (not the user's broad session token)
2. Prove that the user authorised the request
3. Optionally name the agent as the acting party (for audit)

RFC 8693 token exchange solves this: the BFF exchanges the user's session token for a narrow MCP-audience token, without re-authenticating the user.

**MCP token exchange is dormant by default.** It activates when `MCP_RESOURCE_URI` is set.

### 5.2 Path A: 1-Exchange (default)

> Full setup: [PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md](PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md)

The BFF holds the user's `access_token` (from Flow 1). On each MCP tool call:

```
BFF → PingOne:
  POST /token
  grant_type = urn:ietf:params:oauth:grant-type:token-exchange
  subject_token = <user_access_token>
  subject_token_type = urn:ietf:params:oauth:token-type:access_token
  audience = banking_mcp_01

PingOne → BFF:
  MCP access_token { sub: <user-id>, aud: "banking_mcp_01", scope: "banking:general:read banking:general:write banking:ai:agent" }
```

**Token state after 1-exchange:**

| Token | sub | aud | act claim | Notes |
|-------|-----|-----|-----------|-------|
| User session token | `<user-id>` | Admin / user resource | — | Stays in BFF session |
| MCP token | `<user-id>` | `banking_mcp_01` | Not present | The MCP Token Exchanger app (`PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID`) authenticates this exchange request to PingOne |

**PingOne requirement:** `may_act` claim on the user access token must name the BFF's `client_id`. This is set via Attribute Mappings on the resource server.

### 5.3 Path B: 2-Exchange (with act claim for agent identity)

> Full setup: [PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md](PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md)

Activated by: `USE_AGENT_ACTOR_FOR_MCP=true` or runtime flag `ff_two_exchange_delegation`.

Two sequential RFC 8693 exchanges:

**Exchange 1 — Agent actor token (client credentials):**
```
BFF → PingOne:
  POST /token
  grant_type = client_credentials
  client_id = PINGONE_AI_AGENT_CLIENT_ID
  → agent_actor_token { sub: "PINGONE_AI_AGENT_CLIENT_ID" }
```

**Exchange 2 — MCP token with nested act chain when preserved:**
```
BFF → PingOne:
  POST /token
  grant_type = urn:ietf:params:oauth:grant-type:token-exchange
  subject_token = <user_access_token>
  actor_token = <agent_actor_token>
  audience = banking_mcp_01
  → MCP token { sub: <user-id>, aud: "banking_mcp_01",
                act: { sub: "PINGONE_MCP_CLIENT_ID",
                       act: { sub: "PINGONE_AI_AGENT_CLIENT_ID" } } }
```

**RFC 8693 §4.1 — The `act` claim:**

The `act` claim in the issued token records the delegation chain:
- `sub` = the user (who authorised the request)
- `act.sub` = the current exchanger or MCP-facing actor
- `act.act.sub` = the AI agent identity when PingOne preserves the full nested chain

The MCP server can inspect the full chain. PingOne Authorize (PAZ) can enforce `act.sub` and, when present, `act.act.sub` as policy attributes for fine-grained access control. Some PingOne expression paths flatten the chain to a single `act.sub`; the runtime logs and token events call that out explicitly.

**Token state after 2-exchange:**

| Token | sub | aud | act claim | Notes |
|-------|-----|-----|-----------|-------|
| User session token | `<user-id>` | Admin resource | — | Stays in BFF session |
| Agent actor token | `PINGONE_AI_AGENT_CLIENT_ID` | Agent gateway | — | Transient, from CC grant |
| MCP token | `<user-id>` | `banking_mcp_01` | `{ sub: "PINGONE_MCP_CLIENT_ID", act: { sub: "PINGONE_AI_AGENT_CLIENT_ID" } }` | Delegation chain proven when fully preserved |

**Feature flags:**

| Flag | Effect |
|------|--------|
| `USE_AGENT_ACTOR_FOR_MCP=true` | Enables 2-exchange path at startup |
| `ff_two_exchange_delegation` | Runtime toggle (same effect) |
| `SKIP_TOKEN_SIGNATURE_VALIDATION=true` | Dev safety valve — **must be `false` in production** |
| `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` | Client ID for MCP Token Exchanger app (both exchange paths) |}

---

## 6. RFC Reference Summary

| RFC / Spec | Topic | Used in |
|-----------|-------|---------|
| [RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749) | OAuth 2.0 — Authorization Code grant | Flow 1, Flow 3 |
| [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) | PKCE — Proof Key for Code Exchange | Flow 1 |
| [RFC 8693](https://datatracker.ietf.org/doc/html/rfc8693) | Token Exchange grant type; `act` claim | Flow 3 (both paths) |
| [RFC 9396](https://datatracker.ietf.org/doc/html/rfc9396) | Rich Authorization Requests (RAR) | Referenced in Authorize/PAZ integration |
| [RFC 9700](https://datatracker.ietf.org/doc/html/rfc9700) | OAuth 2.0 Security Best Current Practices | All flows — state CSRF, PKCE requirement |
| [OpenID CIBA Core 1.0](https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html) | Backchannel authentication — `bc-authorize` | Flow 2 |
| [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) | ID token, nonce, `sub` claim | Flow 1 (id_token validation) |

---

*For PingOne-specific configuration required to enable each flow, see [PINGONE_APP_SCOPE_MATRIX.md](PINGONE_APP_SCOPE_MATRIX.md).*
*For deployment on Vercel (session store, redirect URIs), see [VERCEL_SETUP.md](VERCEL_SETUP.md).*
