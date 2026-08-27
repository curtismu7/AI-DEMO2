/**
 * demo_mcp_audit — three read-only PingOne audit tools over MCP Streamable HTTP.
 *
 * Deliberately NOT a proxy to PingOne's hosted MCP (mcp.pingone.com/admin/<env>/mcp).
 * That server stopped accepting worker `client_credentials` tokens — verified
 * 2026-08-27, it answers `401 Invalid authentication`, which is also why the
 * BFF's own `pingone-admin` façade door is currently broken. It wants a USER
 * token, which an unattended gateway backend cannot produce.
 *
 * The Management API's activities endpoint underneath it has no such
 * restriction and answers the same worker token fine (verified: HTTP 200, 547
 * events over 7 days), so these tools call that directly.
 *
 * Three tools, because three is all that is implemented — the gateway exposes
 * exactly this surface and there is nothing else here to reach.
 */
'use strict';

const http = require('node:http');

const PORT = parseInt(process.env.PORT || '8898', 10);
const REGION = process.env.PINGONE_REGION || 'com';
const ENV_ID = process.env.PINGONE_ENVIRONMENT_ID || '';
const CLIENT_ID = process.env.PINGONE_WORKER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.PINGONE_WORKER_CLIENT_SECRET || '';

// PingOne keeps roughly a week of audit history: a 30-day window returned zero
// events while 7 days returned 547 (measured 2026-08-27). Asking for more is
// not an error, it just silently comes back empty, which reads as "nothing
// happened" rather than "you asked past retention" — so clamp and say so.
const MAX_DAYS = 7;

let cachedToken = null; // { value, expiresAt }

async function workerToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  if (!ENV_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('missing PINGONE_ENVIRONMENT_ID / PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET');
  }
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`https://auth.pingone.${REGION}/${ENV_ID}/as/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`worker token HTTP ${res.status}`);
  const body = await res.json();
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in || 3600) * 1000),
  };
  return cachedToken.value;
}

function sinceIso(days) {
  const d = Math.min(Math.max(Number(days) || MAX_DAYS, 1), MAX_DAYS);
  return { iso: new Date(Date.now() - d * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z'), days: d };
}

async function fetchActivities({ days, limit }) {
  const token = await workerToken();
  const { iso, days: used } = sinceIso(days);
  const capped = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const filter = encodeURIComponent(`recordedat gt "${iso}"`);
  const url = `https://api.pingone.${REGION}/v1/environments/${ENV_ID}/activities?limit=${capped}&filter=${filter}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`activities HTTP ${res.status}`);
  const body = await res.json();
  return { activities: body?._embedded?.activities || [], windowDays: used, since: iso };
}

function slim(a) {
  const client = a?.actors?.client || {};
  const user = a?.actors?.user || {};
  return {
    id: a.id,
    recordedAt: a.recordedAt,
    type: a?.action?.type,
    description: a?.action?.description,
    client: client.name || client.id || null,
    user: user.name || user.id || null,
    resources: (a.resources || []).map((r) => ({ type: r.type, name: r.name || r.id })),
  };
}

const TOOLS = [
  {
    name: 'search_audit_activities',
    description:
      'Search PingOne audit events. Returns the most recent events in the window, newest first. '
      + `PingOne retains about ${MAX_DAYS} days — longer windows are clamped, not rejected.`,
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: `How far back to look, 1-${MAX_DAYS}. Default ${MAX_DAYS}.` },
        limit: { type: 'integer', description: 'Maximum events to return, 1-200. Default 100.' },
        eventType: { type: 'string', description: 'Optional exact action.type filter, e.g. APPLICATION.UPDATED.' },
      },
    },
  },
  {
    name: 'get_audit_activity',
    description: 'Fetch the full detail of one PingOne audit event by its activity id.',
    inputSchema: {
      type: 'object',
      properties: { activityId: { type: 'string', description: 'The audit activity UUID.' } },
      required: ['activityId'],
    },
  },
  {
    name: 'audit_summary',
    description:
      'Aggregate PingOne audit events in the window: counts by event type and by acting client. '
      + 'Use this to answer "what changed" or "which applications are actually being used".',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: `How far back to look, 1-${MAX_DAYS}. Default ${MAX_DAYS}.` },
      },
    },
  },
];

async function callTool(name, args) {
  if (name === 'search_audit_activities') {
    const { activities, windowDays, since } = await fetchActivities(args);
    const wanted = args?.eventType
      ? activities.filter((a) => a?.action?.type === args.eventType)
      : activities;
    return { windowDays, since, count: wanted.length, activities: wanted.map(slim) };
  }

  if (name === 'get_audit_activity') {
    const id = args?.activityId;
    if (!id) throw new Error('activityId is required');
    const token = await workerToken();
    const res = await fetch(
      `https://api.pingone.${REGION}/v1/environments/${ENV_ID}/activities/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`activity HTTP ${res.status}`);
    return await res.json();
  }

  if (name === 'audit_summary') {
    const { activities, windowDays, since } = await fetchActivities({ days: args?.days, limit: 200 });
    const byType = {};
    const byClient = {};
    for (const a of activities) {
      const t = a?.action?.type || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
      const c = a?.actors?.client || {};
      const key = c.name || c.id || '(none)';
      byClient[key] = (byClient[key] || 0) + 1;
    }
    const sortDesc = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
    return { windowDays, since, total: activities.length, byType: sortDesc(byType), byClient: sortDesc(byClient) };
  }

  throw new Error(`unknown tool: ${name}`);
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, tools: TOOLS.length, env: ENV_ID ? 'set' : 'missing' });
  }

  if (req.method !== 'POST' || !String(req.url).startsWith('/mcp')) {
    return send(res, 404, { error: 'not_found' });
  }

  let rpc;
  try {
    rpc = await readBody(req);
  } catch {
    return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }

  if (rpc.method === 'initialize') {
    return send(res, 200, {
      jsonrpc: '2.0',
      id: rpc.id,
      result: {
        protocolVersion: (rpc.params && rpc.params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'demo-mcp-audit', version: '1.0.0' },
      },
    });
  }

  if (rpc.method === 'notifications/initialized') {
    res.writeHead(202);
    return res.end();
  }

  if (rpc.method === 'tools/list') {
    return send(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { tools: TOOLS } });
  }

  if (rpc.method === 'tools/call') {
    const name = rpc?.params?.name;
    try {
      const out = await callTool(name, rpc?.params?.arguments || {});
      return send(res, 200, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: false },
      });
    } catch (e) {
      // Tool-level failure, not transport failure: report it inside the result
      // so the calling agent can read the reason instead of seeing a dead hop.
      return send(res, 200, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: { content: [{ type: 'text', text: `audit tool failed: ${e.message}` }], isError: true },
      });
    }
  }

  return send(res, 200, {
    jsonrpc: '2.0',
    id: rpc.id ?? null,
    error: { code: -32601, message: `Method not found: ${rpc.method}` },
  });
});

// Only bind when run as the entrypoint — the test suite requires this file for
// its pure helpers and must not leave a listener (or a live PingOne client)
// behind.
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[mcp-audit] listening on ${PORT} — ${TOOLS.length} tools, env ${ENV_ID || '(unset)'}`);
  });
}

module.exports = { TOOLS, callTool, sinceIso, slim, MAX_DAYS };
