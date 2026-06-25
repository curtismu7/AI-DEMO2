# PingOne applications & scopes — Super Banking banking demo

Operational guide: which **PingOne OAuth / worker applications** match this codebase, which **config keys** store their **client IDs**, and which **scopes** must exist on each app. Pair with **[`PINGONE_AUTHORIZE_PLAN.md`](PINGONE_AUTHORIZE_PLAN.md)** for Authorize product APIs and BFF context.

⭐ **For comprehensive reference** showing all resource servers, complete app × resource × scope tables, and verification checklist, see **[`PINGONE_RESOURCES_AND_SCOPES_MATRIX.md`](PINGONE_RESOURCES_AND_SCOPES_MATRIX.md)** (Phase 69.1 scope naming, RFC 8693 exchange, audience binding, multi-resource scope patterns).

**Source of truth in code:** `banking_api_server/config/oauth.js`, `config/oauthUser.js`, `config/scopes.js`, `services/configStore.js`, `services/oauthService.js` (token exchange), `utils/oauthAuthorizeResource.js` (authorize URL `resource` handling).

---

## 1. Application matrix

| PingOne app name | Where you store **Client ID** (Config UI `/config` or env) | Purpose |
|-------------------|-----------------------------------------------------------|---------|
| **Super Banking Admin App** | `admin_client_id` / `PINGONE_ADMIN_CLIENT_ID` | Staff OAuth → `/admin`. **Same** client (`oauthService`) performs **RFC 8693 token exchange** to MCP: requests use this app's `client_id` / `client_secret` at the token endpoint. |
| **Super Banking User App** | `user_client_id` / `PINGONE_USER_CLIENT_ID` | Customer OAuth + PKCE → `/dashboard` (`oauthUser` config). |
| **Super Banking MCP Token Exchanger** | `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` | Type: `AI_AGENT`. Performs RFC 8693 exchange(s); actor token for 1-exchange and 2-exchange chain. |
| **Super Banking Worker Token App** | `PINGONE_WORKER_TOKEN_CLIENT_ID` | **PingOne Management API** (users, apps, probes)—**not** SPA login. Type: `WORKER`. Different scopes (e.g. `p1:read:user`). |
| **Super Banking AI Agent App** (optional) | `PINGONE_AI_AGENT_CLIENT_ID` | Type: `AI_AGENT`. Exchange #1 actor in the 2-exchange chain. **Client credentials** only. |

---◊

## 2. Scope sets the BFF requests

Exact names must exist on the corresponding PingOne application (and underlying Resource, if you use a custom API Resource).

### Super Banking User App (`user_client_id` / `PINGONE_USER_CLIENT_ID`)

For default **`user_role`** = `customer` in config:

- **OIDC:** `openid` `profile` `email` `offline_access`
- **Banking API (Banking RS):** `banking:read` `banking:write` `banking:ai:agent`

Other **`user_role`** values (`readonly`, `admin`, `ai_agent`) change the banking list per `config/scopes.js` → `USER_TYPE_SCOPES`:
- `readonly` → `banking:read` only
- `admin` → `banking:admin` `banking:read` `banking:write` `banking:sensitive` `banking:ai:agent`
- `ai_agent` → `ai_agent` `banking:ai:agent` `banking:read` `banking:write`

### Super Banking Admin App (`admin_client_id` / `PINGONE_ADMIN_CLIENT_ID`)

- **OIDC:** `openid` `profile` `email` `offline_access`
- **Banking API (Banking RS):** `banking:admin` `banking:read` `banking:write` `banking:sensitive` `banking:ai:agent`

### MCP delegation (policy, not a second authorize scope list)

- **`agent_mcp_allowed_scopes`** (or env `AGENT_MCP_ALLOWED_SCOPES`): subset of scopes the BFF may request on the **exchanged** MCP access token. Must be consistent with what the **user** token was allowed at login (`services/agentMcpScopePolicy.js`).

### Super Banking MCP Token Exchanger (`PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID`)

- **Type:** `AI_AGENT`; **grant:** Client Credentials (actor token) + Token Exchange.
- Default client-credentials **`scope`**: `openid banking:read banking:write banking:admin banking:sensitive banking:ai:agent` (env: `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SCOPES`).
- **Auth method:** `client_secret_post` (env: `PINGONE_MCP_TOKEN_EXCHANGER_CC_AUTH_METHOD=post`).

### Super Banking AI Agent App (`PINGONE_AI_AGENT_CLIENT_ID`) — optional 2-exchange actor

- **Type:** `AI_AGENT`; **grant:** Client Credentials only.
- Used as Exchange #1 actor in the 2-exchange delegated chain.
- **Scopes:** Per deployment; typically `openid banking:ai:agent`.

---

## 3. `invalid_scope` — multiple resources

The BFF sends **OIDC scopes + custom `banking:*` scopes** in a **single** `/authorize` request. PingOne may treat those as **multiple resource servers** if `resource` (RFC 8707) is used inconsistently.

