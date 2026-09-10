'use strict';
// relay.js — OAuth PKCE + Dynamic Client Registration relay and MCP JSON-RPC
// relay for testing an OAuth-protected MCP gateway, with PingOne's Privilege
// AI Gateway as the documented default target.
//
// Adapted from the banking demo's demo_api_server/routes/privilegeMcpClient.js.
// Two things were cut in the adaptation, not just renamed:
//   - "Façade" mode (a durable OAuth broker + reverse proxy this relay ran for
//     itself, so a standalone MCP client's DCR registration survived a gateway
//     restart) — that requires hosting infrastructure this standalone tool
//     doesn't have. "Privilege" mode (straight at the gateway) and "Direct"
//     mode (any MCP server URL you supply, no gateway in the path) remain.
//   - The Privilege LLM-call policy comparison panel (/llm/*, /chat in the
//     original) — a separate feature testing Privilege's LLM Gateway, not the
//     MCP gateway this tool is about.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const doorStore = require('./doorStore');

const router = express.Router();

// ---------------------------------------------------------------------------
// Config — all overridable by env; defaults point at the public Ping AI Demo
// Privilege gateway so this works out of the box with zero setup.
// ---------------------------------------------------------------------------
const PRIVILEGE_GATEWAY_HOST = process.env.PRIVILEGE_GATEWAY_HOST || 'https://mcpgw.ai-demo.ping-devops.com';
const PRIVILEGE_APP = () => process.env.PRIVILEGE_GATEWAY_APP || 'opensearch22';
const PRIVILEGE_APP_OPENSEARCH = () => process.env.PRIVILEGE_GATEWAY_APP_OPENSEARCH || 'opensearch';
const PRIVILEGE_APP_BRAVE = () => process.env.PRIVILEGE_GATEWAY_APP_BRAVE || 'brave';

const DEFAULT_PRIVILEGE_MCP_URL = () => `${PRIVILEGE_GATEWAY_HOST}/${PRIVILEGE_APP()}/mcp`;
const DEFAULT_PRIVILEGE_OPENSEARCH_MCP_URL = () => `${PRIVILEGE_GATEWAY_HOST}/${PRIVILEGE_APP_OPENSEARCH()}/mcp`;
const DEFAULT_PRIVILEGE_BRAVE_MCP_URL = () => `${PRIVILEGE_GATEWAY_HOST}/${PRIVILEGE_APP_BRAVE()}/mcp`;
// No Privilege in the path. Defaults to the AI Demo's own façade
// (ai-demo.ping-devops.com) — verified live: it's a self-advertising OAuth
// broker with open Dynamic Client Registration (RFC 7591) and no shared
// secret, so this resolves the same way Privilege mode's default does, with
// zero setup. Override to point at any MCP server you run yourself.
const DEFAULT_DIRECT_MCP_URL = () => process.env.DIRECT_MCP_URL || 'https://ai-demo.ping-devops.com/mcp-facade/opensearch/mcp';
const DEFAULT_DIRECT_BRAVE_MCP_URL = () => process.env.DIRECT_BRAVE_MCP_URL || 'https://ai-demo.ping-devops.com/mcp-facade/brave/mcp';

function privilegeDoorUrl(appName) {
  return `${PRIVILEGE_GATEWAY_HOST}/${appName}/mcp`;
}

const GATEWAY_MODES = ['direct', 'privilege'];
const DEFAULT_GATEWAY_MODE = 'privilege';
const MCP_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_CLIENT_INFO = { name: 'AI Gateway Client', version: '1.0.0' };
const MCP_CLIENT_CAPABILITIES = {
  elicitation: { form: {}, url: {} },
  extensions: { 'io.modelcontextprotocol/tasks': {} },
};
// How long a POST may hang while the eventStream GET is open before fetchMcp
// assumes this gateway can't handle the two concurrently and falls back.
const EVENT_STREAM_GUARD_TIMEOUT_MS = Number(process.env.EVENT_STREAM_GUARD_TIMEOUT_MS) || 8000;

// ---------------------------------------------------------------------------
// Single-operator session — this is a local dev tool, not a multi-tenant
// service, so there's exactly one session, not one per caller.
// ---------------------------------------------------------------------------
function freshSession() {
  const oauthDefaults = {
    clientId: process.env.GATEWAY_CLIENT_ID || '',
    scopes: 'openid profile email',
  };
  const modeConfigs = {
    direct: { ...oauthDefaults, mcpUrl: DEFAULT_DIRECT_MCP_URL() },
    privilege: { ...oauthDefaults, mcpUrl: DEFAULT_PRIVILEGE_MCP_URL() },
  };
  return {
    config: { ...modeConfigs[DEFAULT_GATEWAY_MODE] },
    gatewayMode: DEFAULT_GATEWAY_MODE,
    gatewayConfigs: modeConfigs,
    // Per-(mode+door) oauth, kept OUT of gatewayConfigs (which is echoed back
    // to the client verbatim in /state and /config) so a token is never
    // serialized into a JSON body. Switching mode/door stashes the outgoing
    // key's token here and restores the destination key's, so revisiting an
    // already-signed-in door doesn't force a redundant /auth/start. Keyed by
    // door too: each door is its own OAuth audience.
    savedOauthByDoor: {},
    oauth: {
      accessToken: null, refreshToken: null, expiresAt: null, tokenUri: null, source: null,
      // Set when login went through a self-advertising gateway (the gateway
      // acting as its own AS) via Dynamic Client Registration — refresh must
      // reuse this client, not the configured one, or the token endpoint 400s.
      dcrClientId: null, dcrClientSecret: null,
    },
    tools: [],
    toolPolicy: { permitted: [], filtered: [], total: 0 },
    mcpSession: {
      era: null, initialized: false, protocolVersion: null, sessionId: null,
      nextRequestId: 1, capabilities: {}, serverInfo: null, instructions: '',
    },
    subscription: { controller: null, active: false },
    // Spec-standard Streamable HTTP persistent GET stream, opened best-effort
    // after initialize. Some gateway proxies hang a concurrent POST while
    // this is open — fetchMcp's timeout race auto-disables it on first hang,
    // falling back permanently to the always-safe POST-only pattern.
    eventStream: { controller: null, active: false, disabled: false },
    pendingAuth: null,
    // Privilege console credentials, pasted by the operator. In-memory only —
    // never persisted, never sent back to the client.
    console: null,
  };
}

let session = freshSession();

function getSession(req) {
  // Allow a caller that already holds a token to pass it directly via
  // Authorization: Bearer instead of going through /auth/start. Clears
  // refresh metadata: keeping a prior refreshToken/expiresAt/tokenUri would
  // let accessTokenExpiring() or a 401 retry silently replace this Bearer
  // with a different identity's access token.
  const auth = req.headers?.authorization;
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(\S+)/i);
    if (match) {
      session.oauth.accessToken = match[1];
      session.oauth.refreshToken = null;
      session.oauth.expiresAt = null;
      session.oauth.tokenUri = null;
      session.oauth.dcrClientId = null;
      session.oauth.dcrClientSecret = null;
    }
  }
  return session;
}

function sanitizeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || value.includes('?') || value.includes('#')) return null;
  return value;
}

// ---------------------------------------------------------------------------
// SSE event stream for live relay — a single set of listeners, since this is
// a single-operator tool.
// ---------------------------------------------------------------------------
const sseClients = new Set();

function emitEvent(_session, type, payload) {
  if (sseClients.size === 0) return;
  const msg = `event: ${type}\ndata: ${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n\n`;
  for (const client of sseClients) client.write(msg);
}

