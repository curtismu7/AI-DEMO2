'use strict';
/**
 * mcpTransports/http.js — generic Streamable-HTTP MCP JSON-RPC client for a
 * saved profile (services/mcpProfileStore.js). Same POST-JSON-RPC pattern as
 * mcpPingOneHttpAdapter.js but with a configurable URL + auth header instead
 * of a hardcoded PingOne worker token, so it works against any remote MCP
 * server that speaks Streamable HTTP (e.g. Brave Search run with
 * `--transport http`).
 *
 * A stateful spec-conformant server (the Privilege gateway, confirmed live)
 * requires an `initialize` handshake before any other call and ties
 * subsequent requests to the `Mcp-Session-Id` it returns — without both,
 * tools/list answers 400 "mcp-protocol-version header is required" or 404
 * "unknown or expired MCP-Session-Id". Session state is kept per profile.url
 * (this one transport instance serves every saved profile), mirroring the
 * same initialize/session-id contract routes/privilegeMcpSimple.js already
 * implements for its own fixed single-target relay.
 */
const axios = require('axios');
const { normalizeAxiosError } = require('../../utils/normalizeAxiosError');

const TIMEOUT_MS = 15_000;
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

// url -> { sessionId, protocolVersion, initialized }
const _sessions = new Map();

function getSession(profile) {
  let session = _sessions.get(profile.url);
  if (!session) {
    session = { sessionId: null, protocolVersion: null, initialized: false };
    _sessions.set(profile.url, session);
  }
  return session;
}

function buildHeaders(profile, session, method) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (String(profile.authHeader || '').trim() && String(profile.authValue || '').trim()) {
    headers[profile.authHeader] = profile.authValue;
  }
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;
  // Every non-initialize request needs this, per the same contract
  // privilegeMcpSimple.js already implements for the Privilege gateway.
  if (method !== 'initialize') {
    headers['MCP-Protocol-Version'] = session.protocolVersion || DEFAULT_PROTOCOL_VERSION;
  }
  return headers;
}

/** Some MCP HTTP servers answer with text/event-stream even for a single result. */
function extractJsonRpc(data) {
  if (data && typeof data === 'object') return data;
  if (typeof data !== 'string') return data;
  const trimmed = data.trim();
  if (!trimmed) return undefined; // notifications get an empty 202/204 body
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLines = trimmed.split('\n').filter((l) => l.startsWith('data:'));
  if (dataLines.length) return JSON.parse(dataLines[dataLines.length - 1].slice(5).trim());
  throw new Error('Unrecognized MCP HTTP response framing');
}

let _msgId = 0;

/** One raw JSON-RPC POST. Captures a fresh Mcp-Session-Id if the server sent one. */
async function rawSend(profile, session, method, params, id) {
  let resp;
  try {
    resp = await axios.post(
      profile.url,
      id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params },
      {
        headers: buildHeaders(profile, session, method),
        timeout: TIMEOUT_MS,
        validateStatus: (s) => s >= 200 && s < 300,
        responseType: 'text',
        transformResponse: (d) => d,
      }
    );
  } catch (err) {
    const status = err.response?.status;
    if (!status) {
      throw normalizeAxiosError(err, { label: 'MCP HTTP request', timeoutMs: TIMEOUT_MS });
    }
    const body = err.response?.data;
    const msg = `MCP HTTP ${status}${body ? `: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}` : ''}`;
    const e = new Error(msg);
    e.code = 'mcp_http_error';
    e.httpStatus = status;
    throw e;
  }

  const sid = resp.headers['mcp-session-id'];
  if (sid) session.sessionId = sid;

  const json = extractJsonRpc(resp.data);
  if (json && json.error) {
    const e = new Error(json.error.message || 'MCP JSON-RPC error');
    e.code = 'mcp_rpc_error';
    e.mcpCode = json.error.code;
    throw e;
  }
  return json ? json.result : undefined;
}

/** Handshake once per profile.url; cheap to skip on every later call. */
async function ensureInitialized(profile, session) {
  if (session.initialized) return;
  const result = await rawSend(
    profile,
    session,
    'initialize',
    {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'AI-DEMO2 MCP Inspector', version: '1.0.0' },
    },
    ++_msgId,
  );
  session.protocolVersion = (result && result.protocolVersion) || DEFAULT_PROTOCOL_VERSION;
  // Notification (no id, no response body expected) — required by spec before
  // the session is usable for real requests.
  await rawSend(profile, session, 'notifications/initialized', {}, undefined);
  session.initialized = true;
}

// ponytail: no retry-on-expired-session — a session that goes stale between
// calls (server-side eviction) surfaces as a plain error instead of silently
// re-initializing. Add a reset-and-retry-once wrapper here if that's observed
// in practice; not needed for the immediate case (fresh session per login).
async function send(profile, method, params) {
  const session = getSession(profile);
  await ensureInitialized(profile, session);
  return rawSend(profile, session, method, params, ++_msgId);
}

async function listTools(profile) {
  const result = await send(profile, 'tools/list', {});
  return { tools: (result && result.tools) || [] };
}

async function callTool(profile, tool, params) {
  return send(profile, 'tools/call', { name: tool, arguments: params || {} });
}

module.exports = { listTools, callTool };