- **Implementation:** `buildPingOneAuthorizeResourceQueryParam` in `banking_api_server/utils/oauthAuthorizeResource.js` **does not** append `&resource=` on authorize when both OIDC and custom API scopes are present—avoiding PingOne's *"May not request scopes for multiple resources"* for that shape.
- **`ENDUSER_AUDIENCE`:** Still used for **post-issuance** JWT **`aud`** validation in `middleware/auth.js` where configured; it is **not** required on the authorize URL for this mixed-scope pattern.

---

## 4. Directions for PingOne administrators

> **Quick path:** Use the `/pingone-test` page **Update** buttons (§8) to automate the setup below. The manual steps are documented here for reference and troubleshooting.

### A. Resource and custom scopes

1. In **PingOne Admin** → **Environment** → **Resources** (custom resource server):
   - Define a **Resource** for the Banking API (name arbitrary).
   - Set the audience to match `ENDUSER_AUDIENCE` env var.
   - Create **custom scopes** with **exactly** these strings:
     `banking:read` `banking:write` `banking:admin` `banking:sensitive` `banking:ai:agent`
   - Define a second **Resource** for the MCP Server (audience = `PINGONE_RESOURCE_MCP_SERVER_URI`):
     `banking:read` `banking:write` `banking:mcp:invoke`
   - **Do not create** `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write`, `banking:ai:agent:read`, `banking:agent:invoke` — these are stale and will cause `invalid_scope` errors.

### B. Super Banking Admin App (matches `admin_client_id` / `PINGONE_ADMIN_CLIENT_ID`)

- **Grant types:** Authorization Code; **PKCE** if the template is a public / SPA-style admin entry (or match how you deploy).
- **Redirect URIs:** Must match **`admin_redirect_uri`** (e.g. `https://<host>/api/auth/oauth/callback`).
- **Scopes:** All OIDC + all **admin** banking scopes from §2.
- **Token endpoint authentication:** Must match **`admin_token_endpoint_auth_method`** (`basic` vs `post`).
- **RFC 8693 Token Exchange:** Enable on this app if the demo uses **MCP token exchange** (BFF uses `oauthService` = admin config for `performTokenExchange` / `performTokenExchangeWithActor`).

### C. Super Banking User App (matches `user_client_id` / `PINGONE_USER_CLIENT_ID`)

- Code + PKCE as appropriate for your app type.
- **Redirect URIs:** **`user_redirect_uri`** (e.g. `https://<host>/api/auth/oauth/user/callback`).
- **Scopes:** OIDC + **customer** banking scopes from §2.
- If **`offline_access`** is required, ensure app + sign-on policy allow **refresh tokens**.

### D. Super Banking MCP Token Exchanger (`PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID`)

- **Client type:** `AI_AGENT`; **grant:** Client Credentials + Token Exchange.
- **Auth method:** `client_secret_post`.
- **Scopes:** `openid banking:read banking:write banking:admin banking:sensitive banking:ai:agent`.

### E. Super Banking AI Agent App (`PINGONE_AI_AGENT_CLIENT_ID`) — optional

- **Client type:** `AI_AGENT`; **grant:** Client Credentials.
- Used as actor in the 2-exchange delegated chain.

### F. Super Banking Worker Token App (`PINGONE_WORKER_TOKEN_CLIENT_ID`)

- Separate from SPA apps; **type:** `WORKER`; grant only **Management API** permissions (e.g. `p1:read:user`, `p1:update:user`).

### G. Token exchange and `may_act`

If you use **subject + actor** exchange: PingOne must allow the **admin** exchange client (and policy) to accept the **subject** token and optional **`actor_token`**, including **`may_act`** / actor rules per your PingOne version—see product docs and **`oauthService.performTokenExchangeWithActor`**.

---

## 5. Deployment alignment

| Variable / config | Role |
|-------------------|------|
| `ENDUSER_AUDIENCE` | JWT **`aud`** validation for user tokens in `middleware/auth.js` — tokens with `aud` not matching a known audience URI are rejected when this env var is set. Value: `https://ai-agent.pingdemo.com` (Super Banking AI Agent RS). |
| `MCP_RESOURCE_URI` / `mcp_resource_uri` | Audience / resource URI for **exchanged** MCP tokens (must match what PingOne allows on token exchange). |
| `MIN_USER_SCOPES_FOR_MCP_EXCHANGE` | Optional floor on distinct scopes on user token before exchange (`services/agentMcpTokenService.js`). |

---

## 6. Verification checklist

1. **Admin sign-in:** No `invalid_scope` from PingOne; access token includes expected `scope` (and acceptable `aud` for your rules).
2. **Customer sign-in:** Same.
3. **MCP tool path:** Delegated token succeeds or fails with a clear exchange error (not authorize).
4. **Config UI:** `admin_client_id` and `user_client_id` match the two OIDC apps; redirect URIs exactly match the deployed BFF (scheme, host, path, port).

---

## 7. Testing note