router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  });
  res.write('\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randomString(size = 32) {
  return crypto.randomBytes(size).toString('base64url');
}

function sha256Base64Url(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

function decodeMcpBody(text) {
  if (!text || !text.trim()) return {};
  try { return JSON.parse(text); } catch { /* continue */ }
  const lines = text.split('\n').map((l) => l.trim());
  const dataLines = lines
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  for (let i = dataLines.length - 1; i >= 0; i--) {
    try { return JSON.parse(dataLines[i]); } catch { /* continue */ }
  }
  return { raw: text };
}

function encodeMcpHeaderValue(value) {
  const text = String(value);
  const plainAscii = /^[\x20-\x7e]+$/.test(text)
    && text.trim() === text
    && !(text.startsWith('=?base64?') && text.endsWith('?='));
  return plainAscii ? text : `=?base64?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function modernRequestBody(body, protocolVersion = MCP_PROTOCOL_VERSION) {
  if (!body?.method) return body;
  return {
    ...body,
    params: {
      ...(body.params || {}),
      _meta: {
        ...(body.params?._meta || {}),
        'io.modelcontextprotocol/protocolVersion': protocolVersion,
        'io.modelcontextprotocol/clientInfo': MCP_CLIENT_INFO,
        'io.modelcontextprotocol/clientCapabilities': MCP_CLIENT_CAPABILITIES,
      },
    },
  };
}

function findTool(sess, name) {
  return sess.tools.find((tool) => tool.name === name);
}

function readArgumentAtPath(argumentsValue, argPath) {
  return argPath.split('.').reduce((value, part) => value?.[part], argumentsValue);
}

function addModernHeaders(headers, sess, body) {
  headers['MCP-Protocol-Version'] = sess.mcpSession.protocolVersion || MCP_PROTOCOL_VERSION;
  headers['Mcp-Method'] = body.method;
  if (['tools/call', 'prompts/get', 'resources/read'].includes(body.method)) {
    const name = body.params?.name ?? body.params?.uri;
    if (name !== undefined) headers['Mcp-Name'] = encodeMcpHeaderValue(name);
  }
  if (body.method !== 'tools/call') return;
  const schema = findTool(sess, body.params?.name)?.inputSchema;
  for (const [propertyName, property] of Object.entries(schema?.properties || {})) {
    const headerName = property?.['x-mcp-header'];
    if (!headerName) continue;
    const value = readArgumentAtPath(body.params?.arguments || {}, propertyName);
    if (value === undefined || value === null) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
    headers[`Mcp-Param-${headerName}`] = encodeMcpHeaderValue(value);
  }
}

function normalizeMcpFailure(status, text) {
  const snippet = text.slice(0, 300);
  if (status === 502) {
    const lower = text.toLowerCase();
    if (lower.includes('<html') || lower.includes('bad gateway') || lower.includes('nginx')) {
      return 'MCP gateway returned 502 Bad Gateway from upstream. You may not be authorized for the target MCP tools, or the upstream MCP service is unavailable.';
    }
  }
  return `MCP request failed: ${status} ${snippet}`;
}

/** Error carrying the upstream HTTP status, so a relay handler can answer with the same class of failure instead of flattening everything to 500. */
function mcpRelayError(status, text) {
  const err = new Error(normalizeMcpFailure(status, text));
  err.upstreamStatus = status;
  return err;
}

/** An upstream 4xx is the caller's problem and must survive the hop; anything else (5xx, network failure, a bug here) stays 500. */
function relayFailureStatus(err) {
  const status = err && err.upstreamStatus;
  return Number.isInteger(status) && status >= 400 && status < 500 ? status : 500;
}

function nextMcpRequestId(sess) {
  const id = sess.mcpSession.nextRequestId;
  sess.mcpSession.nextRequestId += 1;
  return id;
}

// Refresh a little before expiry so an in-flight relay never races the clock.
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

function accessTokenExpiring(sess) {
  if (!sess.oauth.expiresAt) return false;
  return Date.now() >= sess.oauth.expiresAt - TOKEN_REFRESH_SKEW_MS;
}

async function refreshAccessToken(sess) {
  if (!sess.oauth.refreshToken || !sess.oauth.tokenUri) return false;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: sess.oauth.refreshToken,
    client_id: sess.oauth.dcrClientId || sess.config.clientId,
  });
  const clientSecret = sess.oauth.dcrClientSecret || process.env.GATEWAY_CLIENT_SECRET || '';
  if (clientSecret) body.set('client_secret', clientSecret);

  let response;
  let data = {};
  try {
    response = await fetch(sess.oauth.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await response.text();
    try { data = JSON.parse(text); } catch { data = {}; }
  } catch (err) {
    emitEvent(sess, 'oauth', { phase: 'refresh_failed', error: err.message });
    return false;
  }

  if (!response.ok || !data.access_token) {
    sess.oauth.accessToken = null;
    sess.oauth.refreshToken = null;
    sess.oauth.expiresAt = null;
    emitEvent(sess, 'oauth', { phase: 'refresh_failed', status: response.status });
    return false;
  }

  sess.oauth.accessToken = data.access_token;
  if (data.refresh_token) sess.oauth.refreshToken = data.refresh_token;
  sess.oauth.expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null;
  if (data.scope) sess.oauth.scope = data.scope;
  emitEvent(sess, 'oauth', { phase: 'refresh_success', expiresIn: data.expires_in || null });
  return true;
}

async function fetchMcp(sess, pathname, body, withAuth = true, allowRefreshRetry = true) {
  if (!sess.config.mcpUrl) throw new Error('MCP URL is required');

  if (withAuth && accessTokenExpiring(sess)) {
    await refreshAccessToken(sess);
  }

  const targetUrl = new URL(sess.config.mcpUrl);
  if (pathname) targetUrl.pathname = pathname;

  const requestBody = sess.mcpSession.era === 'modern'
    ? modernRequestBody(body, sess.mcpSession.protocolVersion || MCP_PROTOCOL_VERSION)
    : body;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Origin: targetUrl.origin,
  };
  if (withAuth && sess.oauth.accessToken) {
    headers.Authorization = `Bearer ${sess.oauth.accessToken}`;
  }
  if (sess.mcpSession.era === 'legacy' && sess.mcpSession.sessionId) {
    headers['MCP-Session-Id'] = sess.mcpSession.sessionId;
  }
  // Privilege Cloud requires x-procyon-session-id on every request.
  if (targetUrl.hostname === 'privilege.pingone.com' || targetUrl.hostname.endsWith('.applications.privilege.pingone.com')) {
    if (!sess.config._procyonSessionId) sess.config._procyonSessionId = crypto.randomUUID();
    headers['x-procyon-session-id'] = sess.config._procyonSessionId;
  }
  if (sess.mcpSession.era === 'modern' && requestBody?.method) {
    addModernHeaders(headers, sess, requestBody);
  } else if (requestBody?.method && requestBody.method !== 'initialize') {
    headers['MCP-Protocol-Version'] = sess.mcpSession.protocolVersion || LEGACY_MCP_PROTOCOL_VERSION;
  }

  emitEvent(sess, 'relay', { direction: 'client->mcp', method: 'POST', url: targetUrl.toString(), body: requestBody });

  // Some gateway proxies hang a POST that arrives while this session's
  // eventStream GET is held open. Race a timeout only when that stream is
  // actually active — every other call is unaffected.
  const streamGuardActive = sess.eventStream.active;
  const abortController = streamGuardActive ? new AbortController() : null;
  const fetchPromise = fetch(targetUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    ...(abortController ? { signal: abortController.signal } : {}),
  });
  let response;
  if (streamGuardActive) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('EVENT_STREAM_GUARD_TIMEOUT')), EVENT_STREAM_GUARD_TIMEOUT_MS);
    });
    try {
      response = await Promise.race([fetchPromise, timeout]);
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.message !== 'EVENT_STREAM_GUARD_TIMEOUT') throw err;
      abortController.abort();
      disableMcpEventStream(sess);
      return fetchMcp(sess, pathname, body, withAuth, allowRefreshRetry);
    }
  } else {
    response = await fetchPromise;
  }
  const text = await response.text();
  const parsed = decodeMcpBody(text);

  const responseSessionId = response.headers.get('mcp-session-id') || response.headers.get('MCP-Session-Id');
  if (responseSessionId && responseSessionId !== sess.mcpSession.sessionId) {
    sess.mcpSession.sessionId = responseSessionId;
    emitEvent(sess, 'mcp', { phase: 'session_attached', sessionId: responseSessionId });
  }

  emitEvent(sess, 'relay', {
    direction: 'mcp->client',
    status: response.status,
    headers: { 'www-authenticate': response.headers.get('www-authenticate'), 'mcp-session-id': responseSessionId },
    body: parsed,
  });

  if (!response.ok) {
    if (response.status === 401 && withAuth && allowRefreshRetry && await refreshAccessToken(sess)) {
      return fetchMcp(sess, pathname, body, withAuth, false);
    }
    const err = mcpRelayError(response.status, text);
    err.rpcError = parsed?.error || null;
    throw err;
  }
  if (parsed?.error) {
    const err = new Error(`MCP RPC error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
    err.rpcError = parsed.error;
    err.upstreamStatus = response.status;
    throw err;
  }
  if (requestBody?.id !== undefined && parsed?.id !== requestBody.id) {
    throw new Error(`MCP response id mismatch: expected ${requestBody.id}, received ${parsed?.id ?? 'none'}`);
  }
  return parsed;
}

