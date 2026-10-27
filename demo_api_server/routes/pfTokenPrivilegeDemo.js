// demo_api_server/routes/pfTokenPrivilegeDemo.js
// Backs /privilege-pf-token: proves a PingFederate-issued token is accepted by the Privilege gateway.
//
//   BFF -> PingFederate (client_credentials, client pf-route-c-test) -> JWT with act.sub = the agent
//   BFF -> P1 Privilege Agent App pftoken (Pass Agent Token) with that JWT as the bearer -> tools/list
//   BFF -> the same agent app with a garbage bearer, as the control
//   BFF -> agent app pftoken-rs (Pass Agent Token, backend = mcp-resource-server) -> tools/call whoami,
//          which returns the identity the backend verified on the token it received: proof the gateway
//          passed the agent's own PingFederate token through rather than swapping in its own credential
//   BFF -> PingFederate twice more, same agent, other scopes -> the same app, to show the scope tiers:
//          the key's grant has one rule per tier, each with RequiredClaims on scope (doc section 16)
//
// The gateway matches the token to its non-human identity (NHI PFtoken) and agent key
// (pftoken-agent), then applies the key's grant. Setup and every failure seen on the way:
// privilege/PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md. The token itself (and its signature) never
// leaves this route; all of its claims are returned.

'use strict';

const express = require('express');
const configStore = require('../services/configStore');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const CALL_TIMEOUT_MS = 15000;
// Same agent, three scopes. The grant gives opensearch:admin all tools, opensearch:read the read tools,
// and nothing to a token with neither. The first tier's token is also the one used for the main answer.
const SCOPE_TIERS = [
  { key: 'full', scope: 'openid opensearch:admin whoami:read' },
  { key: 'read', scope: 'openid opensearch:read' },
  { key: 'none', scope: 'openid whoami:read' },
];

function config() {
  let storedSecret = '';
  try { storedSecret = configStore.getEffective('PF_TOKEN_DEMO_CLIENT_SECRET') || ''; } catch { storedSecret = ''; }
  return {
    issuer: process.env.PF_TOKEN_DEMO_ISSUER || 'https://cmuir-pf.ping-devops.com',
    clientId: process.env.PF_TOKEN_DEMO_CLIENT_ID || 'pf-route-c-test',
    doorUrl: process.env.PF_TOKEN_DEMO_DOOR_URL || 'https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp',
    whoamiUrl: process.env.PF_TOKEN_DEMO_WHOAMI_URL || 'https://mcpgw.ai-demo.ping-devops.com/pftoken-rs/mcp',
    clientSecret: process.env.PF_TOKEN_DEMO_CLIENT_SECRET || storedSecret,
  };
}

