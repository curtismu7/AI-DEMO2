'use strict';
/**
 * /mcp-facade/:door/mcp — recording façade for external MCP clients (LM Studio,
 * LibreChat) calling this demo's gateway doors.
 *
 * Implements docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md
 * §3: relay every JSON-RPC call to the real gateway unchanged, record one ledger
 * hop per phase, and append a `reel_url:` text block to every tools/call result
 * so the client can show the movie reel (LM Studio renders it as a link — see
 * docs/superpowers/specs/2026-08-24-lmstudio-mcp-client-design.md §5.3).
 *
 * Two deliberate differences from that spec:
 *   - §3.2: lives in the BFF instead of a standalone service — the ledger is
 *     in-process (no /internal/transaction-hop round trip), and the Priv-Agent
 *     dispatcher + TLS are already here.
 *   - §3.3: forwards the CLIENT's own bearer instead of owning an upstream OAuth
 *     session. LM Studio / LibreChat complete RFC 9728 → DCR → PKCE themselves;
 *     the façade only has to advertise itself as the protected resource and
 *     point the client at the real authorization server.
 *
 * Doors:
 *   agent-gateway  → demo_mcp_gateway HTTP /mcp (its OAuth broker is the AS). The
 *                    gateway records its own gateway.authorize hop keyed by the
 *                    X-Correlation-ID we forward, so the real P1AZ decision lands
 *                    in the same ledger record.
 *   agentless      → Privilege agentless gateway, `external` application.
 *   agent          → Privilege agent mode (the installed Priv Agent IS the
 *                    identity — no OAuth, no Authorization header).
 */
const express = require('express');
const crypto = require('crypto');
const ledger = require('../services/lmdb/transactionLedger.lmdb');
const { getProcyonDispatcher, isProcyonAgentUrl, decodeMcpBody } = require('./privilegeMcpClient');
const { assemble } = require('../services/transactionAssembler');
const configStore = require('../services/configStore');
const { renderReelSvg } = require('../services/reelSvg');

const router = express.Router();
const SERVICE = 'mcp-facade';

const DOORS = {
  'agent-gateway': {
    label: 'Agent Gateway',
    upstream: () => process.env.MCP_FACADE_AGENT_GATEWAY_URL || 'http://mcp-gateway:3005/mcp',
    // The gateway's own OAuth broker (PR #2353) as the CLIENT reaches it.
    authorizationServer: () => process.env.MCP_FACADE_AGENT_GATEWAY_AS || 'http://localhost:3005',
    scopes: ['read', 'write', 'transfer', 'mcp:invoke'],
    forwardCorrelation: true,
    // ponytail: the Node gateway's initialize reply advertises the UPSTREAM's
    // protocolVersion (2026-07-28 from mcp-server) but its own header check only
    // accepts 2025-11-25 and tolerates absence — so a spec-following client that
    // echoes the negotiated version 400s on every call after initialize. Drop the
    // header for this door until the gateway advertises what it accepts
    // (TECH_DEBT: "Agent Gateway HTTP /mcp protocol-version mismatch").
    dropProtocolHeader: true,
  },
  agentless: {
    label: 'Privilege agentless',
    upstream: () => process.env.MCP_FACADE_AGENTLESS_URL
      || 'https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp',
    authorizationServer: () => process.env.MCP_FACADE_AGENTLESS_AS
      || 'https://cmuir-agentless-mcpgw.ping-devops.com/external',
    scopes: [],
    forwardCorrelation: false,
  },
  agent: {
    label: 'Privilege agent',
    upstream: () => process.env.PRIVILEGE_AGENT_MCPGW_URL
      || 'https://opensearch.default.applications.procyon.ai:8643/mcp',
    authorizationServer: null,
    scopes: [],
    forwardCorrelation: false,
  },
};

// What we learned about each upstream MCP session (keyed by Mcp-Session-Id):
// the catalog the reel shows next to a tool call. ponytail: bounded Map, FIFO.
const MAX_SESSIONS = 200;
const sessions = new Map();
function sessionFor(id) {
  if (!id) return null;
  let s = sessions.get(id);
  if (!s) {
    s = { client: null, server: null, capabilities: null, tools: null, resources: null };
    sessions.set(id, s);
    if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  }
  return s;
}

const MAX_DETAIL_CHARS = 8000;
function clip(value) {
  if (value === undefined) return null;
  const s = JSON.stringify(value);
  if (!s || s.length <= MAX_DETAIL_CHARS) return value;
  return { truncated: true, chars: s.length, preview: s.slice(0, MAX_DETAIL_CHARS) };
}

function identityFromBearer(auth) {
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return { sub: null, act: [] };
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    const scopes = typeof p.scope === 'string' ? p.scope.split(/\s+/).filter(Boolean)
      : Array.isArray(p.scope) ? p.scope : [];
    return { sub: p.sub || null, act: [], aud: p.aud || null, scopes, clientId: p.client_id || null };
  } catch {
    return { sub: null, act: [], opaque: true };
  }
}