Jest suites mock `/login` redirects and do not call PingOne's `/authorize`. **`invalid_scope` from PingOne** is only observed against a live tenant. Unit tests cover **`resource`** query construction (`src/__tests__/oauthAuthorizeResource.test.js`).

**`pingoneTestRoutes.test.js`** (40 tests) validates 7 `/api/pingone-test/*` endpoints against mocked PingOne responses:

| Endpoint | Tests | Validates |
|----------|-------|-----------|
| `GET /ai-agent-apps` | 6 | AI_AGENT type filter, `isSuperBanking` flag, `applicationType` fallback, `missingExpected` detection |
| `POST /update-resources` | 6 | RS create-on-missing, canonical scope idempotency, partial scope add, create failure handling |
| `POST /update-scopes` | 5 | RS not-found path, all-present no-op, only-missing added (non-destructive) |
| `POST /update-apps` | 6 | Banking RS lookup, per-app grant via `enableResourceServer`, not-found / failed app steps, AI_AGENT discovery |
| `POST /update-user-spel` | 9 | No user ID, no `admin_client_id`, PingOne PATCH + app mapping creation, correct SpEL value assertion, mapping already-exists skip, broken `${user.mayAct}` auto-fix, clear (`enabled: false`) skips mapping step, error surfacing |
| `GET /diagnose-mcp-exchange` | 4 | Worker token guard, exchanger lookup by `oidcOptions.clientId` (not just `app.id`), clientId-not-found, `canExchange` flag with RS/scope/grant alignment |
| `POST /fix-mcp-exchange` | 4 | Worker token guard, exchanger lookup by `oidcOptions.clientId` + `enableResourceServer` called with PingOne `app.id`, clientId-not-found skipped, MCP RS create-on-missing + scope creation |

---

## 8. `/pingone-test` Update buttons — automated PingOne setup

The **PingOne Test Page** (`/pingone-test`) now includes **Update** buttons alongside each test card. These call the BFF endpoints above to **idempotently** configure PingOne — no manual admin console work required for the Super Banking demo.

| Button | Endpoint | What it does |
|--------|----------|--------------|
| **Update Resources** | `POST /update-resources` | Ensures Banking RS (`ENDUSER_AUDIENCE`) and MCP RS (`PINGONE_RESOURCE_MCP_SERVER_URI`) exist with all canonical scopes. Creates RS if missing; adds only missing scopes (never removes). |
| **Update Scopes** | `POST /update-scopes` | Same scope additions as above, but skips RS creation. Useful when RS exist but scopes are incomplete. |
| **Update Apps** | `POST /update-apps` | Grants the correct banking scope subset to each of the 4 Super Banking apps via `enableResourceServer`. Returns AI_AGENT apps discovered for visibility. |
| **Test AI Agent Apps** | `GET /ai-agent-apps` | Fetches all PingOne apps with `type: AI_AGENT`, flags Super Banking ones, reports any missing expected apps. |
| **Set may_act** | `POST /update-user-spel` | Two-step: (1) PATCHes `mayAct.sub` on the current user to `admin_client_id`, (2) ensures a `may_act` → `(#root.user.mayAct != null ? #root.user.mayAct : null)` attribute mapping exists on the User + Admin OIDC apps. Auto-detects and replaces broken `${user.mayAct}` mappings. Without step 2, PingOne stores the value but never emits it in the token. User must re-login. |

**Canonical scope sets enforced by Update buttons:**

| App | Banking RS scopes granted |
|-----|-------------------------|
| Super Banking Admin App | `banking:read`, `banking:write`, `banking:admin`, `banking:sensitive`, `banking:ai:agent` |
| Super Banking User App | `banking:read`, `banking:write`, `banking:ai:agent` |
| Super Banking MCP Token Exchanger | `banking:read`, `banking:write`, `banking:admin`, `banking:sensitive`, `banking:ai:agent` |
| Super Banking AI Agent App | `banking:read`, `banking:write`, `banking:ai:agent` |

> **Note:** Super Banking Worker Token App is **not** in the Update Apps list — it uses PingOne Management API scopes (`p1:read:user`, etc.), not banking RS scopes.

---

## See also

- [`PINGONE_AUTHORIZE_PLAN.md`](PINGONE_AUTHORIZE_PLAN.md) — Authorize product, decision endpoints, BFF overview.
- [`PINGONE_RESOURCES_AND_SCOPES_MATRIX.md`](PINGONE_RESOURCES_AND_SCOPES_MATRIX.md) — **COMPREHENSIVE** resource servers, all applications, complete scope tables, troubleshooting. **START HERE** for authority on resource URIs, app configurations, and scope naming (Phase 69.1).
- [`banking_api_server/OAUTH_SCOPE_CONFIGURATION.md`](../banking_api_server/OAUTH_SCOPE_CONFIGURATION.md) — scope names and user-type mappings (may overlap env var naming with older examples).
- [`REGRESSION_PLAN.md`](../REGRESSION_PLAN.md) — audience / OAuth do-not-break notes.
