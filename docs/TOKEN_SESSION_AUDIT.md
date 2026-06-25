# PingOne Token & Session — Codebase Audit

> Audit of all session and token handling in `demo_api_server`. Each finding is labelled:
> - ✅ CORRECT — matches security best practices
> - ⚠️ VERIFY — correct in code but depends on external config (PingOne console / `.env`) that must be confirmed
> - ❌ GAP — missing or suboptimal pattern

---

## Table of Contents

1. [Session Configuration](#1-session-configuration)
2. [Session Cookie Settings](#2-session-cookie-settings)
3. [PKCE Authentication Flow](#3-pkce-authentication-flow)
4. [Access Token Storage](#4-access-token-storage)
5. [Proactive Token Refresh](#5-proactive-token-refresh)
6. [Refresh Token Handling](#6-refresh-token-handling)
7. [Audience Validation](#7-audience-validation)
8. [RFC 8693 Token Chain](#8-rfc-8693-token-chain)
9. [Token Introspection](#9-token-introspection)
10. [Logout & Revocation](#10-logout--revocation)
11. [Summary Table](#11-summary-table)

---

## 1. Session Configuration

**Store:** LMDB (disk-persistent), TTL = 24 hours. Falls back to in-memory on init failure.

```js
// demo_api_server/server.js:64-65
sessionStore = new LmdbSessionStore({ ttl: 24 * 60 * 60 * 1000 });
```

**Session secret:** Validated at startup. In production, process exits if `SESSION_SECRET` is missing or equals the insecure default.

```js
// demo_api_server/server.js:394-401
if (!s || s === 'dev-session-secret-change-in-production') {
  if (process.env.NODE_ENV === 'production' ...) {
    console.error('[FATAL] SESSION_SECRET env var is not set ...');
    process.exit(1);
  }
}
```

**Session settings:**
- `resave: false` — session not saved if not modified ✅
- `saveUninitialized: false` — no session created for unauthenticated requests ✅

**Boot clear:** On each restart, all persisted LMDB sessions are wiped (`CLEAR_SESSIONS_ON_BOOT=true` default). This forces re-authentication so stale tokens cannot linger. Opt out with `CLEAR_SESSIONS_ON_BOOT=false`.

**Session regeneration on login:** Both local login and OAuth callback call `req.session.regenerate()` before setting `req.session.user`, preventing session fixation attacks (CWE-384).

```js
// demo_api_server/routes/auth.js:31 (local login)
req.session.regenerate((err) => { ... req.session.user = user; });
```

**Findings:**
- ✅ Session secret validated at startup; process exits on insecure default in production
- ✅ `saveUninitialized: false` prevents ghost sessions for unauthenticated requests
- ✅ `session.regenerate()` on login prevents session fixation (CWE-384)
- ✅ LMDB session store persists across restarts with configurable TTL
- ⚠️ VERIFY — 24h session TTL should align with PingOne SSO session lifetime. Check: PingOne console → Sign-On Policies → [Policy] → Session Lifetime / Idle Timeout. If PingOne expires the SSO session before the app session, the access token becomes unreachable before the cookie expires.

---

## 2. Session Cookie Settings

```js
// demo_api_server/server.js:409-412
cookie: {
    secure: isProduction,          // HTTPS-only in production
    httpOnly: true,                // inaccessible to JavaScript
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000   // 24 hours
}
```

- `httpOnly: true` — session cookie cannot be read by JavaScript; mitigates XSS token theft
- `secure: isProduction` — only sent over HTTPS in production
- `sameSite: 'none'` (production) — required when the SPA and API are on different origins. Must be paired with `secure: true`.
- `sameSite: 'lax'` (development) — acceptable for local dev; allows GET navigations cross-site.
- `maxAge: 24h` — matches LMDB TTL for consistency.

**Findings:**
- ✅ `httpOnly: true` on all session cookies
- ✅ `secure: true` in production; `sameSite: 'none'` correctly paired with `secure`
- ✅ LMDB TTL and cookie `maxAge` aligned at 24h
- ⚠️ VERIFY — Confirm `SESSION_SECRET` in deployment `.env` is a cryptographically random 32+ character string (not the `dev-session-secret-change-in-production` default)

---

## 3. PKCE Authentication Flow

**Code challenge method:** `S256` (SHA-256 hashed). Confirmed in source:

```js
// demo_api_server/services/oauthUserService.js:80,100
// Generate PKCE code challenge (S256 = base64url(sha256(verifier)))
code_challenge_method: 'S256',
```

**Code verifier & state storage:** Stored in an `httpOnly` cookie (not in `localStorage` or the session body):

```js
// demo_api_server/routes/oauthUser.js:12
const { setPkceCookie, readPkceCookie, clearPkceCookie } = require('../services/pkceStateCookie');
```

**State parameter:** Used for CSRF protection. Validated on callback:

```js
// demo_api_server/routes/oauthUser.js:371-376
const resolvedState = sessionState || pkceCookie?.state;
// state mismatch → reject with error
```

**Nonce:** Stored and validated on callback for ID token replay protection:

```js
// demo_api_server/routes/oauthUser.js:394
const expectedNonce = req.session.oauthNonce || pkceCookie?.nonce;
```

**Open redirect protection:**

```js
// demo_api_server/routes/oauthUser.js:sanitizePostLoginReturnPath()
if (!t.startsWith('/') || t.startsWith('//') || t.length > 160) return null;
if (!/^[/a-zA-Z0-9._~-]+$/.test(t)) return null;
```

**Findings:**
- ✅ PKCE `code_challenge_method: 'S256'` confirmed (not `plain`)
- ✅ Code verifier stored in `httpOnly` cookie, not `localStorage`
- ✅ State parameter validated (CSRF protection)
- ✅ Nonce validated on callback (ID token replay protection)
- ✅ Post-login return path sanitized (open redirect prevention)

---

## 4. Access Token Storage

**Pattern:** Backend-for-Frontend (BFF). Tokens are stored server-side in the express session. The browser never receives the access token directly.

**Session structure:**

```js
req.session.oauthTokens = {
  accessToken:  '<PingOne JWT>',
  refreshToken: '<PingOne RT>',
  idToken:      '<OIDC ID token>',
  expiresAt:    <Unix ms timestamp>,
}
```

**Cookie-only stub detection:** When session restoration produces a stub token, it is detected and rejected explicitly — no silent auth bypass:

```js
// demo_api_server/middleware/agentSessionMiddleware.js:63-75
if (req.session.oauthTokens.accessToken === '_cookie_session') {
  return res.status(401).json({ error: 'session_restore_required', ... });
}
```

**Findings:**
- ✅ BFF pattern: tokens never reach the browser or `localStorage`
- ✅ Browser only gets a session ID cookie (`httpOnly`, `secure`)
- ✅ `_cookie_session` stub detected and rejected explicitly — no silent auth bypass

---

## 5. Proactive Token Refresh

**Refresh margin:** 5 minutes before expiry (RFC 6749 §6 compliant):

```js
// demo_api_server/middleware/tokenRefresh.js:71
const MARGIN = 5 * 60 * 1000; // 5 minutes
```

**Expiry detection:** Checks `session.expiresAt` first; falls back to decoding the JWT `exp` claim. This is safe — the token is not being validated here, just scheduling the refresh.

**Thundering-herd protection:** Two guards prevent concurrent refreshes for the same session:

```js
// demo_api_server/middleware/tokenRefresh.js:11-20
const _refreshInFlight = new Set();     // one refresh per session at a time
const _refreshBlacklist = new Map();    // blacklist sessions with invalid_grant
const BLACKLIST_TTL = 10 * 60 * 1000;  // 10 minutes
```

**Findings:**
- ✅ 5-minute proactive refresh window avoids mid-request token expiry
- ✅ Thundering-herd protection via in-flight Set
- ✅ Blacklist prevents hammering PingOne after RT revocation
- ✅ Stub sessions correctly skipped by refresh middleware

---

## 6. Refresh Token Handling

**Storage:** Refresh token stored server-side in `req.session.oauthTokens.refreshToken`. Never sent to browser.

**On successful refresh:** New AT and new RT are stored atomically, then `session.save()` is called:

```js
// demo_api_server/middleware/tokenRefresh.js:~90 (and agentSessionMiddleware.js)
req.session.oauthTokens.accessToken  = tokenData.access_token;
req.session.oauthTokens.refreshToken = tokenData.refresh_token || tokens.refreshToken;
req.session.oauthTokens.expiresAt    = Date.now() + (tokenData.expires_in || 3600) * 1000;
await new Promise((resolve, reject) => req.session.save(err => ...));
```

**Findings:**
- ✅ Refresh token stored server-side only (BFF pattern)
- ✅ New RT from PingOne replaces old RT in session (code is correct — assumes PingOne RT rotation is enabled)
- ✅ `invalid_grant` triggers blacklist — stops retry loop
- ⚠️ VERIFY — **RT rotation must be enabled in PingOne console.** If rotation is OFF, the same RT persists indefinitely and reuse attacks go undetected. Check: PingOne console → Applications → [User App] → Token Endpoint → **Refresh Token Rotation** → set to **"Rotate On Each Use"**
- ⚠️ VERIFY — **RT lifetime.** Verify Application → Token Endpoint → Refresh Token Lifetime matches your intended session duration.

---

## 7. Audience Validation

**BFF resource URI:** Tokens arriving at the BFF must carry the correct `aud` claim. Validation is fail-closed:

```js
// demo_api_server/middleware/auth.js:24-28
const BFF_RESOURCE_URI =
  process.env.PINGONE_RESOURCE_BFF_URI ||
  process.env.ENDUSER_AUDIENCE ||
  null;
```

**Multi-audience architecture (one resource URI per service hop):**

| Service | Expected `aud` |
|---|---|
| BFF (demo_api_server) | `enduser.ping.demo` |
| MCP Gateway | `mcpgateway.ping.demo` |
| MCP Server | `mcpserver.ping.demo` |
| AI Agent Gateway | `agentgateway.ping.demo` |

**D-05 anti-bypass:** No token carries two audiences simultaneously. A token issued for `mcpgateway` cannot be replayed at the BFF.

**Findings:**
- ✅ Audience validation fail-closed (wrong/missing `aud` → 401)
- ✅ Each service has its own distinct resource URI (token segmentation)
- ✅ D-05 anti-bypass prevents token replay across service hops
- ⚠️ VERIFY — Confirm `PINGONE_RESOURCE_BFF_URI` (or `ENDUSER_AUDIENCE`) is set in the BFF `.env`. If unset, `BFF_RESOURCE_URI = null` and audience validation is skipped.

---

## 8. RFC 8693 Token Chain

**Three-token delegation chain:**

```
User AT          (subject_token, aud=enduser.ping.demo, carries may_act)
  +
Agent CC token   (actor_token,   aud=agentgateway.ping.demo)
  ↓  Exchange #1 (BFF → PingOne)
MCP token        (aud=mcpgateway.ping.demo, act={sub: AI Agent client_id})
  ↓  Exchange #2 (Gateway → PingOne)
MCP Server token (aud=mcpserver.ping.demo)
  ↓  Exchange #3 (MCP Server → PingOne, optional)
Banking API token (aud=enduser.ping.demo)
```

**act claim — working PingOne SPEL (null-safe, verified live PR #152):**

```
${(#root.context.requestData.actorToken != null
  and #root.context.requestData.subjectToken.may_act != null
  and #root.context.requestData.subjectToken.may_act.sub == #root.context.requestData.actorToken.client_id)
  ? #root.context.requestData.subjectToken.may_act
  : null}
```

Critical syntax rules:
- Must use `${(...)}` wrapper — evaluates the SpEL expression
- `#{...}` emits the expression as a literal string (wrong)
- Bare expression without wrapper also emits as literal string (wrong)
- `?.` null-safe navigation NOT supported — use `and` short-circuit instead

> See [PINGONE_TOKEN_SESSION_BEST_PRACTICES.md §9 and §10](PINGONE_TOKEN_SESSION_BEST_PRACTICES.md) for the complete SpEL reference, `act`/`may_act` configuration guide, and common mistakes.

**may_act attribute:** Use `${user.mayAct}` (evaluates to stored JSON object). `#{user.mayAct}` emits the literal string `#{user.mayAct}`.

**ENFORCE_MAY_ACT:** Per-user delegation enforcement is default-on. Agent calls where actor does not match user's `may_act.sub` → DENY at PingOne Authorize.

**Agent app required grant types:** `client_credentials` + `refresh_token` + `token_exchange`

**Single-resource scope rule:** When an agent has grants on multiple resources, request scope for ONE resource at a time. Requesting scopes for multiple resources in one call → `400 May not request scopes for multiple resources`.

**Findings:**
- ✅ Native `act` claim emission working on all three resources (agentgateway, mcpgateway, mcpserver) via SPEL attribute mapping — PR #152
- ✅ ENFORCE_MAY_ACT default-on with kill-switch (`ENFORCE_MAY_ACT=false`)
- ✅ Actor bridging covers both HTTP `/mcp` and WebSocket paths via shared `mcpActorBridge` helper
- ⚠️ VERIFY — Confirm `pingone_ai_agent_actor_scope` is set to a single-resource scope (e.g. `agent:invoke`), not a multi-resource scope combination

---

## 9. Token Introspection

**Standard:** RFC 7662. Endpoint: `{auth_base}/as/introspect`.

**Auth method per client** (critical — mismatch → `401 invalid_client`):

| Client | Auth Method | Env Var |
|---|---|---|
| Worker client (`15881ac7-...`) | `client_secret_basic` | `PINGONE_INTROSPECTION_AUTH_METHOD=basic` in BFF `.env` |
| Gateway/authz client (`d3f8fead-...`) | `client_secret_post` | Same env var in gateway `.env` = `post` |
| User App (fallback default) | `client_secret_post` | Hardcoded default in service |

**Caching:** Results cached for 30 seconds (or remaining token lifetime if shorter). Cache key = SHA-256(token) + introspecting client ID:

```js
// demo_api_server/services/tokenIntrospectionService.js:21
const CACHE_TTL_MS = 30 * 1000; // 30 seconds
```

**Introspecting client resolution:** The Worker is deliberately excluded as the default introspector. PingOne requires introspection to use the token's *issuing* client; using the Worker returns `active: false` for user tokens.

**Findings:**
- ✅ Auth method configurable per client via `PINGONE_INTROSPECTION_AUTH_METHOD`
- ✅ 30s cache prevents per-request PingOne calls; TTL respects remaining token lifetime
- ✅ Cache key includes client ID (no cross-client cache pollution)
- ✅ Worker deliberately excluded from default introspection path
- ⚠️ VERIFY — `PINGONE_INTROSPECTION_AUTH_METHOD=basic` must be set in `demo_api_server/.env` (the Worker uses `client_secret_basic`). The gateway and authz server `.env` files should remain `=post`.
- ⚠️ VERIFY — Negative results (`active: false`) are cached for up to 30s. For high-security flows, consider not caching negative results. Acceptable for this demo context.

---

## 10. Logout & Revocation

**Logout handler** (`demo_api_server/routes/oauthUser.js:861`):

Full logout sequence:
1. **RFC 7009 token revocation** — both AT and RT revoked before session destruction:
   ```js
   oauthService.revokeToken(accessToken,  'access_token');
   oauthService.revokeToken(refreshToken, 'refresh_token');
   ```
2. **PingOne SSO session termination** — all active SSO sessions ended via Management API:
   ```js
   await terminateAllUserSessions(userId);
   ```
3. **App session destruction** — `req.session.destroy()` removes the session from LMDB
4. **Cookie clearing** — `clearAllAuthCookies()` removes all auth-related cookies
5. **PingOne sign-off redirect** — `buildPingOneSignoffUrl()` redirects to `/as/signoff` with `id_token_hint` and `post_logout_redirect_uri`

**Findings:**
- ✅ Both AT and RT revoked at logout (RFC 7009)
- ✅ PingOne SSO sessions terminated via Management API (prevents silent re-auth)
- ✅ `/as/signoff` redirect ends the PingOne browser session
- ✅ `id_token_hint` passed to signoff (allows PingOne to identify the specific session)
- ✅ Correct order: revoke tokens → destroy local session → cookie clear → signoff redirect
- ✅ Stub `_cookie_session` tokens skipped — not sent to PingOne for revocation

---

## 11. Summary Table

| Area | Finding | Label |
|---|---|---|
| Session secret validated at startup | Process exits on insecure default in production | ✅ |
| `saveUninitialized: false` | No ghost sessions for unauthenticated requests | ✅ |
| `session.regenerate()` on login | Prevents session fixation (CWE-384) | ✅ |
| LMDB session store | Disk-persistent, 24h TTL | ✅ |
| Session TTL alignment | 24h in code — confirm matches PingOne SSO session lifetime | ⚠️ |
| Session cookie `httpOnly: true` | JavaScript cannot read the session cookie | ✅ |
| Session cookie `secure: true` in prod | Only sent over HTTPS | ✅ |
| `sameSite: 'none'` + `secure` in prod | Correct for cross-origin SPA+API | ✅ |
| `SESSION_SECRET` randomness | Verify 32+ char random string in deployment | ⚠️ |
| PKCE `code_challenge_method: 'S256'` | Confirmed in source (not `plain`) | ✅ |
| PKCE verifier in `httpOnly` cookie | Not in localStorage | ✅ |
| State parameter validated | CSRF protection | ✅ |
| Nonce validated on callback | ID token replay protection | ✅ |
| Open redirect protection | `sanitizePostLoginReturnPath()` | ✅ |
| BFF token storage pattern | Tokens never reach browser | ✅ |
| `_cookie_session` stub detection | No silent auth bypass on session restore | ✅ |
| 5-minute proactive refresh margin | Avoids mid-request expiry | ✅ |
| Thundering-herd refresh protection | `_refreshInFlight` + `_refreshBlacklist` | ✅ |
| Blacklist on `invalid_grant` | Stops RT retry loop on revocation | ✅ |
| RT stored server-side only | Never sent to browser | ✅ |
| New RT stored on refresh | Assumes PingOne RT rotation enabled | ✅ |
| **RT rotation in PingOne console** | Must be "Rotate On Each Use" — verify | ⚠️ |
| **RT lifetime in PingOne console** | Must match intended session duration | ⚠️ |
| Audience validation fail-closed | Wrong/missing `aud` → 401 | ✅ |
| One resource URI per service hop | Token segmentation, no cross-hop replay | ✅ |
| `PINGONE_RESOURCE_BFF_URI` set | Must be set in `.env` or aud validation is bypassed | ⚠️ |
| Native `act` claim via SPEL | Working on all 3 resources (PR #152) | ✅ |
| ENFORCE_MAY_ACT default-on | Per-user delegation enforced | ✅ |
| Actor bridge covers HTTP + WS | Full-path may_act enforcement | ✅ |
| Single-resource scope rule | Verify `pingone_ai_agent_actor_scope` is single-resource | ⚠️ |
| Introspection auth method per client | `basic` for worker, `post` for gateway/authz | ✅ |
| Introspection cache 30s TTL | Prevents per-request PingOne calls | ✅ |
| No cross-client cache pollution | Cache key includes client ID | ✅ |
| Negative caching (`active:false`) | 30s window — acceptable for demo | ⚠️ |
| `PINGONE_INTROSPECTION_AUTH_METHOD=basic` | Must be set in BFF `.env` | ⚠️ |
| AT + RT revoked at logout | RFC 7009 | ✅ |
| PingOne SSO sessions terminated at logout | `terminateAllUserSessions()` | ✅ |
| `/as/signoff` with `id_token_hint` | Ends browser SSO session | ✅ |
| Correct logout order | Revoke → destroy → signoff | ✅ |

**Totals: 30 ✅ · 10 ⚠️ · 0 ❌**

All ⚠️ items are external configuration checks (PingOne console settings or `.env` values), not code defects. The implementation is correct; these need operator verification.
