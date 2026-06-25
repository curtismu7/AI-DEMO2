# PingOne Resources × Applications × Scopes — Complete Matrix

**Canonical as of Phase 146 (Scope Vocabulary Alignment, D-02).**  
Code source of truth: `banking_api_server/config/scopes.js`, `config/oauth.js`, `config/oauthUser.js`, `banking_api_server/SCOPE_VOCABULARY.md`.

---

## 1. Resource Servers

### 1a. Banking Resource Server

| Property | Value |
|----------|-------|
| **Name** | Super Banking API |
| **Audience / Resource URI** | Value of `ENDUSER_AUDIENCE` env var (e.g. `https://resource.pingdemo.com`) |
| **Type** | Custom resource server |
| **Purpose** | Audience for end-user (customer / admin) tokens + RFC 8693 subject token |

**Scopes — define exactly these on this RS:**

| Scope | Purpose | Who gets it |
|-------|---------|-------------|
| `banking:read` | Read accounts & transactions | Admin, Customer, AI Agent |
| `banking:write` | Write banking operations (deposits, transfers) | Admin, Customer, AI Agent |
| `banking:admin` | Full admin access | Admin only |
| `banking:sensitive` | Sensitive data read/write | Admin only |
| `banking:ai:agent` | AI agent delegation marker | Admin, AI Agent, Customer (2-exchange) |
| `ai_agent` | Agent identity marker (legacy OIDC scope) | AI Agent clients only |

> **Do not create:** `banking:general:read`, `banking:admin:full`, `banking:ai:agent:read`, `agent:invoke`, `banking:agent:invoke` — stale names, not used by the code.

---

### 1b. MCP Resource Server

| Property | Value |
|----------|-------|
| **Name** | Super Banking MCP Server |
| **Audience / Resource URI** | Value of `PINGONE_RESOURCE_MCP_SERVER_URI` (e.g. `https://mcp-server.pingdemo.com`) |
| **Type** | Custom resource server |
| **Purpose** | Audience for RFC 8693 exchanged (narrowed) MCP tokens |

**Scopes — define exactly these on this RS:**

| Scope | Purpose |
|-------|---------|
| `banking:read` | Read access in MCP context |
| `banking:write` | Write access in MCP context |
| `banking:mcp:invoke` | Permission to invoke MCP tools |

> Must match `MCP_TOKEN_EXCHANGE_SCOPES` env var (default: `banking:read banking:write banking:mcp:invoke`).

---

### 1c. PingOne API (built-in)

| Property | Value |
|----------|-------|
| **Name** | PingOne API |
| **Audience** | `https://api.pingone.com` (fixed) |
| **Type** | Built-in |
| **Purpose** | Management API calls from the BFF (**Super Banking Worker Token App**) |

**Scopes used:**

| Scope |
|-------|
| `p1:read:user` |
| `p1:update:user` |
| `p1:create:user` |
| `p1:delete:user` |
| `p1:read:environment` |

---

## 2. Applications

### 2a. Super Banking User App (Customer login)

| Property | Value |
|----------|-------|
| **Type** | WEB_APP |
| **Grant types** | Authorization Code + PKCE |
| **Client ID config key** | `user_client_id` |
| **Redirect URI** | `https://<host>/api/auth/oauth/user/callback` |
| **Token endpoint auth** | `none` (PKCE public client) |
| **RFC 8693 exchange** | Not required on this app |
| **Resource server** | Banking RS |

**Scopes to grant (Banking RS):**

| Scope | Required? |
|-------|-----------|
| `openid` | ✅ |
| `profile` | ✅ |
| `email` | ✅ |
| `offline_access` | ✅ |
| `banking:read` | ✅ |
| `banking:write` | ✅ |
| `banking:ai:agent` | ✅ required for agent delegation |

---

### 2b. Super Banking Admin App (Admin login)

| Property | Value |
|----------|-------|
| **Type** | WEB_APP |
| **Grant types** | Authorization Code (+ PKCE optional) |
| **Client ID config key** | `admin_client_id` |
| **Redirect URI** | `https://<host>/api/auth/oauth/callback` |
| **Token endpoint auth** | `basic` or `post` (per `admin_token_endpoint_auth_method`) |
| **RFC 8693 exchange** | ✅ Enable Token Exchange grant |
| **Resource server** | Banking RS |

