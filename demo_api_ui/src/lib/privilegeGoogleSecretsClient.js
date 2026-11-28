// demo_api_ui/src/lib/privilegeGoogleSecretsClient.js
//
// Client for the Privilege Hubs Google secrets demo (BFF /api/privilege-google-secrets).
// The BFF relays the agent-key-authenticated MCP call to the Hubs gateway; the
// gateway's policy decides allow/deny and the BFF masks secret values before
// they reach the browser.

const BASE = '/api/privilege-google-secrets';

export async function fetchGoogleSecret(tool, args = {}, { reveal = false, signal } = {}) {
  const res = await fetch(`${BASE}/fetch`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args, reveal }),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `fetch failed (${res.status})`);
  return body;
}

export async function fetchGoogleSecretsStatus({ signal } = {}) {
  const res = await fetch(`${BASE}/status`, { credentials: 'include', signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `status failed (${res.status})`);
  return body;
}
