---
name: pingone-session-termination
description: 'Terminate active PingOne SSO sessions via Management API. USE FOR: logout flows that must kill PingOne sessions (not just revoke tokens), any flow needing DELETE /users/{userId}/sessions/{sessionId}. DO NOT USE FOR: STOP AGENT kill switch (token revocation only is correct there — see decision record below); OAuth login/token flows (use oauth-pingone); token-only revocation RFC 7009 (oauthService.revokeToken); MFA or user provisioning (use pingone-api-calls).'
argument-hint: 'Describe where you need session termination (e.g. logout handler)'
---

# PingOne Session Termination

## When to Use

- Implementing a logout flow that must forcibly kill the PingOne server-side SSO session (not just revoke tokens)
- Any flow needing `DELETE /users/{userId}/sessions/{sessionId}` via the Management API
- Coordinating multi-layer signout: protocol logout + session termination + token revocation + cookie cleanup

## When NOT to Use

- STOP AGENT kill switch — token revocation only is the correct behavior there; use `killSwitchService.js` directly
- OAuth login or token exchange flows — use `oauth-pingone` skill instead
- Token-only revocation per RFC 7009 — call `oauthService.revokeToken()` directly
- MFA device management or user provisioning — use `pingone-api-calls` skill instead

## Logout is a layered problem

A complete signout experience requires coordinating up to four distinct layers — they are related but not the same:

| Layer | What it does | This repo |
|---|---|---|
| 1. Protocol logout | Ends the PingOne auth session in the browser (OIDC signoff / SAML SLO) | `/as/signoff` redirect — already in both logout routes |
| 2. PingOne session termination | Forcibly deletes the server-side PingOne session record | `pingOneSessionService.js` `DELETE /sessions/{id}` |
| 3. Application-local session cleanup | Destroys the BFF Express session and clears cookies | `req.session.destroy()` + `clearAllAuthCookies()` |
| 4. Token revocation | Invalidates issued tokens at the authorization server | RFC 7009 — `oauthService.revokeToken()` |

**Key rule (from Ping documentation):** Use logout to end user session state; use token revocation when token invalidation is also required. They are separate controls — logout does not automatically revoke tokens, and token revocation does not end the SSO session.

**Cross-protocol note:** OIDC signoff does not propagate to SAML applications. In a mixed environment, a complete enterprise logout requires explicit coordination across all layers. This demo app is OIDC-only, so the four layers above cover the full signout.

## Decision record: which operation applies where

| Operation | STOP AGENT | Logout |
|---|---|---|
| RFC 7009 token revocation (access + refresh) | ✅ done in killSwitchService.js | ✅ done in logout routes |
| Management API session termination (`DELETE /sessions/{id}`) | ❌ not needed | ✅ done in logout routes |
| RP-initiated OIDC signoff (`/as/signoff` redirect) | ❌ not appropriate | ✅ done in logout routes |

**Why STOP AGENT does not terminate sessions:** The kill switch goal is to make the delegated MCP token immediately invalid. The user's SSO session remaining alive is intentional — they should still be able to log in and review what happened. Terminating the SSO session would log the user out of their browser as a side effect, which is worse UX with no additional security benefit in this context.

**Why logout needs all three:** Token revocation prevents the issued token from being used. Session termination ensures PingOne's SSO session is gone so the user cannot silently re-authenticate with a browser session cookie. The `/as/signoff` redirect cleans up the PingOne login page cookie in the user's browser.

## Service: `pingOneSessionService.js`

Located at `demo_api_server/services/pingOneSessionService.js`.

```javascript
const { terminateAllUserSessions, getUserSessions, terminateUserSessions } = require('../services/pingOneSessionService');
```

### `terminateAllUserSessions(userId)`

Reads all sessions then deletes each one. Best-effort — never throws.

```javascript
const result = await terminateAllUserSessions(pingOneUserId);
// result: { sessions_found: 2, terminated: 2, errors: [] }
```

Always wrap in try/catch in logout handlers (non-fatal):

```javascript
try {
  await terminateAllUserSessions(pingOneUserId);
} catch (_) { /* non-fatal — token revocation + signoff still cover logout */ }
```

### `getUserSessions(userId)`

Returns active sessions from `GET /users/{userId}/sessions`. Returns `[]` on 404 or error.

