// demo_api_server/routes/pfTokenPrivilegeDemo.js
// Backs /privilege-pf-token: proves a PingFederate-issued token is accepted by the Privilege gateway.
//
//   BFF -> PingFederate (client_credentials, client pf-route-c-test) -> JWT with act.sub = the agent
//   BFF -> Privilege door pftoken (Pass Agent Token) with that JWT as the bearer -> tools/list
//   BFF -> the same door with a garbage bearer, as the control
//
// The gateway matches the token to its non-human identity (NHI PFtoken) and agent key
// (pftoken-agent), then applies the key's grant. Setup and every failure seen on the way:
// privilege/PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md. The token itself never leaves this route;
// only its claims are returned.

'use strict';

const express = require('express');
const configStore = require('../services/configStore');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const CALL_TIMEOUT_MS = 15000;
// Claims worth showing; the raw token is never sent to the browser.
const SHOWN_CLAIMS = ['iss', 'sub', 'aud', 'client_id', 'act', 'scope', 'iat', 'exp'];

function config() {
  let storedSecret = '';
  try { storedSecret = configStore.getEffective('PF_TOKEN_DEMO_CLIENT_SECRET') || ''; } catch { storedSecret = ''; }
  return {
    issuer: process.env.PF_TOKEN_DEMO_ISSUER || 'https://cmuir-pf.ping-devops.com',
    clientId: process.env.PF_TOKEN_DEMO_CLIENT_ID || 'pf-route-c-test',
    doorUrl: process.env.PF_TOKEN_DEMO_DOOR_URL || 'https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp',
    clientSecret: process.env.PF_TOKEN_DEMO_CLIENT_SECRET || storedSecret,
  };
}

function decodeClaims(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length < 2) return null;
  try {
    const all = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return Object.fromEntries(SHOWN_CLAIMS.filter((k) => k in all).map((k) => [k, all[k]]));
  } catch {
    return null;
  }
}

async function mintToken(cfg) {
  const res = await fetch(`${cfg.issuer}/as/token.oauth2`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
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

async function listTools(doorUrl, bearer) {
  try {
    const res = await fetch(doorUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const text = await res.text();
    const rpc = parseRpc(text);
    const tools = Array.isArray(rpc?.result?.tools) ? rpc.result.tools.map((t) => t.name).filter(Boolean) : [];
    const detail = rpc?.error?.message || (res.status === 200 ? '' : text.replace(/\s+/g, ' ').trim().slice(0, 200));
    return { status: res.status, verdict: verdictFor(res.status, tools), tools, detail };
  } catch (err) {
    return { status: 0, verdict: 'error', tools: [], detail: err.message };
  }
}

router.get('/state', (req, res) => {
  const cfg = config();
  res.json({ configured: Boolean(cfg.clientSecret), issuer: cfg.issuer, clientId: cfg.clientId, doorUrl: cfg.doorUrl });
});

router.post('/run', authenticateToken, async (req, res) => {
  const cfg = config();
  if (!cfg.clientSecret) {
    return res.status(503).json({ error: 'not_configured', message: 'PF_TOKEN_DEMO_CLIENT_SECRET is not set on the api-server.' });
  }
  const at = new Date().toISOString();
  let mint;
  try {
    mint = await mintToken(cfg);
  } catch (err) {
    return res.json({ at, doorUrl: cfg.doorUrl, mint: { status: 0, error: err.message } });
  }
  if (!mint.token) {
    return res.json({ at, doorUrl: cfg.doorUrl, mint: { status: mint.status, error: mint.error } });
  }
  const [pfToken, garbage] = await Promise.all([
    listTools(cfg.doorUrl, mint.token),
    listTools(cfg.doorUrl, 'not-a-valid-token'),
  ]);
  return res.json({ at, doorUrl: cfg.doorUrl, mint: { status: mint.status, claims: mint.claims }, pfToken, garbage });
});

module.exports = router;
module.exports._internal = { decodeClaims, parseRpc, verdictFor };
