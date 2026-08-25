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
  'pingone-admin': {
    label: 'PingOne Admin',
    // No real upstream fetch — see localHandler. Display-only, for hop details.
    upstream: () => 'local:pingone-admin (config/admin/tools.js)',
    // Worker client_credentials, baked in server-side — same model as the
    // `agent` door above (the identity is fixed, not the caller's own
    // login), so no OAuth challenge at all, matching authorizationServer:
    // null there. Every caller through this door gets the same worker-level
    // PingOne admin access; there is no per-user distinction.
    authorizationServer: null,
    scopes: [],
    forwardCorrelation: false,
    localHandler: pingoneAdminLocalHandler,
  },
};

/**
 * Local-only MCP handler for the pingone-admin door: no upstream fetch, no
 * session concept to proxy (the hosted PingOne MCP server is stateless per
 * mcpPingOneHttpAdapter.js's own comment) — a session id is minted here
 * purely so the rest of this file's session-tracking pipeline (reel
 * correlation, tool/capability caching) works unchanged for this door too.
 *
 * Exposes the hosted catalog RAW (mcpPingOneHttpAdapter's own listTools/
 * callTool) — every tool the worker token's admin roles unlock, full JSON
 * schemas, no cap. Measured live 2026-08-25: 85 tools, ~373KB of schema —
 * this count moves with PingOne's own management-API coverage and the
 * worker's roles, so treat any specific number here as a snapshot, not a
 * guarantee. A client that auto-attaches every tool from this door (a bare
 * chat picker, not an Agent builder's per-tool selection) will blow past a
 * small model's context window the same way the raw catalog already did for
 * bankingAgentLangGraphService.js's own pingone-admin path before that fix —
 * this door deliberately does NOT carry that fix, by request.
 *
 * Returns a fetch Response-shaped object ({status, headers, text()}) so the
 * caller (POST /:door/mcp) doesn't need a separate code path for this door.
 */
async function pingoneAdminLocalHandler({ rpc, method, sessionIdIn }) {
  const { listTools, callTool } = require('../services/mcpPingOneHttpAdapter');
  const headers = new Map();
  const respond = (status, body) => ({ status, headers, text: async () => JSON.stringify(body) });

  if (method === 'notifications/initialized' || String(method).startsWith('notifications/')) {
    if (sessionIdIn) headers.set('mcp-session-id', sessionIdIn);
    return { status: 202, headers, text: async () => '' };
  }

  const sessionId = sessionIdIn || crypto.randomUUID();
  headers.set('mcp-session-id', sessionId);

  if (method === 'initialize') {
    return respond(200, {
      jsonrpc: '2.0',
      id: rpc.id ?? null,
      result: {
        protocolVersion: rpc.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'PingOne Admin (hosted MCP)', version: '1.0.0' },
      },
    });
  }
  if (method === 'tools/list') {
    let tools;
    try {
      tools = await listTools();
    } catch (err) {
      return respond(200, { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32000, message: `pingone_mcp_unavailable: ${err.message}` } });
    }
    return respond(200, { jsonrpc: '2.0', id: rpc.id ?? null, result: { tools } });
  }
  if (method === 'tools/call') {
    const name = String(rpc.params?.name || '');
    const args = rpc.params?.arguments || {};
    let result;
    try {
      result = await callTool(name, args);
    } catch (err) {
      return respond(200, { jsonrpc: '2.0', id: rpc.id ?? null, result: { isError: true, content: [{ type: 'text', text: `pingone_mcp_unavailable: ${err.message}` }] } });
    }
    return respond(200, { jsonrpc: '2.0', id: rpc.id ?? null, result });
  }
  return respond(200, { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: `Method not found: ${method}` } });
}

