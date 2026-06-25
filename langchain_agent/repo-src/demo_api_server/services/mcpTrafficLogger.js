'use strict';
/**
 * MCP Traffic Logger (Phase 212)
 * Writes one NDJSON line per entry to .logs/mcp-traffic.log
 * Captures: BFF→MCP JSON-RPC, BFF→PingOne token exchange, BFF→PingOne Authorize decisions.
 *
 * Entry shape:
 * {
 *   ts:            ISO timestamp
 *   dir:           'BFF→MCP' | 'MCP→BFF' | 'BFF→PingOne' | 'PingOne→BFF' | 'BFF→Authorize' | 'Authorize→BFF'
 *   type:          'rpc_request' | 'rpc_response' | 'exchange_request' | 'exchange_response' | 'authorize_request' | 'authorize_response' | 'error'
 *   method:        JSON-RPC method or 'token_exchange' or 'authorize_evaluate'
 *   tool:          tool name for tools/call, else null
 *   statusCode:    HTTP status for PingOne calls, null for WebSocket
 *   durationMs:    round-trip ms (set on response entries), null on request entries
 *   ok:            true/false
 *   summary:       human-readable one-line description
 *   correlationId: optional request correlation ID
 * }
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '../../.logs');
const LOG_FILE = path.join(LOG_DIR, 'mcp-traffic.log');
const MAX_MEMORY = 500; // ring buffer for GET /api/mcp/traffic

const _buffer = [];

function ensureLogDir() {
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}

/**
 * IN-03 defence-in-depth: path-by-path review confirmed callers currently pass
 * the token-FREE params (mcpWebSocketClient.js logs `followParams`, the
 * version BEFORE the agentToken merge). This helper guarantees that even if a
 * future caller forgets and passes the token-merged params, raw bearer tokens
 * never reach the NDJSON file or the GET /api/mcp/traffic ring buffer. It does
 * NOT change the shape — only the values of known token-bearing keys.
 */
const TOKEN_KEYS = new Set([
    'agenttoken', 'access_token', 'subject_token', 'actor_token',
    'authorization', 'id_token', 'refresh_token',
]);
function redactPayload(obj, depth = 0) {
    if (depth > 12 || !obj || typeof obj !== 'object') return obj;
    const out = Array.isArray(obj) ? [] : {};
    for (const [k, v] of Object.entries(obj)) {
        if (TOKEN_KEYS.has(k.toLowerCase())) {
            out[k] = '[REDACTED]';
        } else if (v && typeof v === 'object') {
            out[k] = redactPayload(v, depth + 1);
        } else {
            out[k] = v;
        }
    }
    return out;
}

/**
 * Write one MCP traffic entry to disk (NDJSON) and memory ring buffer.
 * @param {object} entry
 */
function writeMcpTrafficEntry(entry) {
    const line = {
        ts: new Date().toISOString(),
        dir: null,
        type: null,
        method: null,
        tool: null,
        statusCode: null,
        durationMs: null,
        ok: true,
        summary: '',
        correlationId: null,
        payload: null,
        ...entry,
    };
    // IN-03: defence-in-depth redaction of any token-bearing fields before
    // the entry reaches disk or the in-memory ring buffer.
    if (line.payload && typeof line.payload === 'object') {
        line.payload = redactPayload(line.payload);
    }
    // Ring buffer (newest first)
    _buffer.unshift(line);
    if (_buffer.length > MAX_MEMORY) _buffer.length = MAX_MEMORY;

    // Disk (non-blocking — best-effort, never throws)
    const out = JSON.stringify(line) + '\n';
    ensureLogDir();
    fs.appendFile(LOG_FILE, out, () => {});
}

/**
 * Return recent entries from memory buffer (newest first).
 * @param {number} limit
 * @returns {object[]}
 */
function getMcpTrafficLog(limit) {
    const n = Math.min(limit || 200, _buffer.length);
    return _buffer.slice(0, n);
}

/** Path to the log file (exposed for run scripts and the route). */
const LOG_PATH = LOG_FILE;

module.exports = { writeMcpTrafficEntry, getMcpTrafficLog, LOG_PATH };
