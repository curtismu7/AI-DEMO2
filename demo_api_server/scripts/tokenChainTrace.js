'use strict';

/**
 * Token-chain trace harness (executable SoT for the MCP token path).
 *
 * Drives a real logged-in session through the FULL pipeline
 * (BFF → RFC 8693 → MCP Gateway → Authorize → MCP server → backend)
 * and dumps every token event observed at every hop: aud, sub, scope, act,
 * and the validation status the component recorded.
 *
 * Phase 1 (this commit): empirical DUMP mode — print the real shapes so we can
 * build hard assertions on top. Run with services up:
 *   node scripts/tokenChainTrace.js [tool] [prompt]
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false });

// Bridge demo-user creds → the names resolveSession expects.
if (!process.env.PINGONE_TEST_USER && process.env.DEMO_USER_USERNAME) {
  process.env.PINGONE_TEST_USER = process.env.DEMO_USER_USERNAME;
}
if (!process.env.PINGONE_TEST_PASSWORD && process.env.DEMO_USER_PASSWORD) {
  process.env.PINGONE_TEST_PASSWORD = process.env.DEMO_USER_PASSWORD;
}

const axios = require('axios');
const { loginViaBff } = require('../tests/real/helpers/session');
const { BFF_BASE, httpsAgent } = require('../tests/real/helpers/constants');
const { decodeJwt } = require('../utils/tokenUtils');

async function freshLogin() {
  return loginViaBff({
    envId: process.env.PINGONE_ENVIRONMENT_ID,
    region: process.env.PINGONE_REGION || 'com',
    username: process.env.DEMO_USER_USERNAME,
    password: process.env.DEMO_USER_PASSWORD,
    loginPath: '/api/auth/oauth/user/login',
    callbackPath: '/api/auth/oauth/user/callback',
  });
}

const TOOL = process.argv[2] || 'get_my_accounts';
const PROMPT = process.argv[3] || 'show my accounts';

function summarizeClaims(c) {
  if (!c) return '(no claims)';
  const aud = Array.isArray(c.aud) ? c.aud.join(',') : c.aud;
  const scope = c.scope || c.scp;
  const act = c.act ? `act.sub=${c.act.sub}` : 'act=ABSENT';
  return `aud=[${aud || '-'}] sub=${c.sub || '-'} scope=[${scope || '-'}] ${act} exp=${c.exp || '-'}`;
}

function dumpTokenEvents(label, events) {
  console.log(`\n===== tokenEvents from: ${label} (${(events || []).length}) =====`);
  for (const e of events || []) {
    console.log(`  • [${e.status || '?'}] ${e.id || ''} — ${e.label || ''}`);
    if (e.claims) console.log(`      ${summarizeClaims(e.claims)}`);
    if (e.explanation) console.log(`      ↳ ${e.explanation}`);
  }
}

(async () => {
  console.log(`[trace] BFF_BASE=${BFF_BASE}  tool=${TOOL}  prompt="${PROMPT}"`);
  const cookie = await freshLogin();
  if (!cookie) {
    console.error('[trace] No session — set DEMO_USER_USERNAME/DEMO_USER_PASSWORD in .env and ensure PingOne reachable.');
    process.exit(2);
  }
  const client = axios.create({
    baseURL: BFF_BASE, httpsAgent, headers: { Cookie: cookie }, validateStatus: () => true,
  });

  // Ensure we trace the banking vertical (others refuse banking tools).
  const va = await client.post('/api/verticals/active', { id: 'banking' });
  console.log('[trace] set active vertical=banking ->', va.status);

  // ── Hop 1: user access token (T1) ──────────────────────────────────────────
  const tc = await client.get('/api/auth/oauth/token-claims');
  const t1claims = tc.data?.decoded?.payload || null;
  console.log('\n========== HOP 1 — USER TOKEN (T1) ==========');
  console.log('  token-claims status:', tc.status);
  console.log('  ', summarizeClaims(t1claims));

  // ── Drive via MCP Inspector invoke (full gateway pipeline) ──────────────────
  console.log('\n========== MCP INSPECTOR INVOKE (full gateway path) ==========');
  const inv = await client.post('/api/mcp/inspector/invoke', { tool: TOOL, params: {} });
  console.log('  HTTP', inv.status, '| keys:', Object.keys(inv.data || {}).join(', '));
  const result = inv.data?.result;
  const isErr = result?.isError === true;
  const text = result?.content?.[0]?.text;
  console.log('  result.isError:', isErr, '| text:', typeof text === 'string' ? text.slice(0, 160) : text);
  const meta = result?._meta;
  if (meta) {
    console.log('  result._meta.credentialPath:', meta.credentialPath, '| backendTransport:', meta.backendTransport);
    dumpTokenEvents('result._meta.tokenEvents', meta.tokenEvents);
  }
  if (inv.data?.tokenEvents) dumpTokenEvents('invoke.tokenEvents', inv.data.tokenEvents);
  if (inv.data?.inspector) console.log('  inspector:', JSON.stringify(inv.data.inspector));

  // ── Drive via agent invoke (real gateway path, heuristic) ───────────────────
  console.log('\n========== AGENT INVOKE (heuristic) ==========');
  const ai = await client.post('/api/agent/invoke', { prompt: PROMPT, forceHeuristic: true });
  console.log('  HTTP', ai.status, '| success:', ai.data?.success, '| reply:', String(ai.data?.reply || '').slice(0, 140));
  console.log('  response keys:', Object.keys(ai.data || {}).join(', '));
  // Recursively find every tokenEvents array anywhere in the response.
  const found = [];
  (function walk(node, pathStr) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.tokenEvents)) found.push([pathStr + '.tokenEvents', node.tokenEvents]);
    if (node._meta && Array.isArray(node._meta.tokenEvents)) found.push([pathStr + '._meta.tokenEvents', node._meta.tokenEvents]);
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') walk(v, `${pathStr}.${k}`);
    }
  })(ai.data, 'agent');
  if (!found.length) console.log('  (no tokenEvents arrays found anywhere in response)');
  for (const [p, ev] of found) dumpTokenEvents(p, ev);
  // Also surface any mcp tool-call result text (success/invalid_token)
  const mcpText = JSON.stringify(ai.data).match(/invalid_token|Banking API error|"isError":true/);
  if (mcpText) console.log('  ⚠️ backend error signal in response:', mcpText[0]);

  console.log('\n[trace] done.');
  process.exit(0);
})().catch((e) => {
  console.error('[trace] ERROR:', e.message);
  process.exit(1);
});
