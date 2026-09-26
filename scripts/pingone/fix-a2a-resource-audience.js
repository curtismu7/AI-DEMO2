'use strict';
/**
 * fix-a2a-resource-audience.js — one-shot PingOne repair for the A2A gateway
 * resource audience drift (2026-09-26 incident).
 *
 * THE PROBLEM
 *   The PingOne resource "Super Banking A2A MCP Gateway" has its `audience`
 *   attribute set to its display NAME instead of the URI
 *   mcpgateway-a2a.ping.demo. Every RFC 8693 Exchange #2 minted against it
 *   therefore carries aud=["Super Banking A2A MCP Gateway"], which URI-only
 *   aud validators reject.
 *
 *   Client-side tolerance is deployed (mcpGatewayClient + mcpToolPipeline pin
 *   the NAME-form aud to the node gateway, whose MCP_GW_RESOURCE_URI accepts
 *   it) — the demo works. Fixing the SOURCE removes that permanent coupling.
 *
 * WHY THIS SCRIPT EXISTS
 *   The demo worker app is RBAC-blocked: PATCH /resources returns 403
 *   ("Invalid key=value pair ... Authorization header") on every scope
 *   spelling, because the worker holds no environment-admin role and cannot
 *   self-assign one (role list/assign APIs are also 403). Run this script
 *   from a principal WITH the "Environment Admin" role — or do the equivalent
 *   PATCH in the PingOne admin console:
 *     Admin → Resources → "Super Banking A2A MCP Gateway" → audience
 *     → set to mcpgateway-a2a.ping.demo
 *
 * Usage:
 *   cd demo_api_server && node ../scripts/pingone/fix-a2a-resource-audience.js
 *   # or with explicit creds:
 *   PINGONE_ADMIN_CLIENT_ID=... PINGONE_ADMIN_CLIENT_SECRET=... \
 *     node scripts/pingone/fix-a2a-resource-audience.js
 *   # (reads demo_api_server/.env automatically when run without them)
 *
 * Idempotent: exits 0 without patching when the audience is already correct.
 *
 * After it runs:
 *   1. npm run demo:health-gate — a2a:resource-audience and a2a:aud-form
 *      should both pass with NO "DRIFT (tolerated)" note.
 *   2. Optionally remove the NAME-form tolerance:
 *      - "Super Banking A2A MCP Gateway" from MCP_GW_RESOURCE_URI in
 *        docker-compose.yml (3 services)
 *      - the NAME fallback in mcpGatewayClient.js a2aAuds
 *      - the NAME fallback in mcpToolPipeline.js a2aGwAuds
 */

const fs = require('fs');
const path = require('path');

const WANT = 'mcpgateway-a2a.ping.demo';
const RESOURCE_NAME = 'A2A MCP Gateway';

// --- config resolution: env vars first, then demo_api_server/.env ----------
function loadDotEnv() {
  const p = path.resolve(__dirname, '../../demo_api_server/.env');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

async function main() {
  const env = { ...loadDotEnv(), ...process.env };
  const envId = env.PINGONE_ENVIRONMENT_ID;
  // Worker first: the PINGONE_ADMIN_* client is an OIDC (PKCE) app that cannot
  // client_credentials at all ("Unsupported authentication method"). The worker
  // CAN read the resource; it will 403 at PATCH if it lacks the admin role.
  const clientId = env.PINGONE_WORKER_CLIENT_ID || env.PINGONE_ADMIN_CLIENT_ID;
  const clientSecret = env.PINGONE_WORKER_CLIENT_SECRET || env.PINGONE_ADMIN_CLIENT_SECRET;
  if (!envId || !clientId || !clientSecret) {
    console.error('Missing PINGONE_ENVIRONMENT_ID / admin-or-worker client credentials.');
    process.exit(2);
  }

  const auth = Buffer.from(clientId + ':' + clientSecret).toString('base64');
  const tokenRes = await fetch('https://auth.pingone.com/' + envId + '/as/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + auth },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('p1:read:resource p1:update:resource'),
  });
  const tokJ = await tokenRes.json();
  if (!tokJ.access_token) {
    console.error('Token request failed:', JSON.stringify(tokJ).slice(0, 300));
    process.exit(3);
  }
  const H = { Authorization: 'Bearer ' + tokJ.access_token, 'Content-Type': 'application/json' };

  const listRes = await fetch('https://api.pingone.com/v1/environments/' + envId + '/resources?limit=100', { headers: H });
  if (!listRes.ok) {
    console.error('GET /resources failed:', listRes.status, (await listRes.text()).slice(0, 300));
    process.exit(3);
  }
  const all = ((await listRes.json())._embedded || {}).resources || [];
  const rs = all.find((r) => r.audience === WANT || (r.name || '').includes(RESOURCE_NAME));
  if (!rs) {
    console.error('Resource not found (audience=' + WANT + ' or name contains "' + RESOURCE_NAME + '").');
    process.exit(4);
  }

  if (rs.audience === WANT) {
    console.log('OK — resource "' + rs.name + '" audience is already ' + WANT + '. Nothing to do.');
    process.exit(0);
  }

  console.log('Current: name=' + rs.name + ' audience=' + JSON.stringify(rs.audience));
  const patch = await fetch('https://api.pingone.com/v1/environments/' + envId + '/resources/' + rs.id, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({ name: rs.name, description: rs.description, type: rs.type || 'CUSTOM', audience: WANT }),
  });
  if (patch.status === 403) {
    console.error('PATCH 403 — this principal lacks the environment-admin role.');
    console.error('Do it in the PingOne console instead:');
    console.error('  Admin → Resources → "' + rs.name + '" → audience → set to ' + WANT);
    process.exit(5);
  }
  if (!patch.ok) {
    console.error('PATCH failed:', patch.status, (await patch.text()).slice(0, 300));
    process.exit(6);
  }
  const after = await (await fetch('https://api.pingone.com/v1/environments/' + envId + '/resources/' + rs.id, { headers: H })).json();
  console.log('PATCHED — audience is now ' + JSON.stringify(after.audience));
  console.log('Next: npm run demo:health-gate (a2a:resource-audience + a2a:aud-form should pass with no DRIFT note),');
  console.log('then optionally remove the NAME-form tolerance from docker-compose.yml MCP_GW_RESOURCE_URI / mcpGatewayClient / mcpToolPipeline.');
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
