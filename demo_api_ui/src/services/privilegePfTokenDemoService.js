// Calls the BFF behind /privilege-pf-token (demo_api_server/routes/pfTokenPrivilegeDemo.js).
const API_BASE = '/api/pf-token-demo';

async function call(path, method = 'GET') {
  const r = await fetch(`${API_BASE}${path}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

export const getState = () => call('/state');
export const runDemo = () => call('/run', 'POST');
