# Agent Access Revocation — Design

**Date:** 2026-06-27  
**Status:** Approved  
**Scope:** `demo_api_server` (BFF), `demo_api_ui`

## Summary

Replace `may_act` as the agent authorization gate with the LMDB delegation record (A+C model: delegation record controls *whether* the agent can act; scopes control *what* it can do). Add soft and hard revocation surfaces for both users (self-service) and admins. Hard revoke kills the live token via RFC 7009, clears the user session, and shows a modal explaining what happened.

## Background

`may_act` was the per-user consent signal for RFC 8693 agent delegation. It is being removed. The LMDB delegation store (`delegationService.js`) already holds explicit user-to-agent grants and has its own revoke path. Scopes on the delegation record define permitted operations. Together these fully replace `may_act` semantically.

Existing building blocks:

- `delegationService.revokeDelegation(id, userId)` — LMDB delete + `_syncGrantorDelegatedTo()` PingOne sync
- `tokenRevocation.revokeToken(token, hint, clientId, clientSecret)` — RFC 7009
- `agentAuthorization.js` — already mounted at `/api/agent-authorization` with grant/revoke/status routes
- `actClaimValidator.js` — validates `act` claim structure; correct place to add gate logic

---

## Architecture

Three concerns, cleanly separated:

1. **Gate** — middleware that checks for an active delegation record before any agent-proxied request is processed
2. **Revocation endpoints** — extend `agentAuthorization.js` with soft and hard DELETE routes
3. **UI** — user self-service card (account/settings area) + admin action on the Delegation page

---

## Backend

### 1. Delegation gate middleware

New file: `demo_api_server/middleware/delegationGate.js`

- Applied only to routes that serve agent-proxied requests (not all routes)
- Extracts the actor `sub` from the `act` claim in the bearer token
- Calls `delegationStore.findActiveByActorAndGrantor(actorSub, req.user.id)` — this method may need to be added to `delegationStore.lmdb.js` if not already present (the store has `findByGrantor` and `findByDelegate`; this is a filtered variant)
- If no active record exists: `403 { error: 'delegation_revoked', message: 'Agent access has been revoked.' }`
- If a record exists: attaches it to `req.activeDelegation` and calls `next()`

Scopes are checked by existing authorization logic downstream — the gate only verifies the delegation record exists.

### 2. Soft revoke endpoint

`DELETE /api/agent-authorization`

- Resolves the delegation ID for `req.user.id` (the currently active agent delegation)
- Calls `revokeDelegation(delegationId, req.user.id)` — LMDB delete + PingOne sync
- Returns `{ ok: true, revoked: 'soft' }`

### 3. Hard revoke endpoint

`DELETE /api/agent-authorization/hard`

- Runs soft revoke (same as above)
- Extracts the user's current access token from `req.session.oauthTokens.accessToken`
- Calls `revokeToken(accessToken, 'access_token', clientId, clientSecret)`
- Returns `{ ok: true, revoked: 'hard', sessionClear: true }`
- Client receives `sessionClear: true`, clears its session state, redirects to login with `?revoked=1`

### 4. Admin hard revoke

`DELETE /api/delegation/admin/:id/hard` (extends existing `delegation.js`)

- Requires `requireAdmin`
- Looks up the delegation record to find the grantor user ID
- Calls `adminRevokeDelegation(id)` (existing — LMDB delete + sync)
- Fetches the grantor's active access token (from session store or user record)
- Calls `revokeToken(...)` on the grantor's token
- Returns `{ ok: true, revoked: 'hard', userId: grantorUserId }`
- Admin session is unaffected

---

## UI

### User self-service — "Agent Access" card

Location: account/settings area (alongside existing session/profile controls)

States:

- **No active delegation:** "No agent access is currently granted." — no action buttons
- **Active delegation:** Shows agent name and granted scopes, plus two actions:
  - **Revoke** — confirmation dialog → calls `DELETE /api/agent-authorization` → shows success toast → updates card to inactive state
  - **Revoke Immediately** — confirmation dialog with stronger warning copy ("This will also invalidate your current session") → calls `DELETE /api/agent-authorization/hard` → shows modal (see below) → clears session → redirect to login

### Admin surface — Delegation page

Each delegation row in the admin view gets:

- **Revoke** (soft) — calls existing `DELETE /api/delegation/admin/:id`
- **Revoke Immediately** (hard) — calls new `DELETE /api/delegation/admin/:id/hard` → shows confirmation toast on admin page confirming which user's access was revoked

Admin stays logged in after either action.

### Hard revoke modal (user-facing)

Shown before session is cleared (blocking, not dismissible until CTA clicked):

> **Agent access revoked**
>
> The AI agent can no longer act on your behalf. Your session has been cleared for security.
>
> [Log in again]

Triggered by: `sessionClear: true` in the API response. Modal state is passed via `?revoked=1` query param on the login redirect so the login page can optionally surface a contextual message.

---

## Error handling

| Scenario | Response |
| --- | --- |
| No active delegation found for soft revoke | `404 { error: 'no_active_delegation' }` |
| RFC 7009 token revocation fails | Log the error, still return `{ ok: true, revoked: 'hard', sessionClear: true }` — the delegation record is already deleted; token expiry provides the backstop |
| Agent request with no delegation record | `403 { error: 'delegation_revoked' }` |
| Admin revoke — user token not available | Soft revoke only, return `{ ok: true, revoked: 'soft', note: 'token_unavailable' }` |

RFC 7009 §2.2 specifies that revocation endpoints return 200 whether or not the token was valid — treat any non-5xx response as success.

---

## What is not in scope

- Removing `may_act` claim issuance from PingOne token policy — that is a PingOne configuration change, not a code change
- Migrating existing `mayAct` PingOne user attributes — existing users with the attribute will not break; the attribute simply becomes unused
- Audit log changes — `delegationAuditLogger.js` already captures delegation chain events; revoke events flow through the existing `revokeDelegation` path which logs to LMDB history