```javascript
const sessions = await getUserSessions('user-abc123');
// sessions: [{ id: 'session-xyz', createdAt: '2026-01-01T00:00:00Z' }, ...]
```

### `terminateUserSessions(userId, sessionIds)`

Deletes specific sessions in parallel. Returns count + errors array (never throws).

```javascript
const result = await terminateUserSessions('user-abc123', ['session-1', 'session-2']);
// result: { terminated: 2, errors: [] }
```

## PingOne Management API endpoints

```
GET    https://api.pingone.{region}/v1/environments/{envId}/users/{userId}/sessions
DELETE https://api.pingone.{region}/v1/environments/{envId}/users/{userId}/sessions/{sessionId}
```

**GET response shape:**
```json
{
  "_embedded": {
    "sessions": [
      { "id": "session-abc123", "createdAt": "2026-01-01T00:00:00Z" }
    ]
  }
}
```

**DELETE:** Returns `204 No Content`. Returns `404` if session already gone (treat as success).

**Auth:** `Authorization: Bearer {worker-token}` — client_credentials from the worker app.

**Signoff variant (graceful):** PingOne also provides a graceful sign-off endpoint:
```
GET https://api.pingone.{region}/v1/environments/{envId}/sessions/{sessionId}/signoff
```
This triggers a graceful sign-off notification (PingOne emits session-end events to connected apps) rather than a hard delete. Use DELETE for forced termination on logout; use the signoff variant when you want PingOne to propagate the logout event to other RPs in the SSO federation. For this demo app, DELETE is used.

## Worker token config keys

```javascript
const configStore = require('./configStore');
const region       = configStore.getEffective('pingone_region') || 'com';
const envId        = configStore.getEffective('pingone_environment_id');
const clientId     = configStore.getEffective('pingone_worker_token_client_id');
const clientSecret = configStore.getEffective('pingone_worker_token_client_secret');
// Token endpoint: https://auth.pingone.{region}/{envId}/as/token
// API base:       https://api.pingone.{region}/v1/environments/{envId}
```

## Complete logout sequence (correct order)

1. Read `accessToken`, `refreshToken`, `idToken`, `userId` from `req.session`
2. Revoke `accessToken` + `refreshToken` via RFC 7009 (fire-and-forget, non-fatal)
3. **`await terminateAllUserSessions(userId)`** ← this service
4. `req.session.destroy()` — removes BFF Express session
5. Redirect to PingOne `/as/signoff?id_token_hint=...` — RP-initiated logout, clears PingOne browser cookie

Steps 2–3 are both best-effort (try/catch, non-fatal). Steps 4–5 are the hard guarantees that end the browser session.

## Where it's wired in this repo

| Callsite | File | Purpose |
|---|---|---|
| Admin logout | `routes/oauth.js` GET /logout | Before `session.destroy()` |
| User logout | `routes/oauthUser.js` GET /logout | Before `session.destroy()` |

## When to add more layers

If the demo ever adds **widget-based or SDK-based** integrations: the underlying logout protocol doesn't change — widget/SDK affect delivery, not the PingOne session model. The same four layers still apply.

If the demo ever adds **SAML applications**: OIDC signoff alone won't log the user out of SAML RPs. A broader signout would need SAML SLO coordination in addition to the four layers above.

For **helpdesk-forced signout, fraud response, or forced reauthentication** scenarios: all four layers should fire, plus `disableUserAtPingOne()` in `killSwitchService.js` (prevents re-authentication entirely until re-enabled).

## Public documentation

- [Signoff endpoint](https://developer.pingidentity.com/pingone-api/auth/openid-connect-oauth-2/signoff.html)
- [Token Revocation](https://developer.pingidentity.com/pingone-api/auth/openid-connect-oauth-2/token-revocation.html)
- [Sessions and Logout](https://developer.pingidentity.com/pingone-api/workflow-library/platform-sso-and-authorization/sessions-and-logout.html)
- [PingOne docs index (llms.txt)](https://docs.pingidentity.com/pingone/llms.txt) — machine-readable index of every PingOne doc page. Append `.md` to any `docs.pingidentity.com/pingone/...` URL to fetch it as raw markdown. Pull current, authoritative session/sign-off docs this way.