async function ensureMcpSessionInitialized(sess) {
  if (sess.mcpSession.initialized) return;

  if (!sess.mcpSession.era) {
    sess.mcpSession.era = 'modern';
    sess.mcpSession.protocolVersion = MCP_PROTOCOL_VERSION;
    const discoverRpc = { jsonrpc: '2.0', id: nextMcpRequestId(sess), method: 'server/discover', params: {} };
    try {
      const discovery = await fetchMcp(sess, null, discoverRpc, true);
      const result = discovery?.result || {};
      const supported = result.supportedVersions || [];
      if (supported.length && !supported.includes(MCP_PROTOCOL_VERSION)) {
        throw new Error(`MCP server does not support ${MCP_PROTOCOL_VERSION}; supported versions: ${supported.join(', ')}.`);
      }
      sess.mcpSession.capabilities = result.capabilities || {};
      sess.mcpSession.serverInfo = result._meta?.['io.modelcontextprotocol/serverInfo'] || null;
      sess.mcpSession.instructions = result.instructions || '';
      sess.mcpSession.initialized = true;
      emitEvent(sess, 'mcp', { phase: 'discovered', era: 'modern', protocolVersion: MCP_PROTOCOL_VERSION });
      return;
    } catch (err) {
      const modernError = [-32020, -32021, -32022].includes(err.rpcError?.code)
        || (err.upstreamStatus === 404 && err.rpcError?.code === -32601);
      if (modernError) throw err;
      const methodNotFound = err.rpcError?.code === -32601;
      if (!methodNotFound && ![400, 404, 405].includes(err.upstreamStatus)) throw err;
      sess.mcpSession.era = 'legacy';
      sess.mcpSession.protocolVersion = null;
      sess.mcpSession.nextRequestId = 1;
    }
  }

  const initRpc = {
    jsonrpc: '2.0',
    id: nextMcpRequestId(sess),
    method: 'initialize',
    params: { protocolVersion: LEGACY_MCP_PROTOCOL_VERSION, capabilities: MCP_CLIENT_CAPABILITIES, clientInfo: MCP_CLIENT_INFO },
  };
  const initResponse = await fetchMcp(sess, null, initRpc, true);
  const serverProtocol = initResponse?.result?.protocolVersion;
  if (!serverProtocol) throw new Error('MCP initialize response did not include a protocolVersion.');
  sess.mcpSession.protocolVersion = serverProtocol;
  sess.mcpSession.capabilities = initResponse?.result?.capabilities || {};
  sess.mcpSession.serverInfo = initResponse?.result?.serverInfo || null;
  sess.mcpSession.instructions = initResponse?.result?.instructions || '';

  await fetchMcp(sess, null, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, true);

  sess.mcpSession.initialized = true;
  emitEvent(sess, 'mcp', { phase: 'initialized', protocolVersion: serverProtocol });
  void openMcpEventStream(sess);
}

function resetMcpState(sess) {
  sess.subscription.controller?.abort();
  sess.subscription = { controller: null, active: false };
  sess.eventStream.controller?.abort();
  sess.eventStream = { controller: null, active: false, disabled: false };
  sess.tools = [];
  sess.toolPolicy = { permitted: [], filtered: [], total: 0 };
  sess.mcpSession.era = null;
  sess.mcpSession.initialized = false;
  sess.mcpSession.protocolVersion = null;
  sess.mcpSession.sessionId = null;
  sess.mcpSession.nextRequestId = 1;
  sess.mcpSession.capabilities = {};
  sess.mcpSession.serverInfo = null;
  sess.mcpSession.instructions = '';
}

/** Best-effort: open the persistent GET /mcp SSE stream Streamable HTTP allows a client to hold alongside POSTs. Failure here is never fatal. */
async function openMcpEventStream(sess) {
  if (sess.eventStream.disabled || sess.eventStream.active) return;
  if (!sess.mcpSession.sessionId) return;
  const targetUrl = new URL(sess.config.mcpUrl);
  const headers = {
    Accept: 'text/event-stream',
    'MCP-Session-Id': sess.mcpSession.sessionId,
    'MCP-Protocol-Version': sess.mcpSession.protocolVersion || LEGACY_MCP_PROTOCOL_VERSION,
    Origin: targetUrl.origin,
  };
  if (sess.oauth.accessToken) headers.Authorization = `Bearer ${sess.oauth.accessToken}`;
  const controller = new AbortController();
  let response;
  try {
    response = await fetch(targetUrl, { method: 'GET', headers, signal: controller.signal });
  } catch (err) {
    emitEvent(sess, 'mcp', { phase: 'event_stream_open_failed', message: err.message });
    return;
  }
  if (!response.ok || !response.body?.getReader) {
    controller.abort();
    return;
  }
  sess.eventStream = { controller, active: true, disabled: false };
  emitEvent(sess, 'mcp', { phase: 'event_stream_opened' });
  const reader = response.body.getReader();
  void (async () => {
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // Aborted by disableMcpEventStream, or the connection dropped — either
      // way this is not fatal, fetchMcp already fell back to POST-only.
    } finally {
      if (sess.eventStream.controller === controller) {
        sess.eventStream = { controller: null, active: false, disabled: sess.eventStream.disabled };
      }
      emitEvent(sess, 'mcp', { phase: 'event_stream_closed' });
    }
  })();
}