function decodeClaims(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function mintToken(cfg, scope) {
  const res = await fetch(`${cfg.issuer}/as/token.oauth2`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) {
    return { status: res.status, error: body.error_description || body.error || `HTTP ${res.status}` };
  }
  return { status: res.status, token: body.access_token, claims: decodeClaims(body.access_token) };
}

// The door answers JSON or an SSE frame ("event: message\ndata: {...}"); pull the JSON-RPC message out of either.
function parseRpc(text) {
  const t = String(text || '').trim();
  const data = t.split('\n').find((l) => l.startsWith('data:'));
  try { return JSON.parse(data ? data.slice(5).trim() : t); } catch { return null; }
}

// What the gateway's answer means. 401 = the gateway did not accept the token at all;
// 403 = it accepted the token and a Privilege policy refused the call.
function verdictFor(status, tools) {
  if (status === 200 && tools.length) return 'allowed';
  if (status === 200) return 'allowed-no-tools';
  if (status === 403) return 'refused-by-policy';
  if (status === 401) return 'token-rejected';
  return 'error';
}

async function postRpc(doorUrl, bearer, method, params) {
  const res = await fetch(doorUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const text = await res.text();
  const rpc = parseRpc(text);
  const detail = rpc?.error?.message || (res.status === 200 ? '' : text.replace(/\s+/g, ' ').trim().slice(0, 200));
  return { status: res.status, rpc, detail };
}

async function listTools(doorUrl, bearer) {
  try {
    const { status, rpc, detail } = await postRpc(doorUrl, bearer, 'tools/list', {});
    const tools = Array.isArray(rpc?.result?.tools) ? rpc.result.tools.map((t) => t.name).filter(Boolean) : [];
    return { status, verdict: verdictFor(status, tools), tools, detail };
  } catch (err) {
    return { status: 0, verdict: 'error', tools: [], detail: err.message };
  }
}

// whoami on the resource server answers with every claim of the token it verified.
async function askBackend(whoamiUrl, bearer) {
  try {
    const { status, rpc, detail } = await postRpc(whoamiUrl, bearer, 'tools/call', { name: 'whoami', arguments: {} });
    let received = null;
    try { received = JSON.parse(rpc?.result?.content?.[0]?.text || 'null'); } catch { received = null; }
    const verdict = status === 200 && received ? 'allowed' : status === 200 ? 'allowed-no-tools' : verdictFor(status, []);
    return { status, verdict, received, detail: detail || (rpc?.result?.isError ? 'whoami returned an error' : '') };
  } catch (err) {
    return { status: 0, verdict: 'error', received: null, detail: err.message };
  }
}

// One tier: mint for this scope, then ask the app for its tools. `scope` is what the token carried.
async function tierAnswer(cfg, tier) {
  try {
    const m = await mintToken(cfg, tier.scope);
    if (!m.token) return { key: tier.key, scope: tier.scope, status: 0, verdict: 'error', tools: [], detail: `PingFederate: ${m.error}` };
    return { key: tier.key, scope: m.claims?.scope ?? tier.scope, ...(await listTools(cfg.doorUrl, m.token)) };
  } catch (err) {
    return { key: tier.key, scope: tier.scope, status: 0, verdict: 'error', tools: [], detail: err.message };
  }
}

router.get('/state', (req, res) => {
  const cfg = config();
  res.json({ configured: Boolean(cfg.clientSecret), issuer: cfg.issuer, clientId: cfg.clientId, doorUrl: cfg.doorUrl, whoamiUrl: cfg.whoamiUrl });
});

router.post('/run', authenticateToken, async (req, res) => {
  const cfg = config();
  if (!cfg.clientSecret) {
    return res.status(503).json({ error: 'not_configured', message: 'PF_TOKEN_DEMO_CLIENT_SECRET is not set on the api-server.' });
  }
  const at = new Date().toISOString();
  let mint;
  try {
    mint = await mintToken(cfg, SCOPE_TIERS[0].scope);
  } catch (err) {
    return res.json({ at, doorUrl: cfg.doorUrl, mint: { status: 0, error: err.message } });
  }
  if (!mint.token) {
    return res.json({ at, doorUrl: cfg.doorUrl, mint: { status: mint.status, error: mint.error } });
  }
  const [pfToken, garbage, backend, ...others] = await Promise.all([
    listTools(cfg.doorUrl, mint.token),
    listTools(cfg.doorUrl, 'not-a-valid-token'),
    askBackend(cfg.whoamiUrl, mint.token),
    ...SCOPE_TIERS.slice(1).map((t) => tierAnswer(cfg, t)),
  ]);
  const tiers = [{ key: SCOPE_TIERS[0].key, scope: mint.claims?.scope ?? SCOPE_TIERS[0].scope, ...pfToken }, ...others];
  return res.json({
    at, doorUrl: cfg.doorUrl, whoamiUrl: cfg.whoamiUrl, mint: { status: mint.status, claims: mint.claims }, pfToken, garbage, backend, tiers,
  });
});

module.exports = router;
module.exports._internal = { decodeClaims, parseRpc, verdictFor };
