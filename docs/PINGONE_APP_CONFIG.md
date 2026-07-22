# PingOne Application Configuration Reference

> Required PingOne app settings for the Super Banking demo. Use the [Setup Wizard](/config → PingOne Setup tab) to auto-provision, or follow this guide for manual setup.

---

## 1. Admin OIDC App ("Super Banking Admin App")

| Setting | Value |
|---------|-------|
| **Type** | `WEB_APP` |
| **Grant Types** | `AUTHORIZATION_CODE` |
| **Token Endpoint Auth** | `CLIENT_SECRET_BASIC` |
| **PKCE Enforcement** | `S256_REQUIRED` |
| **Response Type** | `CODE` |

### Redirect URIs

```
{PUBLIC_APP_URL}/api/auth/oauth/callback
http://localhost:3000/api/auth/oauth/callback
http://localhost:3001/api/auth/oauth/callback
http://localhost:4000/api/auth/oauth/callback
```

### Post-Logout Redirect URIs

```
{PUBLIC_APP_URL}
{PUBLIC_APP_URL}/login
http://localhost:3000
http://localhost:3001
```

### Scopes (via Resource Grants)

- `openid`, `profile`, `email`, `offline_access`
- `banking:general:read`, `banking:general:write`, `banking:admin`, `banking:sensitive`, `banking:ai:agent`
- `p1:read:user`, `p1:update:user`

**Note:** Consolidated from 14 scopes to 6 scopes (57% reduction). All capabilities preserved through broader scopes. See [PINGONE_RESOURCES_AND_SCOPES_MATRIX.md](PINGONE_RESOURCES_AND_SCOPES_MATRIX.md) for authoritative scope definitions.

### Token Exchange

Enable **Token Exchange** grant type if using 1-exchange or 2-exchange delegation.

### Attribute Mappings

| PingOne Attribute | Expression |
|-------------------|------------|
| `sub` | `${user.id}` |
| `may_act` | `(#root.user.mayAct != null ? #root.user.mayAct : null)` |

The `may_act` mapping is **critical** for token exchange delegation. Without it, the subject token will not contain the `may_act` claim and token exchange will fail with `invalid_request`.

---

## 2. User OIDC App ("Super Banking User App")

| Setting | Value |
|---------|-------|
| **Type** | `WEB_APP` |
| **Grant Types** | `AUTHORIZATION_CODE` |
| **Token Endpoint Auth** | `CLIENT_SECRET_BASIC` |
| **PKCE Enforcement** | `S256_REQUIRED` |
| **Response Type** | `CODE` |

### Redirect URIs

```
{PUBLIC_APP_URL}/api/auth/oauth/user/callback
http://localhost:3000/api/auth/oauth/user/callback
http://localhost:3001/api/auth/oauth/user/callback
http://localhost:4000/api/auth/oauth/user/callback
```

### Post-Logout Redirect URIs

Same as Admin app.

### Scopes

- `openid`, `profile`, `email`, `offline_access`
- `banking:ai:agent` (critical for agent delegation)
- `banking:general:read`, `banking:general:write`

**Note:** Must include `banking:ai:agent` for agent delegation to work. See [PINGONE_RESOURCES_AND_SCOPES_MATRIX.md](PINGONE_RESOURCES_AND_SCOPES_MATRIX.md) for authoritative scope definitions.

### Attribute Mappings

Same as Admin app — include the `may_act` mapping.

### Sign-on policy — Agent Consent (IDAI)

Assigned by bootstrap / `node scripts/ensureAgentConsentAgreement.js`:

| PingOne object | Name / notes |
|----------------|--------------|
| Agreement | `Agent Consent` — HTML from `demo_api_server/config/agentConsentAgreement.js` (mirrors AgentConsentModal “Allow AI Agent Access”) |
| Sign-on policy | `Agent-Consent-Login` — LOGIN then AGREEMENT |
| App assignment | Super Banking User App (AGREEMENT also appended to any other assigned SOPs) |

Reconsent every **180** days. Does **not** replace HITL / transfer consent.

---

## 3. Worker App (Management API)

| Setting | Value |
|---------|-------|
| **Type** | `WORKER` |
| **Grant Types** | `CLIENT_CREDENTIALS` |
| **Token Endpoint Auth** | `CLIENT_SECRET_BASIC` |

### Required Scopes

The worker app needs Management API scopes to provision users and read app configs:

- `p1:read:user`, `p1:update:user`, `p1:create:user`, `p1:delete:user`
- `p1:read:user:password`, `p1:update:user:password`
- `p1:read:application`, `p1:update:application`
- `p1:read:resource`, `p1:create:resource`

### Environment Variables

```
PINGONE_MGMT_CLIENT_ID=<worker-app-client-id>
PINGONE_MGMT_CLIENT_SECRET=<worker-app-client-secret>
```

Falls back to `PINGONE_CLIENT_ID` / `PINGONE_CLIENT_SECRET` if management-specific vars are not set.

