---
name: oauth-pingone
description: 'Authoritative PingOne OAuth 2.0 / OIDC guide for ALL grant types. USE FOR: authentication, login, logout, Authorization Code + PKCE, Client Credentials, CIBA backchannel auth, Token Exchange, Device Authorization, refresh token, revocation, introspection, PAR, nonce, state, CSRF, id_token validation, act/may_act claims, scope enforcement, session management, DaVinci, PingOne app config checklist, OAuth error codes, hybrid, implicit, ROPC, redirectless, pi.flow, RAR, authorization_details, jwt-bearer. DO NOT USE FOR: calling PingOne Management API to manage users or MFA (use pingone-api-calls); MCP server tool registration (use mcp-server).'
argument-hint: 'Describe the OAuth flow or token operation you need to implement'
---

# PingOne OAuth 2.0 / OIDC — Complete Implementation Guide
## Super Banking demo

> **Default host:** local development uses `https://api.ping.demo:4000` (UI / public origin) and `https://api.ping.demo:3001` (BFF) via `mkcert` HTTPS. OAuth callbacks land at the **UI** origin :4000 — CRA's `setupProxy.js` forwards `/api/*` to BFF :3001. PingOne app **Redirect URIs** must include the UI-port callback URLs:
> - Admin: `https://api.ping.demo:4000/api/auth/oauth/callback`
> - User:  `https://api.ping.demo:4000/api/auth/oauth/user/callback`
>
> Users can override the host via the `/setup` page (configStore-backed) or by setting `PUBLIC_APP_URL` / `REACT_APP_CLIENT_URL` — but skills, docs, examples, and PingOne app config use `api.ping.demo:4000` for callbacks. Don't hardcode `localhost` in `routes/oauth*.js` callbacks (REGRESSION_PLAN §1).

---

## When to Use

- Implementing or debugging any OAuth 2.0 / OIDC flow: Authorization Code + PKCE, Client Credentials, CIBA, Token Exchange, Device Authorization, refresh, revocation, introspection
- Working with login, logout, session management, `id_token` validation, `act`/`may_act` claims, or scope enforcement
- Configuring PingOne applications (Redirect URIs, grant types, authentication methods, DaVinci policies)
- Debugging OAuth errors, CSRF/state/nonce issues, PAR, or token custody violations
- Understanding or implementing MFA during login (ACR values, step-up, `pi.flow`)

## When NOT to Use

- Calling the PingOne Management API to manage users, groups, or MFA devices — use `pingone-api-calls` or `pingone-mfa` instead
- Registering or implementing MCP server tools — use `mcp-server` instead
- BFF session/cookie plumbing unrelated to OAuth flows — use `bff-sessions` instead

## 0. Quick Reference — Grant Type Selector

| Scenario | Grant Type | Use In This Project |
|---|---|---|
| User signs in via browser redirect | `authorization_code` + PKCE S256 | Admin login (`/api/auth/oauth/login`), User login (`/api/auth/oauth/user/login`) |
| Server-side machine-to-machine | `client_credentials` | Agent actor token (`oauthService.getAgentClientCredentialsToken()`) |
| Out-of-band user approval (no browser) | CIBA (`urn:openid:params:grant-type:ciba`) | Step-up auth, transfer approval (`cibaService.js`) |
| Delegate user token to another audience | Token Exchange (`urn:ietf:params:oauth:grant-type:token-exchange`) | MCP server access (`oauthService.performTokenExchange()`) |
| IoT / limited-input device | Device Authorization (`urn:ietf:params:oauth:grant-type:device_code`) | Not yet wired but PingOne supports it since Feb 2024 |
| Refresh existing session | `refresh_token` | Auto-refresh middleware (`middleware/tokenRefresh.js`) |
| Revoke token on logout | RFC 7009 `/revoke` | Logout route (`oauthService.revokeToken()`) |
| Zero-trust token validation | RFC 7662 introspection | `middleware/tokenIntrospection.js` |
| Reduce redirect round-trip in high-security flows | PAR (`/par`) | Optional — PingOne supports, not yet implemented |
| Front-channel token + code combined | Hybrid (`code id_token` / `code token` / `code id_token token`) | Demo/teaching reference only — NOT wired in banking (violates token custody). See `reference/hybrid-flow.md` |
| Embedded login, no browser redirect | Redirectless (`response_mode=pi.flow`, `urn:pingidentity:redirectless`) | Demo/teaching reference only — NOT wired in banking. See `reference/redirectless-pi-flow.md` |
| Signed-JWT assertion in place of secret/user | JWT-bearer (`urn:ietf:params:oauth:grant-type:jwt-bearer`) | Demo/teaching reference only — NOT wired in banking. See `reference/jwt-bearer-and-rar.md` |
| Fine-grained structured permissions | RAR (`authorization_details`, RFC 9396) | Demo/teaching reference only — NOT wired in banking (HITL consent used instead). See `reference/jwt-bearer-and-rar.md` |
| Legacy SPA token-in-fragment | Implicit (`token` / `id_token token`) | ⚠️ Anti-pattern — NEVER wired in banking. See `reference/deprecated-flows.md` |
| App collects raw username/password | ROPC (`password`) | ⚠️ Anti-pattern — NEVER wired in banking. See `reference/deprecated-flows.md` |