function hop(correlationId, h) {
  try {
    ledger.appendHop(correlationId, { service: SERVICE, ...h });
  } catch (err) {
    console.warn('[mcpFacade] hop failed:', err?.message);
  }
}

function facadeBase(req) {
  return `${req.protocol}://${req.get('host')}/mcp-facade/${req.params.door}`;
}

// Where the reel_url points. Deliberately NOT PUBLIC_APP_URL: the embed page is
// public (no session cookie), so it needs no special hostname — localhost:4000
// resolves on every box with zero /etc/hosts dependency, which is what a link
// LM Studio shows or an iframe LibreChat embeds actually needs.
function reelBase() {
  return process.env.MCP_FACADE_REEL_BASE || 'https://localhost:4000';
}

// Replace the upstream's resource_metadata pointer with ours — the client can
// only GET metadata for the resource it is actually talking to (this façade).
// Also widen the challenge's `scope`: MCP clients ask the AS for exactly what
// the challenge names, before scopes_supported. The gateway names only
// `mcp:invoke`, so LM Studio logged in with a token that could not call any
// tool (`insufficient_scope: missing read`, seen live 2026-08-25).
function rewriteChallenge(www, prmUrl, scopes = []) {
  let stripped = String(www || 'Bearer').replace(/,?\s*resource_metadata="[^"]*"/, '').trim();
  if (scopes.length) {
    const scope = `scope="${scopes.join(' ')}"`;
    stripped = /\bscope="[^"]*"/.test(stripped)
      ? stripped.replace(/\bscope="[^"]*"/, scope)
      : `${stripped}${/^Bearer$/i.test(stripped) ? ' ' : ', '}${scope}`;
  }
  const sep = /^Bearer$/i.test(stripped) ? ' ' : ', ';
  return `${stripped}${sep}resource_metadata="${prmUrl}"`;
}

router.param('door', (req, res, next, name) => {
  if (!DOORS[name]) return res.status(404).json({ error: 'unknown_door', doors: Object.keys(DOORS) });
  req.door = DOORS[name];
  return next();
});

// RFC 9728 — this façade is the protected resource; the AS is the real one.
router.get('/:door/.well-known/oauth-protected-resource', (req, res) => {
  const base = facadeBase(req);
  const body = {
    resource: `${base}/mcp`,
    bearer_methods_supported: ['header'],
    scopes_supported: req.door.scopes,
    resource_name: `Demo MCP façade (${req.door.label})`,
  };
  if (req.door.authorizationServer) body.authorization_servers = [req.door.authorizationServer()];
  res.set('Cache-Control', 'no-store');
  return res.json(body);
});

function forwardHeaders(req, correlationId) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const passthrough = ['authorization', 'mcp-session-id'];
  if (!req.door.dropProtocolHeader) passthrough.push('mcp-protocol-version');
  for (const h of passthrough) {
    const v = req.get(h);
    if (v) headers[h] = v;
  }
  if (correlationId && req.door.forwardCorrelation) headers['X-Correlation-ID'] = correlationId;
  return headers;
}

function fetchOpts(upstreamUrl) {
  return isProcyonAgentUrl(upstreamUrl) ? { dispatcher: getProcyonDispatcher() } : {};
}