---

## 4. Resource Server ("Super Banking API")

| Setting | Value |
|---------|-------|
| **Audience** | `banking_api_enduser` |
| **Type** | `CUSTOM` |

### Scopes

| Scope | Description |
|-------|-------------|
| `banking:general:read` | Read all banking data |
| `banking:general:write` | Write all banking data |
| `banking:admin` | Admin operations (full access) |
| `banking:sensitive` | Sensitive data access (read+write) |
| `banking:ai:agent` | Agent delegation (full access) |

**Note:** Consolidated from 14 scopes to 6 scopes (57% reduction). All capabilities preserved through broader scopes. See [PINGONE_RESOURCES_AND_SCOPES_MATRIX.md](PINGONE_RESOURCES_AND_SCOPES_MATRIX.md) for authoritative scope definitions.

---

## 5. Demo AI Agent (RFC 8693 actor) — intentional WEB_APP

The live actor client for agent token exchange is **Demo AI Agent**
(`d21c5124-8ac5-43d1-81f2-31a7ec649b96` — see [`AUTHORIZATION_RULES.md`](AUTHORIZATION_RULES.md) §1).

| Setting | Value |
|---------|-------|
| **Type** | `WEB_APP` (OIDC application) |
| **Grant Types** | `AUTHORIZATION_CODE`, `CLIENT_CREDENTIALS`, `TOKEN_EXCHANGE` |
| **Token Endpoint Auth** | `CLIENT_SECRET_POST` |

### Why not PingOne “AI Agents” product UI?

Ping’s [Securing AI agents with PingOne](https://developer.pingidentity.com/identity-for-ai/use-cases/idai-securing-agents-pingone.html)
tutorial registers the agent under **Applications → AI Agents**. Super Banking
keeps a standard **OIDC WEB_APP** instead. That is **intentional**:

- Same OAuth capabilities needed for the demo (client credentials actor token +
  token exchange + optional auth code redirect).
- Stable client ID/secret already wired through BFF TE, gateway actors, and docs.
- Avoids migrating live TE chains to a new product-surface client.

Admin UX differs (Applications list vs AI Agents console); security shape for
delegation does not. Re-registering under AI Agents (product packaging only) is
out of scope unless a demo explicitly needs that console on camera.

Redirect placeholder (unused interactive login for most flows):

```
https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback
```

### Optional secondary worker (env-only)

Some deployments still accept a separate worker-style agent client via env for
narrow experiments:

| Setting | Value |
|---------|-------|
| **Type** | `WORKER` |
| **Grant Types** | `CLIENT_CREDENTIALS` |

```
AGENT_OAUTH_CLIENT_ID=<agent-app-client-id>
AGENT_OAUTH_CLIENT_SECRET=<agent-app-client-secret>
```

Prefer Demo AI Agent (`d21c5124`) from [`AUTHORIZATION_RULES.md`](AUTHORIZATION_RULES.md)
for the standard two-hop TE path.

---

## 6. mayAct Custom Attribute

The `mayAct` attribute is a **custom JSON attribute** on PingOne user profiles. It controls which OAuth client is permitted to act on behalf of the user during RFC 8693 token exchange.

### Setting mayAct

**Via Demo UI:** Navigate to the Delegation page (`/delegation`) → click "Authorize agent" (or "Revoke agent access" to clear it). The former `/demo-data` may_act demo controls and the `PATCH /api/demo/may-act` endpoint were removed — the attribute is written only by the agent-authorization, admin user-edit, and delegation features.

### mayAct Values

| Mode | Value | Used For |
|------|-------|----------|
| 1-exchange | `{"client_id": "<admin_client_id>"}` | BFF exchanges user token directly |
| 2-exchange | `{"client_id": "<agent_client_id>"}` | Agent exchanges first, then BFF |
| Disabled | `null` | No delegation permitted |

### Diagnosing mayAct Issues

```bash
curl http://localhost:3001/api/demo/claim-diagnostics \
  -H "Cookie: <session>"
```

(The dedicated `/api/demo/may-act/diagnose` endpoint was removed; `claim-diagnostics` wraps the same checks.) Returns a structured report checking:
1. **User attribute** — is `mayAct` set on the PingOne user record?
2. **App mapping** — does the OIDC app have a `may_act` attribute mapping?

Both must pass for `may_act` to appear in the subject token.

---

## 7. Automated Configuration

### Fix Logout URLs

```bash
POST /api/admin/app-config/fix-logout-urls
Body: { "publicAppUrl": "https://your-domain.vercel.app" }
```

Automatically adds correct `postLogoutRedirectUris` and `signOffUrl` to both Admin and User apps.

### Audit App Config

```bash
GET /api/admin/app-config/audit/all
```

Checks both apps for common issues: missing logout URIs, PKCE not enforced, missing grant types, etc.

### Setup Wizard

Navigate to `/config` → **PingOne Setup** tab to auto-provision all apps, resource server, scopes, and demo users from a single form.
