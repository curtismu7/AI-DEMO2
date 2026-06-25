# PingOne Session Termination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PingOne server-side session termination (Management API `DELETE /users/{userId}/sessions/{sessionId}`) to the user logout flow, and create a reusable `pingone-session-termination` skill documenting all three session management options.

**Architecture:** Token revocation (RFC 7009) alone does not end the PingOne SSO session — the user can silently re-authenticate without re-entering credentials. The STOP AGENT kill switch intentionally only revokes tokens (its goal is to invalidate the delegated token, not log the user out). Logout, however, should do the full sequence: revoke tokens + terminate PingOne session + RP-initiated signoff redirect. A new `pingOneSessionService.js` wraps the two Management API calls (`GET /sessions` → `DELETE /sessions/{id}`) using the existing worker-app pattern from `pingOneUserService.js`. It plugs into both logout routes (admin and user). The STOP button is **not changed** — token revocation is correct and intentional there.

**Tech Stack:** Node.js/CommonJS, `axios`, PingOne Management API (`api.pingone.{region}/v1`), worker client_credentials token

---

## Decision record: what each operation applies to

| Operation | STOP AGENT | Logout |
|---|---|---|
| RFC 7009 token revocation (access + refresh) | ✅ already done | ✅ already done |
| PingOne Management API session termination (`DELETE /sessions/{id}`) | ❌ not needed — goal is token invalidity, not full logout | ✅ **adding this** |
| RP-initiated OIDC signoff (`/as/signoff` redirect) | ❌ not appropriate for agent stop | ✅ already done |

**Why STOP doesn't need session termination:** The kill switch is an AI safety control — its goal is to make the delegated MCP token immediately invalid at PingOne. The user's SSO session being alive is correct behaviour; the user should still be able to log in and review what happened. Session termination on STOP would log the user out of their browser, which is a worse UX without a security benefit in this context.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `demo_api_server/services/pingOneSessionService.js` | All PingOne session read/terminate logic |
| Modify | `demo_api_server/routes/oauth.js` | Call session termination in admin logout |
| Modify | `demo_api_server/routes/oauthUser.js` | Call session termination in user logout |
| Create | `demo_api_server/src/__tests__/pingOneSessionService.test.js` | Unit tests |
| Create | `.claude/skills/pingone-session-termination/SKILL.md` | Reusable agent skill |
| Modify | `REGRESSION_PLAN.md` | §4 enhancement log entry |

---

## Task 1: Create `pingOneSessionService.js`

**Files:**
- Create: `demo_api_server/services/pingOneSessionService.js`
- Test: `demo_api_server/src/__tests__/pingOneSessionService.test.js`

**PingOne Management API session endpoints:**
- `GET  https://api.pingone.{region}/v1/environments/{envId}/users/{userId}/sessions`
  - Returns `{ _embedded: { sessions: [ { id, createdAt, ... } ] } }`
  - Returns `404` if user has no sessions (not an error)
- `DELETE https://api.pingone.{region}/v1/environments/{envId}/users/{userId}/sessions/{sessionId}`
  - Returns `204 No Content` on success
- Auth: `Authorization: Bearer {worker-token}` (client_credentials from worker app)

**There is also a sign-off variant per PingOne docs:**
- `GET https://api.pingone.{region}/v1/environments/{envId}/sessions/{sessionId}/signoff`
  - Triggers a graceful signoff for a specific session (equivalent to RP-initiated logout for that session)
  - Use this when you want PingOne to clean up SSO state gracefully; use DELETE when you need forced termination
  - For logout we use DELETE (more authoritative); signoff is documented in the skill for completeness

- [ ] **Step 1: Write the failing tests**

