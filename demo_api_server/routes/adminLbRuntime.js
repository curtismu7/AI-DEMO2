'use strict';

/**
 * adminLbRuntime.js — runtime park/unpark for the mcpgw-lb HAProxy pods.
 *
 * HAProxy's runtime API is a line protocol on a TCP socket (`stats socket
 * :9999 level admin` in the chart's haproxy.cfg, behind the headless Service
 * mcpgw-lb-sock). The headless DNS returns BOTH pod IPs, so every command is
 * fanned out to each resolved address — park state must agree across pods or
 * the two pods' pinning/health state diverges (GATEWAY-LOAD-BALANCER.md's
 * invariant: both pods hash and probe identically).
 *
 * Guards live on the mount in server.js (authenticateToken + requireAdmin).
 *
 * # ponytail: no NetworkPolicy on :9999, so any in-cluster pod could dial the
 * socket if it learned the address; fine for the demo threat model — add one
 * when the SE cluster hosts strangers. Runtime park also resets when the LB
 * pods roll; persistent parking still goes through gateway1-lb.values.yaml.
 */

const express = require('express');
const net = require('net');
const dns = require('dns').promises;

const router = express.Router();

// "host:port,host:port" — one per LB pod. A host may be the headless Service
// DNS name (mcpgw-lb-sock...svc.cluster.local), which resolves to EVERY pod
// IP — resolved4 below fans out per A record, because net.createConnection
// would silently pick only the first address and park half the LB.
const SOCKETS = (process.env.MCPGW_LB_RUNTIME_SOCKETS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const GATEWAYS_BACKEND = 'gateways';

/**
 * Expand configured "host:port" entries to one address per pod: a host that
 * resolves to several A records (the headless Service) yields one entry each.
 * @param {string[]} sockets
 * @returns {Promise<string[]>} "ip:port" entries, one per LB pod
 */
async function resolvePods(sockets) {
  const expanded = await Promise.all(sockets.map(async (s) => {
    const [host, port] = s.split(':');
    try {
      const addrs = await dns.resolve4(host);
      return addrs.map((a) => `${a}:${port}`);
    } catch {
      return [s]; // literal IP, or resolution is broken — let the connect fail visibly
    }
  }));
  return [...new Set(expanded.flat())];
}

/**
 * Send one line command to one HAProxy runtime socket, collect the answer.
 * @param {string} host
 * @param {number} port
 * @param {string} command
 * @returns {Promise<string>} full response text
 */
function runtimeCommand(host, port, command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let out = '';
    socket.setTimeout(3000);
    socket.on('connect', () => socket.write(command + '\n'));
    socket.on('data', (chunk) => (out += chunk));
    socket.on('end', () => resolve(out));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`timeout waiting for ${host}:${port}`));
    });
    socket.on('error', reject);
  });
}

/**
 * Run a command against every configured pod. One pod failing does not fail
 * the others — the response reports per-pod errors so the UI can show them.
 * @param {string} command
 * @returns {Promise<{ok: string[], replies: Map<string, string>, errors: string[]}>}
 *   ok: addresses that answered; replies: address -> response text.
 */
async function fanOut(command) {
  const pods = await resolvePods(SOCKETS);
  const results = await Promise.allSettled(
    pods.map((s) => {
      const [host, port] = s.split(':');
      return runtimeCommand(host, Number(port), command);
    }),
  );
  const ok = [];
  const replies = new Map();
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      ok.push(pods[i]);
      replies.set(pods[i], r.value);
    } else {
      errors.push(`${pods[i]}: ${r.reason.message}`);
    }
  });
  return { ok, replies, errors };
}

/**
 * Parse `show stat` CSV into one row per gateway node. Skips FRONTEND rows
 * and anything outside the gateways backend.
 * @param {string} csv
 * @returns {{name: string, status: string, sessions: number}[]}
 */
function parseGateways(csv) {
  const nodes = [];
  for (const line of csv.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split(',');
    if (cols[0] !== GATEWAYS_BACKEND || cols[1] === 'FRONTEND') continue;
    nodes.push({
      name: cols[1],
      status: cols[2] || 'UNKNOWN',
      sessions: Number(cols[3]) || 0,
    });
  }
  return nodes;
}

// The live node list comes from HAProxy itself; an unknown node gets 404 and
// nothing is sent to the pods. [\w.-] also keeps a newline from smuggling a
// second command in via the node name.
const NODE_NAME = /^[\w.-]+$/;