---

## 1. Project Auth Architecture

This project uses a **Backend-for-Frontend (BFF)** pattern:
- `demo_api_server` is the confidential client — it holds tokens in server-side sessions, never exposes them to the browser.
- `demo_api_ui` (React SPA) only ever receives opaque session cookies — never raw tokens.
- Two PingOne applications: **Admin client** (admin users/employees) and **User client** (bank customers).
- Tokens are stored in `req.session.oauthTokens` on the server, managed by `express-session`.

---

## 2. PingOne Endpoint Reference

All endpoints are under: `https://auth.pingone.{tld}/{envId}/as/`

| Endpoint | Method | Description |
|---|---|---|
| `/as/.well-known/openid-configuration` | GET | OIDC Discovery (caches all other URLs) |
| `/as/authorize` | GET | Start authorization / login redirect |
| `/as/token` | POST | Exchange code, refresh token, CIBA poll, client credentials, token exchange, device |
| `/as/revoke` | POST | RFC 7009 token revocation |
| `/as/introspect` | POST | RFC 7662 token introspection |
| `/as/userinfo` | GET | OIDC userinfo (Bearer token required) |
| `/as/jwks` | GET | JSON Web Key Set for id_token / access token signature verification |
| `/as/signoff` | GET | End SSO session (pass `id_token_hint`) |
| `/as/bc-authorize` | POST | CIBA backchannel authentication initiation |
| `/as/par` | POST | Pushed Authorization Request (PAR) — returns `request_uri` |
| `/as/device_authorization` | POST | Device Authorization Grant initiation |

### Region TLD Table

| Region | TLD |
|---|---|
| North America | `com` |
| Canada | `ca` |
| European Union | `eu` |
| Australia | `com.au` |
| Singapore | `sg` |
| Asia-Pacific | `asia` |

**In this project:** region is stored in `configStore` as `pingone_region` and defaults to `'com'`.  
Config pointer (lazy): `oauthConfig._base` = `https://auth.pingone.${region}/${envId}/as`

---

## 3. Environment Variables

All real env vars use the `PINGONE_*` prefix. Endpoints are auto-computed from `PINGONE_ENVIRONMENT_ID` + `PINGONE_REGION` via `oauthEndpointResolver.js` — you don't set `_TOKEN_ENDPOINT` / `_AUTHORIZATION_ENDPOINT` manually. Always read values via `configStore.getEffective(key)`, never `process.env.*` directly in route handlers (CLAUDE.md rule).

```bash
# PingOne Core
PINGONE_ENVIRONMENT_ID=<envId>
PINGONE_REGION=com  # com | ca | eu | com.au | sg | asia

# Admin (confidential) client — WEB_APP type, Authorization Code + PKCE
PINGONE_ADMIN_CLIENT_ID=<admin-app-client-id>
PINGONE_ADMIN_CLIENT_SECRET="<admin-app-client-secret>"   # quote secrets with special chars
PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH=basic                   # basic | post

# User (public/confidential) client — WEB_APP or NATIVE_APP type
PINGONE_USER_CLIENT_ID=<user-app-client-id>
PINGONE_USER_CLIENT_SECRET="<user-app-client-secret>"     # omit for public client (PKCE only)

# Token exchange / MCP delegation (RFC 8693)
PINGONE_AUDIENCE_ENDUSER=<resource-server-audience-for-user-tokens>
PINGONE_RESOURCE_MCP_SERVER_URI=<mcp-server-resource-uri-and-audience>

# Token exchanger client (client_credentials for the RFC 8693 actor token)
PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID=<agent-client-id>
PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET="<agent-client-secret>"
PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SCOPES=openid
PINGONE_MCP_TOKEN_EXCHANGER_AUTH_METHOD=basic           # basic | post (post for PingOne AI_AGENT apps)
MCP_TOKEN_EXCHANGE_SCOPES=read write mcp:invoke largepurchase:read records:read gear:read expense:read

# CIBA
CIBA_ENABLED=true
CIBA_TOKEN_DELIVERY_MODE=poll  # poll | ping
CIBA_BINDING_MESSAGE=Banking App Authentication
STEP_UP_ACR_VALUE=<davinci-policy-acr-value>  # e.g. Multi_factor

# Security
SKIP_TOKEN_SIGNATURE_VALIDATION=false  # MUST be false in production
```

---

## 4. Authorization Code + PKCE Flow (Primary Backend-for-Frontend (BFF) Pattern)

**PingOne app requirements:**
- `type: WEB_APP`, `grantTypes: ["authorization_code", "refresh_token"]`
- `pkceEnforcement: S256_REQUIRED`
- `tokenEndpointAuthMethod: CLIENT_SECRET_BASIC`
- `redirectUris` must include the Backend-for-Frontend (BFF) callback URL

