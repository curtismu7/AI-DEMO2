// demo_api_ui/src/lib/privilegeDecisionClient.js
//
// Client for the live-Privilege decision path (BFF /api/privilege/decision).
// Each platform-update page maps one of its scenarios to a real gateway tool
// call; the gateway's own policy decides allow/deny and the page renders the
// gateway's actual verdict next to the scenario's expected outcome.

export const PRIVILEGE_DECISION_PATH = '/api/privilege/decision';

/**
 * Invoke one allowlisted tool through the tenant's Privilege AI Gateway via the
 * BFF. Resolves to { decision, by, status, latencyMs, upstream } on success;
 * throws Error with a user-facing message otherwise.
 */
export async function callPrivilegeDecision(tool, args = {}, { signal } = {}) {
  const res = await fetch(PRIVILEGE_DECISION_PATH, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args }),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `live decision failed (${res.status})`);
  }
  return body;
}