**Scopes to grant (Banking RS):**

| Scope | Required? |
|-------|-----------|
| `openid` | ✅ |
| `profile` | ✅ |
| `email` | ✅ |
| `offline_access` | ✅ |
| `banking:read` | ✅ |
| `banking:write` | ✅ |
| `banking:admin` | ✅ |
| `banking:sensitive` | ✅ |
| `banking:ai:agent` | ✅ |

---

### 2c. Super Banking MCP Token Exchanger (RFC 8693 exchange client)

| Property | Value |
|----------|-------|
| **Type** | AI_AGENT |
| **Grant types** | Client Credentials + Token Exchange (RFC 8693) |
| **Client ID env var** | `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` |
| **Client Secret env var** | `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET` |
| **Token endpoint auth** | `client_secret_post` — AI_AGENT apps use `post` for ALL grant types |
| **RFC 8693 exchange** | ✅ Enable |
| **Resource servers** | Banking RS **and** MCP RS |

**Scopes to grant — Banking RS:**

| Scope |
|-------|
| `openid` |
| `banking:read` |
| `banking:write` |
| `banking:admin` |
| `banking:sensitive` |
| `banking:ai:agent` |

**Scopes to grant — MCP RS:**

| Scope |
|-------|
| `banking:read` |
| `banking:write` |
| `banking:mcp:invoke` |

> Both RS grants must exist for Exchange 1/2/3 to succeed. The Auto-Fix button on the PingOne Test page creates these.

---

### 2d. Super Banking Worker Token App (Management API)

| Property | Value |
|----------|-------|
| **Type** | WORKER |
| **Grant type** | Client Credentials only |
| **Client ID env var** | `PINGONE_WORKER_TOKEN_CLIENT_ID` |
| **Client Secret env var** | `PINGONE_WORKER_TOKEN_CLIENT_SECRET` |
| **Token endpoint auth** | `basic` (configurable via `PINGONE_WORKER_TOKEN_AUTH_METHOD`) |
| **RFC 8693 exchange** | ❌ Not required |
| **Resource server** | PingOne API (built-in) |

**Scopes to grant (PingOne API):**
`p1:read:user` `p1:update:user` `p1:create:user` `p1:delete:user` `p1:read:environment`

---

### 2e. Super Banking AI Agent App (Exchange #2 actor — optional)

| Property | Value |
|----------|-------|
| **Type** | AI_AGENT |
| **Grant types** | Client Credentials + Token Exchange |
| **Client ID env var** | `PINGONE_AI_AGENT_CLIENT_ID` |
| **Token endpoint auth** | `client_secret_post` |
| **RFC 8693 exchange** | ✅ Enable |
| **Resource server** | Banking RS |

**Scopes to grant (Banking RS):**
`openid` `banking:read` `banking:write` `banking:ai:agent`

---

## 3. Token Exchange Flow Summary

| Exchange | Subject token `aud` | Result token `aud` | Auth client |
|----------|--------------------|--------------------|-------------|
| Exchange 1: User → MCP | `ENDUSER_AUDIENCE` | `PINGONE_RESOURCE_MCP_SERVER_URI` | MCP Token Exchanger (`post`) |
| Exchange 2: User+Actor → MCP Gateway | `ENDUSER_AUDIENCE` | `PINGONE_RESOURCE_MCP_GATEWAY_URI` | MCP Token Exchanger (`post`) |
| Exchange 3: Agent CC → MCP | AI Agent CC token | `PINGONE_RESOURCE_MCP_SERVER_URI` | MCP Token Exchanger (`post`) |

### `act` and `may_act` claim lifecycle

