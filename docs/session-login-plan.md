# Super Banking — Session & Login Reliability Plan

_Last updated: 2026-03-27_

---

## How the auth flow works today

```
PingOne ──PKCE callback──► BFF (Vercel Lambda A)
                              │
                              ├─ save session → Upstash Redis  (async, ~50–200ms)
                              ├─ set _auth cookie              (signed, user identity, no tokens)
                              └─ redirect → /dashboard?oauth=success
                                               │
                              React App.js ────┘
                              1. GET /api/auth/oauth/status     ← may land on Lambda B
                              2. GET /api/auth/oauth/user/status
                              3. GET /api/auth/session          (fallback)
                              All read session from Upstash ← write may not have arrived yet
                              FAIL → retry 450ms → 950ms → 1900ms → 3000ms
                              PASS on retry once Upstash catches up
```

**Localhost**: single process, no cold starts, `SameSite=lax` cookies.
Sessions in MemoryStore (lost on restart). Retry loop never fires.

**Vercel**: N stateless Lambda instances, `SameSite=none` cookies required for
cross-origin OAuth callback. Sessions in Upstash REST API. The race between Lambda A's
Redis write and Lambda B's Redis read is the core reliability problem.

---

## Session store by environment

| Component | Local dev | Vercel production |
|---|---|---|
| **Session store** | MemoryStore (ephemeral) | Upstash REST + in-process cache (45s TTL, 100 entries) |
| **Cookie `secure`** | `false` | `true` (HTTPS only) |
| **Cookie `sameSite`** | `lax` | `none` (cross-origin OAuth) |
| **PKCE state/nonce** | Session + `_pkce` cookie (15 min) | Same — cookie is fallback if Lambda hops |
| **Token storage** | Session memory | Upstash (no access token in cookie) |
| **Logout** | RP-Initiated → PingOne signoff | Same |
| **Session loss recovery** | N/A (single process) | `_auth` cookie + App.js retry (4 attempts, ~6.3s) |

### `_auth` cookie (signed, HMAC-SHA256)

Set immediately after successful OAuth callback. Contains:

```
{ userId, email, firstName, lastName, role, oauthType, expiresAt }
```

**Does NOT contain tokens** (too large, sensitive). Allows the BFF to restore the
user identity on a cold-started Lambda instance that doesn't yet have the session in
its local cache — but the user will have no `accessToken`, so banking agent calls fail
silently until the Upstash read catches up.

---

## Known failure modes

| Failure | Cause | Current handling |
|---|---|---|
| Session not found after callback | Lambda B reads Upstash before Lambda A's write propagates | App.js 4-retry loop (6.3s window) |
| `_auth` cookie restore, no tokens | Cold-started instance serves user info but has no tokens | `cookieOnlyBffSession: true` flag — UI currently silent |
| Circuit breaker OPEN | 3+ Upstash failures → in-memory cache only | New sessions get cookie-only restore; old sessions served from cache (45s) |
| Access token expired | PingOne 1-hour default expiry | No refresh — banking API returns 401, agent fails silently |
| Session regeneration fails (Vercel) | Cold-start TCP race in `req.session.regenerate()` | Non-fatal, continues with old session ID (session fixation risk) |
| `invalid_state` | Session or PKCE cookie missing on callback | Redirect to `/login?error=invalid_state` |
| `nonce_mismatch` | ID token nonce ≠ stored nonce | Redirect to `/login?error=nonce_mismatch` |
| `session_persist_failed` | `req.session.save()` throws | Destroy session, redirect to `/login?error=session_persist_failed` |
| Localhost restart | MemoryStore wiped | User must log in again |

---

## Prioritised fixes

### P0 — Implement now (session unreliability in prod)

#### 1. Add 4th retry in App.js
**File:** `banking_api_ui/src/App.js`

```js
// Before (3 retries, 3.3s total)
const retryDelays = [450, 950, 1900];

// After (4 retries, 6.3s total)
const retryDelays = [450, 950, 1900, 3000];
```

**Why:** Upstash REST latency spikes to 600ms+ on cold starts under load.
An extra retry adds 3s of budget at minimal UX cost.

---

#### 2. Token refresh middleware before banking/MCP routes
**File:** `banking_api_server/server.js`

```js
async function refreshIfExpired(req, res, next) {
  const tokens = req.session.oauthTokens;
  if (!tokens) return next();

  const expiresInMs = tokens.expiresAt - Date.now();
  if (expiresInMs > 5 * 60 * 1000) return next(); // still valid, skip

  try {
    const refreshed = await refreshAccessToken(tokens.refreshToken, req.session.oauthType);
    req.session.oauthTokens = refreshed;
    await req.session.save();
    next();
  } catch (err) {
    req.session.destroy(() => {});
    res.status(401).json({ error: 'session_expired', message: 'Please log in again.' });
  }
}

app.use(['/api/mcp', '/api/banking'], refreshIfExpired);
```

**Why:** `accessToken` expires in 1 hour (PingOne default). Without refresh, all
banking agent calls silently fail while the user appears logged in.

---

### P1 — This week (user-facing breakage)

#### 3. Force Upstash re-fetch on `_auth` cookie restore
**File:** `banking_api_server/server.js`

After the existing `_auth` cookie restore middleware, add:

```js
app.use(async (req, res, next) => {
  if (req.session.user && req.session._cookieOnlyRestore && !req.session.oauthTokens) {
    try {
      const stored = await sessionStore.getAsync(req.sessionID);
      if (stored?.oauthTokens) {
        Object.assign(req.session, stored);
        req.session._cookieOnlyRestore = false;
        await req.session.save();
      }
    } catch (_) { /* non-fatal */ }
  }
  next();
});
```

