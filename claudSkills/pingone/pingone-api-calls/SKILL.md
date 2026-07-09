---
name: pingone-api-calls
description: 'Patterns for calling PingOne Management API from demo_api_server. USE FOR: read user, update user attributes, p1:read:user, p1:update:user, list users, create user, delete user, PingOne Management API /v1/environments, /users endpoint, worker app token calls, assign roles to Worker applications, application roleAssignments, Identity Data Admin, Environment Admin, GET /v1/roles, admin PingOne REST API, new service file, new route calling PingOne, error handling for PingOne responses, existing services (mfaService.js, pingoneManagementService.js, pingOneUserService.js, pingoneBootstrapService.js). DO NOT USE FOR: OAuth login, token exchange, or session flows (use oauth-pingone); MFA device lifecycle (use pingone-mfa); MCP server tools (use mcp-server); session/cookie patterns (use bff-sessions); HITL/consent (use hitl-consent).'
argument-hint: 'Describe the PingOne API call you need to make (e.g. read user, update MFA)'
---

# Calling the Banking API Server (PingOne Proxy Layer)

## When to Use

- Making calls to the PingOne Management API from `demo_api_server` (read user, update user, list users, create/delete)
- Adding a new service file or route that calls PingOne's `/v1/environments/{envId}/users` endpoint
- Working with worker app `client_credentials` tokens for Management API access
- Assigning / listing / revoking admin roles on a Worker application (`/applications/{appId}/roleAssignments`)
- Extending existing services: `mfaService.js`, `pingoneManagementService.js`, `pingOneUserService.js`, `pingoneBootstrapService.js`
- Handling PingOne error responses or debugging `invalid_client` / `INVALID_DATA` errors from Management API calls

## When NOT to Use

- OAuth login, token exchange, PKCE, or session flows — use `oauth-pingone` instead
- MFA device lifecycle (enroll, activate, delete devices) — use `pingone-mfa` instead
- MCP server tools or WebSocket connections — use `mcp-server` instead
- Session/cookie/token custody patterns — use `bff-sessions` instead
- HITL/consent challenge state — use `hitl-consent` instead

## Architecture Overview

```
Browser / UI
    │  (cookies only, no tokens)
    ▼
demo_api_server  ← Backend-for-Frontend (BFF): holds all tokens server-side
    │
    ├─ /api/auth/*        → PingOne AS  (auth.pingone.{region}/{envId}/as/*)
    ├─ /api/auth/ciba/*   → PingOne CIBA (bc-authorize, token polling)
    └─ Internal services  → PingOne Management API (api.pingone.{region}/v1/*)
```

The UI **never** calls PingOne directly — it always calls `demo_api_server` which proxies to PingOne. Tokens are stored in server-side sessions (`req.session.oauthTokens`), never in the response body.

---

## Config Access (Server-Side)

**Never hardcode URLs or credentials.** All PingOne config comes from `configStore.getEffective()`:

```javascript
const configStore = require('../services/configStore');
const oauthConfig = require('../config/oauth'); // lazy getters backed by configStore

// Auth Server endpoints (lazy, config-driven)
oauthConfig.tokenEndpoint        // https://auth.pingone.{region}/{envId}/as/token
oauthConfig.authorizationEndpoint
oauthConfig.cibaEndpoint          // .../bc-authorize
oauthConfig.jwksEndpoint
oauthConfig.userInfoEndpoint

// Client credentials
oauthConfig.clientId
oauthConfig.clientSecret

// Raw config values
const envId  = configStore.getEffective('pingone_environment_id');
const region = configStore.getEffective('pingone_region') || 'com';

const authBase = `https://auth.pingone.${region}/${envId}/as`;
const apiBase  = `https://api.pingone.${region}/v1`;
```

---

## Pattern: Management API (worker client_credentials)

Use for provisioning/management calls (user CRUD, app registration, etc.):

```javascript
'use strict';
const axios = require('axios');
const configStore = require('../services/configStore');