| Token | `aud` | `act` | `may_act` | Set by |
|-------|-------|-------|-----------|--------|
| User login token (Banking RS) | `ENDUSER_AUDIENCE` | — | `{ sub: PINGONE_AI_AGENT_CLIENT_ID }` (optional — set via PingOne RS attribute mapping) | PingOne on authorize |
| MCP token (1-exchange result) | `PINGONE_RESOURCE_MCP_SERVER_URI` | `{ sub: PINGONE_ADMIN_CLIENT_ID }` | — | PingOne on token exchange |
| AI Agent intermediate token (2-exchange step 1) | `AI_AGENT_INTERMEDIATE_AUDIENCE` | `{ sub: PINGONE_AI_AGENT_CLIENT_ID }` | — | PingOne on token exchange |
| Final 2-exchange token | `PINGONE_RESOURCE_TWO_EXCHANGE_URI` | `{ sub: PINGONE_ADMIN_CLIENT_ID, act: { sub: PINGONE_AI_AGENT_CLIENT_ID } }` | — | PingOne on token exchange |

**`aud` validation in BFF (`middleware/auth.js`):** Tokens are rejected if their `aud` does not include one of `ENDUSER_AUDIENCE`, `AI_AGENT_AUDIENCE`, or `MCP_RESOURCE_URI` (when those env vars are set — fail-open if unset).

**`may_act.sub` ≠ gating check.** `may_act` is extracted for audit logging only (`actClaimValidator.js`, `delegationAuditLogger.js`). Admin role is derived from `azp`/`client_id == PINGONE_ADMIN_CLIENT_ID`, not from `may_act`.

### Scope ↔ Audience binding (`services/configStore.js::buildAllowedScopesByAudience`)

| Audience env var | Allowed scopes |
|------------------|----------------|
| `ENDUSER_AUDIENCE` (Banking RS) | `banking:read` `banking:write` `banking:admin` `banking:sensitive` `banking:ai:agent` |
| `PINGONE_RESOURCE_AGENT_GATEWAY_URI` | `banking:ai:agent` `ai_agent` |
| `AI_AGENT_INTERMEDIATE_AUDIENCE` | `banking:read` `banking:write` `banking:ai:agent` |
| `PINGONE_RESOURCE_MCP_GATEWAY_URI` | `banking:mcp:invoke` `banking:ai:agent` |
| `PINGONE_RESOURCE_MCP_SERVER_URI` (MCP RS) | `banking:read` `banking:write` `banking:mcp:invoke` |
| `PINGONE_RESOURCE_TWO_EXCHANGE_URI` | `banking:read` `banking:write` `banking:mcp:invoke` |

---

## 4. Environment Variable Reference

| Variable | Purpose | Example |
|----------|---------|---------|
| `ENDUSER_AUDIENCE` | Banking RS audience URI | `https://resource.pingdemo.com` |
| `PINGONE_RESOURCE_MCP_SERVER_URI` | MCP RS audience URI | `https://mcp-server.pingdemo.com` |
| `MCP_TOKEN_EXCHANGE_SCOPES` | Scopes on exchanged MCP token | `banking:read banking:write banking:mcp:invoke` |
| `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` | Exchanger app client ID | UUID |
| `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET` | Exchanger app secret | — |
| `PINGONE_MCP_TOKEN_EXCHANGER_CC_AUTH_METHOD` | CC grant auth method | `post` |
| `PINGONE_TOKEN_EXCHANGE_AUTH_METHOD` | Token exchange auth method | `post` |
| `PINGONE_WORKER_TOKEN_CLIENT_ID` | **Super Banking Worker Token App** client ID | UUID |
| `PINGONE_WORKER_TOKEN_CLIENT_SECRET` | **Super Banking Worker Token App** secret | — |
| `PINGONE_WORKER_TOKEN_AUTH_METHOD` | Worker CC auth method | `basic` |
| `admin_client_id` / `PINGONE_ADMIN_CLIENT_ID` | **Super Banking Admin App** client ID | UUID |
| `user_client_id` / `PINGONE_USER_CLIENT_ID` | **Super Banking User App** client ID | UUID |

---

## 5. PingOne Admin Console Checklist

### Banking RS
- [ ] Audience matches `ENDUSER_AUDIENCE`
- [ ] Scopes defined: `banking:read` `banking:write` `banking:admin` `banking:sensitive` `banking:ai:agent` `ai_agent`
- [ ] **Do NOT create:** `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write`, `banking:ai:agent:read`