// What we learned about each upstream MCP session (keyed by Mcp-Session-Id):
// the catalog the reel shows next to a tool call, plus the session's reel
// correlation id (`cid`). ponytail: bounded Map; evicts BEFORE inserting the
// newcomer so a new session is never its own eviction victim, preferring a
// cid-less entry so an established reel is never forked mid-session.
const MAX_SESSIONS = 200;
const sessions = new Map();
function sessionFor(id) {
  if (!id) return null;
  let s = sessions.get(id);
  if (!s) {
    if (sessions.size >= MAX_SESSIONS) {
      // Bounded: drop the oldest session that has no reel yet; only if every
      // existing session already owns a reel (cid) drop the oldest of those —
      // never the session being created, so a new conversation always keeps
      // its reel id and an established one is forked only at the hard bound.
      const victim = [...sessions].find(([, v]) => !v.cid)?.[0] ?? sessions.keys().next().value;
      sessions.delete(victim);
    }
    s = { cid: null, denied: null, client: null, server: null, capabilities: null, tools: null, resources: null };
    sessions.set(id, s);
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
  const passthrough = ['authorization', 'mcp-session-id', 'mcp-protocol-version'];
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

function reelBlockFor(req, correlationId) {
  const reelUrl = `${reelBase()}/transaction-trace/embed/${correlationId}`;
  const reelImage = `${req.protocol}://${req.get('host')}/mcp-facade/reel/${correlationId}.svg`;
  // Data, not commands: an imperative sentence here ("always show this link")
  // was correctly flagged as prompt injection by qwen3 in LM Studio and the
  // link was dropped (2026-08-25). The ask to surface it belongs in the
  // chat's system prompt (lmstudio/README.md); the block just describes
  // what the link and image are.
  const reelBlock = {
    type: 'text',
    text: `reel_url: ${reelUrl}\n`
      + `reel_image: ${reelImage}\n`
      + 'Transaction trace ("movie reel") for this tool call: who called, the gateway\'s '
      + 'authorization decision, the MCP request and response.\n'
      + `![Transaction trace](${reelImage})`,
  };
  return { reelUrl, reelImage, reelBlock };
}

function deniedMessage(door, denied) {
  return `You have been denied by Policy. ${door.label} refused ${denied.method}: ${denied.reason}`;
}

function deniedInitializeResult(rpc, door, denied) {
  return {
    protocolVersion: rpc.params?.protocolVersion || '2025-06-18',
    capabilities: { tools: {} },
    serverInfo: { name: `${door.label} (access denied)`, version: '0' },
    // MCP `instructions` is the server's sanctioned channel into the model's
    // context — the one place a "tell the user" message is not injection.
    instructions: `${deniedMessage(door, denied)} Tell the user they were denied by policy; no tools are available.`,
  };
}

// A door said 403 before any session existed (Privilege agent: "User … doesn't
// have access to MCP app …"). A raw 403 kills the client's plugin and the user
// sees nothing, so the façade hands out a "denied" session instead: initialize
// succeeds with the denial in `instructions`, tools/list exposes one
// policy_denied tool carrying the reason, any call answers with the same
// message as an isError result — and every step lands on the reel as a DENY.
function respondDeniedSession(req, res, { rpc, method, isCall, toolName, correlationId, session, door }) {
  const denied = session.denied;
  const msg = deniedMessage(door, denied);
  res.set('Mcp-Session-Id', req.get('mcp-session-id'));
  res.set('Content-Type', 'application/json');
  if (method.startsWith('notifications/')) return res.status(202).end();
  if (method === 'initialize') {
    return res.status(200).send(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: deniedInitializeResult(rpc, door, denied) }));
  }
  if (method === 'tools/list') {
    return res.status(200).send(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: { tools: [
      { name: 'policy_denied', description: msg, inputSchema: { type: 'object', properties: {} } },
    ] } }));
  }
  if (isCall) {
    hop(correlationId, { phase: 'gateway.authorize', op: toolName, status: 'error',
      decision: { outcome: 'deny', by: door.label, reason: denied.reason, source: 'inferred' } });
    hop(correlationId, { phase: 'mcp.tool', op: toolName, status: 'error', durationMs: 0, details: { httpStatus: 403, error: { message: denied.reason } } });
    const { reelUrl, reelBlock } = reelBlockFor(req, correlationId);
    hop(correlationId, { phase: 'response', op: 'tools/call', status: 'error', details: { httpStatus: 403, reelUrl } });
    return res.status(200).send(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: { isError: true, content: [{ type: 'text', text: msg }, reelBlock] } }));
  }
  return res.status(200).send(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: {} }));
}

