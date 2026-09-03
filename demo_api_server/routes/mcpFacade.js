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
const jwksService = require('../services/jwksService');
const privilegeGatewaySession = require('../services/privilegeGatewaySession');

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
    // DARK since 2026-09-01, deliberately. This is the BANKING door (`/external`),
    // and cmuir-agentless-mcpgw.ping-devops.com no longer resolves — that gateway
    // was torn down when the estate moved to the one AI Gateway at
    // mcpgw.ai-demo.ping-devops.com. Repointing needs a banking MCP server
    // registered there as its own Agentic App; only `opensearch22` exists today,
    // and pointing this door at an OpenSearch app would silently serve the wrong
    // tools. Leave it dark until that app exists, then set MCP_FACADE_AGENTLESS_URL.
    upstream: () => process.env.MCP_FACADE_AGENTLESS_URL
      || 'https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp',
    authorizationServer: () => process.env.MCP_FACADE_AGENTLESS_AS
      || 'https://cmuir-agentless-mcpgw.ping-devops.com/external',
    scopes: [],
    forwardCorrelation: false,
  },
  audit: {
    label: 'PingOne audit (scope-narrowed)',
    // Same upstream as the agent-gateway door — the gateway is NOT audit-only,
    // and must not be. What makes this door narrow is `scopes` below: it is
    // advertised in this door's oauth-protected-resource metadata and in its
    // 401 challenge, so a client discovers `audit:read` and asks for only that.
    // The gateway then filters tools/list to what the token permits
    // (guardToolsList -> vertical filter -> scope-denied split), leaving the
    // three demo_mcp_audit tools. A caller through agent-gateway gets the full
    // banking surface from the very same code path.
    //
    // So the narrowing is per-URL and enforced on the token, not a filter here
    // — do not add a tool allowlist to this door, or a scope regression would
    // stop being visible.
    upstream: () => process.env.MCP_FACADE_AUDIT_URL || 'http://mcp-gateway:3005/mcp',
    authorizationServer: () => process.env.MCP_FACADE_AGENT_GATEWAY_AS || 'http://localhost:3005',
    scopes: ['audit:read'],
    forwardCorrelation: true,
  },
  agent: {
    label: 'Privilege agent',
    // DARK since 2026-09-01: the agent-mode frontends below resolve through the
    // Priv Agent's DNS proxy but have no gateway behind them — the agent-based
    // release (cm-mcpgw) was uninstalled, and the AI Gateway chart exposes no
    // inbound mesh port, so these hang rather than fail fast. The live client
    // path is now https://mcpgw.ai-demo.ping-devops.com/<app>/mcp.
    upstream: () => process.env.PRIVILEGE_AGENT_MCPGW_URL
      || 'https://opensearch.default.applications.procyon.ai:8643/mcp',
    authorizationServer: null,
    scopes: [],
    forwardCorrelation: false,
  },
  'agent-cmuir': {
    label: 'Privilege agent (cmuir OpenSearch)',
    // Second Agentic App under the same ai-demo-agent Mesh Cluster as the
    // `agent` door above, registered 2026-08-26 against
    // ping-mcpgw-opensearch-mcp-server.ping-devops-cmuir (see mcpFacade.test.js).
    upstream: () => process.env.PRIVILEGE_AGENT_CMUIR_MCPGW_URL
      || 'https://opensearch-cmuir.default.applications.procyon.ai:8643/mcp',
    authorizationServer: null,
    scopes: [],
    forwardCorrelation: false,
  },
  opensearch: {
    label: 'OpenSearch',
    // Cross-namespace FQDN, not a short name: there were briefly TWO OpenSearch
    // MCP servers — this one (Helm release cm-mcpgw, up 8d, the one the Mac
    // port-forward always used) and a duplicate in the BFF's own namespace from
    // a release whose gateway crash-looped on an expired ENV_PROXY_TOKEN. The
    // duplicate was uninstalled 2026-08-26, so the surviving server does NOT
    // live beside the BFF and a short name would not resolve.
    //
    // Renamed 2026-09-01: the cm-mcpgw release is gone too. The AI Gateway chart
    // (release agentless-mcpgw) names its objects WITHOUT a release prefix, so
    // the live service is `opensearch-mcp-server` in the same namespace.
    upstream: () => process.env.MCP_FACADE_OPENSEARCH_URL
      || 'http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local:80/mcp',
    // Reuses the Agent Gateway's OAuth broker: the client runs the same
    // RFC 9728 -> 8414 -> 7591 -> PKCE dance it already does for that door.
    authorizationServer: () => process.env.MCP_FACADE_AGENT_GATEWAY_AS || 'http://localhost:3005',
    scopes: ['mcp:invoke'],
    forwardCorrelation: false,
    // THE REASON THIS DOOR EXISTS. The OpenSearch MCP server has no auth of
    // its own -- it answers any caller -- so unlike every other door here the
    // façade cannot rely on the upstream to issue the 401 that starts the
    // OAuth dance (see the `upstream.status === 401` branch in relay()). It
    // would happily relay anonymous traffic to a tool set that includes
    // SearchIndexTool and GenericOpenSearchApiTool. requireBearer makes the
    // FAÇADE do the challenging and the verifying instead.
    requireBearer: true,
    // Explicit, not resolveExpectedMcpResourceUri(): that helper answers for
    // whichever gateway the demo UI is routed to (PingGateway's URI when
    // ff_mcp_gateway_pinggateway is ON, as it is on SE), but the token a client
    // gets from the broker above is always minted for the NODE gateway's own
    // resource. Verified against a live broker token: aud
    // ['mcpgateway.ping.demo'], iss https://auth.pingone.com/<env>/as, RS256.
    // Deriving it from routing mode would reject every valid token on SE.
    expectedAudience: () => process.env.MCP_FACADE_OPENSEARCH_AUD
      || process.env.MCP_GW_RESOURCE_URI
      || 'mcpgateway.ping.demo',
  },
  banking: {
    label: 'Banking (oauth-mcp)',
    // oauth-mcp already advertises its own OAuth (RFC 9728 -> 8414 -> PKCE), so
    // this door is a pure proxy, same shape as the agent-gateway door: no
    // façade-level challenge, the upstream's own 401 is what the client sees.
    upstream: () => process.env.MCP_FACADE_BANKING_URL || 'http://mcp-server:8080/mcp',
    authorizationServer: null,
    scopes: [],
    forwardCorrelation: false,
  },
  brave: {
    label: 'Brave Search',
    // mcp-brave has no auth of its own -- same reasoning as the opensearch
    // door above: requireBearer makes the FAÇADE challenge and verify instead
    // of relaying anonymous traffic straight to the tool.
    upstream: () => process.env.MCP_FACADE_BRAVE_URL || 'http://mcp-brave:8897/mcp',
    authorizationServer: () => process.env.MCP_FACADE_AGENT_GATEWAY_AS || 'http://localhost:3005',
    scopes: ['mcp:invoke'],
    forwardCorrelation: false,
    requireBearer: true,
    expectedAudience: () => process.env.MCP_FACADE_OPENSEARCH_AUD
      || process.env.MCP_GW_RESOURCE_URI
      || 'mcpgateway.ping.demo',
  },
  'privilege-gateway': {
    label: 'Privilege AI Gateway',
    // The door that survives a gateway restart. Everything else that talks to
    // the AI Gateway registers with the GATEWAY's authorization server, whose
    // client registry is in memory — so a restart forgets the client and the
    // MCP client dead-ends on "Unknown client" until someone re-adds it by
    // hand. Here the client registers with OUR broker (durable) and the gateway
    // leg is held server-side by services/privilegeGatewaySession.js, which the
    // BFF re-establishes on its own. The client's config never breaks.
    //
    // The gateway still enforces its own per-user policy: what goes upstream is
    // the token minted for the human who signed in at /privilege-mcp-client,
    // not a service identity.
    // One door, every registered Agentic App: /privilege-gateway/<app>/mcp
    // resolves to <gateway>/<app>/mcp. Without the segment the door falls back
    // to the default app, so the shorter URL keeps working.
    multiApp: true,
    upstream: () => process.env.MCP_FACADE_PRIVILEGE_GATEWAY_URL
      || `${privilegeGatewayBase()}/${process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP || 'opensearch22'}/mcp`,
    upstreamFor: (app) => `${privilegeGatewayBase()}/${app}/mcp`,
    authorizationServer: () => process.env.MCP_FACADE_AGENT_GATEWAY_AS || 'http://localhost:3005',
    scopes: [],
    forwardCorrelation: false,
    // Same reasoning as the opensearch door: this door does not let the
    // upstream issue the 401, because it attaches its own upstream credential —
    // anonymous traffic would otherwise ride the operator's gateway session.
    requireBearer: true,
    expectedAudience: () => process.env.MCP_FACADE_OPENSEARCH_AUD
      || process.env.MCP_GW_RESOURCE_URI
      || 'mcpgateway.ping.demo',
    // Replaces the caller's bearer on the upstream hop instead of forwarding it.
    ownsUpstreamAuth: true,
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
  // The app segment belongs in the base: RFC 9728 discovery and the 401
  // challenge must name the URL the client actually called, or a multi-app
  // client authenticates for one app and then calls another.
  const app = req.params.app ? `/${req.params.app}` : '';
  return `${req.protocol}://${req.get('host')}/mcp-facade/${req.params.door}${app}`;
}

