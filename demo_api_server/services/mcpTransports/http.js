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
 * "unknown or expired MCP-Session-Id". Session state is kept per (url,
 * authValue) pair, not per url alone (this one transport instance serves
 * every saved profile) — see sessionKey()'s own comment for why a caller's
 * identity has to be part of the key, mirroring the same initialize/
 * session-id contract routes/privilegeMcpSimple.js already implements for
 * its own fixed single-target relay.
 */
const axios = require('axios');
const { normalizeAxiosError } = require('../../utils/normalizeAxiosError');

const TIMEOUT_MS = 15_000;
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

// sessionKey(profile) -> { sessionId, protocolVersion, initialized, pending }
const _sessions = new Map();

/** profile.url alone is NOT a safe cache key: routes/mcpInspector.js's
 * privilegeVirtualProfile() builds a fresh profile object per request with a
 * CONSTANT url but the CALLING admin's OWN bearer token as authValue — one
 * shared session keyed only by url would let the first admin to call cache
 * an Mcp-Session-Id every other admin's later calls then silently reused
 * under their own Authorization header (cross-identity session reuse,
 * flagged in review of PR #2348). Folding authValue into the key gives each
 * distinct identity its own session while still reusing one session across
 * that same identity's repeat calls — profiles with no auth (a shared
 * no-auth backend) collapse back to keying on url alone, unchanged. */
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

/** The actual initialize + notifications/initialized handshake. Never call
 * directly — go through ensureInitialized/resetAndReinitialize so concurrent
 * callers for the same profile.url share one attempt (see below). */
async function performHandshake(profile, session) {
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

/** Handshake once per profile.url; cheap to skip on every later call.
 *
 * `session.pending` makes concurrent first-callers for the same profile.url
 * share one handshake instead of each starting its own: two requests can
 * arrive close enough together that both read `session.initialized ===
 * false` before either has written `true`, and without this guard both
 * would call performHandshake independently, each overwriting the other's
 * sessionId on the one shared session object. The check-then-set below has
 * no `await` between reading and writing `session.pending`, so it's atomic
 * within Node's single-threaded event loop — no separate lock needed. */
async function ensureInitialized(profile, session) {
  if (session.initialized) return;
  if (!session.pending) {
    session.pending = performHandshake(profile, session).finally(() => {
      session.pending = null;
    });
  }
  return session.pending;
}

/** Same single-flight guard as ensureInitialized, for the recovery path:
 * if two concurrent calls both discover the session expired, only the first
 * should reset+reinitialize — the second must await that same attempt
 * rather than resetting a session the first call just fixed. */
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

/** True for the MCP spec's documented "session not found" signal (404) — the
 * gateway evicted a session we still think is live. Any other error (auth,
 * network, a genuine tool-call failure) must NOT trigger a reset+retry. */
function isExpiredSessionError(err) {
  return err && err.httpStatus === 404;
}

// A session can go stale between calls (server-side eviction) — the first
// call after that returns 404 "unknown or expired session", and without a
// reset every later call for that profile.url fails the same way until the
// process restarts (confirmed live against oauth-mcp's identical contract
// elsewhere in this repo: `{"error":"Unknown or expired MCP-Session-Id..."}`
// at 404). Reset and retry the handshake exactly once — a second failure is
// a real error, not staleness, and must propagate.
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

module.exports = { listTools, callTool };
