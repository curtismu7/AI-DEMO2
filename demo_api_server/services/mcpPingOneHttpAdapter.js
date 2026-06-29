'use strict';
/**
 * mcpPingOneHttpAdapter.js
 *
 * Adapter for PingOne's HOSTED remote MCP server (Streamable HTTP transport).
 * Replaces the local `pingone-mcp-server` stdio binary: instead of spawning a
 * process, it POSTs MCP JSON-RPC (`tools/list` / `tools/call`) to
 *   https://api.pingone.{region}/v1/environments/{envId}/mcp
 * authenticated with a worker `client_credentials` token (the same worker app
 * that backs Management API calls — its admin roles determine the tool set).
 *
 * The hosted server is stateless: each JSON-RPC POST is self-contained, so there
 * is no `initialize` handshake or `Mcp-Session-Id` to track.
 *
 * Drop-in for the old stdio adapter — exports `listTools()` and `callTool()`
 * with the same shapes the agent / pipeline / inspector already consume.
 * Worker auth is internal; the optional accessToken/userSub args are accepted
 * for call-site compatibility but are NOT used for authentication.
 */
const axios = require('axios');
const configStore = require('./configStore');
const pingoneUserService = require('./pingOneUserService');

const TIMEOUT_MS = 30_000;

let _msgId = 0;
let _toolsCache = null; // cached tools/list result for the process lifetime

function _mcpUrl() {
    const region = process.env.PINGONE_REGION || configStore.getEffective('PINGONE_REGION') || 'com';
    const envId = process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('PINGONE_ENVIRONMENT_ID');
    if (!envId) throw new Error('PingOne MCP: environment ID not configured');
    return `https://api.pingone.${region}/v1/environments/${envId}/mcp`;
}

/**
 * Worker client_credentials token whose admin roles gate the available tools.
 * Reuses pingoneUserService's cached, auth-method-self-healing getter so we
 * don't duplicate token mechanics.
 */
async function _workerToken() {
    pingoneUserService.initialize(); // idempotent — re-reads config, keeps token cache
    return pingoneUserService.getAccessToken();
}

/**
 * Some MCP HTTP servers answer with text/event-stream even for a single result.
 * The PingOne server returns application/json today, but parse SSE defensively
 * so a transport change doesn't silently break tool calls.
 */
function _extractJsonRpc(data) {
    if (data && typeof data === 'object') return data;
    if (typeof data !== 'string') return data;
    const trimmed = data.trim();
    if (trimmed.startsWith('{')) return JSON.parse(trimmed);
    // SSE framing: pull the last `data:` line and parse it.
    const dataLines = trimmed.split('\n').filter((l) => l.startsWith('data:'));
    if (dataLines.length) return JSON.parse(dataLines[dataLines.length - 1].slice(5).trim());
    throw new Error('PingOne MCP: unrecognized response framing');
}

async function _send(method, params) {
    const id = ++_msgId;
    const token = await _workerToken();
    let resp;
    try {
        resp = await axios.post(
            _mcpUrl(),
            { jsonrpc: '2.0', id, method, params },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                },
                timeout: TIMEOUT_MS,
                // Treat non-2xx as thrown so we surface PingOne's error body.
                validateStatus: (s) => s >= 200 && s < 300,
                responseType: 'text',
                transformResponse: (d) => d, // keep raw; _extractJsonRpc parses
            }
        );
    } catch (err) {
        const status = err.response?.status;
        const body = err.response?.data;
        const msg = status
            ? `PingOne MCP HTTP ${status}${body ? `: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}` : ''}`
            : err.message;
        const e = new Error(msg);
        e.code = 'pingone_mcp_http_error';
        e.status = status;
        throw e;
    }

    const json = _extractJsonRpc(resp.data);
    if (json && json.error) {
        const e = new Error(json.error.message || 'PingOne MCP JSON-RPC error');
        e.code = 'pingone_mcp_rpc_error';
        e.mcpCode = json.error.code;
        throw e;
    }
    return json ? json.result : undefined;
}

/**
 * List all tools exposed by the hosted PingOne MCP server.
 * Cached for the process lifetime (reset on a malformed response so a transient
 * failure doesn't poison the cache).
 * @returns {Promise<Array<{ name: string, description: string, inputSchema: object }>>}
 */
async function listTools() {
    if (_toolsCache) return _toolsCache;
    const result = await _send('tools/list', {});
    if (!Array.isArray(result?.tools)) {
        console.warn('[mcpPingOneHttpAdapter] tools/list returned no tools array');
        return [];
    }
    _toolsCache = result.tools;
    return _toolsCache;
}

/**
 * Tool names from the cached tools/list, as a Set, or null if not yet warmed.
 * Synchronous so a hot path (e.g. tool routing) can test membership without an
 * await; callers warm the cache via listTools() and fall back while it's null.
 * @returns {Set<string>|null}
 */
function getCachedToolNames() {
    if (!Array.isArray(_toolsCache)) return null;
    return new Set(_toolsCache.map((t) => t.name));
}

/**
 * Call a tool on the hosted PingOne MCP server.
 *
 * @param {string} tool            MCP tool name
 * @param {object} params          Tool input parameters
 * @param {string} [_accessToken]  Accepted for call-site compatibility; NOT used
 *                                 for auth (the hosted server authenticates the
 *                                 worker token in the Authorization header).
 * @param {string} [_userSub]      Unused (see above).
 * @param {string} [_correlationId] Unused (see above).
 * @returns {Promise<object>}      MCP tools/call result (e.g. { content: [...] })
 */
async function callTool(tool, params, _accessToken, _userSub, _correlationId) {
    return _send('tools/call', { name: tool, arguments: params || {} });
}

/**
 * Plain JWT decode → { header, claims } (the shape buildTokenEvent consumes).
 * Inlined rather than reusing agentMcpTokenService.decodeJwtClaims to avoid a
 * circular require; buildTokenEvent still runs claims through sanitizeClaims.
 */
function _decodeJwt(token) {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    try {
        return { header: JSON.parse(b64url(parts[0])), claims: JSON.parse(b64url(parts[1])) };
    } catch {
        return null;
    }
}

/**
 * Decoded header+claims of the worker token used to authenticate to the hosted
 * server, for the token-chain visualization. The raw token never leaves this
 * module — only its decoded (and downstream-sanitized) claims. Returns null on
 * failure so the caller can render a degraded card instead of throwing.
 * @returns {Promise<{header:object,claims:object}|null>}
 */
async function getWorkerTokenDecoded() {
    try {
        const token = await _workerToken();
        return _decodeJwt(token);
    } catch (err) {
        console.warn('[mcpPingOneHttpAdapter] worker-token decode failed: %s', err.message);
        return null;
    }
}

// `_resetToolsCache` is exported for tests only.
function _resetToolsCache() {
    _toolsCache = null;
}

module.exports = { listTools, getCachedToolNames, callTool, getWorkerTokenDecoded, _resetToolsCache };