// Origin of the Privilege AI Gateway, without a trailing slash so the app
// segment can be appended cleanly.
function privilegeGatewayBase() {
  return String(process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE || 'https://mcpgw.ai-demo.ping-devops.com')
    .replace(/\/+$/, '');
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

// The app segment is interpolated into the upstream URL, so it is validated as
// a NAME and never as a path: no slashes, no colon, no percent-escapes. Without
// this an app of `..%2F..%2Fadmin` — or an absolute URL — would steer the
// façade's authenticated upstream hop somewhere it was never meant to reach.
// Express decodes the segment before this runs, so the check sees the real value.
const APP_SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;

router.param('app', (req, res, next, name) => {
  if (!req.door?.multiApp) {
    return res.status(404).json({ error: 'door_takes_no_app', door: req.params.door });
  }
  if (!APP_SEGMENT.test(name)) {
    return res.status(400).json({ error: 'invalid_app', message: 'App name may contain letters, digits, dot, underscore and dash only.' });
  }
  return next();
});

// RFC 9728 — this façade is the protected resource; the AS is the real one.
// Both shapes share every handler: the bare door, and the door plus an Agentic
// App segment for multiApp doors. facadeBase() folds the segment into the
// advertised resource URL, so discovery answers for the exact URL called.
router.get(['/:door/.well-known/oauth-protected-resource', '/:door/:app/.well-known/oauth-protected-resource'], (req, res) => {
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

/**
 * Verify a door's inbound bearer when the upstream will not do it for us
 * (door.requireBearer). Full RS256 verification against PingOne's JWKS —
 * signature, expiry, and audience — because a decode-only check would accept
 * any self-made JWT, which is the same as no gate at all.
 *
 * Fails CLOSED: any missing key, malformed token, or JWKS error denies. The
 * caller turns a denial into the RFC 9728 challenge that starts the OAuth
 * dance, so a denial is a recoverable "go authenticate", not a dead end.
 *
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
async function verifyDoorBearer(req, door) {
  const raw = String(req.get('authorization') || '');
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!m) return { ok: false, reason: 'missing_bearer' };
  const token = m[1].trim();
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed_token' };

  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }
  if (header.alg !== 'RS256') return { ok: false, reason: 'unsupported_alg' };
  if (!header.kid) return { ok: false, reason: 'missing_kid' };

  let key;
  try {
    key = await jwksService.getPublicKey(header.kid);
  } catch {
    return { ok: false, reason: 'jwks_unavailable' };
  }
  if (!key) return { ok: false, reason: 'unknown_kid' };

  // jwksService can hand back a key shape crypto.Verify rejects outright (a
  // raw, unconverted JWK, say) rather than a usable PEM/KeyObject. That threw
  // out of this async function as an unhandled rejection — no response ever
  // sent, so the caller hung until nginx's own 60s upstream timeout, not the
  // "fails closed" this function promises. Same failure shape as a bad
  // signature: deny and let the caller re-challenge.
  let verified;
  try {
    verified = crypto.createVerify('RSA-SHA256')
      .update(`${parts[0]}.${parts[1]}`)
      .verify(key.keyObject, Buffer.from(parts[2], 'base64url'));
  } catch {
    return { ok: false, reason: 'verify_error' };
  }
  if (!verified) return { ok: false, reason: 'bad_signature' };

  // exp is seconds since epoch; treat a token with no exp as invalid rather
  // than eternal.
  if (typeof claims.exp !== 'number') return { ok: false, reason: 'missing_exp' };
  if (claims.exp * 1000 <= Date.now()) return { ok: false, reason: 'expired' };

  const expected = door.expectedAudience && door.expectedAudience();
  if (expected) {
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud].filter(Boolean);
    if (!aud.includes(expected)) return { ok: false, reason: 'audience_mismatch' };
  }
  return { ok: true };
}

function forwardHeaders(req, correlationId) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  // mcp-method / mcp-name are REQUIRED by MCP 2026-07-28 Streamable HTTP
  // whenever the body carries Modern `_meta`, and the gateway rejects a
  // mismatch with -32020. The façade forwards the body untouched, so dropping
  // these headers produced a request that declared Modern and then failed its
  // own contract: "Missing required header: Mcp-Method" on every tools/list
  // through a door, with the relay looking correct at both ends.
  // mcp-param-* carries x-mcp-header tool arguments (see addModernHeaders in
  // privilegeMcpClient.js) and is forwarded for the same reason.
  const passthrough = ['authorization', 'mcp-session-id', 'mcp-protocol-version', 'mcp-method', 'mcp-name'];
  for (const h of passthrough) {
    const v = req.get(h);
    if (v) headers[h] = v;
  }
  // Mcp-Param-* is an open-ended family (one per x-mcp-header tool argument),
  // so it cannot be listed above.
  for (const [name, value] of Object.entries(req.headers)) {
    if (name.toLowerCase().startsWith('mcp-param-') && typeof value === 'string') {
      headers[name] = value;
    }
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

router.post(['/:door/mcp', '/:door/:app/mcp'], express.json({ limit: '1mb', type: () => true }), async (req, res) => {
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
  const upstreamUrl = req.params.app && door.upstreamFor
    ? door.upstreamFor(req.params.app)
    : door.upstream();

  // Doors whose upstream has no auth of its own are gated HERE, before the
  // relay — otherwise anonymous traffic reaches it. Answering with the same
  // RFC 9728 challenge the upstream-401 path builds means an unauthenticated
  // client discovers the AS and completes OAuth exactly as it does elsewhere;
  // the door behaves like every other one from the client's side.
  if (door.requireBearer) {
    const verdict = await verifyDoorBearer(req, door);
    if (!verdict.ok) {
      res.set('WWW-Authenticate', rewriteChallenge(null, `${facadeBase(req)}/.well-known/oauth-protected-resource`, door.scopes));
      return res.status(401).json({
        jsonrpc: '2.0',
        id: rpc.id ?? null,
        error: { code: -32001, message: 'Unauthorized', data: { reason: verdict.reason } },
      });
    }
  }

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

  // A door that owns its upstream auth swaps the caller's bearer for the
  // server-side gateway session. Without one the honest answer is "a human has
  // to sign in", not a confusing 401 that sends the client back to OUR broker
  // it already satisfied.
  let upstreamHeaders = forwardHeaders(req, correlationId);
  if (door.ownsUpstreamAuth) {
    const upstreamToken = await privilegeGatewaySession.getAccessToken();
    if (!upstreamToken) {
      return res.status(503).json({
        jsonrpc: '2.0',
        id: rpc.id ?? null,
        error: {
          code: -32002,
          message: 'Gateway session unavailable',
          data: {
            reason: privilegeGatewaySession.status().reason,
            remedy: 'Sign in once at /privilege-mcp-client — the gateway forgets its clients on restart.',
          },
        },
      });
    }
    upstreamHeaders = { ...upstreamHeaders, authorization: `Bearer ${upstreamToken}` };
  }

  const t0 = Date.now();
  let upstream;
  try {
    upstream = door.localHandler
      ? await door.localHandler({ rpc, method, sessionIdIn: req.get('mcp-session-id') })
      : await fetch(upstreamUrl, {
        method: 'POST',
        headers: upstreamHeaders,
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
router.get(['/:door/mcp', '/:door/:app/mcp'], (req, res) => res.status(405).end());

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
module.exports.__test = { DOORS, rewriteChallenge, sessions, MAX_SESSIONS, verifyDoorBearer };
