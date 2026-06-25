// banking_api_ui/src/services/agentAuthorizationService.js
/**
 * AI Agent Authorization (may_act) service.
 *
 * Talks to the BFF agent-authorization endpoints that toggle whether the AI
 * agent is permitted to act on the user's behalf (RFC 8693 may_act).
 *   - GET    /api/agent-authorization/status  → { authorized, enforced }
 *   - POST   /api/agent-authorization/grant   → { ok, reauthRequired }
 *   - POST   /api/agent-authorization/revoke  → { ok, reauthRequired }
 *
 * On reauthRequired the caller must silently re-auth (requestSilentReauth)
 * so the freshly minted token reflects the may_act change.
 */

/**
 * Read the current agent authorization status.
 * @returns {Promise<{ authorized: boolean, enforced: boolean }>}
 */
export async function getAgentAuthStatus() {
  const res = await fetch('/api/agent-authorization/status', {
    credentials: 'include',
  });
  return res.json();
}

/**
 * Authorize (grant) or de-authorize (revoke) the AI agent.
 * @param {boolean} authorize - true to grant, false to revoke.
 * @returns {Promise<{ ok: boolean, reauthRequired: boolean }>}
 */
export async function setAgentAuthorization(authorize) {
  const path = authorize
    ? '/api/agent-authorization/grant'
    : '/api/agent-authorization/revoke';
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Agent authorization failed (${res.status})`);
  }
  return data;
}