**Why:** The `_auth` restore path leaves the user with no tokens. Proactively
re-fetching from Upstash (which may have the session now that the write has settled)
restores full session capability without requiring user action.

---

#### 4. Show "Reconnecting…" in BankingAgent when session is token-less
**File:** `banking_api_ui/src/components/BankingAgent.js`

When `/api/auth/session` returns `cookieOnlyBffSession: true`, display a visible
reconnecting state in the agent panel instead of silently failing:

```jsx
{cookieOnlySession && (
  <div className="ba-reconnecting">
    🔄 Reconnecting to your session…
  </div>
)}
```

Poll `/api/auth/session` every 2s for up to 10s; once `cookieOnlyBffSession` is
false, clear the banner and re-enable the action buttons.

**Why:** Users currently see no feedback when the agent fails due to a cookie-only
restore. This turns a confusing silent failure into a clear transient state.

---

### P2 — Next sprint (demo quality)

#### 5. Admin ↔ Customer role switch endpoint

Enables demos without a full logout/login cycle.

**New endpoint:** `POST /api/auth/switch`

```
Request body: { targetRole: 'admin' | 'customer' }

Steps:
  1. Store current session tokens in Upstash under key
     sessions:prev:{userId} (TTL 60s grace period)
  2. Clear req.session.oauthTokens and req.session.user
  3. Set switch_target cookie ('admin' | 'user')
  4. Return { redirectUrl: <PingOne authorize URL for target role> }

On callback (detect switch_target cookie):
  5. Complete normal OAuth callback
  6. Remove switch_target cookie
  7. Redirect to correct dashboard (/admin or /dashboard)
  8. Schedule revocation of prev session tokens after 60s
```

**UI change:** Add a "Switch to [Admin/Customer] view" button in the dashboard
header, visible only when the user has multiple roles configured.

---

#### 6. Local dev persistent sessions (optional)

**File:** `banking_api_server/server.js`

```js
// Add to .env.local:
LOCAL_REDIS_URL=redis://127.0.0.1:6379
```

The existing `redisWireUrl.js` already resolves this env var. No code change needed —
just document it in the developer setup guide and start a local Redis instance via
Docker:

```bash
docker run -d -p 6379:6379 redis:7-alpine
```

**Why:** Eliminates "please log in again" after every local server restart.

---

### P3 — Later (architecture)

#### 7. Move MCP server off Vercel (no cold-start guarantee)

The `banking_mcp_server` uses persistent WebSocket connections. Vercel serverless
functions have a 10s timeout (Pro: 60s) and no persistent process. This means WebSocket
connections are dropped on every Lambda recycle.

**Fix:** Deploy MCP server to Railway, Render, or Fly (persistent process).
The `vercel-banking` skill has deployment patterns. Already documented in the MCP
server README.

#### 8. Session fixation on regeneration failure

The non-fatal path in `oauth.js` where `req.session.regenerate()` fails on Vercel
and continues with the same session ID is a session fixation vulnerability. Fix:

```js
// In oauth.js callback handler — if regenerate fails, abort instead of continuing
if (regenerateError) {
  return res.redirect('/login?error=session_regenerate_failed');
}
```

Accept the small UX cost (user retries login once) in exchange for eliminating the
attack surface.

---

## Implementation checklist

```
P0
[x] App.js — add 4th retry delay: retryDelays = [450, 950, 1900, 3000]
[x] server.js — add refreshIfExpired middleware before /api/mcp and /api/banking
[x] Run npm run test:e2e:quality && npm run test:api-server
[x] Deploy to Vercel preview, test PingOne login → banking agent chat

P1
[x] server.js — add Upstash re-fetch middleware after _auth cookie restore
[x] BankingAgent.js — add cookieOnlySession reconnecting banner + 2s poll
[x] Test: simulate cold-start by clearing in-process cache, verify banner shows/clears

P2
[x] server.js — POST /api/auth/switch endpoint
[x] Dashboard UI — "Switch role" button (hidden unless multiple roles configured)
[x] Test: switch admin → customer → back, verify both sessions intact

P3
[x] MCP server — confirm Railway deployment, document steps
[x] oauth.js — make session.regenerate() failure fatal (abort login, don't continue)
```

---

## Files to change (by priority)

| File | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| `banking_api_ui/src/App.js` | retryDelays | — | — | — |
| `banking_api_server/server.js` | refreshIfExpired middleware | Upstash re-fetch | switch endpoint | regenerate fatal |
| `banking_api_ui/src/components/BankingAgent.js` | — | reconnecting banner | switch button | — |
| `banking_api_server/routes/oauth.js` | — | — | switch callback | regenerate fatal |
| `banking_api_server/routes/oauthUser.js` | — | — | switch callback | — |

---

## Reference: session endpoints

| Endpoint | Purpose | Returns tokens? |
|---|---|---|
| `GET /api/auth/oauth/status` | Admin OAuth session check | No (BFF pattern) |
| `GET /api/auth/oauth/user/status` | End-user OAuth session check | No |
| `GET /api/auth/session` | Generic fallback (any auth type) | No; `cookieOnlyBffSession` flag |
| `POST /api/auth/clear-session` | Belt-and-suspenders session destroy on logout return | — |
| `GET /api/auth/logout` | RP-Initiated Logout → PingOne signoff | — |