// ── /stats-view: the PingOne-SSO front for HAProxy's built-in stats page ────
// The topology page's iframe points here instead of at /lb-stats directly:
// the mount's authenticateToken + requireAdmin is the gate (the demo's
// PingOne sign-in), and the stats credential never reaches the browser.
// Env: MCPGW_LB_STATS_URL (absolute, e.g. https://mcpgw…/lb-stats) and
// MCPGW_LB_STATS_AUTH ("Basic base64(user:password)" — pre-encoded so this
// file never holds the password itself).

const http = require('http');
const https = require('https');

// Rewrite HAProxy's absolute /lb-stats* hrefs onto this proxy path; anchors
// and fragments stay as-is. HAProxy emits exactly: /lb-stats, /lb-stats;csv…,
// /lb-stats;json…, /lb-stats;norefresh, /lb-stats;up.
function rewriteStatsHrefs(html, proxyBase) {
  return html.replace(/(href|action)="\/lb-stats([^"]*)"/g, `$1="${proxyBase}$2"`);
}

router.get('/stats-view;csv', async (req, res) => {
  req.statsVariant = ';csv';
  return statsViewHandler(req, res);
});

router.get('/stats-view', statsViewHandler);

async function statsViewHandler(req, res) {
  const url = process.env.MCPGW_LB_STATS_URL;
  const auth = process.env.MCPGW_LB_STATS_AUTH;
  if (!url || !auth) {
    return res.status(503).send('stats view not configured: set MCPGW_LB_STATS_URL and MCPGW_LB_STATS_AUTH');
  }
  const target = url + (req.statsVariant || '');
  const mod = target.startsWith('https:') ? https : http;
  const upstream = await new Promise((resolve) => {
    const r = mod.get(target, { headers: { authorization: auth } }, resolve);
    r.on('error', (e) => resolve({ error: e.message }));
    r.setTimeout(8000, () => {
      r.destroy();
      resolve({ error: 'timeout fetching stats page' });
    });
  });
  if (upstream.error) {
    return res.status(502).send(`stats page fetch failed: ${upstream.error}`);
  }
  if (upstream.statusCode !== 200) {
    upstream.resume();
    return res.status(502).send(`stats page upstream status ${upstream.statusCode}`);
  }
  let body = '';
  for await (const chunk of upstream) body += chunk;
  const proxyBase = req.baseUrl + '/stats-view';
  res.set('content-type', 'text/html; charset=utf-8');
  if (upstream.headers.refresh) res.set('refresh', upstream.headers.refresh);
  res.send(rewriteStatsHrefs(body, proxyBase));
}

router.get('/', async (req, res) => {
  const { ok, replies, errors } = await fanOut('show stat');
  if (!ok.length) {
    return res.status(502).json({ error: 'no LB runtime socket reachable', errors });
  }
  const merged = new Map();
  for (const addr of ok) {
    for (const node of parseGateways(replies.get(addr))) {
      // Both pods probe identically; a disagreement names both answers rather
      // than silently picking one.
      const seen = merged.get(node.name);
      merged.set(node.name, !seen ? node
        : seen.status === node.status ? node
        : { ...node, status: `${seen.status}/${node.status}` });
    }
  }
  res.json({ nodes: [...merged.values()], errors });
});

router.post('/:node/:action(park|unpark)', async (req, res) => {
  const { node, action } = req.params;
  if (!NODE_NAME.test(node)) return res.status(404).json({ error: 'unknown node' });
  // Membership check against the pods' own state: an unknown node gets 404
  // and nothing is sent to the pods.
  const { ok: statOk, replies, errors: statErrors } = await fanOut('show stat');
  const known = new Set(statOk.flatMap((addr) => parseGateways(replies.get(addr)).map((n) => n.name)));
  if (!known.has(node)) {
    return res.status(404).json({ error: `unknown node ${node}`, known: [...known], errors: statErrors });
  }
  const verb = action === 'park' ? 'disable' : 'enable';
  const { ok, errors } = await fanOut(`${verb} server ${GATEWAYS_BACKEND}/${node}`);
  if (!ok.length) {
    return res.status(502).json({ error: `no LB runtime socket accepted ${verb}`, errors });
  }
  res.json({ node, action, appliedTo: ok.length, errors });
});

module.exports = { router, parseGateways, NODE_NAME };