router.post('/:door/mcp', express.json({ limit: '1mb', type: () => true }), async (req, res) => {
  const door = req.door;
  const rpc = req.body && typeof req.body === 'object' ? req.body : {};
  const method = typeof rpc.method === 'string' ? rpc.method : '';
  const isCall = method === 'tools/call';
  const toolName = isCall ? String(rpc.params?.name || '') : null;
  const correlationId = isCall ? crypto.randomUUID() : null;
  const inbound = sessionFor(req.get('mcp-session-id'));
  const upstreamUrl = door.upstream();

  if (isCall) {
    hop(correlationId, {
      phase: 'ui.request',
      op: `tools/call ${toolName}`,
      identity: identityFromBearer(req.get('authorization')),
      status: 'ok',
      details: {
        door: req.params.door,
        doorLabel: door.label,
        upstream: upstreamUrl,
        client: inbound?.client || null,
        server: inbound?.server || null,
        capabilities: inbound?.capabilities || null,
        tools: inbound?.tools || null,
        resources: inbound?.resources || null,
        arguments: clip(rpc.params?.arguments ?? {}),
      },
    });
  }

  const t0 = Date.now();
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: forwardHeaders(req, correlationId),
      body: JSON.stringify(rpc),
      ...fetchOpts(upstreamUrl),
    });
  } catch (err) {
    if (isCall) {
      hop(correlationId, { phase: 'mcp.tool', op: toolName, status: 'error', durationMs: Date.now() - t0, details: { error: err.message } });
      hop(correlationId, { phase: 'response', op: 'tools/call', status: 'error', details: { httpStatus: 502 } });
    }
    return res.status(502).json({ error: 'upstream_unavailable', message: err.message });
  }

  const text = await upstream.text();
  const durationMs = Date.now() - t0;
  const parsed = decodeMcpBody(text);
  const upstreamSession = upstream.headers.get('mcp-session-id');

  const sess = sessionFor(upstreamSession) || inbound;
  if (sess) {
    if (method === 'initialize') {
      sess.client = rpc.params?.clientInfo || null;
      sess.server = parsed?.result?.serverInfo || null;
      sess.capabilities = parsed?.result?.capabilities || null;
    } else if (method === 'tools/list' && Array.isArray(parsed?.result?.tools)) {
      sess.tools = parsed.result.tools.map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 160) }));
    } else if (method === 'resources/list' && Array.isArray(parsed?.result?.resources)) {
      sess.resources = parsed.result.resources.map((r) => ({ uri: r.uri, name: r.name, description: String(r.description || '').slice(0, 160) }));
    }
  }

  res.status(upstream.status);
  if (upstreamSession) res.set('Mcp-Session-Id', upstreamSession);
  if (upstream.status === 401) {
    res.set('WWW-Authenticate', rewriteChallenge(upstream.headers.get('www-authenticate'), `${facadeBase(req)}/.well-known/oauth-protected-resource`, door.scopes));
  }

  if (!isCall) {
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(text);
  }

  const rpcError = parsed?.error || null;
  const ok = upstream.ok && !rpcError && !parsed?.result?.isError;
  const status = ok ? 'ok' : 'error';
  if (!door.forwardCorrelation) {
    // Privilege doors expose no policy trail — infer from the HTTP outcome and
    // say so (TransactionTracePage renders source:'inferred' as a guess).
    const denied = upstream.status === 401 || upstream.status === 403;
    hop(correlationId, {
      phase: 'gateway.authorize',
      op: toolName,
      status,
      decision: { outcome: denied ? 'deny' : 'permit', by: door.label, reason: `HTTP ${upstream.status}`, source: 'inferred' },
    });
  }
  hop(correlationId, {
    phase: 'mcp.tool',
    op: toolName,
    status,
    durationMs,
    details: { httpStatus: upstream.status, result: clip(parsed?.result ?? null), error: rpcError },
  });
  const reelUrl = `${reelBase()}/transaction-trace/embed/${correlationId}`;
  hop(correlationId, { phase: 'response', op: 'tools/call', status, details: { httpStatus: upstream.status, reelUrl } });

  if (parsed?.result && Array.isArray(parsed.result.content)) {
    // First line stays machine-parseable (`reel_url: <url>` — LibreChat's
    // artifact instruction keys on it). The rest is for the MODEL: without it,
    // LM Studio's model judged the bare localhost link a debug artifact and
    // hid it from the user (seen live 2026-08-25).
    const reelImage = `${req.protocol}://${req.get('host')}/mcp-facade/reel/${correlationId}.svg`;
    parsed.result.content.push({
      type: 'text',
      text: `reel_url: ${reelUrl}\n`
        + 'Transaction trace ("movie reel") for this tool call: who called, the gateway\'s '
        + 'authorization decision, the MCP request and response. Always show this link to the '
        + 'user as a clickable link so they can open it — it is part of the answer, not debug output.\n'
        + `![Transaction trace](${reelImage})`,
    });
    res.set('Content-Type', 'application/json');
    return res.send(JSON.stringify(parsed));
  }
  res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
  return res.send(text);
});

// GET /mcp-facade/reel/:correlationId.svg — the image the tool result embeds.
// No auth (the id is the capability, same as /api/transaction-trace/embed).
// Always answers with an SVG: an <img> cannot show a JSON error.
router.get('/reel/:correlationId.svg', async (req, res) => {
  res.set('Content-Type', renderReelSvg.CONTENT_TYPE);
  res.set('Cache-Control', 'no-store');
  if (configStore.getEffective('ff_transaction_ledger') === 'false') {
    return res.send(renderReelSvg(null, { title: 'Transaction trace — recording is off (ff_transaction_ledger)' })
      .replace('Waiting for the first hop…', 'Enable ff_transaction_ledger on the Feature Flags page to record.'));
  }
  let record = null;
  try {
    record = await assemble(req.params.correlationId);
  } catch (err) {
    console.warn('[mcpFacade] reel svg read failed:', err?.message);
  }
  return res.send(renderReelSvg(record));
});

// No server-initiated stream through the façade; spec-compliant clients treat
// 405 as "not offered".
router.get('/:door/mcp', (req, res) => res.status(405).end());

router.delete('/:door/mcp', async (req, res) => {
  const upstreamUrl = req.door.upstream();
  try {
    const upstream = await fetch(upstreamUrl, { method: 'DELETE', headers: forwardHeaders(req, null), ...fetchOpts(upstreamUrl) });
    sessions.delete(req.get('mcp-session-id'));
    return res.status(upstream.status).end();
  } catch (err) {
    return res.status(502).json({ error: 'upstream_unavailable', message: err.message });
  }
});

module.exports = router;
module.exports.__test = { DOORS, rewriteChallenge, sessions };