### 4a. Step 1 — Initiate Login

```javascript
const crypto = require('crypto');
const { oauthService } = require('../services/oauthService');
const { setPkceCookie } = require('../services/pkceStateCookie');
const { validateRedirectUriOrigin } = require('../services/oauthRedirectUris');

router.get('/login', (req, res) => {
  const state = oauthService.generateState(); // crypto.randomBytes(32).hex
  const codeVerifier = oauthService.generateCodeVerifier(); // crypto.randomBytes(64).hex
  const nonce = crypto.randomBytes(16).toString('hex'); // OIDC replay protection
  const redirectUri = getAdminRedirectUri(req);

  // Validate redirect_uri origin — prevent open redirect
  const uriCheck = validateRedirectUriOrigin(redirectUri);
  if (!uriCheck.ok) return res.status(400).json({ error: 'invalid_redirect_uri' });

  // Store in session AND signed cookie (PKCE/state fallback for any async or cross-process store)
  req.session.oauthState = state;
  req.session.oauthCodeVerifier = codeVerifier;
  req.session.oauthRedirectUri = redirectUri;
  req.session.oauthNonce = nonce;
  setPkceCookie(res, { state, codeVerifier, redirectUri, nonce }, isProd());

  const authUrl = oauthService.generateAuthorizationUrl(state, codeVerifier, redirectUri, nonce);

  // Save session BEFORE redirect (required for async stores like SQLite)
  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'session_save_failed' });
    res.redirect(authUrl);
  });
});
```

**Authorization URL parameters:**
```
GET https://auth.pingone.{tld}/{envId}/as/authorize
  ?response_type=code
  &client_id={clientId}
  &redirect_uri={redirectUri}
  &scope=openid profile email
  &state={random-hex-64}
  &code_challenge={sha256base64url(verifier)}
  &code_challenge_method=S256
  &nonce={random-hex-32}
  &acr_values=Single_Factor      // optional: PingOne predefined or DaVinci policy name
  &login_hint=admin              // optional: hint to PingOne login UI
```

### 4b. Step 2 — Callback: Exchange Code for Tokens

```javascript
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // If PingOne returned an error (user denied, policy failed, etc.)
  if (error) {
    console.error('[callback] PingOne error:', error, error_description);
    return res.redirect(`${getFrontendOrigin(req)}/login?error=${encodeURIComponent(error)}`);
  }

  // State validation — prefer session, fall back to signed PKCE cookie if session lookup fails
  const pkceData = req.session.oauthState === state
    ? { codeVerifier: req.session.oauthCodeVerifier, redirectUri: req.session.oauthRedirectUri, nonce: req.session.oauthNonce }
    : readPkceCookie(req);  // validates HMAC signature internally

  if (!pkceData || pkceData.state !== state) {
    return res.redirect(`${getFrontendOrigin(req)}/login?error=invalid_state`);
  }

  const tokens = await oauthService.exchangeCodeForToken(
    code, pkceData.codeVerifier, pkceData.redirectUri
  );
  // Token request: grant_type=authorization_code, code={code}, redirect_uri={uri},
  // client_id={id}, code_verifier={verifier},  Authorization: Basic base64(id:secret)

  // Verify nonce in id_token to prevent replay attacks
  const idTokenClaims = jwt.decode(tokens.id_token);
  if (idTokenClaims.nonce !== pkceData.nonce) {
    return res.redirect(`${getFrontendOrigin(req)}/login?error=nonce_mismatch`);
  }

  // Backend-for-Frontend (BFF): store tokens server-side, never send to browser
  req.session.oauthTokens = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: Date.now() + ((tokens.expires_in || 3600) * 1000),
    tokenType: tokens.token_type,
  };
  req.session.oauthType = 'admin';
  // determineRole() below is ILLUSTRATIVE PSEUDOCODE — no helper by this exact name
  // exists; derive the role from your own id_token claims / group mapping.
  req.session.user = { ...idTokenClaims, role: determineRole(idTokenClaims) };

  clearPkceCookie(res, isProd());
  res.redirect(`${getFrontendOrigin(req)}/dashboard`);
});
```

### 4c. PKCE Code Challenge Generation

```javascript
// code_verifier: crypto.randomBytes(64).toString('hex') — 128 hex chars / 256 bits
// code_challenge: base64url(sha256(verifier))
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
// PingOne requires code_challenge_method=S256 when pkceEnforcement=S256_REQUIRED
```

---

## 5. Client Credentials Grant

Used for machine-to-machine auth where no user is involved.

**PingOne app requirements:**
- `type: WORKER` or `SERVICE`
- `grantTypes: ["client_credentials"]`
- `tokenEndpointAuthMethod: CLIENT_SECRET_BASIC`

