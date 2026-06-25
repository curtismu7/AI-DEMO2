# Runbook: Token Compromise

A PingOne access token, refresh token, or RFC 8693 **exchanged** token (the
agent/gateway/MCP-server tokens) is suspected leaked or stolen — e.g. exposed in
logs, copied from a browser, or replayed from an unexpected source.

**Default severity:** SEV-2 (single user token) → SEV-1 (refresh token, an
exchanged token with write scopes, or active misuse).

See [README.md](README.md) for first-response and evidence-capture steps.

---

## 1. Detect / confirm

- **Is the token still active?** Introspect it (RFC 7662, public endpoint):
  ```bash
  curl -sk -X POST https://api.ping.demo:3001/api/introspect \
    -H 'Content-Type: application/json' \
    -d '{"token":"<TOKEN>"}'
  ```
  `{"active": true, "scope": "...", "sub": "...", "exp": ...}` → live and usable.
  `active:false` → already expired/revoked; pivot to *what did it do* (evidence).
- **What did it do?** Pull the audit trail for the actor and correlate by sub /
  correlation id:
  - `GET /api/mcp/audit?agentId=<id>` — MCP tool calls made with the token (durable, LMDB).
  - `GET /api/admin/audit-trail?agentId=<id>&hours=<h>` — agent lifecycle events.
  - `auditLogger` security events — look for invalid/revoked-token usage.
- **Decode the token** to see `sub`, `aud`, `scope`, `act` (delegation), `exp`.
  An exchanged token's `aud` tells you which hop it was for (BFF user token vs
  gateway aud `mcpgateway.ping.demo` vs MCP-server aud).

## 2. Contain (stop the bleeding)

Pick the smallest lever that covers the blast radius.

### a) If it belongs to an agent — use the kill switch (most complete)
The kill switch is the "red button": it revokes the agent's tokens at PingOne
(RFC 7009), disables the PingOne **user** and the **agent application** (blocks
*new* token issuance), invalidates the agent's sessions, and captures a forensic
state snapshot.
```bash
curl -sk -X POST https://api.ping.demo:3001/api/admin/agent/<AGENT_ID>/kill-switch \
  -H 'Authorization: Bearer <ADMIN_SESSION>' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"suspected token compromise"}'
```
- Implemented in `services/killSwitchService.js` (`killAgent`); audited via
  `auditLogService.recordKillEvent` → retrievable from `/api/admin/audit-trail`.
- The call **destroys the admin session** on success (forces your own re-auth) —
  expect a 401 back; that is success, not failure.
- After this, `agentRateLimit` rejects the agent with `401 agent_revoked` even if
  it presents a still-unexpired token.

### b) If it's a user/standalone token — revoke at PingOne (RFC 7009)
`services/tokenRevocation.js` revokes against `PINGONE_REVOCATION_ENDPOINT`.
Revocation is bound to the **issuing client** (see the introspection/issuing-client
note in `docs/INTROSPECTION_VALIDATION_GUIDE.md`), so revoke with that client's
credentials:
```bash
curl -s -X POST "$PINGONE_REVOCATION_ENDPOINT" \
  -u "<ISSUING_CLIENT_ID>:<ISSUING_CLIENT_SECRET>" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'token=<TOKEN>&token_type_hint=access_token'
```
Revoke the **refresh token too** (`token_type_hint=refresh_token`) — otherwise the
session silently mints a fresh access token (see `middleware/tokenRefresh.js`).

### c) Kill the session(s)
Sessions persist in LMDB (`services/lmdb/sessionStore.js`, db `sessions`). To
force every user to re-authenticate, restart the BFF with
`CLEAR_SESSIONS_ON_BOOT=true` (this is the **default**; it is currently set
`false` on the deployment to preserve sessions — flip it for the restart, then
restore). For a single agent, the kill switch already invalidates its sessions.

## 3. Eradicate

- Confirm the token is dead: re-introspect → `active:false`.
- Confirm no live refresh path: the refresh token is revoked and the session is gone.
- If an **exchanged** token was compromised, the upstream user token it was
  exchanged from is also suspect — revoke that too (RFC 8693 chains forward).
- Identify the leak vector (logs, screenshot, shared `.env`, browser devtools).
  Tokens are intentionally visible in this teaching demo's UI — rule that in/out
  as the "leak" before treating it as an incident.

## 4. Recover

- Re-enable the PingOne user and agent application if the kill switch disabled
  them and the agent is cleared (re-enable is a PingOne admin action — set the
  user/app `enabled: true`).
- Have the affected user re-authenticate to obtain fresh tokens.
- Restore `CLEAR_SESSIONS_ON_BOOT` to its prior deployment value if you changed it.

## 5. Post-incident

Run the [README post-incident checklist](README.md#post-incident-checklist-all-incidents).
Token-specific:
- [ ] Confirm time-to-revoke from the kill event (`time_to_revoke_ms`).
- [ ] If the leak was a code path (token logged, returned in an error body, etc.),
      add a test + `REGRESSION_LOG.md` entry and scrub the log sink.
