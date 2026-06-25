# PingOne Token & Session Best Practices

> Expert guide for teams using PingOne OAuth 2.0 / OIDC in Node.js applications.
> Grounded in this project's implementation, PingOne official documentation, and the relevant RFCs.
> Each section covers: what the standard/PingOne recommends → what this project does → any verification step.
>
> **Related:** See [TOKEN_SESSION_AUDIT.md](TOKEN_SESSION_AUDIT.md) for code-level evidence behind each finding.

---

## Table of Contents

1. [BFF Pattern for Token Storage](#1-bff-pattern-for-token-storage)
2. [Access Token Lifetime](#2-access-token-lifetime)
3. [Refresh Token Rotation](#3-refresh-token-rotation)
4. [Session Management](#4-session-management)
5. [PKCE — Proof Key for Code Exchange](#5-pkce--proof-key-for-code-exchange)
6. [Audience-Per-Resource (Token Segmentation)](#6-audience-per-resource-token-segmentation)
7. [Token Introspection](#7-token-introspection)
8. [Token Revocation at Logout](#8-token-revocation-at-logout)
9. [RFC 8693 Token Exchange — AI Agent Delegation](#9-rfc-8693-token-exchange--ai-agent-delegation)
10. [PingOne-Specific Gotchas & Common Mistakes](#10-pingone-specific-gotchas--common-mistakes)

---

## 1. BFF Pattern for Token Storage

### Expert Recommendation

For Single-Page Applications (SPAs), **never store access tokens or refresh tokens in the browser** — not in `localStorage`, `sessionStorage`, or JavaScript-readable cookies. All three are accessible to cross-site scripts (XSS), meaning a single injected script can exfiltrate every token.

The **Backend-for-Frontend (BFF)** pattern solves this:
- The browser gets only a **session ID cookie** (`httpOnly`, `secure`, `sameSite`)
- All OAuth tokens live in a **server-side session store** (Redis, LMDB, etc.)
- The browser authenticates to the BFF, and the BFF calls downstream APIs on its behalf using the real bearer token

PingOne's architecture supports this pattern natively — the BFF is a confidential client that participates in the Authorization Code flow on behalf of the SPA.

### What This Project Does

Tokens are stored in `req.session.oauthTokens` (LMDB session store). The browser never receives an access token or refresh token directly.

```js
// demo_api_server/server.js — session cookie
cookie: { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax' }

// demo_api_server/middleware/agentSessionMiddleware.js — token access
req.session.oauthTokens.accessToken  // server-side only
```

The `_cookie_session` stub pattern adds a safety net: if LMDB fails to restore tokens after a restart, the stub is detected and the request returns `401 session_restore_required` — never silently using a phantom token.

### Verification
- Confirm no token appears in browser `localStorage` or `sessionStorage` (browser DevTools → Application → Storage)
- Confirm the session cookie is marked `HttpOnly` and `Secure` (browser DevTools → Application → Cookies)

---

## 2. Access Token Lifetime

### Expert Recommendation

Access tokens should be **short-lived**. They cannot be revoked without introspection — once issued, an access token is valid until it expires or PingOne is called to check it. Shorter lifetimes limit the blast radius of a leaked token.

| Use Case | Recommended Lifetime |
|---|---|
| End-user interactive sessions | 15–30 minutes |
| Machine-to-machine / service tokens | 5–15 minutes |
| Highly sensitive operations | 5 minutes or less |
| Long-running background jobs | Use refresh tokens instead of long-lived ATs |

PingOne default is **60 minutes**. For most production applications this is too long.

**Configure:** PingOne console → Applications → [App Name] → **Token Endpoint** → **Access Token Lifetime**

### What This Project Does

The BFF proactively refreshes the access token when it is within **5 minutes of expiry** (`tokenRefresh.js:71`). This means the effective user-visible session can last much longer than the AT lifetime — the token stays fresh transparently.

```js
// demo_api_server/middleware/tokenRefresh.js:71
const MARGIN = 5 * 60 * 1000; // refresh when < 5 min remaining
```

This is the correct pattern: use a short AT lifetime with a refresh token for continuity. The 5-minute margin gives enough buffer even under load.

### Verification

1. Open PingOne console → Applications → [Demo User App] → Token Endpoint → check **Access Token Lifetime**
2. If it reads 3600 (60 minutes), consider reducing to 900 (15 minutes) for production
3. The 5-minute refresh margin in code remains correct regardless of the AT lifetime configured

---

## 3. Refresh Token Rotation

### Expert Recommendation

Refresh tokens are long-lived credentials. If a refresh token is stolen, the attacker can mint new access tokens silently until the RT expires. Two defences:

**1. Rotate on every use:** PingOne issues a new RT with every AT refresh. The old RT is immediately invalidated. An attacker who steals an RT gets one use before the legitimate client's next refresh invalidates it — and the next legitimate refresh with the old RT returns `invalid_grant`, alerting the system.

**2. Revoke the entire token family on replay:** If PingOne detects that an already-revoked RT is presented (i.e., the same RT is used twice), it revokes the entire token family. This detects token theft when the attacker and victim use the RT concurrently.

**Configure in PingOne:**
- Applications → [User App] → Token Endpoint → **Refresh Token Rotation** → select **"Rotate On Each Use"**
- Applications → [User App] → Token Endpoint → **Refresh Token Lifetime** → set to match your intended session length (e.g., 8 hours for a workday app, 24 hours for a consumer app)

### What This Project Does

The token refresh middleware correctly handles RT rotation:

```js
// demo_api_server/middleware/tokenRefresh.js:~90
req.session.oauthTokens.refreshToken = tokenData.refresh_token || tokens.refreshToken;
```

When PingOne rotates the RT, `tokenData.refresh_token` contains the new RT. The old RT is replaced in the session atomically, and `session.save()` persists it.

When PingOne rejects a RT with `invalid_grant`, the session is blacklisted for 10 minutes:

```js
// demo_api_server/middleware/tokenRefresh.js:11-20
const _refreshBlacklist = new Map();   // sessionId → expiry timestamp
const BLACKLIST_TTL = 10 * 60 * 1000; // 10 minutes
```

This stops hammering PingOne after revocation, while allowing re-login to work once the TTL expires.

**Status: ✅ Code is correct — depends on PingOne console config**

### Verification (Required)

⚠️ The code ASSUMES rotation is enabled. If PingOne returns the same RT on each refresh (rotation OFF), the code still works — it stores the same RT — but you lose reuse-detection.

**Check:** PingOne console → Applications → [Demo User App] → **Token Endpoint** → confirm **Refresh Token Rotation** is set to **"Rotate On Each Use"**.

---

## 4. Session Management

### Expert Recommendation

PingOne has two independent session concepts that are easy to confuse:

| Session Type | Where it Lives | Ended By |
|---|---|---|
| **PingOne SSO session** | PingOne's servers; browser holds a PingOne session cookie | `GET /as/signoff` or Management API |
| **App session** | Your server's session store | `req.session.destroy()` + cookie clear |

If you only destroy the app session (logout from your app), the user still has an active PingOne SSO session. The next time they click "Login with PingOne", PingOne silently re-authenticates them without a password prompt. This is usually surprising and unwanted.

**Best practices:**
- Always call `GET /as/signoff` on logout to end the PingOne SSO session
- Pass `id_token_hint` to signoff so PingOne can identify which session to end
- Pass `post_logout_redirect_uri` to control where the user lands after signoff
- Align app session `maxAge` with PingOne session lifetime (Sign-On Policy → Session settings)
- Use `CLEAR_SESSIONS_ON_BOOT` to force fresh authentication after server restarts

**PingOne session lifetime configuration:**
- Sign-On Policies → [Policy] → **Session Settings** → Max Session Duration + Idle Timeout

### What This Project Does

```js
// demo_api_server/server.js:76-79
// Boot clear: wipe all LMDB sessions on restart
sessionStore.clear(...)

// demo_api_server/routes/oauthUser.js:894
// Signoff with id_token_hint
res.redirect(buildPingOneSignoffUrl(postLogoutUri, 'pingone_user_client_id', idToken));

// demo_api_server/routes/oauthUser.js:874
// Also terminates PingOne SSO sessions via Management API
await terminateAllUserSessions(userId);
```

The project takes the belt-and-suspenders approach: both `/as/signoff` redirect (browser-side SSO end) AND a Management API call to `DELETE /environments/{envId}/users/{userId}/sessions` (server-side force-terminate). This is more thorough than required but provides stronger logout guarantees.

### Verification

1. Confirm PingOne console → Sign-On Policies → [Policy] → Session Settings lifetime matches app session `maxAge` (24h in both, or adjust to match)
2. Test logout: after logout, confirm clicking "Sign in with PingOne" requires re-authentication (no silent SSO re-auth)

---

## 5. PKCE — Proof Key for Code Exchange

### Expert Recommendation

PKCE (RFC 7636) is **mandatory** for all public clients (SPAs, mobile apps) using the Authorization Code flow. It prevents authorization code interception attacks.

**How it works:**
1. Client generates a random `code_verifier` (43–128 characters, URL-safe)
2. Client computes `code_challenge = BASE64URL(SHA256(code_verifier))`
3. `code_challenge` is sent in the authorization request; `code_verifier` is sent in the token request
4. The authorization server rejects the token request if `SHA256(code_verifier) ≠ code_challenge`

**Always use `S256`** (SHA-256). The `plain` method provides no security benefit and should never be used.

Additional parameters:
- **`state`**: Random nonce bound to the session; prevents CSRF. Validated on callback.
- **`nonce`**: Embedded in the ID token; prevents replay attacks.
- **`redirect_uri`**: Must be pre-registered in PingOne and validated on callback.

**Configure in PingOne:** Applications → [App] → ensure PKCE Enforcement = **Required** (not Optional or disabled)

### What This Project Does

```js
// demo_api_server/services/oauthUserService.js:80,100
// Generate PKCE code challenge (S256 = base64url(sha256(verifier)))
code_challenge_method: 'S256',
```

The PKCE verifier and state are stored in an `httpOnly` cookie (not `localStorage`):

```js
// demo_api_server/routes/oauthUser.js:12
setPkceCookie(res, { codeVerifier, state, nonce, redirectUri });
```

On callback, all three are validated: state (CSRF), nonce (replay), and `code_verifier` is sent to the token endpoint.

Post-login return paths are sanitized to prevent open redirect attacks:

```js
if (!t.startsWith('/') || t.startsWith('//') || t.length > 160) return null;
if (!/^[/a-zA-Z0-9._~-]+$/.test(t)) return null;
```

### Verification

1. PingOne console → Applications → [Demo User App] → check **PKCE Enforcement** = Required
2. Confirm S256 is the configured code challenge method (S256 is the PingOne default for PKCE)

---

## 6. Audience-Per-Resource (Token Segmentation)

### Expert Recommendation

Each service in your architecture should have its own **Resource** registered in PingOne with a unique **Resource URI** (audience). Tokens issued for one service cannot be accepted by another.

**Why this matters:** Without audience segmentation, a token stolen from one service can be replayed at any other service that accepts the same token. With segmentation, a token for `mcpgateway.ping.demo` is structurally invalid at `enduser.ping.demo` — the audience check rejects it.

This implements the **principle of least privilege** at the token level.

**Configure in PingOne:** Resources → [Resource] → **Resource URI** (e.g. `enduser.ping.demo`)

Audience validation must be **fail-closed**: if the expected audience is not configured (env var missing), the service should reject all tokens, not accept everything.

### What This Project Does

```
User BFF (demo_api_server)   aud = enduser.ping.demo
MCP Gateway                  aud = mcpgateway.ping.demo
MCP Server                   aud = mcpserver.ping.demo
AI Agent Gateway             aud = agentgateway.ping.demo
```

Each service validates `aud` against its own resource URI:

```js
// demo_api_server/middleware/auth.js:24-28
const BFF_RESOURCE_URI =
  process.env.PINGONE_RESOURCE_BFF_URI ||
  process.env.ENDUSER_AUDIENCE ||
  null;  // null → validation bypassed (misconfiguration risk)
```

The **D-05 anti-bypass** ensures no token ever carries two audiences simultaneously. A token for the MCP gateway cannot be replayed at the BFF — the single-audience constraint holds at the PingOne resource level.

### Verification

⚠️ If `PINGONE_RESOURCE_BFF_URI` (and `ENDUSER_AUDIENCE`) are both unset in `demo_api_server/.env`, `BFF_RESOURCE_URI = null` and audience validation is bypassed. This is a misconfiguration that would accept tokens for any audience.

**Check:** Confirm `PINGONE_RESOURCE_BFF_URI` or `ENDUSER_AUDIENCE` is set in `demo_api_server/.env`.

---

## 7. Token Introspection

### Expert Recommendation

Token introspection (RFC 7662) lets a resource server verify a token's validity at the authorization server — useful for opaque tokens or when you need to check revocation status beyond the token's `exp` claim.

**Key rules:**

**1. The introspecting client must be the token's issuing client** (or a client that has been granted introspection rights for that resource). PingOne binds introspection to the requesting client — using the wrong client returns `{ active: false }` for a valid token, causing spurious logouts.

**2. Auth method must match the client's configuration.** PingOne supports `client_secret_basic` (credentials in `Authorization: Basic` header) and `client_secret_post` (credentials in the request body). A mismatch returns `401 invalid_client` — which looks like an authentication failure, not a configuration error. See [Gotcha 2](#gotcha-2-introspection-401-invalid_client--invalid-token) for per-client assignments and diagnostic curl commands.

**3. Cache results responsibly.** Introspecting on every request is expensive. Cache for a TTL shorter than the token's remaining lifetime. Do not cache `active: false` responses if you need real-time revocation detection.

**4. Never log the raw token.** Log the token hash instead.

### What This Project Does

```js
// demo_api_server/services/tokenIntrospectionService.js
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

// Auth method per client:
// Worker client (15881ac7-...) → client_secret_basic
// Gateway/authz client (d3f8fead-...) → client_secret_post
// User App (default) → client_secret_post (hardcoded)
```

The cache key is `SHA256(token) + clientId`, preventing cross-client cache pollution. Cache TTL is capped at the token's remaining lifetime so the cached result never outlives the token.

The Worker client is deliberately excluded from the default introspection path — it would return `active: false` for user tokens (PingOne requires introspection as the issuing client).

### Verification (Required)

⚠️ `PINGONE_INTROSPECTION_AUTH_METHOD=basic` must be set in `demo_api_server/.env`. The Worker client (`15881ac7-...`) uses `client_secret_basic`. If this env var is absent or set to `post`, every introspection call returns `401 invalid_client`.

The gateway and authz server `.env` files must keep their own `PINGONE_INTROSPECTION_AUTH_METHOD=post` — each service reads its own `.env`.

---

## 8. Token Revocation at Logout

### Expert Recommendation

A complete logout must do all three of the following — in this order:

1. **Revoke the access token** — `POST /as/revoke` with `token=<at>&token_type_hint=access_token` (RFC 7009). Even though the AT will expire naturally, early revocation limits the window during which a stolen AT could be reused.

2. **Revoke the refresh token** — `POST /as/revoke` with `token=<rt>&token_type_hint=refresh_token`. This is the critical one. If the RT is not revoked, an attacker with the RT can continue minting new ATs indefinitely, even after logout.

3. **End the PingOne SSO session** — `GET /as/signoff?id_token_hint=<id_token>&post_logout_redirect_uri=<uri>`. Without this step, the user still has an active PingOne session and will be silently re-authenticated on the next login click.

**Auth client credentials** are required for revocation — the client must identify itself when revoking its own tokens.

### What This Project Does

```js
// demo_api_server/routes/oauthUser.js:869-894
// 1. Revoke tokens (RFC 7009)
oauthService.revokeToken(accessToken,  'access_token');
oauthService.revokeToken(refreshToken, 'refresh_token');

// 2. Terminate all PingOne SSO sessions via Management API
await terminateAllUserSessions(userId);

// 3. Destroy local session + clear cookies
req.session.destroy(...);
clearAllAuthCookies(res, _isProd());

// 4. Redirect to /as/signoff with id_token_hint
res.redirect(buildPingOneSignoffUrl(postLogoutUri, 'pingone_user_client_id', idToken));
```

This exceeds the minimum requirement — it both redirects to `/as/signoff` (browser-side) AND calls the Management API to force-terminate sessions (server-side). Stub `_cookie_session` tokens are skipped.

**Status: ✅ Fully implemented**

### Note on Revocation Being "Best-Effort"

The code fires `revokeToken()` without awaiting (fire-and-forget). This means logout proceeds even if revocation fails (e.g., PingOne is briefly unreachable). For most applications this is the right trade-off — a failed revocation call should not block the user from logging out. The AT will expire naturally; the RT is the more important one to revoke.

---

## 9. RFC 8693 Token Exchange — AI Agent Delegation

### Expert Recommendation

When an AI agent acts on behalf of a human user, a standard bearer token is insufficient — it can't express *who* the agent is or *that* the human authorized it. RFC 8693 (OAuth 2.0 Token Exchange) solves this by issuing a derived token that carries both:

- **`sub`** — the human user the agent is acting for
- **`act`** — the agent's identity (the actor)

This creates a verifiable delegation chain: every downstream service can see "Agent X is acting on behalf of User Y."

### PingOne Three-Token Chain

```
1. User Access Token (AT)
   - Obtained via Authorization Code + PKCE
   - aud: enduser.ping.demo
   - Contains: may_act claim (which agent is authorized to act for this user)

2. Agent Access Token
   - Obtained via Client Credentials (agent authenticates autonomously)
   - aud: agentgateway.ping.demo
   - Contains: agent's own identity (client_id)

3. Exchanged MCP Token  (RFC 8693 token exchange)
   - subject_token: User AT (#1)
   - actor_token:   Agent AT (#2)
   - grant_type:    urn:ietf:params:oauth:grant-type:token-exchange
   - Returns: token with sub=user, act={sub:agent_client_id}
```

### Configuring the `act` Claim in PingOne

The `act` claim is set via a **Resource Attribute Mapping** on the target resource. The value must be a SpEL expression that:
1. Validates the actor token's `client_id` matches the user's `may_act.sub` (ensuring the user authorized this specific agent)
2. Returns the `may_act` object as `act` when valid, `null` otherwise

**Working null-safe SpEL expression (verified live):**

```
${(#root.context.requestData.actorToken != null
  and #root.context.requestData.subjectToken.may_act != null
  and #root.context.requestData.subjectToken.may_act.sub == #root.context.requestData.actorToken.client_id)
  ? #root.context.requestData.subjectToken.may_act
  : null}
```

**Critical syntax rules:**
- Use `${(...)}` wrapper — this triggers SpEL evaluation
- `#{...}` emits the expression as a literal string (common mistake)
- Bare expression without `${}` wrapper also emits as literal string
- `?.` null-safe navigation is NOT supported by PingOne's SpEL evaluator — use `and` short-circuit instead
- `${actor.client_id}` → `400 Bad Request` (invalid reference — cannot access actor token claims this way)

### Configuring the `may_act` Claim

The `may_act` claim records which agent a user has authorized to act on their behalf. Set it as a **User Attribute** or via a **Resource Attribute** mapping on the user resource.

**Critical syntax:**
- `${user.mayAct}` — evaluates to the stored JSON object ✅
- `#{user.mayAct}` — emits the literal string `#{user.mayAct}` ❌

### Agent App Grant Type Requirements

The AI agent application must have all three grant types enabled in PingOne:
- **Client Credentials** — for the agent's own autonomous authentication
- **Refresh Token** — for session management
- **Token Exchange** — for the RFC 8693 delegation exchange

PingOne console → Applications → [AI Agent App] → Grant Types → check all three.

### Per-User Delegation Enforcement (`ENFORCE_MAY_ACT`)

The project enforces that the `act` claim's `sub` matches the user's `may_act.sub` at the PingOne Authorize decision layer. Default: **on**. Kill-switch: `ENFORCE_MAY_ACT=false` in `demo_api_server/.env`.

When enforcement is on, agent calls where the actor is not the user's authorized delegate → **DENY**.

### What This Project Does

Native `act` claim emission is configured on all three resources (agentgateway, mcpgateway, mcpserver) using the working null-safe SpEL expression above. Actor bridging (X-Act-Client-Id / X-May-Act-Sub headers) covers both the HTTP `/mcp` path and the WebSocket upgrade path via the shared `mcpActorBridge` helper.

**Status: ✅ Fully implemented (PR #152)**

---

## 10. PingOne-Specific Gotchas & Common Mistakes

These are non-obvious behaviours in PingOne that have caused real issues in this project. Consider this section a "gotcha register" for future sessions.

---

### Gotcha 1: Worker Tokens Have Roles, Not Scopes

PingOne Worker client tokens (`client_credentials` for admin/management operations) do **not** carry OAuth scopes. Access to Management API resources is controlled entirely by the **Role** assigned to the Worker application, not by the scopes in the token.

**Effect:** Requesting specific scopes in a Worker CC token request has no effect. You cannot scope-limit a Worker token — you can only control access via the assigned role.

**Common mistake:** Trying to add Worker tokens to resource-based access control by adding scopes. It doesn't work.

---

### Gotcha 2: Introspection `401 invalid_client` ≠ Invalid Token

When PingOne returns `401 invalid_client` from `/as/introspect`, it means the **client authentication failed** — not that the token is invalid. The two failure modes look similar in logs but have different root causes:

| Error | Meaning |
|---|---|
| `401 invalid_client` | Wrong auth method, wrong secret, or wrong client |
| `200 { active: false }` | Client auth succeeded but token is inactive |

**Per-client auth methods in this project:**

- Worker `15881ac7-...` → `client_secret_basic` → `PINGONE_INTROSPECTION_AUTH_METHOD=basic` in BFF `.env`
- Gateway/authz `d3f8fead-...` → `client_secret_post` → keep `=post` in gateway and authz `.env`
- Each service reads its OWN `.env` — do not unify these

**Diagnose with curl:**

```bash
# Test basic auth (client_secret_basic)
curl -X POST https://auth.pingone.com/{envId}/as/introspect \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  --data-urlencode "token=garbage"

# Test post auth (client_secret_post)
curl -X POST https://auth.pingone.com/{envId}/as/introspect \
  -d "client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&token=garbage"
```

The method that returns `{ "active": false }` (HTTP 200) is the correct method for that client.

---

### Gotcha 3: SpEL Expression Wrapper — `${}` vs `#{}`

PingOne Resource Attribute value fields evaluate only expressions wrapped in `${(...)}`. See [Section 9 — Critical syntax rules](#configuring-the-act-claim-in-pingone) for the complete reference.

**Effect on `act` claim:** If you configure the `act` attribute with `#{...}` syntax, the token will contain the literal string `#{#root.context.requestData...}` instead of the delegation object. This looks like the attribute is set but produces a broken token.

**Effect on `may_act` claim:** Similarly, `#{user.mayAct}` produces the literal string `#{user.mayAct}` in the token. Use `${user.mayAct}`.

---

### Gotcha 4: `?.` Null-Safe Navigation is NOT Supported

PingOne's SpEL evaluator does **not** support the `?.` (null-safe navigation) operator from standard Spring SpEL. Using it causes a `400 Bad Request` response.

**Use `and` short-circuit instead.** Replace `${actorToken?.client_id}` with the null-safe expression from [Section 9](#configuring-the-act-claim-in-pingone).

`and` in Spring SpEL short-circuits: if `actorToken != null` is false, the rest of the expression is not evaluated. This is functionally equivalent to null-safe navigation.

---

### Gotcha 5: Single-Resource Scope Rule

An AI agent application in PingOne can have grants on **multiple resources** (e.g., the Agent Gateway resource and the Demo API resource). When requesting an access token, you can only request scopes from **one resource at a time**.

**Effect:** Requesting `scope=agent:invoke banking:read` where those scopes belong to different resources → `400 May not request scopes for multiple resources`.

**Fix:** Request a single-resource scope. Use `scope=agent:invoke` for the Agent Gateway token. Use a separate token request for Demo API scopes.

In this project, `pingone_ai_agent_actor_scope` must be set to a single-resource scope (e.g. `agent:invoke` for the Agent Gateway resource).

---

### Gotcha 6: `_cookie_session` Stub After Server Restart

When the server restarts with `CLEAR_SESSIONS_ON_BOOT=true` (default), all LMDB sessions are wiped. The browser still has the old session cookie. On the next request, the session middleware cannot find the session in LMDB.

A separate `authStateCookie` (httpOnly, set at login time) preserves basic identity across restarts. The session middleware detects this case and restores a stub session with `accessToken: '_cookie_session'` — enough to recognize the user but not to make API calls.

**Effect:** Any code path that requires a real bearer token (MCP calls, agent runs) will get `401 session_restore_required`. The user must log in again.

**This is the correct behaviour** — it prevents stale tokens from being used after a restart.

**To preserve sessions across restarts:** set `CLEAR_SESSIONS_ON_BOOT=false` in `.env`. The LMDB store will then serve the persisted sessions on startup.

---

### Gotcha 7: `active: false` ≠ `401` From Introspection

PingOne returns `HTTP 200` with `{ "active": false }` for an inactive token — not a `4xx` status. The HTTP status code alone tells you nothing about token validity.

Always check `response.data.active === true` in code, not just the HTTP status.

---

### Gotcha 8: Audience Validation Bypass When Env Var Is Unset

If `PINGONE_RESOURCE_BFF_URI` (and the fallback `ENDUSER_AUDIENCE`) are both absent from the environment, `BFF_RESOURCE_URI = null`. The audience validation middleware skips the check when `BFF_RESOURCE_URI` is null.

This means **any valid PingOne token** from any audience will be accepted by the BFF in a misconfigured deployment — a significant security gap.

**Mitigation:** Add a startup assertion that exits the process if `BFF_RESOURCE_URI` is null in production. Currently the code only warns.

---

## Quick Reference — PingOne Console Checklist

Use this checklist when setting up or auditing a PingOne environment for this pattern:

**Applications → [Demo User App] → Token Endpoint:**
- [ ] Access Token Lifetime: `900` (15 min) or less for production
- [ ] Refresh Token: **Enabled**
- [ ] Refresh Token Rotation: **Rotate On Each Use**
- [ ] Refresh Token Lifetime: matches intended session duration (e.g. 86400 for 24h)
- [ ] PKCE Enforcement: **Required**

**Applications → [AI Agent App] → Grant Types:**
- [ ] Client Credentials: **enabled**
- [ ] Refresh Token: **enabled**
- [ ] Token Exchange: **enabled**

**Resources → [User Resource] → Attribute Mappings:**
- [ ] `may_act` attribute value: `${user.mayAct}` (not `#{user.mayAct}`)

**Resources → [Agent Gateway Resource] / [MCP Gateway Resource] / [MCP Server Resource] → Attribute Mappings:**
- [ ] `act` attribute value: the null-safe SpEL expression (see Section 9)

**Sign-On Policies → [Policy] → Session Settings:**
- [ ] Session duration aligned with app session `maxAge` (24h)

**`.env` verification:**
- [ ] `SESSION_SECRET`: random 32+ character string
- [ ] `PINGONE_RESOURCE_BFF_URI` (or `ENDUSER_AUDIENCE`): set to `enduser.ping.demo`
- [ ] `PINGONE_INTROSPECTION_AUTH_METHOD=basic` in `demo_api_server/.env`
- [ ] `PINGONE_INTROSPECTION_AUTH_METHOD=post` in `demo_mcp_gateway/.env` and `demo_authz_server/.env`