```javascript
// services/oauthService.js — getAgentClientCredentialsToken()
// Always read via configStore.getEffective — NEVER process.env in handlers (CLAUDE.md).
const configStore = require('./configStore');
const body = new URLSearchParams({
  grant_type: 'client_credentials',
  client_id: configStore.getEffective('pingone_mcp_token_exchanger_client_id'),
  client_secret: configStore.getEffective('pingone_mcp_token_exchanger_client_secret'),
  scope: configStore.getEffective('pingone_mcp_token_exchanger_client_scopes') || 'openid',
});
const response = await axios.post(tokenEndpoint, body.toString(), {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
// Returns: { access_token, token_type: 'Bearer', expires_in }
// No refresh_token and no id_token in client_credentials response
```

**Preferred auth method:** Use `Authorization: Basic base64(clientId:clientSecret)` header instead of body params (`CLIENT_SECRET_BASIC`).

---

## 6. CIBA — Client-Initiated Backchannel Authentication

Used for step-up auth and out-of-band user approval without a browser redirect.

**Flow:** Backend-for-Frontend (BFF) initiates → PingOne delivers challenge to user (email / device push via DaVinci) → Backend-for-Frontend (BFF) polls token endpoint

**PingOne app requirements:**
- Enable CIBA grant type on the application
- Delivery mode: `poll` (server polls) or `ping` (PingOne POSTs to notification endpoint)
- Configure a DaVinci policy for challenge delivery
- For step-up: `STEP_UP_ACR_VALUE` env var matching your DaVinci policy ACR

**Grant type URN:** `urn:openid:params:grant-type:ciba`

### 6a. Initiate CIBA

```
POST https://auth.pingone.{tld}/{envId}/as/bc-authorize
Authorization: Basic base64(clientId:clientSecret)
Content-Type: application/x-www-form-urlencoded

login_hint=user@email.com
&scope=openid profile email
&binding_message=Super Banking — Approve Transfer
&acr_values=Multi_factor                        // optional step-up ACR
// For ping mode only: &client_notification_token=<random-32-bytes-hex>
```

Response: `{ auth_req_id, expires_in, interval }`

### 6b. Poll for Tokens

```
POST https://auth.pingone.{tld}/{envId}/as/token
Authorization: Basic base64(clientId:clientSecret)

grant_type=urn:openid:params:grant-type:ciba
&auth_req_id={authReqId}
```

| Response error | Meaning | Action |
|---|---|---|
| `authorization_pending` | User hasn't responded yet | Retry after `interval` seconds |
| `slow_down` | Polling too fast | Increase interval by 5s (max 30s) |
| `access_denied` | User denied | Abort, notify user |
| `expired_token` | auth_req_id expired | Start new CIBA flow |
| _(success)_ | `{ access_token, id_token, refresh_token, ... }` | Store in Backend-for-Frontend (BFF) session |

### 6c. cibaService.js Route Pattern

```javascript
router.post('/initiate', authenticateToken, async (req, res) => {
  const loginHint = req.body.login_hint || req.session.user?.email;
  const result = await initiateBackchannelAuth(
    loginHint,
    req.body.binding_message || 'Super Banking Authentication',
    req.body.scope || 'openid profile email',
    req.body.acr_values,  // e.g. process.env.STEP_UP_ACR_VALUE
  );
  req.session.cibaAuthReqId = result.auth_req_id;
  req.session.save(() => res.json(result));
});

router.get('/poll/:authReqId', authenticateToken, async (req, res) => {
  try {
    const tokens = await pollForTokens(req.params.authReqId);
    req.session.oauthTokens = tokens;  // Backend-for-Frontend (BFF): tokens stay server-side
    res.json({ status: 'approved' });
  } catch (err) {
    const code = err.response?.data?.error;
    if (code === 'authorization_pending') return res.json({ status: 'pending' });
    if (code === 'access_denied')         return res.json({ status: 'denied' });
    if (code === 'slow_down')             return res.json({ status: 'slow_down' });
    throw err;
  }
});
```

---

## 7. Token Exchange — RFC 8693

Used to mint a scoped delegated token for a specific audience (e.g., MCP server).

**PingOne setup:**
1. User's T1 token must contain `may_act: { client_id: <bff-client-id> }` — configure in PingOne token customization
2. Enable `urn:ietf:params:oauth:grant-type:token-exchange` grant on Backend-for-Frontend (BFF) admin client
3. Configure a custom resource server with the target audience URI

**Grant type URN:** `urn:ietf:params:oauth:grant-type:token-exchange`
**Token type URN:** `urn:ietf:params:oauth:token-type:access_token`

### 7a. Simple Token Exchange (subject only)