### MCP RS
- [ ] Audience matches `PINGONE_RESOURCE_MCP_SERVER_URI`
- [ ] Scopes defined: `banking:read` `banking:write` `banking:mcp:invoke`

### Super Banking User App
- [ ] WEB_APP, Auth Code + PKCE, no client secret
- [ ] Redirect URI registered
- [ ] Banking RS granted: `openid profile email offline_access banking:read banking:write banking:ai:agent`

### Super Banking Admin App
- [ ] WEB_APP, Auth Code
- [ ] Redirect URI registered
- [ ] Token Exchange grant enabled
- [ ] Banking RS granted: all 9 scopes above

### Super Banking MCP Token Exchanger
- [ ] AI_AGENT type
- [ ] Client Credentials + Token Exchange grants enabled
- [ ] Token endpoint auth: `client_secret_post`
- [ ] **Banking RS** granted: `openid banking:read banking:write banking:admin banking:sensitive banking:ai:agent`
- [ ] **MCP RS** granted: `banking:read banking:write banking:mcp:invoke`

### Super Banking Worker Token App
- [ ] WORKER type, Client Credentials only
- [ ] PingOne API RS granted: `p1:read:user p1:update:user p1:create:user p1:delete:user p1:read:environment`

---

## 6. Route Enforcement — What Scopes Are Actually Enforced in Code

Derived from `routes/accounts.js`, `routes/transactions.js`, `routes/users.js`, and `config/scopes.js`. Verified by test suite (Phase 146 scope audit).

| Route | `requireScopes` gate | Additional guards | Notes |
|-------|----------------------|-------------------|-------|
| `GET /api/accounts` | `banking:read` | Admin role check → 403 for non-admin | All accounts |
| `GET /api/accounts/my` | `banking:read` | — | Returns only caller's accounts |
| `GET /api/accounts/:id` | `banking:read` | Ownership check | |
| `GET /api/accounts/:id/balance` | `banking:read` | — | |
| `POST /api/accounts` | `banking:write` | Admin role check → 403 for non-admin | |
| `PUT /api/accounts/:id` | `banking:write` | — | |
| `DELETE /api/accounts/:id` | `banking:write` | — | |
| `GET /api/transactions` | `banking:read` | Admin role check → 403 for non-admin | All transactions |
| `GET /api/transactions/my` | _(none — auth only)_ | Row-level ownership | **No scope gate.** Any valid token works |
| `GET /api/transactions/:id` | `banking:read` | — | |
| `POST /api/transactions` | _(none — auth only)_ | Phase 122 session check + HITL consent + Step-up MFA | **No scope gate.** Requires browser login session (`req.session?.user`). Bearer token alone returns 401. Amounts > $500 HITL consent required. |
| `PUT /api/transactions/:id` | `banking:write` | — | |
| `DELETE /api/transactions/:id` | `banking:write` | — | |
| `GET /api/admin/*` | `banking:admin` | — | |
| `POST /api/admin/*` | `banking:admin` | — | |
| `PUT /api/admin/*` | `banking:admin` | — | |
| `DELETE /api/admin/*` | `banking:admin` | — | |
| `GET /api/users` | `banking:read` | — | |
| `GET /api/users/me` | `banking:read` | — | |
| `GET /api/users/:id` | `banking:read` | Ownership check | |
| `POST /api/users` | `requireAdmin` (role check) | — | `banking:write` is insufficient; admin role required |
| `PUT /api/users/:id` | `banking:write` | — | |
| `DELETE /api/users/:id` | `banking:write` | — | |

### `banking:admin` scope vs. admin role

- **`banking:admin` scope** → grants access to `GET/POST/PUT/DELETE /api/admin/*` routes
- **Admin role** (`req.user.role === 'admin'`) → set by BFF when token was issued by the admin client app (`admin_client_id`) or when session records admin role
- `GET /api/accounts`, `GET /api/transactions`, `POST /api/accounts`, `POST /api/users` additionally require admin role — holding `banking:read` alone is insufficient for those routes