```javascript
// demo_api_server/src/__tests__/pingOneSessionService.test.js
'use strict';

const axios = require('axios');
jest.mock('axios');

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    const config = {
      pingone_environment_id: 'test-env-id',
      pingone_region: 'com',
      pingone_worker_token_client_id: 'worker-client-id',
      pingone_worker_token_client_secret: 'worker-secret',
    };
    return config[key] || null;
  }),
}));

const { getUserSessions, terminateUserSessions, terminateAllUserSessions } = require('../../services/pingOneSessionService');

describe('pingOneSessionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock worker token acquisition
    axios.post = jest.fn().mockResolvedValue({
      data: { access_token: 'worker-token', expires_in: 3600 },
    });
  });

  describe('getUserSessions', () => {
    it('returns sessions array for a user', async () => {
      axios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          _embedded: {
            sessions: [
              { id: 'session-1', createdAt: '2026-01-01T00:00:00Z' },
              { id: 'session-2', createdAt: '2026-01-01T01:00:00Z' },
            ],
          },
        },
      });

      const sessions = await getUserSessions('user-123');
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe('session-1');
      expect(axios.get).toHaveBeenCalledWith(
        'https://api.pingone.com/v1/environments/test-env-id/users/user-123/sessions',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer worker-token' }) })
      );
    });

    it('returns empty array when user has no sessions', async () => {
      axios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: { _embedded: { sessions: [] } },
      });
      const sessions = await getUserSessions('user-123');
      expect(sessions).toEqual([]);
    });

    it('returns empty array on 404 (no active sessions)', async () => {
      const err = new Error('Not Found');
      err.response = { status: 404 };
      axios.get = jest.fn().mockRejectedValue(err);
      const sessions = await getUserSessions('user-123');
      expect(sessions).toEqual([]);
    });

    it('returns empty array when userId is falsy', async () => {
      const sessions = await getUserSessions(null);
      expect(sessions).toEqual([]);
      expect(axios.get).not.toHaveBeenCalled();
    });
  });

  describe('terminateUserSessions', () => {
    it('deletes each session and returns count', async () => {
      axios.delete = jest.fn().mockResolvedValue({ status: 204 });

      const result = await terminateUserSessions('user-123', ['session-1', 'session-2']);
      expect(result.terminated).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(axios.delete).toHaveBeenCalledTimes(2);
    });

    it('counts failures but does not throw', async () => {
      axios.delete = jest.fn()
        .mockResolvedValueOnce({ status: 204 })
        .mockRejectedValueOnce(new Error('network error'));

      const result = await terminateUserSessions('user-123', ['session-1', 'session-2']);
      expect(result.terminated).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('returns zero when no session ids provided', async () => {
      axios.delete = jest.fn();
      const result = await terminateUserSessions('user-123', []);
      expect(result.terminated).toBe(0);
      expect(axios.delete).not.toHaveBeenCalled();
    });
  });

  describe('terminateAllUserSessions', () => {
    it('reads sessions then terminates all of them', async () => {
      axios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: { _embedded: { sessions: [{ id: 'session-1' }, { id: 'session-2' }] } },
      });
      axios.delete = jest.fn().mockResolvedValue({ status: 204 });

      const result = await terminateAllUserSessions('user-123');
      expect(result.sessions_found).toBe(2);
      expect(result.terminated).toBe(2);
    });

    it('returns zeros when userId is falsy', async () => {
      const result = await terminateAllUserSessions(null);
      expect(result.sessions_found).toBe(0);
      expect(result.terminated).toBe(0);
      expect(axios.get).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server
npx jest pingOneSessionService --no-coverage
```

Expected: FAIL — `Cannot find module '../../services/pingOneSessionService'`

- [ ] **Step 3: Implement `pingOneSessionService.js`**

```javascript
// demo_api_server/services/pingOneSessionService.js
'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const { logger } = require('../utils/logger');

let _cachedToken = null;
let _tokenExpiry = 0;

async function _getWorkerToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const region = configStore.getEffective('pingone_region') || 'com';
  const envId = configStore.getEffective('pingone_environment_id');
  const clientId = configStore.getEffective('pingone_worker_token_client_id');
  const clientSecret = configStore.getEffective('pingone_worker_token_client_secret');

  if (!envId || !clientId || !clientSecret) {
    throw new Error('pingOneSessionService: worker credentials not configured');
  }

  const response = await axios.post(
    `https://auth.pingone.${region}/${envId}/as/token`,
    'grant_type=client_credentials',
    {
      auth: { username: clientId, password: clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 5000,
    }
  );

  _cachedToken = response.data.access_token;
  _tokenExpiry = Date.now() + (response.data.expires_in - 30) * 1000;
  return _cachedToken;
}