/** Permanently (for this session) stop opening the GET event stream, after fetchMcp's timeout race catches a hung concurrent POST. */
function disableMcpEventStream(sess) {
  sess.eventStream.controller?.abort();
  sess.eventStream = { controller: null, active: false, disabled: true };
  emitEvent(sess, 'mcp', { phase: 'event_stream_disabled', reason: 'concurrent_request_timeout' });
}

async function startModernSubscription(sess, types) {
  await ensureMcpSessionInitialized(sess);
  if (sess.mcpSession.era !== 'modern') {
    throw new Error('subscriptions/listen requires MCP 2026-07-28.');
  }
  sess.subscription.controller?.abort();
  const controller = new AbortController();
  const rpc = modernRequestBody({
    jsonrpc: '2.0', id: nextMcpRequestId(sess), method: 'subscriptions/listen', params: { types },
  }, sess.mcpSession.protocolVersion);
  const targetUrl = new URL(sess.config.mcpUrl);
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream', Origin: targetUrl.origin };
  addModernHeaders(headers, sess, rpc);
  if (sess.oauth.accessToken) headers.Authorization = `Bearer ${sess.oauth.accessToken}`;
  const response = await fetch(targetUrl, { method: 'POST', headers, body: JSON.stringify(rpc), signal: controller.signal });
  if (!response.ok) {
    const text = await response.text();
    throw mcpRelayError(response.status, text);
  }
  if (!response.body?.getReader) throw new Error('MCP subscription response is not streamable.');
  sess.subscription = { controller, active: true };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const data = frame.split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim()).join('\n');
          if (!data) continue;
          let message;
          try { message = JSON.parse(data); } catch { message = { raw: data }; }
          emitEvent(sess, 'subscription', { message });
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') emitEvent(sess, 'error', { scope: 'subscription', message: err.message });
    } finally {
      if (sess.subscription.controller === controller) {
        sess.subscription = { controller: null, active: false };
      }
      emitEvent(sess, 'subscription', { phase: 'closed' });
    }
  })();
}

function isExpiredMcpSessionError(err) {
  return err.message.includes('invalid during session initialization')
    || err.message.includes('Unknown or expired MCP-Session-Id');
}

async function callMcp(sess, method, params = {}) {
  await ensureMcpSessionInitialized(sess);
  const rpc = { jsonrpc: '2.0', id: nextMcpRequestId(sess), method, params };
  try {
    return await fetchMcp(sess, null, rpc, true);
  } catch (err) {
    if (sess.mcpSession.era !== 'legacy' || !isExpiredMcpSessionError(err)) throw err;
    resetMcpState(sess);
    await ensureMcpSessionInitialized(sess);
    rpc.id = nextMcpRequestId(sess);
    return fetchMcp(sess, null, rpc, true);
  }
}

// No allowlist bounds an operator-configured MCP endpoint's pagination — a
// pagination bug on that upstream (repeating a cursor, or always emitting a
// fresh nextCursor) would hang the request indefinitely otherwise.
const MAX_MCP_PAGES = 100;

async function listAllMcpPages(sess, method, resultKey) {
  const items = [];
  const seenCursors = new Set();
  let cursor;
  let pages = 0;
  do {
    const data = await callMcp(sess, method, cursor ? { cursor } : {});
    items.push(...(data.result?.[resultKey] || []));
    cursor = data.result?.nextCursor;
    pages += 1;
    if (cursor && (seenCursors.has(cursor) || pages >= MAX_MCP_PAGES)) break;
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return items;
}

async function discoverPolicyTools(sess) {
  const permitted = [];
  const filteredByName = new Map();
  const seenCursors = new Set();
  let cursor;
  let pages = 0;
  do {
    const data = await callMcp(sess, 'tools/list', cursor ? { cursor } : {});
    const result = data.result || {};
    permitted.push(...(result.tools || []));
    for (const tool of result._meta?.deniedTools || []) {
      if (tool?.name) filteredByName.set(tool.name, tool);
    }
    cursor = result.nextCursor;
    pages += 1;
    if (cursor && (seenCursors.has(cursor) || pages >= MAX_MCP_PAGES)) break;
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  const filtered = [...filteredByName.values()];
  sess.tools = permitted;
  sess.toolPolicy = { permitted, filtered, total: permitted.length + filtered.length };
  return sess.toolPolicy;
}

function publicPolicySummary(sess) {
  const policy = sess.toolPolicy || { permitted: sess.tools || [], filtered: [], total: (sess.tools || []).length };
  return {
    total: policy.total,
    permitted: policy.permitted.length,
    filtered: policy.filtered.length,
    filteredTools: policy.filtered.map((tool) => ({ name: tool.name, reason: tool.deniedReason || 'Filtered by gateway policy.' })),
  };
}

/**
 * RFC 9728 -> RFC 8414 discovery for an MCP resource that advertises a
 * protected-resource document. Elicits the challenge with a POST — some
 * doors answer GET with 405 and no WWW-Authenticate, so a GET probe learns
 * nothing. Returns null (never throws) for a resource that isn't this shape,
 * so the caller falls through to its next branch.
 */
async function discoverProtectedResource(mcpUrl, headers = {}) {
  const probe = await fetch(mcpUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'discovery', method: 'tools/list', params: {} }),
  });
  if (probe.status !== 401) return null;

  const challenge = probe.headers.get('www-authenticate') || '';
  const metaUrl = challenge.match(/resource_metadata="([^"]+)"/)?.[1];
  if (!metaUrl) return null;

  const metaRes = await fetch(metaUrl, { method: 'GET' });
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();
  const asUrl = Array.isArray(meta.authorization_servers) ? meta.authorization_servers[0] : null;
  if (!asUrl) return null;

  const asMetaRes = await fetch(`${String(asUrl).replace(/\/$/, '')}/.well-known/oauth-authorization-server`, { method: 'GET' });
  if (!asMetaRes.ok) return null;
  const asMeta = await asMetaRes.json();
  if (!asMeta.authorization_endpoint || !asMeta.token_endpoint) return null;

  return {
    authorizationUri: asMeta.authorization_endpoint,
    tokenUri: asMeta.token_endpoint,
    issuer: asMeta.issuer || new URL(asMeta.authorization_endpoint).origin,
    // Drives DCR: this AS keeps its own client registry, so a configured
    // static client_id means nothing to it.
    selfAdvertised: true,
    // The whole point of a narrow door: without this, the flow would request
    // session.config.scopes and the gateway would hand back whatever that
    // implies rather than the door's own advertised scope.
    advertisedScopes: Array.isArray(meta.scopes_supported) ? meta.scopes_supported : [],
    tokenEndpointAuthMethods: Array.isArray(asMeta.token_endpoint_auth_methods_supported)
      ? asMeta.token_endpoint_auth_methods_supported
      : [],
  };
}