```javascript
// services/oauthService.js — performTokenExchange(subjectToken, audience, scopes)
// The caller passes the subject token, target audience, and scopes; client auth is
// applied to the request via header by applyAdminTokenEndpointClientAuth() — there is
// NO client_secret in the body.
// T1 (user access token) → T2 (MCP-scoped delegated token)
const body = new URLSearchParams({
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  subject_token: subjectToken,              // T1 — end-user's token
  subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  audience,                                 // caller-supplied target audience
  scope: scopes,                            // caller-supplied (default from mcp_token_exchange_scopes)
});
// Client auth (Basic header or client_id in body per configured method) is added here:
applyAdminTokenEndpointClientAuth(body, headers);
// T2: sub = user sub (unchanged), act = { client_id: <bff-client-id> }
// This is delegation, NOT impersonation
```

### 7b. Token Exchange with Actor Token (subject + actor)

```javascript
// services/oauthService.js — performTokenExchangeWithActor()
const configStore = require('./configStore');
const body = new URLSearchParams({
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  subject_token: userAccessToken,           // who the action is FOR
  subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  actor_token: agentClientCredToken,        // who performs the action
  actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  audience: configStore.getEffective('pingone_resource_mcp_server_uri'),
  scope: configStore.getEffective('mcp_token_exchange_scopes') || 'read write mcp:invoke largepurchase:read records:read gear:read expense:read',
  client_id: configStore.getEffective('pingone_admin_client_id'),
  client_secret: configStore.getEffective('pingone_admin_client_secret'),
});
// T3: sub = user sub, act = { sub: <agent-sub>, client_id: <agent-id> }
```

### 7b-1. PingOne single-resource-per-request rule (RFC 8707) — load-bearing

**PingOne rejects any token request whose requested scopes span more than one
resource server with `400 invalid_scope: "May not request scopes for multiple
resources"`.** This applies to every token endpoint call, not just exchanges:
`/authorize` with `&resource=`, `client_credentials`, and **each individual leg
of a multi-step RFC 8693 chain**.

Rules of thumb for this codebase:

- **Never set `audience` and omit `scope` on a `client_credentials` request** if
  the worker app is granted scopes on >1 resource. PingOne then tries every
  entitled scope, they span resources, and it 400s. Always pass an explicit
  single-resource `scope` (see `getClientCredentialsTokenAs(..., scope)`).