router.post('/:door/mcp', express.json({ limit: '1mb', type: () => true }), async (req, res) => {
  const door = req.door;
  const rpc = req.body && typeof req.body === 'object' ? req.body : {};
  const method = typeof rpc.method === 'string' ? rpc.method : '';
  const isCall = method === 'tools/call';
  const toolName = isCall ? String(rpc.params?.name || '') : null;
  const inbound = sessionFor(req.get('mcp-session-id'));
  // One reel per MCP session: minted on the first request (initialize has no
  // session id yet), remembered on the session when the upstream issues its
  // Mcp-Session-Id, reused for every later request that carries it — so the
  // whole lifecycle (initialize → tools/list → tools/call…) and the gateway's
  // own decisions for each step land on the same record.
  const correlationId = inbound?.cid || crypto.randomUUID();
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

  if (inbound?.denied) {
    return respondDeniedSession(req, res, { rpc, method, isCall, toolName, correlationId, session: inbound, door });
  }

  const t0 = Date.now();
  let upstream;
  try {
    upstream = door.localHandler
      ? await door.localHandler({ rpc, method, sessionIdIn: req.get('mcp-session-id') })
      : await fetch(upstreamUrl, {
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
    if (!sess.cid) sess.cid = correlationId;
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
    // Every lifecycle step is on the reel — except unauthenticated probes,
    // which are discovery noise, not a transaction.
    if (upstream.status !== 401) {
      const details = { httpStatus: upstream.status, door: req.params.door, doorLabel: door.label, error: clip(parsed?.error ?? null) };
      if (method === 'initialize') {
        Object.assign(details, {
          client: rpc.params?.clientInfo || null,
          protocolVersion: parsed?.result?.protocolVersion || null,
          server: parsed?.result?.serverInfo || null,
          capabilities: parsed?.result?.capabilities || null,
        });
      } else if (method === 'tools/list') {
        details.toolCount = Array.isArray(parsed?.result?.tools) ? parsed.result.tools.length : null;
      } else if (method === 'resources/list') {
        details.resourceCount = Array.isArray(parsed?.result?.resources) ? parsed.result.resources.length : null;
      }
      hop(correlationId, {
        phase: 'mcp.step',
        op: method || 'unknown',
        status: upstream.ok && !parsed?.error ? 'ok' : 'error',
        durationMs,
        ...(method === 'initialize' ? { identity: identityFromBearer(req.get('authorization')) } : {}),
        details,
      });
    }
    if (upstream.status === 403) {
      const reason = parsed?.error?.message || parsed?.message || (typeof parsed?.error === 'string' ? parsed.error : '') || text.slice(0, 200) || 'no reason given';
      hop(correlationId, { phase: 'gateway.authorize', op: method, status: 'error',
        decision: { outcome: 'deny', by: door.label, reason: String(reason).trim(), source: 'inferred' } });
      if (method === 'initialize') {
        const sid = `denied-${crypto.randomUUID()}`;
        const denied = sessionFor(sid);
        denied.cid = correlationId;
        denied.denied = { reason: String(reason).trim(), method };
        denied.server = { name: `${door.label} (access denied)`, version: '0' };
        denied.client = rpc.params?.clientInfo || null;
        res.status(200).set('Mcp-Session-Id', sid).set('Content-Type', 'application/json');
        return res.send(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: deniedInitializeResult(rpc, door, denied.denied) }));
      }
      res.set('Content-Type', 'application/json');
      return res.send(JSON.stringify({ error: 'policy_denied', message: `You have been denied by Policy. ${door.label} refused ${method || 'the request'}: ${String(reason).trim()}` }));
    }
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
  const { reelUrl, reelBlock } = reelBlockFor(req, correlationId);
  hop(correlationId, { phase: 'response', op: 'tools/call', status, details: { httpStatus: upstream.status, reelUrl } });

  if (upstream.status === 403) {
    // A 403 on tools/call is the door's policy saying no — the one error the
    // demo audience should read verbatim. Hand it to the model the MCP way
    // (a tool result with isError) instead of a transport error it paraphrases.
    const reason = rpcError?.message || parsed?.message || parsed?.error || text.slice(0, 200) || 'no reason given';
    res.status(200).set('Content-Type', 'application/json');
    return res.send(JSON.stringify({
      jsonrpc: '2.0',
      id: rpc.id ?? null,
      result: {
        isError: true,
        content: [
          { type: 'text', text: `You have been denied by Policy.\n${door.label} refused ${toolName}: ${String(reason).trim()}` },
          reelBlock,
        ],
      },
    }));
  }

  if (parsed?.result && Array.isArray(parsed.result.content)) {
    parsed.result.content.push(reelBlock);
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
    return res.send(renderReelSvg(null, {
      title: 'Transaction trace — recording is off (ff_transaction_ledger)',
      subtitle: 'Enable ff_transaction_ledger on the Feature Flags page to record.',
    }));
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
  if (req.door.localHandler) {
    // Stateless upstream (see pingoneAdminLocalHandler) — nothing to tear
    // down but this door's own local session-tracking entry.
    sessions.delete(req.get('mcp-session-id'));
    return res.status(200).end();
  }
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
module.exports.__test = { DOORS, rewriteChallenge, sessions, MAX_SESSIONS };
