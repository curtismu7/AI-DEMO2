// banking_api_server/services/http2McpBridge.js
/**
 * HTTP/2-capable adapter between BFF and MCP server's POST /mcp endpoint.
 *
 * Status (2026-05-14): the BFF default is still `MCP_SERVER_URL=ws://localhost:8080`
 * (server.js line ~1729), so this bridge is only exercised when an operator sets
 * `MCP_SERVER_URL` to an `http://` / `https://` URL. Even when invoked, the local
 * MCP server runs on plain `http.createServer` (banking_mcp_server BankingMCPServer.ts),
 * which does NOT advertise h2 — Node's `http2.connect(..., { allowHTTP1: true })`
 * therefore negotiates DOWN to HTTP/1.1. The "multiplexing" benefit is theoretical
 * until the MCP server enables `http2.createServer({ allowHTTP1: true })`.
 *
 * Connection pool: keyed by `{url}:{tokenPrefix}`, max 5 concurrent sessions.
 * Graceful shutdown: drain pending streams on SIGTERM.
 */
const http2 = require('http2');
const https = require('https');
const { URL } = require('url');

// ---------- Connection pool ----------

/** @type {Map<string, {session: http2.ClientHttp2Session, lastUsed: number, pendingStreams: number}>} */
const pool = new Map();
const MAX_POOL_SIZE = 5;
const IDLE_TIMEOUT_MS = 60_000;  // Close idle sessions after 60s
const STREAM_TIMEOUT_MS = 30_000; // Individual stream timeout

/** Derive a pool key from URL + token (use first 16 chars of token to avoid storing full secret). */
function poolKey(mcpServerUrl, bearerToken) {
  const prefix = bearerToken ? bearerToken.slice(0, 16) : 'no-token';
  return `${mcpServerUrl}::${prefix}`;
}

/**
 * Create or retrieve a persistent HTTP/2 session to the MCP server.
 *
 * @param {string} mcpServerUrl  Base URL of the MCP server (e.g. https://mcp.example.com:8081)
 * @param {string} bearerToken   Agent bearer token
 * @returns {http2.ClientHttp2Session}
 */
function createHttp2Session(mcpServerUrl, bearerToken) {
  const key = poolKey(mcpServerUrl, bearerToken);
  const existing = pool.get(key);

  if (existing && !existing.session.destroyed && !existing.session.closed) {
    existing.lastUsed = Date.now();
    return existing.session;
  }

  // Enforce pool size limit
  if (pool.size >= MAX_POOL_SIZE) {
    evictOldest();
  }

  const parsed = new URL(mcpServerUrl);
  const connectUrl = `${parsed.protocol}//${parsed.host}`;

  const options = {};
  // For local development / self-signed certs: allow connecting over plain HTTP
  if (parsed.protocol === 'http:') {
    // Node http2 only speaks h2c (cleartext HTTP/2) via http2.connect with allowHTTP1
    options.allowHTTP1 = true;
  } else if (parsed.protocol === 'https:') {
    // Same-network internal hop to demo_mcp_server's self-signed TLS+ALPN
    // listener (MCP_TLS_ENABLED) — not a trust boundary. Matches PingGateway's
    // own local-dev requireHttps:false pattern.
    options.rejectUnauthorized = false;
  }

  const session = http2.connect(connectUrl, options);

  session.on('error', (err) => {
    console.error(`[http2McpBridge] Session error for ${parsed.host}:`, err.message);
    pool.delete(key);
  });

  session.on('close', () => {
    pool.delete(key);
  });

  pool.set(key, { session, lastUsed: Date.now(), pendingStreams: 0 });
  return session;
}