async function discoverAuth(sess) {
  const discoverHeaders = {};
  const mcpUrlParsed = new URL(sess.config.mcpUrl);
  if (mcpUrlParsed.hostname === 'privilege.pingone.com' || mcpUrlParsed.hostname.endsWith('.applications.privilege.pingone.com')) {
    if (!sess.config._procyonSessionId) sess.config._procyonSessionId = crypto.randomUUID();
    discoverHeaders['x-procyon-session-id'] = sess.config._procyonSessionId;
  }
  // An unreachable MCP URL must not abort discovery — the PingOne OIDC
  // fallback below can still resolve the endpoints.
  let response = null;
  let bodyText = '';
  let transportError = null;
  try {
    response = await fetch(sess.config.mcpUrl, { method: 'GET', headers: discoverHeaders });
    bodyText = await response.text();
  } catch (err) {
    transportError = err;
  }
  let body;
  try { body = JSON.parse(bodyText); } catch { body = {}; }

  const authHeader = (response && response.headers.get('www-authenticate')) || '';
  const authUriMatch = authHeader.match(/authorization_uri="([^"]+)"/);
  const authorizationUri = body.authorization_uri || (authUriMatch ? authUriMatch[1] : null);
  const tokenUri = body.token_uri || null;

  // selfAdvertised marks endpoints the gateway minted for itself (RFC 9728)
  // rather than a shared IdP's own — it is its own Authorization Server with
  // its own client registry, so callers must run Dynamic Client Registration
  // before using these endpoints.
  if (authorizationUri && tokenUri) {
    return { authorizationUri, tokenUri, selfAdvertised: true, issuer: body.issuer || new URL(authorizationUri).origin };
  }

  try {
    const rfc9728 = await discoverProtectedResource(sess.config.mcpUrl, discoverHeaders);
    if (rfc9728) return rfc9728;
  } catch (err) {
    emitEvent(sess, 'oauth', { phase: 'rfc9728_skipped', error: err.message });
  }

  // PingOne OIDC discovery fallback (Privilege Cloud authenticates via its
  // own SSO PingOne environment).
  try {
    const mcpUrl = new URL(sess.config.mcpUrl);
    const envMatch = mcpUrl.pathname.match(/\/v1\/environments\/([0-9a-fA-F-]{36})\/mcp\/?$/);
    let envId = envMatch?.[1] || process.env.PINGONE_ENVIRONMENT_ID;
    const authHost = mcpUrl.host.startsWith('api.') ? mcpUrl.host.replace(/^api\./, 'auth.') : 'auth.pingone.com';
    if (envId) {
      const wellKnownUrl = `https://${authHost}/${envId}/as/.well-known/openid-configuration`;
      const metaResponse = await fetch(wellKnownUrl, { method: 'GET' });
      if (metaResponse.ok) {
        const meta = await metaResponse.json();
        if (meta.authorization_endpoint && meta.token_endpoint) {
          return {
            authorizationUri: meta.authorization_endpoint,
            tokenUri: meta.token_endpoint,
            issuer: meta.issuer || new URL(meta.authorization_endpoint).origin,
          };
        }
      }
    }
  } catch { /* fall through */ }

  throw new Error(transportError
    ? `Failed to discover OAuth metadata: ${sess.config.mcpUrl} is unreachable (${transportError.message}), `
      + 'and no PINGONE_ENVIRONMENT_ID is set to fall back on.'
    : `Failed to discover OAuth metadata from MCP URL. status=${response.status}`);
}

// One registration per gateway origin for the life of the process — the
// gateway mints a fresh client_id on every POST /register, so re-registering
// per login would leak a new client on the gateway each time.
//
// The cache outlives the gateway, though: a gateway that keeps its client
// registry in memory forgets every client on restart. The cached id then
// survives as a permanent poison pill unless isDcrClientStillKnown() below
// notices and re-registers.
const dcrClientCache = new Map();

async function isDcrClientStillKnown(tokenUri, client) {
  try {
    const form = new URLSearchParams({ grant_type: 'authorization_code', code: 'dcr-liveness-probe', client_id: client.clientId });
    if (client.clientSecret) form.set('client_secret', client.clientSecret);
    const response = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (response.status === 401) return false;
    const text = await response.text();
    return !/invalid[_ ]client|unknown client/i.test(text);
  } catch {
    return true;
  }
}

// Dynamic Client Registration (RFC 7591) against a self-advertising gateway.
async function getOrRegisterDcrClient(authorizationUri, redirectUri, tokenEndpointAuthMethod = 'client_secret_post') {
  const registerUri = new URL(authorizationUri);
  registerUri.pathname = registerUri.pathname.replace(/\/authorize$/, '/register');
  const cacheKey = registerUri.toString();
  if (dcrClientCache.has(cacheKey)) {
    const cached = dcrClientCache.get(cacheKey);
    const tokenUri = cacheKey.replace(/\/register$/, '/token');
    if (await isDcrClientStillKnown(tokenUri, cached)) return cached;
    dcrClientCache.delete(cacheKey);
  }

  const response = await fetch(cacheKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: 'ai-gateway-client',
      application_type: 'web',
      token_endpoint_auth_method: tokenEndpointAuthMethod,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Dynamic Client Registration failed: ${response.status} ${text.slice(0, 300)}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`DCR response non-JSON: ${text.slice(0, 300)}`); }
  if (!data.client_id) throw new Error('DCR response missing client_id.');

  const client = { clientId: data.client_id, clientSecret: data.client_secret || null };
  dcrClientCache.set(cacheKey, client);
  return client;
}

async function beginOAuthFlow(sess, req) {
  const { authorizationUri, tokenUri, issuer, selfAdvertised, advertisedScopes, tokenEndpointAuthMethods } = await discoverAuth(sess);
  const verifier = randomString(48);
  const challenge = sha256Base64Url(verifier);
  const oauthState = randomString(24);

  const host = req.get('host');
  const protocol = req.protocol || 'http';
  const redirectUri = `${protocol}://${host}/api/gateway/auth/callback`;

  let clientId = sess.config.clientId;
  let dcrClientId = null;
  let dcrClientSecret = null;
  if (selfAdvertised) {
    // Not every self-advertising gateway requires DCR — some already trust
    // the configured client_id. Try DCR, but a gateway that doesn't support
    // it must not break sign-in: fall back to the configured client_id.
    try {
      const dcrAuthMethod = tokenEndpointAuthMethods?.length && !tokenEndpointAuthMethods.includes('client_secret_post')
        ? tokenEndpointAuthMethods[0]
        : 'client_secret_post';
      const dcr = await getOrRegisterDcrClient(authorizationUri, redirectUri, dcrAuthMethod);
      clientId = dcr.clientId;
      dcrClientId = dcr.clientId;
      dcrClientSecret = dcr.clientSecret;
    } catch (err) {
      emitEvent(sess, 'oauth', { phase: 'dcr_skipped', error: err.message });
    }
  }

  const authUrl = new URL(authorizationUri);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  // A resource that advertises its own scopes wins over the session default:
  // requesting "openid profile email" at a door that exists to hand out a
  // narrow scope would defeat the narrowing the door was built for.
  const requestedScopes = advertisedScopes?.length ? advertisedScopes.join(' ') : sess.config.scopes;
  authUrl.searchParams.set('scope', requestedScopes);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', oauthState);
  if (process.env.LOGIN_HINT) authUrl.searchParams.set('login_hint', process.env.LOGIN_HINT);

  sess.pendingAuth = { oauthState, verifier, tokenUri, redirectUri, issuer, dcrClientId, dcrClientSecret };
  return authUrl;
}

// ---------------------------------------------------------------------------
// Door discovery via the Privilege console API
// ---------------------------------------------------------------------------
// A function, not a module-load constant, so a test can point it at a mock
// console by setting the env var before the call rather than before require()
// — the same reason consoleEnvId() below is already a function.
function consoleBase() {
  return process.env.PRIVILEGE_CONSOLE_URL || 'https://console.privilege.pingone.com';
}

function consoleEnvId() {
  return process.env.PRIVILEGE_CONSOLE_ENV_ID || process.env.PINGONE_ENVIRONMENT_ID || '';
}

