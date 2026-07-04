#!/usr/bin/env node
'use strict';

/**
 * gateway-parity-harness.js  (SP-1)
 *
 * Runtime behavioral-parity harness for the two MCP gateways:
 *   - Demo Agent Gateway   (Node)  default http://localhost:3005
 *   - PingOne Agent Gateway (IG)   default http://localhost:3036
 *
 * It replays the SAME request through BOTH gateways and asserts the
 * HTTP-observable enforcement outcome is identical on the dimensions that
 * define the contract: status code, WWW-Authenticate presence, and the
 * JSON-RPC error code (when the body is JSON-RPC).
 *
 * Complements the unit-level parity gates (decision.pinggateway-parity.test.js,
 * authorize.parity.test.js) which prove the DECISION payload matches; this
 * proves the two enforcement points BEHAVE the same over HTTP.
 *
 * Token tiers:
 *   - Tier A (always runs): token-free contract — /health, unauthenticated /mcp.
 *   - Tier B (gated): authenticated tool-call parity. Requires a real delegated
 *     RS256 bearer that BOTH gateways accept, supplied via GW_TEST_BEARER. The
 *     gateways are asymmetric on mock HS256 (Node rejects, IG JWKS accepts), so
 *     a mock token cannot drive both — a real token is required. Skipped (not
 *     failed) when absent.
 *
 * Usage:
 *   node scripts/gateway-parity-harness.js
 *   GW_NODE_URL=http://localhost:3005 GW_IG_URL=http://localhost:3037 \
 *     GW_TEST_BEARER="<rs256-delegated-token>" node scripts/gateway-parity-harness.js
 *
 * Exit code 0 = all applicable cases at parity; 1 = at least one divergence.
 */

const NODE_URL = (process.env.GW_NODE_URL || 'http://localhost:3005').replace(/\/$/, '');
const IG_URL   = (process.env.GW_IG_URL   || 'http://localhost:3036').replace(/\/$/, '');
const BEARER   = process.env.GW_TEST_BEARER || '';
const TIMEOUT_MS = parseInt(process.env.GW_TIMEOUT_MS || '5000', 10);

// A parity dimension extractor: turns a fetch Response (+parsed body) into the
// small comparable shape we assert equality on.
async function probe(baseUrl, { path, method = 'GET', headers = {}, body }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal: ctrl.signal,
    });
    let json = null;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { /* not json */ }
    return {
      ok: true,
      status: res.status,
      wwwAuth: res.headers.has('www-authenticate'),
      jsonRpcErr: json && json.error && typeof json.error === 'object' ? json.error.code : null,
      snippet: text.slice(0, 120),
    };
  } catch (err) {
    return { ok: false, status: null, wwwAuth: false, jsonRpcErr: null, snippet: `ERR ${err.name}: ${err.message}` };
  } finally {
    clearTimeout(t);
  }
}

// Which dimensions to compare for a case (default: status only).
function compare(a, b, dims) {
  const diffs = [];
  for (const d of dims) {
    if (JSON.stringify(a[d]) !== JSON.stringify(b[d])) diffs.push(`${d}: node=${JSON.stringify(a[d])} ig=${JSON.stringify(b[d])}`);
  }
  return diffs;
}

const authHeaders = BEARER
  ? { Authorization: `Bearer ${BEARER}`, 'Content-Type': 'application/json', Accept: 'application/json' }
  : null;

// ── Cases ────────────────────────────────────────────────────────────────────
// tier A = token-free contract; tier B = requires GW_TEST_BEARER.
const CASES = [
  {
    name: 'health returns 200',
    tier: 'A',
    req: { path: '/health', method: 'GET' },
    dims: ['status'],
  },
  {
    name: 'unauthenticated /mcp is rejected (401)',
    tier: 'A',
    req: { path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
           body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } },
    dims: ['status', 'wwwAuth'],
  },
  {
    name: 'authenticated tools/list parity',
    tier: 'B',
    req: () => ({ path: '/mcp', method: 'POST', headers: authHeaders,
                  body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }),
    dims: ['status'],
  },
  {
    name: 'malformed JSON-RPC rejected identically',
    tier: 'B',
    req: () => ({ path: '/mcp', method: 'POST', headers: authHeaders,
                  body: { not: 'jsonrpc' } }),
    dims: ['status', 'jsonRpcErr'],
  },
  {
    name: 'unknown MCP method rejected identically',
    tier: 'B',
    req: () => ({ path: '/mcp', method: 'POST', headers: authHeaders,
                  body: { jsonrpc: '2.0', id: 1, method: 'no/such/method' } }),
    dims: ['status', 'jsonRpcErr'],
  },
];

async function main() {
  console.log(`Gateway parity harness`);
  console.log(`  Node (Demo Agent Gateway):    ${NODE_URL}`);
  console.log(`  IG   (PingOne Agent Gateway): ${IG_URL}`);
  console.log(`  Tier B (authenticated):       ${BEARER ? 'ENABLED (GW_TEST_BEARER set)' : 'SKIPPED (set GW_TEST_BEARER to enable)'}`);
  console.log('');

  let pass = 0, fail = 0, skip = 0;
  for (const c of CASES) {
    if (c.tier === 'B' && !BEARER) {
      console.log(`  SKIP  ${c.name}  (needs GW_TEST_BEARER)`);
      skip++;
      continue;
    }
    const req = typeof c.req === 'function' ? c.req() : c.req;
    const [node, ig] = await Promise.all([probe(NODE_URL, req), probe(IG_URL, req)]);

    if (!node.ok || !ig.ok) {
      console.log(`  FAIL  ${c.name}  (transport)  node=${node.snippet} ig=${ig.snippet}`);
      fail++;
      continue;
    }
    const diffs = compare(node, ig, c.dims);
    if (diffs.length === 0) {
      console.log(`  PASS  ${c.name}  [${c.dims.map(d => `${d}=${JSON.stringify(node[d])}`).join(', ')}]`);
      pass++;
    } else {
      console.log(`  FAIL  ${c.name}`);
      for (const d of diffs) console.log(`          ${d}`);
      fail++;
    }
  }

  console.log('');
  console.log(`  ${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('harness crashed:', e); process.exit(2); });
