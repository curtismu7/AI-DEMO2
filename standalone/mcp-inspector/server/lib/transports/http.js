'use strict';
/**
 * transports/http.js — generic Streamable-HTTP MCP JSON-RPC client for a
 * saved profile (../profileStore.js). Works against any remote MCP server
 * that speaks Streamable HTTP.
 *
 * A stateful spec-conformant server requires an `initialize` handshake
 * before any other call and ties subsequent requests to the
 * `Mcp-Session-Id` it returns — without both, tools/list answers 400
 * "mcp-protocol-version header is required" or 404 "unknown or expired
 * MCP-Session-Id". Session state is kept per (url, authValue) pair, not per
 * url alone (this one transport instance serves every saved profile).
 */
const axios = require('axios');
const { normalizeAxiosError } = require('../normalizeAxiosError');

const TIMEOUT_MS = 15_000;
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

// sessionKey(profile) -> { sessionId, protocolVersion, initialized, pending }
const _sessions = new Map();

/** profile.url alone is not a safe cache key when two profiles share a url
 * with different auth (e.g. a virtual per-token profile) — fold authValue
 * into the key so each identity gets its own session while still reusing
 * one session across that identity's repeat calls. */
function sessionKey(profile) {
  return `${profile.url}::${profile.authValue || ''}`;
}

function getSession(profile) {
  const key = sessionKey(profile);
  let session = _sessions.get(key);
  if (!session) {
    session = { sessionId: null, protocolVersion: null, initialized: false, pending: null };
    _sessions.set(key, session);
  }
  return session;
}

function buildHeaders(profile, session, method) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (String(profile.authHeader || '').trim() && String(profile.authValue || '').trim()) {
    headers[profile.authHeader] = profile.authValue;
  }
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;
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

/** The actual initialize + notifications/initialized handshake. Never call
 * directly — go through ensureInitialized/resetAndReinitialize so concurrent
 * callers for the same profile share one attempt. */
async function performHandshake(profile, session) {
  const result = await rawSend(
    profile,
    session,
    'initialize',
    {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mcp-inspector', version: '1.0.0' },
    },
    ++_msgId,
  );
  session.protocolVersion = (result && result.protocolVersion) || DEFAULT_PROTOCOL_VERSION;
  await rawSend(profile, session, 'notifications/initialized', {}, undefined);
  session.initialized = true;
}

async function ensureInitialized(profile, session) {
  if (session.initialized) return;
  if (!session.pending) {
    session.pending = performHandshake(profile, session).finally(() => {
      session.pending = null;
    });
  }
  return session.pending;
}

async function resetAndReinitialize(profile, session) {
  if (!session.pending) {
    session.initialized = false;
    session.sessionId = null;
    session.pending = performHandshake(profile, session).finally(() => {
      session.pending = null;
    });
  }
  return session.pending;
}

/** True only for the MCP spec's documented "session not found" signal. */
function isExpiredSessionError(err) {
  return Boolean(err && err.httpStatus === 404 && /session/i.test(err.message) && /expired|unknown/i.test(err.message));
}

async function send(profile, method, params) {
  const session = getSession(profile);
  await ensureInitialized(profile, session);
  try {
    return await rawSend(profile, session, method, params, ++_msgId);
  } catch (err) {
    if (!isExpiredSessionError(err)) throw err;
    await resetAndReinitialize(profile, session);
    return rawSend(profile, session, method, params, ++_msgId);
  }
}

async function listTools(profile) {
  const result = await send(profile, 'tools/list', {});
  return { tools: (result && result.tools) || [] };
}

async function callTool(profile, tool, params) {
  return send(profile, 'tools/call', { name: tool, arguments: params || {} });
}

async function rpc(profile, method, params) {
  return send(profile, method, params || {});
}

module.exports = { listTools, callTool, rpc };