async function consoleGet(sess, apiPath) {
  const res = await fetch(`${consoleBase()}${apiPath}`, {
    headers: {
      Cookie: `auth_token=${sess.console.authToken}`,
      'x-procyon-session-id': sess.console.sessionId,
      accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    // Never include the request headers here — they carry the console token.
    throw Object.assign(new Error(`Console API ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  }
  try { return JSON.parse(text); } catch { throw new Error(`Console API non-JSON from ${apiPath}`); }
}

function doorUrl(gatewayUrl, appName) {
  try { return `${new URL(gatewayUrl).origin}/${appName}/mcp`; } catch { return null; }
}

async function consoleInventory(sess) {
  const envId = consoleEnvId();
  if (!envId) throw new Error('PRIVILEGE_CONSOLE_ENV_ID (or PINGONE_ENVIRONMENT_ID) not configured.');
  const [appsBody, polBody] = await Promise.all([
    consoleGet(sess, `/api/${envId}/v1/applications?ObjectMeta.Namespace=default`),
    consoleGet(sess, `/api/${envId}/v1/pacpolicys`),
  ]);
  const applications = (appsBody.Applications || []).map((app) => {
    const cfg = app.Spec?.McpAppConfig || {};
    const st = app.Status?.McpServerStatus || {};
    const guard = cfg.AIGuardConfig;
    const name = app.ObjectMeta?.Name || '';
    return {
      name,
      mcpUrl: doorUrl(sess.config.mcpUrl, name),
      gatewayUrl: privilegeDoorUrl(name),
      frontEndName: cfg.FrontEndName?.Elems?.[0] || null,
      backends: cfg.Backends?.Elems || [],
      entryPath: cfg.EntryPath || null,
      status: st.Status || '',
      // Fields the 2026-09 console spec documents (console.privilege.pingone.com
      // /swagger/imodel.swagger.json). An older console build omits them, so
      // each degrades to empty rather than failing the read.
      tools: (st.Capabilities?.Tools || []).map((t) => t.name).filter(Boolean),
      lastDiscoveredAt: consoleTime(st.LastDiscoveredAt),
      transport: st.Transport || null,
      authMode: cfg.AuthMode || null,
      aiGuard: guard ? { enabled: Boolean(guard.Enabled) && !guard.Disabled, failClosed: Boolean(guard.FailClosed) } : null,
    };
  });
  // The pacpolicy Spec schema is undocumented, so each policy carries its raw
  // Spec and the UI matches on the text — a HEURISTIC ("mentions"), never a
  // claim that a policy grants access.
  const policies = (polBody.PacPolicys || polBody.Items || polBody.items || []).map((p) => ({
    name: p.ObjectMeta?.Name || '(unnamed)',
    spec: p.Spec || {},
    // Top-level on the PacPolicy, outside the undocumented Spec — a fact, not
    // a heuristic. Console policies are often time-boxed, and an expired one
    // denies exactly like a missing one.
    notBefore: consoleTime(p.NotBefore),
    notAfter: consoleTime(p.NotAfter),
  }));
  return { applications, policies, envId };
}

// A console timestamp as ISO, or null. The console is Go: an unset time
// arrives as 0001-01-01T00:00:00Z, which must not read as "expired in year 1".
function consoleTime(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
}

function rememberInventory(inventory) {
  try {
    return doorStore.saveInventory({ ...inventory, gatewayOrigin: PRIVILEGE_GATEWAY_HOST });
  } catch (err) {
    console.warn('[ai-gateway-client] door store write failed:', err.message);
    return null;
  }
}

function readInventory() {
  const record = doorStore.getInventory();
  if (!record || !Array.isArray(record.applications)) return null;
  return record;
}

function discoverySummary(record) {
  if (!record) return { persisted: false, appCount: 0, policyCount: 0, discoveredAt: null, gatewayOrigin: null, applications: [] };
  return {
    persisted: true,
    appCount: record.applications.length,
    policyCount: record.policyCount,
    discoveredAt: record.discoveredAt,
    gatewayOrigin: record.gatewayOrigin || null,
    applications: record.applications.map((a) => ({ name: a.name, status: a.status || '', policies: Array.isArray(a.policies) ? a.policies : [] })),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get('/state', (req, res) => {
  const sess = getSession(req);
  const discovery = readInventory();
  const defaultApp = PRIVILEGE_APP();
  const siblingApps = (discovery
    ? discovery.applications.map((a) => ({ name: a.name, privilegeUrl: privilegeDoorUrl(a.name), status: a.status || '', policies: Array.isArray(a.policies) ? a.policies : [] }))
    : [
      { name: PRIVILEGE_APP_OPENSEARCH(), privilegeUrl: DEFAULT_PRIVILEGE_OPENSEARCH_MCP_URL(), status: '', policies: [] },
      { name: PRIVILEGE_APP_BRAVE(), privilegeUrl: DEFAULT_PRIVILEGE_BRAVE_MCP_URL(), status: '', policies: [] },
    ]
  ).filter((app) => app.name && app.name !== defaultApp);

  const presets = [
    { label: '1 · Privilege — straight at the AI Gateway', mode: 'privilege', url: DEFAULT_PRIVILEGE_MCP_URL() },
    ...siblingApps.map((app) => ({ label: `Privilege — ${app.name}`, mode: 'privilege', url: app.privilegeUrl })),
    { label: '2 · Direct — no Privilege in the path', mode: 'direct', url: DEFAULT_DIRECT_MCP_URL() },
    { label: 'Direct — Brave Search', mode: 'direct', url: DEFAULT_DIRECT_BRAVE_MCP_URL() },
  ].filter((p) => p.url);

  res.json({
    config: sess.config,
    gatewayMode: sess.gatewayMode,
    gatewayConfigs: sess.gatewayConfigs,
    oauth: { authenticated: Boolean(sess.oauth.accessToken), source: sess.oauth.source || null, expiresAt: sess.oauth.expiresAt, scope: sess.oauth.scope || '' },
    doorDiscovery: discoverySummary(discovery),
    tools: sess.tools,
    policy: publicPolicySummary(sess),
    mcp: {
      era: sess.mcpSession.era,
      protocolVersion: sess.mcpSession.protocolVersion,
      capabilities: sess.mcpSession.capabilities,
      serverInfo: sess.mcpSession.serverInfo,
      instructions: sess.mcpSession.instructions,
      subscriptionActive: sess.subscription.active,
    },
    presets,
  });
});

router.post('/config', express.json(), (req, res) => {
  const sess = getSession(req);
  const body = req.body || {};
  const requestedMode = body.gatewayMode || sess.gatewayMode;
  const gatewayMode = GATEWAY_MODES.includes(requestedMode) ? requestedMode : DEFAULT_GATEWAY_MODE;
  // Blank means "unchanged" — the client posts its whole config object before
  // /auth/start, and merging blanks would wipe the env-seeded clientId/mcpUrl.
  const patch = Object.fromEntries(Object.entries(body).filter(([key, v]) => key !== 'gatewayMode' && v !== undefined && v !== null && v !== ''));
  const gatewayPatch = Object.fromEntries(Object.entries(patch).filter(([key]) => ['mcpUrl', 'clientId', 'scopes'].includes(key)));
  sess.gatewayConfigs[gatewayMode] = { ...sess.gatewayConfigs[gatewayMode], ...gatewayPatch };

  // Actually switching mode+door — stash the outgoing key's live token so
  // returning to it later can reuse it, then restore the destination key's.
  // A request that hands us a fresh Bearer credential is asserting "this
  // token IS for the key about to be selected" — never swap that back out.
  const providedBearerThisRequest = /^Bearer\s+\S+/i.test(String(req.headers?.authorization || ''));
  const oauthKey = (mode, mcpUrl) => `${mode}::${mcpUrl || ''}`;
  const previousOauthKey = oauthKey(sess.gatewayMode, sess.config.mcpUrl);
  const nextOauthKey = oauthKey(gatewayMode, sess.gatewayConfigs[gatewayMode].mcpUrl);
  if (nextOauthKey !== previousOauthKey && !providedBearerThisRequest) {
    if (sess.oauth.accessToken) sess.savedOauthByDoor[previousOauthKey] = { ...sess.oauth };
    const restored = sess.savedOauthByDoor[nextOauthKey];
    const restoredIsLive = restored && (!restored.expiresAt || restored.expiresAt > Date.now());
    sess.oauth = restoredIsLive
      ? { ...restored }
      : { accessToken: null, refreshToken: null, expiresAt: null, tokenUri: null, source: null, dcrClientId: null, dcrClientSecret: null };
  }
  sess.gatewayMode = gatewayMode;
  sess.config = { ...sess.gatewayConfigs[gatewayMode] };
  resetMcpState(sess);
  emitEvent(sess, 'config', { config: sess.config });
  res.json({ ok: true, config: sess.config, gatewayMode: sess.gatewayMode, gatewayConfigs: sess.gatewayConfigs, oauth: { authenticated: Boolean(sess.oauth.accessToken) } });
});

router.post('/auth/start', express.json(), async (req, res) => {
  const sess = getSession(req);
  try {
    if (!sess.config.mcpUrl) return res.status(400).json({ error: 'An MCP URL is required before auth start.' });
    const authUrl = await beginOAuthFlow(sess, req);
    sess.pendingAuth.returnTo = sanitizeReturnTo(req.body?.returnTo);
    emitEvent(sess, 'oauth', { phase: 'start', authUrl: authUrl.toString() });
    res.json({ authUrl: authUrl.toString() });
  } catch (err) {
    emitEvent(sess, 'error', { scope: 'oauth_start', message: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/auth/callback', async (req, res) => {
  const sess = getSession(req);
  const returnBase = sanitizeReturnTo(sess.pendingAuth?.returnTo) || '/';
  const redirectWithError = (reason) => {
    const safeReason = encodeURIComponent((reason || 'OAuth callback failed').slice(0, 300));
    res.redirect(`${returnBase}?auth=error&reason=${safeReason}`);
  };

  try {
    const { code, state: incomingState, iss, error, error_description } = req.query;
    if (error) {
      const reason = error_description ? `${error}: ${error_description}` : error;
      emitEvent(sess, 'oauth', { phase: 'callback_error', error: reason });
      return redirectWithError(reason);
    }
    if (!sess.pendingAuth || incomingState !== sess.pendingAuth.oauthState) throw new Error('OAuth state mismatch.');
    if (iss && sess.pendingAuth.issuer && iss !== sess.pendingAuth.issuer) throw new Error('OAuth issuer mismatch.');

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: sess.pendingAuth.redirectUri,
      code_verifier: sess.pendingAuth.verifier,
    });
    tokenBody.set('client_id', sess.pendingAuth.dcrClientId || sess.config.clientId);
    const clientSecret = sess.pendingAuth.dcrClientSecret || process.env.GATEWAY_CLIENT_SECRET || '';
    if (clientSecret) tokenBody.set('client_secret', clientSecret);

    const tokenResponse = await fetch(sess.pendingAuth.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    const tokenText = await tokenResponse.text();
    let tokenData;
    try { tokenData = JSON.parse(tokenText); } catch { throw new Error(`Token exchange non-JSON: ${tokenText.slice(0, 300)}`); }
    if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${tokenResponse.status} ${tokenText.slice(0, 300)}`);

    sess.oauth.accessToken = tokenData.access_token;
    sess.oauth.refreshToken = tokenData.refresh_token || null;
    sess.oauth.expiresAt = tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : null;
    sess.oauth.scope = tokenData.scope || sess.config.scopes || '';
    sess.oauth.tokenUri = sess.pendingAuth.tokenUri;
    sess.oauth.dcrClientId = sess.pendingAuth.dcrClientId || null;
    sess.oauth.dcrClientSecret = sess.pendingAuth.dcrClientSecret || null;
    sess.pendingAuth = null;
    resetMcpState(sess);

    emitEvent(sess, 'oauth', { phase: 'token_success', expiresIn: tokenData.expires_in || null });
    res.redirect(`${returnBase}?auth=success`);
  } catch (err) {
    emitEvent(sess, 'error', { scope: 'oauth_callback', message: err.message });
    redirectWithError(err.message);
  }
});

router.post('/auth/logout', (req, res) => {
  const sess = getSession(req);
  sess.oauth.accessToken = null;
  sess.oauth.refreshToken = null;
  sess.oauth.expiresAt = null;
  sess.oauth.tokenUri = null;
  sess.oauth.scope = '';
  resetMcpState(sess);
  emitEvent(sess, 'oauth', { phase: 'logout' });
  res.json({ ok: true });
});

router.post('/tools/list', express.json(), async (req, res) => {
  const sess = getSession(req);
  try {
    if (!sess.oauth.accessToken) return res.status(401).json({ error: 'Not authenticated — click Sign In.' });
    await discoverPolicyTools(sess);
    res.json({ tools: sess.tools, policy: publicPolicySummary(sess) });
  } catch (err) {
    resetMcpState(sess);
    emitEvent(sess, 'error', { scope: 'tools_list', message: err.message });
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

router.post('/tools/call', express.json(), async (req, res) => {
  const sess = getSession(req);
  try {
    if (!sess.oauth.accessToken) return res.status(401).json({ error: 'Not authenticated.' });
    const { name, arguments: args } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Tool name is required.' });
    const data = await callMcp(sess, 'tools/call', { name, arguments: args || {} });
    res.json(data);
  } catch (err) {
    emitEvent(sess, 'error', { scope: 'tools_call', message: err.message });
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

router.get('/catalog', async (req, res) => {
  const sess = getSession(req);
  try {
    if (!sess.oauth.accessToken) return res.status(401).json({ error: 'Not authenticated.' });
    await ensureMcpSessionInitialized(sess);
    const capabilities = sess.mcpSession.capabilities || {};
    const catalog = { tools: sess.tools, prompts: [], resources: [], resourceTemplates: [] };
    const requests = [];
    if (capabilities.tools && catalog.tools.length === 0) {
      requests.push(listAllMcpPages(sess, 'tools/list', 'tools').then((tools) => { catalog.tools = tools; sess.tools = tools; }));
    }
    if (capabilities.prompts) {
      requests.push(listAllMcpPages(sess, 'prompts/list', 'prompts').then((prompts) => { catalog.prompts = prompts; }));
    }
    if (capabilities.resources) {
      requests.push(listAllMcpPages(sess, 'resources/list', 'resources').then((resources) => { catalog.resources = resources; }));
      requests.push(listAllMcpPages(sess, 'resources/templates/list', 'resourceTemplates').then((templates) => { catalog.resourceTemplates = templates; }));
    }
    const settled = await Promise.allSettled(requests);
    const errors = settled.filter((result) => result.status === 'rejected').map((result) => result.reason.message);
    res.json({ ...catalog, protocol: { era: sess.mcpSession.era, version: sess.mcpSession.protocolVersion, capabilities, serverInfo: sess.mcpSession.serverInfo, instructions: sess.mcpSession.instructions }, errors });
  } catch (err) {
    emitEvent(sess, 'error', { scope: 'catalog', message: err.message });
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

router.post('/request', express.json(), async (req, res) => {
  const sess = getSession(req);
  try {
    if (!sess.oauth.accessToken) return res.status(401).json({ error: 'Not authenticated.' });
    const { method, params } = req.body || {};
    if (typeof method !== 'string' || !method.includes('/')) return res.status(400).json({ error: 'A valid MCP method is required.' });
    const data = await callMcp(sess, method, params || {});
    res.json(data);
  } catch (err) {
    emitEvent(sess, 'error', { scope: 'mcp_request', message: err.message });
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

router.post('/subscriptions/start', express.json(), async (req, res) => {
  const sess = getSession(req);
  try {
    if (!sess.oauth.accessToken) return res.status(401).json({ error: 'Not authenticated.' });
    const types = Array.isArray(req.body?.types) ? req.body.types : ['toolsListChanged', 'promptsListChanged', 'resourcesListChanged', 'resourceSubscriptions'];
    await startModernSubscription(sess, types);
    res.status(202).json({ ok: true, types });
  } catch (err) {
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

router.delete('/subscriptions', (req, res) => {
  const sess = getSession(req);
  sess.subscription.controller?.abort();
  sess.subscription = { controller: null, active: false };
  res.json({ ok: true });
});

router.post('/rpc', express.json(), async (req, res) => {
  const sess = getSession(req);
  try {
    if (!sess.oauth.accessToken) return res.status(401).json({ error: 'Not authenticated.' });
    const body = req.body || {};
    const method = body?.method || '';
    if (method && method !== 'initialize' && method !== 'notifications/initialized') {
      await ensureMcpSessionInitialized(sess);
    }
    const data = await fetchMcp(sess, null, body, true);
    res.json(data);
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('502')) resetMcpState(sess);
    emitEvent(sess, 'error', { scope: 'raw_rpc', message: err.message });
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

// A throwaway session that borrows the caller's identity but keeps its own
// MCP state, so probing another door cannot clobber the live negotiated
// session. eventStream is disabled — a probe must never open a long-lived GET.
function probeSessionFor(sess, mcpUrl) {
  return {
    config: { ...sess.config, mcpUrl },
    oauth: sess.oauth,
    gatewayMode: sess.gatewayMode,
    tools: [],
    toolPolicy: { permitted: [], filtered: [], total: 0 },
    mcpSession: { era: null, initialized: false, protocolVersion: null, sessionId: null, nextRequestId: 1, capabilities: {}, serverInfo: null, instructions: '' },
    subscription: { controller: null, active: false },
    eventStream: { controller: null, active: false, disabled: true },
    pendingAuth: null,
    console: null,
  };
}

// "denied here; does this identity work anywhere else?" — a policy denial
// often answers with a bare 403 and no detail, so the only way to tell a
// missing grant from a wrong door is to try the other doors with the same token.
router.post('/doors/probe', express.json(), async (req, res) => {
  const sess = getSession(req);
  if (!sess.oauth.accessToken) return res.status(401).json({ error: 'Not authenticated.' });
  const urls = [...new Set((Array.isArray(req.body?.urls) ? req.body.urls : []).filter((u) => typeof u === 'string' && u))]
    .filter((u) => u !== sess.config.mcpUrl)
    .slice(0, 12); // bound the fan-out: one gateway round trip each
  if (urls.length === 0) return res.json({ results: [] });
  const results = await Promise.all(urls.map(async (url) => {
    const probe = probeSessionFor(sess, url);
    try {
      await ensureMcpSessionInitialized(probe);
      const tools = await listAllMcpPages(probe, 'tools/list', 'tools');
      return { url, ok: true, tools: tools.length };
    } catch (err) {
      return { url, ok: false, status: relayFailureStatus(err), error: String(err.message).slice(0, 200) };
    }
  }));
  res.json({ results });
});

router.post('/console/connect', express.json(), async (req, res) => {
  const sess = getSession(req);
  const authToken = String(req.body?.authToken || '').trim();
  if (!authToken) return res.status(400).json({ error: 'authToken is required.' });
  try {
    const idRes = await fetch(`${consoleBase()}/session-token`, { headers: { Cookie: `auth_token=${authToken}` } });
    const idBody = await idRes.json().catch(() => ({}));
    const sessionId = idBody.session_id;
    if (!sessionId) return res.status(502).json({ error: 'Console did not return a session_id.' });
    sess.console = { authToken, sessionId };
    const inventory = await consoleInventory(sess);
    const stored = rememberInventory(inventory);
    emitEvent(sess, 'relay', { scope: 'console', message: `connected — ${inventory.applications.length} apps, ${inventory.policies.length} policies` });
    res.json({ ...inventory, discovery: discoverySummary(stored) });
  } catch (err) {
    sess.console = null;
    res.status(err.status === 401 ? 401 : 502).json({ error: err.message });
  }
});

router.get('/console/inventory', async (req, res) => {
  const sess = getSession(req);
  if (!sess.console?.authToken) return res.status(401).json({ error: 'No console token. Connect first.' });
  try {
    const inventory = await consoleInventory(sess);
    const stored = rememberInventory(inventory);
    emitEvent(sess, 'relay', { scope: 'console', message: `refreshed — ${inventory.applications.length} apps, ${inventory.policies.length} policies` });
    res.json({ ...inventory, discovery: discoverySummary(stored) });
  } catch (err) {
    res.status(err.status === 401 ? 401 : 502).json({ error: err.message });
  }
});

router.post('/console/disconnect', (req, res) => {
  getSession(req).console = null;
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /env — view/edit the OIDC client id/secret for a self-hosted gateway
// (e.g. your own ping-mcpgw deployment), if you run one. No auth gate: this
// is a local single-user tool, config lives in a file you already control.
// ---------------------------------------------------------------------------
const GATEWAY_ENV_PATH = process.env.GATEWAY_ENV_PATH
  || path.join(os.homedir(), '.ai-gateway-client', 'gateway.env');
const GATEWAY_ENV_ALLOWED_KEYS = ['SERVER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_AUTH_URL', 'OIDC_TOKEN_URL', 'OIDC_USER_URL', 'OIDC_SCOPES'];

function parseDotenv(text) {
  const vars = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return vars;
}

function serializeDotenv(vars) {
  return Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

function readExistingEnvVars() {
  try {
    return parseDotenv(fs.readFileSync(GATEWAY_ENV_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

router.get('/env', (_req, res) => {
  try {
    res.json({ ok: true, vars: readExistingEnvVars() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/env', express.json(), (req, res) => {
  try {
    const vars = req.body?.vars;
    if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return res.status(400).json({ error: 'vars object required' });
    const existing = readExistingEnvVars();
    const filtered = {};
    for (const key of GATEWAY_ENV_ALLOWED_KEYS) {
      if (Object.hasOwn(existing, key)) filtered[key] = String(existing[key]);
    }
    for (const key of GATEWAY_ENV_ALLOWED_KEYS) {
      if (vars[key] !== undefined) filtered[key] = String(vars[key]);
    }
    fs.mkdirSync(path.dirname(GATEWAY_ENV_PATH), { recursive: true });
    fs.writeFileSync(GATEWAY_ENV_PATH, serializeDotenv(filtered), 'utf8');
    res.json({ ok: true, vars: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

/** Test hooks. */
module.exports.__test = {
  emitEvent,
  getSession,
  listAllMcpPages,
  reset() {
    session = freshSession();
    sseClients.clear();
  },
};