// Illustrative only. The canonical worker-token implementation is
// `pingOneClientService.getManagementToken()` — use it; don't hand-roll this.
// The real client-id lookup falls back through a key chain:
//   pingone_worker_token_client_id → PINGONE_MGMT_CLIENT_ID → PINGONE_MANAGEMENT_CLIENT_ID
async function getManagementToken() {
  const envId        = configStore.getEffective('pingone_environment_id');
  const region       = configStore.getEffective('pingone_region') || 'com';
  const clientId     = configStore.getEffective('pingone_client_id');     // worker app
  const clientSecret = configStore.getEffective('pingone_client_secret');

  if (!envId || !clientId || !clientSecret) {
    throw new Error('PingOne admin credentials not configured');
  }

  const tokenUrl = `https://auth.pingone.${region}/${envId}/as/token`;
  const response = await axios.post(
    tokenUrl,
    'grant_type=client_credentials',
    {
      auth: { username: clientId, password: clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    }
  );
  return response.data.access_token;
}

async function callPingOneManagementApi(path) {
  const envId  = configStore.getEffective('pingone_environment_id');
  const region = configStore.getEffective('pingone_region') || 'com';
  const token  = await getManagementToken();

  const url = `https://api.pingone.${region}/v1/environments/${envId}${path}`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
  });
  return data;
}
```

> **Official docs:** [PingOne API — Before You Begin / Introduction](https://developer.pingidentity.com/pingone-api/before-you-begin/introduction.html). Read this before adding any new Management API call (base URLs, auth model, request/response envelope, error shape).

### Updating an existing application — PUT (full replace), NOT PATCH

Hard-won (cost a full debugging session): **PingOne `/v1/environments/{envId}/applications/{id}` does not support PATCH.** A `PATCH` (partial update) is rejected with a **misleading 403**:

```
403 { "message": "Invalid key=value pair (missing equal-sign) in
      Authorization header (hashed with SHA-256 and encoded with Base64): '…'." }
```

This error mentions the Authorization header but the token is fine — it is PingOne's confusing way of saying *this method/shape is not accepted on this endpoint*. The same Bearer token works for `GET` and `PUT` on the same URL. To change one field you must **read-modify-write with PUT**:

1. `GET /applications/{id}` → current app object
2. Merge your change onto it (e.g. `{ ...current, tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' }`)
3. Strip read-only/HATEOAS fields: `_links`, `environment`, `id`, `createdAt`, `updatedAt`, `clientId`, `signing`
4. `PUT /applications/{id}` with the merged body (a partial PUT fails on required fields like `protocol` with `INVALID_DATA`)

`pingoneProvisionService.updateApplication(appId, updates)` already does exactly this — **use it; never hand-roll a PATCH.** Its `createApplication(name, …)` also runs idempotent drift-correction (GET → diff → PUT) so re-running `npm run pingone:bootstrap` realigns existing apps.

### Token-endpoint auth method (ARCHITECTURE TRUTH T-9)

Every PingOne **client connection authenticates with `client_secret_post`**. The single exception is the Management-API Worker Token CC client (the app literally named **"Super Banking Worker"** / `PINGONE_WORKER_TOKEN_*`), which stays `client_secret_basic`. This is keyed by **app name, not PingOne `type`** — several apps are `type: WORKER` yet must use `client_secret_post` (MCP Server, MCP Gateway, Agent). A `client_secret_basic`↔`post` mismatch surfaces as `invalid_client: "Unsupported authentication method"` → `delegation_chain_broken` / `actor_token_invalid` → 502 on `/api/mcp/tool`. See [ARCHITECTURE-TRUTHS.md](../../../docs/ARCHITECTURE-TRUTHS.md) T-9.

### Worker tokens carry roles, not scopes

PingOne **Worker** app tokens do **not** carry OAuth scopes — the `scope` field in
a Worker `client_credentials` token response is `null`. Management API access is
governed by the **environment roles** assigned to the Worker app (Identity Data
Admin, Environment Admin, …), not by OAuth scopes. When debugging a Management API
**403**, check the Worker app's assigned role in PingOne Console → Identities →
Services → Workers — don't look for scopes in the introspection response.

### Assigning roles to a Worker application

Worker entitlements come from **application role assignments**, not OAuth scopes.
Only apps with `type: WORKER` accept these endpoints — non-Worker apps return
**404** on `/roleAssignments`. Docs:
[Application Role Assignments](https://developer.pingidentity.com/pingone-api/platform/applications/application-role-assignments.html),
[Create](https://developer.pingidentity.com/pingone-api/platform/applications/application-role-assignments/create-application-role-assignments.html),
[Read all built-in roles](https://developer.pingidentity.com/pingone-api/platform/roles/predefined-roles/read-all-roles.html).

**Demo defaults for "Super Banking Worker"** (`PINGONE_WORKER_TOKEN_*`):
**Identity Data Admin** + **Environment Admin**, scoped to this environment
(`scope.type: ENVIRONMENT`, `scope.id: {envId}`).

**Privilege rule:** the actor minting the token used for these calls can only
grant roles it already holds (and only at equal-or-narrower scope). A Worker
with only Identity Data Admin cannot grant Environment Admin.

**Create-time tip:** when creating a Worker via API, set `assignActorRoles: false`
so it does not inherit the creator's full role set — then assign the minimum
roles explicitly (least privilege).

#### 1. Resolve role name → role id

`GET /v1/roles` is **org-level** (not under `/environments/{envId}`). It returns
built-in roles only (no custom roles).

```javascript
const region = configStore.getEffective('pingone_region') || 'com';
const token  = await getManagementToken(); // existing Worker CC token

const { data } = await axios.get(`https://api.pingone.${region}/v1/roles`, {
  headers: { Authorization: `Bearer ${token}` },
  timeout: 20000,
});
const roleIdsByName = Object.fromEntries(
  (data._embedded?.roles || []).map((r) => [r.name, r.id])
);
const identityDataAdminId = roleIdsByName['Identity Data Admin'];
const environmentAdminId  = roleIdsByName['Environment Admin'];
```

Same lookup pattern already exists for **user** role grants in
`pingOneUserService.ensureAdminRoleAssignments()` /
`pingoneProvisionService._ensureAdminRoleAssignments()` — those POST to
`/users/{userId}/roleAssignments`. Worker apps use the **application** path below.

#### 2. List current Worker role assignments

```http
GET /v1/environments/{envId}/applications/{appId}/roleAssignments
Authorization: Bearer {accessToken}
```

Response: `_embedded.roleAssignments[]` with `id`, `role.id`, `scope.{id,type}`.

Hosted PingOne MCP tools: `listApplicationRoleAssignments`,
`createApplicationRoleAssignment`, `deleteApplicationRoleAssignment`.

#### 3. Grant a role (idempotent recipe)

```http
POST /v1/environments/{envId}/applications/{appId}/roleAssignments
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "role":  { "id": "{roleId}" },
  "scope": { "id": "{envId}", "type": "ENVIRONMENT" }
}
```

`scope.type` options: `ORGANIZATION` | `ENVIRONMENT` | `POPULATION` | `APPLICATION`.
For this demo, prefer **ENVIRONMENT** scoped to the current env id.

```javascript
async function ensureWorkerRoleAssignment(appId, roleName) {
  const envId  = configStore.getEffective('pingone_environment_id');
  const region = configStore.getEffective('pingone_region') || 'com';
  const token  = await getManagementToken();
  const base   = `https://api.pingone.${region}/v1/environments/${envId}/applications/${appId}`;

  // Resolve role id (cache per process in real code)
  const { data: roles } = await axios.get(`https://api.pingone.${region}/v1/roles`, {
    headers: { Authorization: `Bearer ${token}` }, timeout: 20000,
  });
  const roleId = (roles._embedded?.roles || []).find((r) => r.name === roleName)?.id;
  if (!roleId) throw new Error(`Unknown built-in role: ${roleName}`);

  const { data: list } = await axios.get(`${base}/roleAssignments`, {
    headers: { Authorization: `Bearer ${token}` }, timeout: 20000,
  });
  const existing = list._embedded?.roleAssignments || [];
  if (existing.some((ra) => ra.role?.id === roleId && ra.scope?.id === envId)) {
    return { status: 'existing', roleName };
  }

  try {
    await axios.post(`${base}/roleAssignments`, {
      role:  { id: roleId },
      scope: { id: envId, type: 'ENVIRONMENT' },
    }, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    return { status: 'assigned', roleName };
  } catch (err) {
    // Duplicate assignment race → treat as success
    if (/unique|already|exist|duplicate/i.test(err.response?.data?.message || err.message)) {
      return { status: 'existing', roleName };
    }
    throw err;
  }
}

// Demo Worker minimum:
await ensureWorkerRoleAssignment(workerAppId, 'Identity Data Admin');
await ensureWorkerRoleAssignment(workerAppId, 'Environment Admin');
```

After granting roles, **mint a fresh Worker token** — existing CC tokens do not
pick up new entitlements until re-issued (and any in-process token cache in
`pingoneManagementService` / `mfaService._getWorkerToken()` must be cleared).

#### 4. Revoke a role

```http
DELETE /v1/environments/{envId}/applications/{appId}/roleAssignments/{roleAssignmentId}
Authorization: Bearer {accessToken}
```

`roleAssignmentId` is the assignment resource `id` from the list response (not
the role id).

#### Common failures

| Symptom | Cause / fix |
|---|---|
| `404` on `/roleAssignments` | App `type` is not `WORKER` |
| `403` granting a role | Actor lacks that role (or broader scope); use a higher-privileged admin/Worker |
| CC token request rejected | Worker has **zero** role assignments — assign at least one before token mint |
| Management API `403` after grant | Stale cached Worker token — clear cache and re-mint |
| Role name not found | Typo / custom role — `GET /v1/roles` is built-ins only; custom roles use the custom-roles API |

### `pingone-admin` MCP tool: "User does not have any role assignments"

The `pingone-admin` MCP server (configured in `.mcp.json`) authenticates via an
interactive **browser login as a PingOne user** — that user must hold admin role
assignments (e.g. Environment Admin + Identity Data Admin) or every tool call
fails with `Request denied: User does not have any role assignments`. If it
recurs, the browser silently SSO'd a role-less user: terminate that user's
sessions (`DELETE /users/{id}/sessions/{sid}`, worker creds in
`demo_api_server/.env` — see the `pingone-session-termination` skill), then sign
in as an admin user (e.g. demoAdmin).

---

## Pattern: Auth Server Token Operations

Use `oauthService` for auth-server calls (token exchange, refresh, revoke):

```javascript
const oauthService = require('../services/oauthService');

// Token exchange (RFC 8693) — T1 → T2 scoped for MCP.
// Always read config via configStore — never process.env in handlers (CLAUDE.md).
const configStore = require('../services/configStore');
const mcpToken = await oauthService.performTokenExchange(
  req.session.oauthTokens.access_token,
  configStore.getEffective('pingone_resource_mcp_server_uri'),
  ['read', 'write', 'mcp:invoke']
);

// Refresh
const refreshed = await oauthService.refreshAccessToken(
  req.session.oauthTokens.refresh_token
);

// Revoke (RFC 7009)
await oauthService.revokeToken(req.session.oauthTokens.refresh_token, 'refresh_token');
```

---

## Pattern: CIBA (Backchannel Auth)

```javascript
const cibaService = require('../services/cibaService');

const { auth_req_id, expires_in, interval } = await cibaService.initiateBackchannelAuth(
  loginHint,        // user's email or sub
  bindingMessage,   // short string shown in push/email
  'openid profile email write',
  acrValues         // e.g. 'Multi_factor' for step-up
);

// Poll (returns tokens when approved)
const tokens = await cibaService.pollForTokens(auth_req_id);
// throws { error: 'authorization_pending' } while waiting
// throws { error: 'access_denied' } on denial
```

---

## Calling the API Server from the UI

The React UI calls `/api/*` routes — never PingOne directly. Use service layer, never `fetch` in components.

```javascript
// src/services/authService.js
export const getSession = () =>
  fetch('/api/auth/session', { credentials: 'include' }).then(r => r.ok ? r.json() : null);

export const loginAdmin = () => { window.location.href = '/api/auth/oauth/login'; };
export const loginUser  = () => { window.location.href = '/api/auth/oauth/user/login'; };
export const logout     = () => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });

// CIBA from UI
export async function initiateCiba(bindingMessage, scope, acrValues) {
  const resp = await fetch('/api/auth/ciba/initiate', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ binding_message: bindingMessage, scope, acr_values: acrValues }),
  });
  if (!resp.ok) throw new Error(`CIBA initiate failed: ${resp.status}`);
  return resp.json(); // { auth_req_id, expires_in, interval }
}

export async function pollCiba(authReqId) {
  const resp = await fetch(`/api/auth/ciba/poll/${authReqId}`, { credentials: 'include' });
  if (!resp.ok) throw new Error(`Poll failed: ${resp.status}`);
  return resp.json(); // { status: 'pending' | 'approved' | 'denied' }
}
```

---

## Available Server API Routes

| Route | Auth Required | Description |
|-------|---------------|-------------|
| `GET  /api/auth/oauth/login` | No | Start admin login (PKCE) |
| `GET  /api/auth/oauth/user/login` | No | Start user login (PKCE) |
| `GET  /api/auth/oauth/callback` | No | Admin OAuth callback |
| `GET  /api/auth/oauth/user/callback` | No | User OAuth callback |
| `GET  /api/auth/session` | No | Returns current session user info |
| `POST /api/auth/logout` | No | Revoke tokens + destroy session |
| `POST /api/auth/ciba/initiate` | Yes | Start CIBA backchannel flow |
| `GET  /api/auth/ciba/poll/:authReqId` | Yes | Poll CIBA approval status |
| `GET  /api/auth/ciba/status` | No | Check if CIBA is enabled |
| `GET  /api/auth/oauth/redirect-info` | No | Debug: shows registered redirect URIs |
| `GET  /api/accounts` | Yes | List user's bank accounts |
| `GET  /api/transactions` | Yes | List transactions |
| `POST /api/transactions/transfer` | Yes | Initiate transfer |
| `GET  /api/users` | Yes | PingOne user directory (routes/users.js; `/api/admin` via pingOneUserLookupService) |
| `POST /api/clients` | Admin | Create PingOne app (CIMD flow; mounted server.js:1211) |
| `GET  /api/admin/config` | Admin | Read app config (server.js:949, routes/adminConfig.js) |
| `POST /api/admin/config` | Admin | Update app config (routes/adminConfig.js) |

---

## Error Handling for PingOne Calls

Always surface PingOne's error fields — don't swallow them:

```javascript
try {
  const response = await axios.post(tokenUrl, body, { headers, timeout: 10000 });
  return response.data;
} catch (err) {
  const pingoneError = err.response?.data?.error;
  const pingoneDesc  = err.response?.data?.error_description;
  const status       = err.response?.status;

  console.error('[MyService] PingOne error:', { pingoneError, pingoneDesc, status });

  const msg = pingoneError
    ? `PingOne error: ${pingoneError}${pingoneDesc ? ' — ' + pingoneDesc : ''}`
    : err.message;

  const wrapped = new Error(msg);
  wrapped.pingoneError = pingoneError;
  wrapped.status = status;
  throw wrapped;
}
```

In route handlers, propagate status codes:

```javascript
router.post('/my-route', authenticateToken, async (req, res) => {
  try {
    const result = await myPingOneService.doSomething(req.session.oauthTokens);
    res.json(result);
  } catch (err) {
    const status = err.status === 401 ? 401 : err.status === 403 ? 403 : 502;
    res.status(status).json({
      error: err.pingoneError || 'upstream_error',
      message: err.message,
    });
  }
});
```

---

## PingOne API Reference

**Authoritative external docs:** [PingOne API — Before You Begin / Introduction](https://developer.pingidentity.com/pingone-api/before-you-begin/introduction.html) (base URLs, auth, regions, request/response + error envelope). Consult this first for anything not covered below.

### Auth Server (AS) — `https://auth.pingone.{region}/{envId}/as/`

| Endpoint | Use |
|----------|-----|
| `/authorize` | Start PKCE flow |
| `/token` | Exchange code, refresh, token-exchange, client_credentials, CIBA poll |
| `/revoke` | RFC 7009 revocation |
| `/bc-authorize` | CIBA initiate |
| `/userinfo` | OIDC user claims |
| `/jwks` | Public keys for JWT validation |
| `/.well-known/openid-configuration` | Discovery |

### Management API — `https://api.pingone.{region}/v1/environments/{envId}/`

| Endpoint | Use |
|----------|-----|
| `/applications` | List / create OAuth apps |
| `/applications/{id}/secret` | Fetch client secret |
| `/users` | Create / list directory users |
| `/users/{id}` | Read / update user |

### Regions

| Config value | Auth base | API base |
|-------------|-----------|----------|
| `com` (default) | `auth.pingone.com` | `api.pingone.com` |
| `eu` | `auth.pingone.eu` | `api.pingone.eu` |
| `ca` | `auth.pingone.ca` | `api.pingone.ca` |
| `asia` | `auth.pingone.asia` | `api.pingone.asia` |
| `com.au` | `auth.pingone.com.au` | `api.pingone.com.au` |
| `sg` | `auth.pingone.sg` | `api.pingone.sg` |

---

## Existing services in this repo (don't reinvent)

Before writing a new service that calls PingOne Management API, check whether the operation already lives in one of these:

| Service | Owns |
|---|---|
| `demo_api_server/services/mfaService.js` | MFA device list/delete/rename, nickname patch, enrollment helpers |
| `demo_api_server/services/pingOneUserService.js` | User CRUD against `/v1/environments/{envId}/users`; owns the real token cache (`this.accessToken` / `this.tokenExpiry`) |
| `demo_api_server/services/pingoneManagementService.js` | Thin resource/scope/app helper — consumes an injected token param or reads `PINGONE_MANAGEMENT_API_TOKEN` from `process.env`; does **not** cache tokens |
| `demo_api_server/services/pingOneClientService.js` | Worker-token acquisition (`getManagementToken()`) — canonical `client_credentials` mgmt-token implementation |
| `demo_api_server/services/pingoneProvisionService.js` | Idempotent provisioning (`provisionEnvironment()`) used by `npm run pingone:bootstrap` via `scripts/bootstrapPingOne.js` (apps, resources, scopes, demo users) |
| `demo_api_server/services/pingoneBootstrapService.js` | Separate manifest-plan / probe helper (not what `npm run pingone:bootstrap` runs) |

When you add a new Management API operation, add it as a method on the appropriate service above — don't fork a parallel service in a route file. The token-custody and `configStore` rules apply to anything you add.

---

## Security Rules

- ✅ All PingOne calls go through `demo_api_server` — never from the browser
- ✅ Client secrets read from `configStore.getEffective()` — not `process.env` in route files (CLAUDE.md non-negotiable)
- ✅ Management API tokens are short-lived, obtained via `client_credentials`; the token cache lives in `pingOneUserService` (`this.accessToken` / `this.tokenExpiry`), and worker-token acquisition in `pingOneClientService.getManagementToken()` — `pingoneManagementService` does **not** cache tokens (it consumes an injected token or `process.env.PINGONE_MANAGEMENT_API_TOKEN`)
- ✅ `timeout: 10000` on all `axios` calls
- ✅ Check `configStore.isConfigured()` (or per-key `configStore.getEffective` returning non-null) before PingOne calls; return graceful error if not set up
- ❌ Never log `access_token`, `client_secret`, or `code_verifier` values
- ❌ Never pass raw tokens to `res.json()` — store in `req.session.oauthTokens`

---

## See Also

- [PingOne API — Before You Begin (official docs)](https://developer.pingidentity.com/pingone-api/before-you-begin/introduction.html) — base URLs, auth model, regions, error envelope; read before any new Management API call
- [PingOne docs index (llms.txt)](https://docs.pingidentity.com/pingone/llms.txt) — machine-readable index of every PingOne doc page. Append `.md` to any `docs.pingidentity.com/pingone/...` URL to fetch that page as raw markdown. Pull current, authoritative docs for any PingOne service (directory, users, applications, gateways) this way.
- [oauth-pingone skill](../oauth-pingone/SKILL.md) — auth-server calls (login, token exchange, refresh, revoke, introspection)
- [bff-sessions skill](../bff-sessions/SKILL.md) — session/token custody, `configStore` lookup pattern
- [mcp-server skill](../mcp-server/SKILL.md) — when the PingOne call originates from an agent/MCP tool
- [hitl-consent skill](../hitl-consent/SKILL.md) — when a Management API call should be gated by user approval
- [regression-guard skill](../regression-guard/SKILL.md) — pre-edit rules for files touching PingOne config
- [typescript-banking skill](../typescript-banking/SKILL.md) — style rules for new service code