/** Evict the oldest idle session from the pool. */
function evictOldest() {
  let oldestKey = null;
  let oldestTime = Infinity;
  for (const [key, entry] of pool) {
    if (entry.lastUsed < oldestTime && entry.pendingStreams === 0) {
      oldestTime = entry.lastUsed;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    const entry = pool.get(oldestKey);
    if (entry) {
      entry.session.close();
      pool.delete(oldestKey);
    }
  }
}

// ---------- Tool call forwarding ----------

/**
 * Forward a JSON-RPC tools/call request to the MCP server via HTTP/2 POST /mcp.
 *
 * Follows the MCP spec handshake: `initialize` → `notifications/initialized` → `tools/call`.
 * Each call opens a new h2 stream on the existing session (multiplexed).
 *
 * @param {http2.ClientHttp2Session} session  HTTP/2 session from createHttp2Session
 * @param {string} toolName                   MCP tool name
 * @param {object} toolParams                 Tool arguments
 * @param {string} bearerToken                Agent bearer token for Authorization header
 * @param {string} [userSub]                  PingOne user subject (optional)
 * @param {string} [correlationId]            Request correlation ID (optional)
 * @returns {Promise<object>}                 MCP JSON-RPC result
 */
async function forwardToolCall(session, toolName, toolParams, bearerToken, userSub, correlationId) {
  // Step 1: Initialize the MCP session (get Mcp-Session-Id)
  const initBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'demo-api-server-h2', version: '1.0.0' },
    },
  };
  if (userSub) initBody.params.userSub = userSub;
  if (correlationId) initBody.params.correlationId = correlationId;

  const initResult = await h2Post(session, '/mcp', initBody, {
    'Authorization': `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  });

  if (initResult.error) {
    const err = new Error(initResult.error.message || 'MCP initialize failed');
    err.code = initResult.error.code;
    throw err;
  }

  const mcpSessionId = initResult._mcpSessionId;
  const negotiatedVersion = initResult.result?.protocolVersion || '2025-11-25';

  // Step 2: Send notifications/initialized
  await h2Post(session, '/mcp', {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  }, {
    'Authorization': `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
    'Mcp-Session-Id': mcpSessionId,
    'Mcp-Protocol-Version': negotiatedVersion,
  });

  // Step 3: Send tools/call
  const callBody = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: toolParams || {},
    },
  };
  if (userSub) callBody.params.userSub = userSub;
  if (correlationId) callBody.params.correlationId = correlationId;

  const callResult = await h2Post(session, '/mcp', callBody, {
    'Authorization': `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Mcp-Session-Id': mcpSessionId,
    'Mcp-Protocol-Version': negotiatedVersion,
  });

  if (callResult.error) {
    const err = new Error(callResult.error.message || `MCP tools/call failed for ${toolName}`);
    err.code = callResult.error.code;
    err.statusCode = callResult._httpStatus;
    throw err;
  }

  return callResult.result;
}

/**
 * Low-level: send an HTTP/2 POST stream and read the JSON response.
 *
 * @param {http2.ClientHttp2Session} session
 * @param {string} path
 * @param {object} body
 * @param {object} headers
 * @returns {Promise<object>}
 */
function h2Post(session, path, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const isNotification = body.id === undefined; // Notifications = 202 No Content

    const reqHeaders = {
      ':method': 'POST',
      ':path': path,
      'content-length': Buffer.byteLength(payload),
      ...headers,
    };

    const stream = session.request(reqHeaders);

    // Track pending streams for pool eviction
    const poolEntries = [...pool.values()];
    const entry = poolEntries.find(e => e.session === session);
    if (entry) entry.pendingStreams++;

    const timeout = setTimeout(() => {
      stream.close(http2.constants.NGHTTP2_CANCEL);
      if (entry) entry.pendingStreams--;
      reject(new Error(`HTTP/2 stream timeout after ${STREAM_TIMEOUT_MS}ms`));
    }, STREAM_TIMEOUT_MS);

    const chunks = [];
    let httpStatus = 200;
    let mcpSessionId = '';

    stream.on('response', (responseHeaders) => {
      httpStatus = responseHeaders[':status'] || 200;
      mcpSessionId = responseHeaders['mcp-session-id'] || '';
    });

    stream.on('data', (chunk) => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      clearTimeout(timeout);
      if (entry) entry.pendingStreams--;

      // Notifications return 202 with no body
      if (isNotification) {
        resolve({ _httpStatus: httpStatus, _mcpSessionId: mcpSessionId });
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        const parsed = JSON.parse(raw);
        parsed._httpStatus = httpStatus;
        parsed._mcpSessionId = mcpSessionId || parsed._mcpSessionId;
        resolve(parsed);
      } catch {
        reject(new Error(`HTTP/2 response parse error (status ${httpStatus}): ${raw.slice(0, 200)}`));
      }
    });

    stream.on('error', (err) => {
      clearTimeout(timeout);
      if (entry) entry.pendingStreams--;
      reject(err);
    });

    stream.end(payload);
  });
}

// ---------- Response handling ----------

/**
 * Parse a streaming MCP response (for future use with SSE-over-HTTP/2).
 * Currently MCP POST /mcp returns complete JSON responses,
 * but this is ready for chunked streaming if the MCP server supports it.
 *
 * @param {http2.ClientHttp2Stream} stream
 * @returns {Promise<object>}
 */
function handleMcpResponse(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timeout = setTimeout(() => {
      stream.close(http2.constants.NGHTTP2_CANCEL);
      reject(new Error('MCP response stream timeout'));
    }, STREAM_TIMEOUT_MS);

    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => {
      clearTimeout(timeout);
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error(`Failed to parse MCP response: ${raw.slice(0, 200)}`));
      }
    });
    stream.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ---------- Session cleanup ----------

/**
 * Close a specific HTTP/2 session and remove from pool.
 *
 * @param {http2.ClientHttp2Session} session
 */
function closeSession(session) {
  for (const [key, entry] of pool) {
    if (entry.session === session) {
      entry.session.close();
      pool.delete(key);
      return;
    }
  }
  // Not in pool — close directly
  if (session && !session.destroyed) {
    session.close();
  }
}

/**
 * Close all sessions in the pool (graceful shutdown).
 */
function closeAllSessions() {
  for (const [key, entry] of pool) {
    entry.session.close();
    pool.delete(key);
  }
}

// Periodic cleanup of idle sessions
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pool) {
    if (now - entry.lastUsed > IDLE_TIMEOUT_MS && entry.pendingStreams === 0) {
      entry.session.close();
      pool.delete(key);
    }
  }
}, IDLE_TIMEOUT_MS);

// Don't prevent Node from exiting
if (cleanupInterval.unref) cleanupInterval.unref();

// Graceful shutdown
process.on('SIGTERM', () => closeAllSessions());
process.on('SIGINT', () => closeAllSessions());

module.exports = {
  createHttp2Session,
  forwardToolCall,
  handleMcpResponse,
  closeSession,
  closeAllSessions,
  // Exposed for testing
  _pool: pool,
  _h2Post: h2Post,
};