- **In a two-exchange delegation chain, each exchange requests scopes for ONE
  resource only.** The intermediate-audience exchange (Exchange #1) requests
  only the scope unique to the Intermediate resource
  (`two_exchange_intermediate_scope`, default `agent:invoke`);
  the actor-CC tokens use `agent_gateway_cc_scope` / `mcp_gateway_cc_scope`. The
  real tool scopes (`read` + `mcp:invoke`, which span resources)
  belong **only** at the final exchange against the final audience — never at an
  intermediate leg.
- A worker/AI-agent app *should* still be granted scopes across multiple
  resources (each leg needs its own). The fix for the multi-resource error is
  always "request one resource's scope per call", never "remove grants".
- configStore CC/exchange scope defaults are kept in SYNC with the provisioner's
  granted scopes — change one end, change the other (SYNC comments mark both).

This rule has bitten three distinct code paths (`/authorize`, the two actor-CC
tokens, and Exchange #1's subject leg). See REGRESSION_PLAN.md §1 row "PingOne
authorize `resource` + mixed scopes" and the 2026-05-15 / 2026-05-16 §4 entries.

### 7c. act / may_act Claims (RFC 8693 §4.1)

```javascript
// T1 (user token) must contain:
{ sub: "user-guid", may_act: { client_id: "bff-admin-client-id" } }

// T2 (exchanged token) will contain:
{ sub: "user-guid", act: { client_id: "bff-admin-client-id" } }

// Middleware validation (actClaimValidator.js):
function validateActClaim(actClaim) {
  if (!actClaim) return { valid: false, reason: 'act claim absent' };
  return { valid: !!(actClaim.client_id || actClaim.sub || actClaim.iss), actor: actClaim };
}
function validateMayActClaim(mayActClaim, expectedClientId) {
  if (mayActClaim?.client_id !== expectedClientId)
    return { valid: false, reason: 'may_act.client_id mismatch' };
  return { valid: true };
}
```

### 7c-1. Configuring `may_act` in PingOne — `${user.mayAct}` vs `#{...}` (recurring token bug)

This is the single most recurring root cause of a broken delegation chain in this
repo ("tripping on tokens"). Two PingOne attribute-substitution syntaxes look
interchangeable in a **resource custom attribute** but are not:

- `${user.mayAct}` (dollar-brace substitution) **IS evaluated** — a JSON-typed
  user attribute emits as a real **JSON object** claim. ✅ **Use this.**
- `#{...}` (hash-brace SpEL, e.g. `#{'sub':'<uuid>'}`) is **NOT evaluated** in a
  resource custom attribute — PingOne emits the **literal string**
  `"#{'sub':'...'}"` into the JWT. ❌ This silently broke `may_act.sub` lookups
  for months because the value *looks* present but is an inert string.

Design in this repo (verified empirically via Management API + live token mint):

- `may_act` lives on the **user record**, not hardcoded on the resource — user
  custom attribute **`mayAct`** (type **JSON**) holds `{ "sub": "<actor>" }`.
- The Demo API (`enduser.ping.demo`) and MCP resources set resource attribute
  `may_act = ${user.mayAct}`, projecting the user's value into the token.
- For PingOne to then emit `act`, `may_act.sub` must equal a claim the **actor
  token actually carries**. The AI-Agent CC actor token has only `client_id`
  (a UUID) and **no `sub`** — so a URL or arbitrary value will NOT produce `act`.
  Because `#{...}` is emitted literally, conditional act-SpEL can't live in a
  resource attribute; the repo bridges `act` to the gateway via the
  `X-Act-Client-Id` header instead.
- Bootstrap (`pingoneProvisionService.js`): the `mayAct-schema` step ensures the
  JSON attr, a later step sets resource `may_act = ${user.mayAct}`, and a per-user
  step sets `mayAct = {sub: AGENT_MAY_ACT_SUB || aiAgentClientId}`. An empty
  per-user `mayAct` (a bootstrap miss) is the usual reason a user token carries no
  usable `may_act`.

See `reference/token-exchange-pingone-deep-dive.md` for the full SPEL attribute
mapping, and the [PingOne: Securing AI Agents](https://developer.pingidentity.com/identity-for-ai/identity/idai-securing-agents-pingone.html) official guide.

---

## 8. Device Authorization Grant

For devices with limited input (TV, CLI, IoT). PingOne supports this since Feb 2024.

**PingOne app requirements:** `type: CUSTOM_APP`, `grantTypes: ["device_code", "refresh_token"]`, `tokenEndpointAuthMethod: NONE`, optionally `devicePathId` (short alias like `activate`)

**Grant type URN:** `urn:ietf:params:oauth:grant-type:device_code`

```javascript
// Step 1: POST /as/device_authorization
// body: client_id={id} & scope=openid profile email
// Response: { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }
// Show user: "Go to {verification_uri} and enter code {user_code}"

// Step 2: Poll /as/token
// grant_type=urn:ietf:params:oauth:grant-type:device_code & device_code={device_code} & client_id={id}
// Loop on authorization_pending, respect slow_down, stop on success/access_denied/expired_token
```

---

## 9. Token Refresh (RFC 6749 §6)

```javascript
// middleware/tokenRefresh.js — refreshIfExpiring()
// Silent auto-refresh 5 minutes before access token expiry
async function refreshIfExpiring(req, res, next) {
  const tokens = req.session?.oauthTokens;
  if (!tokens?.refreshToken) return next();
  if (tokens.accessToken === '_cookie_session') return next(); // local session

  const MARGIN = 5 * 60 * 1000;
  if (!tokens.expiresAt || (Date.now() + MARGIN) < tokens.expiresAt) return next();

  const tokenData = await oauthUserService.refreshAccessToken(tokens.refreshToken);

  // PingOne rotates refresh tokens — always store the new one
  req.session.oauthTokens = {
    ...tokens,
    accessToken:  tokenData.access_token,
    refreshToken: tokenData.refresh_token || tokens.refreshToken,
    idToken:      tokenData.id_token || tokens.idToken,
    expiresAt:    Date.now() + ((tokenData.expires_in || 3600) * 1000),
  };
  req.session.save(err => { if (err) console.error('[tokenRefresh] save error:', err); });
  next(); // non-fatal — always continue
}
// Token request: grant_type=refresh_token & refresh_token={token} + client auth
```

**Enable `additionalRefreshTokenReplayProtectionEnabled`** on the PingOne app to automatically revoke access tokens when a replayed refresh token is detected.

---

## 10. Token Revocation — RFC 7009

Always revoke on logout. Revoke both the refresh token AND the access token.

```javascript
// services/oauthService.js — revokeToken()
async revokeToken(token, tokenType) {
  if (!token) return;
  const revocationEndpoint = this.config.tokenEndpoint.replace(/\/as\/token$/, '/as/revoke');
  const body = new URLSearchParams({ token, client_id: this.config.clientId });
  if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret);
  if (tokenType) body.set('token_type_hint', tokenType); // 'access_token' | 'refresh_token'
  await axios.post(revocationEndpoint, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000,
  }).catch(err => console.warn('[RFC7009] revocation failed (non-fatal):', err.message));
}

router.get('/logout', async (req, res) => {
  const { oauthTokens } = req.session;
  await oauthService.revokeToken(oauthTokens?.refreshToken, 'refresh_token');
  await oauthService.revokeToken(oauthTokens?.accessToken,  'access_token');
  req.session.destroy(() => { clearAuthCookie(res, isProd()); res.json({ ok: true }); });
});
```

**PingOne constraints:** PingOne API resource tokens cannot be revoked. `id_token` cannot be revoked. Only custom resource tokens are revocable.

---

## 11. Token Introspection — RFC 7662

```javascript
const response = await axios.post(
  `${PINGONE_AUTH_BASE}/introspect`,
  new URLSearchParams({ token, token_type_hint: 'access_token' }),
  { auth: { username: clientId, password: clientSecret },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 }
);
// { active: true, sub, scope, client_id, aud, exp, iss, token_type }
// { active: false }  ← revoked, expired, or unknown token
// See middleware/tokenIntrospection.js — per-client cache key, 30s TTL / 60s eviction
// (the earlier token-prefix cache key was removed as a collision risk)
```

---

## 12. PAR — RFC 9126

```javascript
// Step 1: POST /as/par  (same params as /authorize, sent server-to-server)
// Response: { request_uri: 'urn:ietf:params:oauth:request_uri:...', expires_in: 60 }
// Step 2: Redirect with only client_id + request_uri
res.redirect(`${AUTH_BASE}/authorize?client_id=${CLIENT_ID}&request_uri=${encodeURIComponent(requestUri)}`);
```

---

## 13. OIDC ID Token Validation

```javascript
// 1. Decode header → get kid
// 2. Fetch JWKS from /as/jwks → select key matching kid (use jwks-rsa package)
// 3. Verify signature: jwt.verify(idToken, publicKey, { algorithms: ['RS256'] })
// 4. Verify iss === `https://auth.pingone.${region}/${envId}/as`
// 5. Verify aud contains client_id
// 6. Verify exp * 1000 > Date.now()
// 7. Verify nonce === sessionNonce  (replay prevention)
// 8. (Optional) Verify acr if step-up was requested
// 9. (Optional) Verify at_hash against access token
```

`SKIP_TOKEN_SIGNATURE_VALIDATION=true` skips steps 2–3. **Never set in production — server will refuse to start.**

---

## 14. Scope Configuration

| Scope | Client | Purpose |
|---|---|---|
| `openid` | All | Required for OIDC / id_token |
| `profile` | Admin, User | name, given_name, family_name |
| `email` | Admin, User | email, email_verified |
| `offline_access` | User | Adds refresh_token |
| `read` | User | Read accounts/transactions |
| `write` | User | Transfer/payment actions |
| `mcp:invoke` | User | Invoke MCP server tools |
| `admin:read` | Admin | Read admin config / user management |
| `admin:write` | Admin | Write admin config / user management |

> **Worker directory access is NOT a scope.** PingOne reserves the `p1:*` namespace
> (e.g. `p1:read:user`, `p1:update:user`, `p1:update:userMfaEnabled`) and **rejects any
> attempt to provision them as custom resource scopes**. A Worker app's ability to read
> the PingOne directory or toggle MFA is granted via **ROLE assignments** (e.g. Identity
> Data Admin) on the worker app / service account — not by requesting these as OAuth
> scopes. Do not add them to a resource server's scope list.

---

## 15. PingOne Application Configuration Checklist

| Setting | Admin Client | User Client | Agent Client |
|---|---|---|---|
| App type | `WEB_APP` | `WEB_APP` | `WORKER` |
| Grant types | `authorization_code`, `refresh_token`, `token-exchange`, CIBA | `authorization_code`, `refresh_token` | `client_credentials` |
| PKCE enforcement | `S256_REQUIRED` | `S256_REQUIRED` | N/A |
| Token endpoint auth | `CLIENT_SECRET_BASIC` | `CLIENT_SECRET_BASIC` | `CLIENT_SECRET_BASIC` |
| Redirect URIs | `/api/auth/oauth/callback` | `/api/auth/oauth/user/callback` | N/A |
| Token exchange | ✅ Enable | ❌ | ❌ |
| CIBA | ✅ Enable | ❌ | ❌ |

---

## 16. Common PingOne Error Codes

| Error | Cause | Resolution |
|---|---|---|
| `invalid_client` | Wrong credentials or auth method | Use `CLIENT_SECRET_BASIC` (header), not body params |
| `invalid_grant` | Code reused or wrong `code_verifier` | Fresh PKCE per request |
| `access_denied` | User denied or policy blocked | Surface to user; do not retry |
| `authorization_pending` | CIBA user hasn't responded | Keep polling |
| `slow_down` | Polling too fast | Increase interval by 5s (max 30s) |
| `expired_token` | CIBA `auth_req_id` expired | Start new CIBA flow |
| `invalid_scope` | Scope not in PingOne resource grants | Add scope in PingOne console |
| `invalid_redirect_uri` | URI not registered | Register exact URI in PingOne app |
| `interaction_required` | Session expired / MFA needed | Redirect with `acr_values` |

---

## 17. Security Checklist

- ✅ PKCE S256 on every authorization code flow
- ✅ State validated on every callback (CSRF prevention)
- ✅ Nonce validated in id_token (replay attack prevention)
- ✅ Redirect URIs validated server-side before constructing auth URL
- ✅ Tokens in server-side session only — never in localStorage or response body
- ✅ RFC 7009 revocation on logout (both access + refresh tokens)
- ✅ `SKIP_TOKEN_SIGNATURE_VALIDATION=false` enforced in production
- ✅ `act`/`may_act` claims validated on token-exchanged tokens
- ✅ Scope enforcement middleware on all resource routes
- ✅ `additionalRefreshTokenReplayProtectionEnabled` enabled on PingOne app
- ❌ Never use implicit flow
- ❌ Never log raw tokens
- ❌ Never expose `client_secret` to the browser
- ❌ Never skip CIBA `slow_down`
- ❌ Never use `prompt=none` without handling `interaction_required`

---

## 18. Extended Grant Types (reference index)

The flows below are **demo/teaching reference only — none are wired into the
banking app.** They exist so an agent can recognize, explain, and (for the
deprecated ones) *reject* them. Detailed bundled docs:

| Flow | Reference file | Wired in banking? |
|---|---|---|
| OIDC Hybrid (`code id_token` / `code token` / `code id_token token`) | `reference/hybrid-flow.md` | ❌ No (violates token custody) |
| Redirectless (`response_mode=pi.flow`) | `reference/redirectless-pi-flow.md` | ❌ No |
| JWT-bearer assertion + RAR (`authorization_details`) | `reference/jwt-bearer-and-rar.md` | ❌ No (HITL consent used instead) |
| Implicit + ROPC (anti-patterns) | `reference/deprecated-flows.md` | ❌ Never |
| RFC 8693 PingOne deep dive | `reference/token-exchange-pingone-deep-dive.md` | ✅ Basic exchange is (§7) |

### ⚠️ Critical PingOne constraints (read before designing with these)

- **Token Exchange is same-environment-only.** `subject_token` /
  `actor_token` MUST be an access or ID token previously issued by the
  **same PingOne environment**. A token from another environment (even the
  same organization) or any external AS is **not supported**.
- **Token Exchange returns NO refresh token.** PingOne never includes a
  `refresh_token` in a token-exchange response — re-run the exchange to mint
  a fresh scoped token; never try to "refresh" a T2/T3.
- **Token Exchange is opt-in per app** and requested scopes must be added to
  the exchanging application (same processing as an authorization request).
- **Hybrid / Implicit expose tokens to the browser** — incompatible with the
  BFF token-custody rule; reference only, never adopt in `routes/oauth*.js`.
- **ROPC puts the raw password in the app** — bypasses MFA / DaVinci / SSO;
  anti-pattern, never adopt.

---

## See Also

- [.cursor/rules/oauth-references/python-java.md](../../.cursor/rules/oauth-references/python-java.md) — Python Flask + Java Spring Security examples
- [pingone-api-calls skill](../pingone-api-calls/SKILL.md) — PingOne Management API (users, MFA)
- [bff-sessions skill](../bff-sessions/SKILL.md) — session store, cookies, `req.session.save()`, PKCE/state cookie fallback
- [mcp-server skill](../mcp-server/SKILL.md) — MCP tool auth challenge, RFC 8693 token exchange in the MCP context
- [hitl-consent skill](../hitl-consent/SKILL.md) — HITL/step-up gating after OAuth, Phase 170 transfer consent
- [regression-guard skill](../regression-guard/SKILL.md) — REGRESSION_PLAN §1 OAuth-protected files; never hardcode `localhost` in callbacks
- [typescript-banking skill](../typescript-banking/SKILL.md) — TS/JS style for OAuth handlers and services
- [mcp-server skill](../mcp-server/SKILL.md) — MCP tool auth challenge, token chain
- [reference/hybrid-flow.md](reference/hybrid-flow.md) — OIDC Hybrid response types (demo/teaching reference, not wired)
- [reference/redirectless-pi-flow.md](reference/redirectless-pi-flow.md) — PingOne `response_mode=pi.flow` (demo/teaching reference, not wired)
- [reference/jwt-bearer-and-rar.md](reference/jwt-bearer-and-rar.md) — JWT-bearer assertion + RAR `authorization_details` (demo/teaching reference, not wired)
- [reference/deprecated-flows.md](reference/deprecated-flows.md) — Implicit & ROPC documented as anti-patterns (never wired)
- [reference/token-exchange-pingone-deep-dive.md](reference/token-exchange-pingone-deep-dive.md) — Ping-internal RFC 8693 constraints (same-environment-only, no refresh token, SPEL attribute mapping)
- [PingOne: Securing AI Agents (official)](https://developer.pingidentity.com/identity-for-ai/identity/idai-securing-agents-pingone.html) — authoritative PingOne guide: act/may_act SPEL expression, three-token RFC 8693 chain, PingGateway MCP filters (McpProtectionFilter, McpAuditFilter, streamingEnabled), Agent-Consent-Login policy
- [PingOne docs index (llms.txt)](https://docs.pingidentity.com/pingone/llms.txt) — machine-readable index of every PingOne doc page. Append `.md` to any `docs.pingidentity.com/pingone/...` URL to fetch that page as raw markdown (e.g. `.../authorize/p1az-policies.md`). Pull current, authoritative docs for any PingOne service this way before relying on memory.