function _apiBase() {
  const region = configStore.getEffective('pingone_region') || 'com';
  const envId = configStore.getEffective('pingone_environment_id');
  return `https://api.pingone.${region}/v1/environments/${envId}`;
}

/**
 * Fetch all active PingOne sessions for a user.
 * GET /environments/{envId}/users/{userId}/sessions
 * @param {string} userId - PingOne user ID (sub claim)
 * @returns {Promise<Array<{id: string, createdAt: string}>>} empty array on error or 404
 */
async function getUserSessions(userId) {
  if (!userId) return [];
  try {
    const token = await _getWorkerToken();
    const response = await axios.get(
      `${_apiBase()}/users/${userId}/sessions`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      }
    );
    return response.data?._embedded?.sessions || [];
  } catch (err) {
    if (err.response?.status === 404) return [];
    logger.warn('[pingOneSessionService] getUserSessions failed', { userId, error: err.message });
    return [];
  }
}

/**
 * Terminate specific PingOne sessions by ID.
 * DELETE /environments/{envId}/users/{userId}/sessions/{sessionId}
 * @param {string} userId - PingOne user ID
 * @param {string[]} sessionIds - session IDs to delete
 * @returns {Promise<{terminated: number, errors: string[]}>}
 */
async function terminateUserSessions(userId, sessionIds) {
  if (!sessionIds || sessionIds.length === 0) return { terminated: 0, errors: [] };

  const token = await _getWorkerToken();
  const base = _apiBase();
  let terminated = 0;
  const errors = [];

  await Promise.all(
    sessionIds.map(async (sessionId) => {
      try {
        await axios.delete(`${base}/users/${userId}/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 5000,
        });
        terminated++;
        logger.info('[pingOneSessionService] session terminated', { userId, sessionId });
      } catch (err) {
        errors.push(`${sessionId}: ${err.message}`);
        logger.warn('[pingOneSessionService] session termination failed', { userId, sessionId, error: err.message });
      }
    })
  );

  return { terminated, errors };
}

/**
 * Read then terminate all active PingOne sessions for a user.
 * Used by logout — NOT by STOP AGENT (which only revokes tokens).
 * @param {string} userId - PingOne user ID (sub claim from session)
 * @returns {Promise<{sessions_found: number, terminated: number, errors: string[]}>}
 */
async function terminateAllUserSessions(userId) {
  if (!userId) {
    logger.warn('[pingOneSessionService] terminateAllUserSessions: no userId — skipping');
    return { sessions_found: 0, terminated: 0, errors: [] };
  }

  const sessions = await getUserSessions(userId);
  const sessionIds = sessions.map(s => s.id);

  logger.info('[pingOneSessionService] terminating sessions', { userId, count: sessionIds.length });

  const result = await terminateUserSessions(userId, sessionIds);
  return { sessions_found: sessionIds.length, ...result };
}

module.exports = { getUserSessions, terminateUserSessions, terminateAllUserSessions };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_api_server
npx jest pingOneSessionService --no-coverage
```

Expected: PASS — 9 tests across 3 describe blocks

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/pingOneSessionService.js \
        demo_api_server/src/__tests__/pingOneSessionService.test.js
git commit -m "feat(auth): add pingOneSessionService for Management API session termination"
```

---

## Task 2: Plug session termination into admin logout (`oauth.js`)

**Files:**
- Modify: `demo_api_server/routes/oauth.js`

The admin logout `GET /logout` handler (currently around line 412) revokes tokens then redirects to PingOne's `/as/signoff`. Add `terminateAllUserSessions` between token revocation and `session.destroy()`. The handler must become `async` to `await` the call.

- [ ] **Step 1: Add require near the top of `oauth.js`**

After the other require statements at the top of the file, add:

```javascript
const { terminateAllUserSessions } = require('../services/pingOneSessionService');
```

- [ ] **Step 2: Replace the admin logout handler**

Find and replace the entire `router.get('/logout', ...)` handler (lines ~412–439):

```javascript
router.get('/logout', async (req, res) => {
  const idToken      = req.session.oauthTokens?.idToken      || null;
  const accessToken  = req.session.oauthTokens?.accessToken  || null;
  const refreshToken = req.session.oauthTokens?.refreshToken || null;
  const postLogoutUri = `${getFrontendOrigin(req)}/logout`;
  const logoutUserId = req.session.user?.id;
  const pingOneUserId = req.session.user?.oauthId || req.session.user?.id || null;

  // RFC 7009 — revoke tokens before destroying the session (best-effort, non-fatal)
  if (accessToken  && accessToken  !== '_cookie_session') oauthService.revokeToken(accessToken,  'access_token');
  if (refreshToken && refreshToken !== '_cookie_session') oauthService.revokeToken(refreshToken, 'refresh_token');

  // Terminate PingOne SSO sessions so the user cannot silently re-authenticate
  try {
    await terminateAllUserSessions(pingOneUserId);
  } catch (_) { /* non-fatal — token revocation + signoff redirect still cover logout */ }

  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }
    if (logoutUserId) {
      posthog.capture({ distinctId: logoutUserId, event: 'user_logged_out' });
    }
    logAppEvent('auth_lifecycle', 'info', 'Session snapshot: admin logout', {
      tag: 'auth_lifecycle/session-snapshot',
      metadata: { event: 'logout', role: null, hasAccessToken: false, hasIdToken: false, hasRefreshToken: false },
    });

    clearAllAuthCookies(res, _isProd());

    res.redirect(buildPingOneSignoffUrl(postLogoutUri, 'pingone_admin_client_id', idToken));
  });
});
```

- [ ] **Step 3: Run server tests**

```bash
cd demo_api_server
npx jest --no-coverage --testPathPattern='oauth|session'
```

Expected: all previously passing tests still pass.

- [ ] **Step 4: Build the UI**

```bash
cd demo_api_ui && npm run build
```

Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/oauth.js
git commit -m "feat(auth): terminate PingOne sessions on admin logout"
```

---

## Task 3: Plug session termination into user logout (`oauthUser.js`)

**Files:**
- Modify: `demo_api_server/routes/oauthUser.js`

Same pattern as Task 2 but for the user route. The user logout handler is at line ~749.

- [ ] **Step 1: Add require near the top of `oauthUser.js`**

```javascript
const { terminateAllUserSessions } = require('../services/pingOneSessionService');
```

- [ ] **Step 2: Replace the user logout handler**

Find and replace the `router.get('/logout', ...)` handler (lines ~749–779):

```javascript
router.get('/logout', async (req, res) => {
  const idToken      = req.session.oauthTokens?.idToken      || null;
  const accessToken  = req.session.oauthTokens?.accessToken  || null;
  const refreshToken = req.session.oauthTokens?.refreshToken || null;
  const userId       = req.session.user?.oauthId || req.session.user?.id || null;
  const postLogoutUri = `${getFrontendOrigin(req)}/logout`;

  // RFC 7009 — revoke tokens before destroying the session (best-effort, non-fatal)
  if (accessToken  && accessToken  !== '_cookie_session') oauthService.revokeToken(accessToken,  'access_token');
  if (refreshToken && refreshToken !== '_cookie_session') oauthService.revokeToken(refreshToken, 'refresh_token');

  // Terminate PingOne SSO sessions so the user cannot silently re-authenticate
  try {
    await terminateAllUserSessions(userId);
  } catch (_) { /* non-fatal */ }

  // Clear this user's in-memory demo state so the next login starts fresh
  try {
    const { clearTokenChain } = require('../services/tokenChainService');
    const mcpAudit = require('../services/mcpToolAuditStore');
    if (userId) clearTokenChain(userId);
    mcpAudit.clearToolCalls();
    appEventService.clearEvents();
    if (global.pendingConsents) global.pendingConsents = {};
  } catch (_) { /* non-fatal */ }

  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }

    clearAllAuthCookies(res, _isProd());

    res.redirect(buildPingOneSignoffUrl(postLogoutUri, 'pingone_user_client_id', idToken));
  });
});
```

- [ ] **Step 3: Run server tests + UI build**

```bash
cd demo_api_server && npx jest --no-coverage --testPathPattern='oauth|session'
cd demo_api_ui && npm run build
```

Expected: all tests pass, build exits 0

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/routes/oauthUser.js
git commit -m "feat(auth): terminate PingOne sessions on user logout"
```

---

## Task 4: Write the `pingone-session-termination` skill

**Files:**
- Create: `.claude/skills/pingone-session-termination/SKILL.md`

- [ ] **Step 1: Create the skill**

```bash
mkdir -p .claude/skills/pingone-session-termination
```

Write `.claude/skills/pingone-session-termination/SKILL.md`:

````markdown
---
name: pingone-session-termination
description: 'Terminate active PingOne SSO sessions via Management API. USE FOR: logout flows that must kill PingOne sessions (not just revoke tokens), any flow needing DELETE /users/{userId}/sessions/{sessionId}. DO NOT USE FOR: STOP AGENT kill switch (token revocation only is correct there — see decision record below); OAuth login/token flows (use oauth-pingone); token-only revocation RFC 7009 (oauthService.revokeToken); MFA or user provisioning (use pingone-api-calls).'
argument-hint: 'Describe where you need session termination (e.g. logout handler)'
---

# PingOne Session Termination

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

**Signoff variant (graceful):** There is also a Management API sign-off endpoint:
```
GET https://api.pingone.{region}/v1/environments/{envId}/sessions/{sessionId}/signoff
```
This triggers a graceful sign-off notification to PingOne rather than a hard delete. Use DELETE for forced termination on logout; the signoff variant is appropriate if you want PingOne to emit session-end events to other connected apps. For this demo app, DELETE is used.

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
````

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/pingone-session-termination/SKILL.md
git commit -m "docs(skills): add pingone-session-termination skill"
```

---

## Task 5: Update REGRESSION_PLAN.md

**Files:**
- Modify: `REGRESSION_PLAN.md`

- [ ] **Step 1: Add §4 entry**

In `REGRESSION_PLAN.md` find §4 (Bug Fix Log) and add at the top:

```markdown
### 2026-05-28 — PingOne session termination on logout
- **Files:** `demo_api_server/services/pingOneSessionService.js` (new), `routes/oauth.js`, `routes/oauthUser.js`
- **Problem:** RFC 7009 token revocation did not terminate the PingOne SSO session. A user whose tokens were revoked could silently re-authenticate without re-entering credentials.
- **Fix:** New `pingOneSessionService.js` calls `GET /users/{userId}/sessions` then `DELETE /users/{userId}/sessions/{sessionId}` (Management API). Wired into admin and user logout, awaited before session.destroy().
- **Do not regress:** Session termination is non-fatal — logout (session.destroy + signoff redirect) must complete even if PingOne Management API is unreachable. STOP AGENT intentionally does NOT call session termination (token revocation only is correct there).
```

- [ ] **Step 2: Commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs(regression): log PingOne session termination on logout"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| STOP button: token revocation only | Decision record — no code change, correct as-is |
| Logout: terminate PingOne sessions | Tasks 2 + 3 |
| Skill documenting all three options + decision record | Task 4 |
| Unit tests for the new service | Task 1 |
| Non-fatal: logout completes even if PingOne API is down | Tasks 2, 3 (try/catch) |
| REGRESSION_PLAN.md entry | Task 5 |

### Placeholder scan — clean

No TBD, no TODO, no "similar to Task N".

### Type consistency

- `terminateAllUserSessions(userId: string)` — consistent across Tasks 1, 2, 3, 4
- Return shape `{ sessions_found, terminated, errors }` — consistent in tests (Task 1) and implementation
- `getUserSessions` returns `Array<{id, createdAt, ...}>` — consistent across tests and implementation
