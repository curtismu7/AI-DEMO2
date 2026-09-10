'use strict';
/**
 * mcpPingOneHttpAdapter.js
 *
 * Adapter for PingOne's HOSTED remote MCP server (Streamable HTTP transport).
 * Replaces the local `pingone-mcp-server` stdio binary: instead of spawning a
 * process, it POSTs MCP JSON-RPC (`tools/list` / `tools/call`) to
 *   https://mcp.pingone.{region}/admin/{envId}/mcp
 *
 * AUTH IS DELEGATED PKCE, NOT A WORKER TOKEN. The hosted server only accepts an
 * authorization-code + PKCE token. A worker `client_credentials` token is
 * minted for `https://api.pingone.com` (Management API) and the MCP server —
 * a different resource at `https://mcp.pingone.com` — rejects it outright with
 * `401 Invalid authentication`. That is an AUDIENCE mismatch, not an admin-role
 * problem, so granting the worker more roles never helped. Measured 2026-08-30.
 *
 * The token comes from routes/mcpPingOneAdminAuth.js (Authorization Code +
 * PKCE against the "PingOne MCP Server" app — S256_REQUIRED, no secret) and
 * lives at `req.session.pingoneMcpAdminToken.accessToken`. Callers MUST pass it
 * in. Roles ride on the SIGNED-IN USER, which is also what sizes the tool list:
 * an admin user sees ~73 tools, a plain user ~6.
 *
 * Consequence: every consumer of this adapter is SESSION-SCOPED. There is no
 * unattended path — a background job cannot call the hosted MCP server at all.
 * The hosted server is stateless: each JSON-RPC POST is self-contained, so there
 * is no `initialize` handshake or `Mcp-Session-Id` to track.
 *
 * Drop-in for the old stdio adapter — exports `listTools()` and `callTool()`
 * with the same shapes the agent / pipeline / inspector already consume, with
 * one difference that is NOT optional: the token argument IS the
 * authentication. It was ignored back when this adapter used a worker token;
 * passing nothing now throws `pingone_mcp_auth_required` rather than sending a
 * credential the server rejects.
 */
const axios = require('axios');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');
const configStore = require('./configStore');

const TIMEOUT_MS = 30_000;

/**
 * Which 401 is this? The hosted server answers "Invalid authentication" for
 * every rejection, so the string alone never says what to change.
 *
 * THE RULE, established by measurement 2026-09-10 and not before: the hosted
 * MCP accepts a token only when it was minted for PingOne's OWN built-in client
 * `pingone-mcp-server`, and only against the endpoint for the SAME environment
 * that issued it. Two tokens identical in aud, scope, sub, env, org, iss and
 * acr — differing only in client_id — behave differently: ours 401s, the
 * built-in one returns 78 tools.
 *
 * Two earlier revisions of this comment were WRONG, in ways worth naming so
 * they do not come back:
 *   1. "the tenant lacks Remote MCP enablement" — no; the tenant is fine.
 *   2. "the admin MCP is served from the organisation's ADMINISTRATORS
 *      environment, not the one being administered" — no. BOTH environments
 *      serve it. That came from only ever testing one environment with the
 *      built-in client and the other with our own app, never crossing the two.
 *
 * Neither roles nor scopes nor audience are the lever: the working token
 * carries `scope: openid` and `aud: https://api.pingone.com`, exactly like the
 * one that fails.
 *
 * Reports, never throws — a diagnosis must not replace the error it explains.
 */
const BUILTIN_MCP_CLIENT_ID = 'pingone-mcp-server';

function _authDiagnosis(token) {
    const want = (() => { try { return _mcpUrl(); } catch { return null; } })();
    const wantEnv = want && /\/admin\/([0-9a-f-]{36})\/mcp$/.exec(want);
    let claims;
    try {
        const parts = String(token).split('.');
        if (parts.length !== 3) return 'token is not a JWT, so its issuer could not be read.';
        claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
        return 'token could not be decoded.';
    }

    // Checked first: it is the cause in every case measured so far, and the
    // environment check below reads as authoritative if this one is skipped.
    if (claims.client_id && claims.client_id !== BUILTIN_MCP_CLIENT_ID) {
        return `the token was minted for client ${claims.client_id}, and this server accepts only PingOne's own `
            + `built-in client "${BUILTIN_MCP_CLIENT_ID}". Measured: two tokens identical in every claim but `
            + 'client_id, and only the built-in one is accepted. Roles, scopes, audience and app type are NOT the '
            + 'lever — a full org admin is refused the same way. That client is loopback-redirect-only, which is '
            + 'why this door signs in through PINGONE_MCP_ADMIN_LOOPBACK_PORT rather than an HTTPS callback.';
    }

    const tokenEnv = _issuerEnv(claims.iss);
    if (wantEnv && tokenEnv && tokenEnv !== wantEnv[1]) {
        return `the token was issued by environment ${tokenEnv} but this endpoint is ${wantEnv[1]}. The endpoint `
            + "environment must match the issuing one — a token from one environment is refused by another's "
            + 'endpoint even with the right client. Align PINGONE_ENVIRONMENT_ID with the sign-in environment.';
    }
    return `client and environment both look right (${claims.client_id || 'no client_id'}, ${tokenEnv || 'unknown env'}), `
        + "so this is a permissions problem — check the signed-in user's PingOne admin roles.";
}

let _msgId = 0;
let _toolsCache = null; // cached tools/list result for the process lifetime

// Single source of truth for the hosted MCP URL format. Optional overrides let
// callers (e.g. the /pingone-setup connectivity test) build the URL for a
// submitted region/envId instead of the configured one.
//
// The env here is simply the environment being administered — the same
// PINGONE_ENVIRONMENT_ID as everything else in this demo. A
// PINGONE_MCP_ENVIRONMENT_ID override briefly existed on the theory that the
// admin plane lived in the organisation's Administrators environment; that was
// wrong (see _authDiagnosis) and the indirection is gone with it. Measured:
// admin/<this env>/mcp returns 78 tools, and the SAME token is refused by
// another environment's endpoint.
function _mcpUrl(overrides = {}) {
    const region = overrides.region || process.env.PINGONE_REGION || configStore.getEffective('PINGONE_REGION') || 'com';
    const envId = overrides.envId
        || process.env.PINGONE_ENVIRONMENT_ID
        || configStore.getEffective('PINGONE_ENVIRONMENT_ID');
    if (!envId) throw new Error('PingOne MCP: environment ID not configured');
    return `https://mcp.pingone.${region}/admin/${envId}/mcp`;
}

/** The environment id embedded in a PingOne issuer URL, or null. */
function _issuerEnv(iss) {
    const m = /^https:\/\/auth\.pingone\.[^/]+\/([0-9a-f-]{36})\/as$/.exec(String(iss || ''));
    return m ? m[1] : null;
}

/**
 * The delegated PKCE access token for this request. `req.session` is accepted
 * as a convenience so callers can hand over the session they already have.
 *
 * Throws rather than falling back to a worker token: a worker token is not a
 * weaker credential here, it is an invalid one, and silently sending it turned
 * every failure into an opaque 401 instead of naming the real cause.
 */
function _delegatedToken(auth) {
    const t = typeof auth === 'string'
        ? auth
        : auth?.pingoneMcpAdminToken?.accessToken           // a session object
          || auth?.accessToken                              // the stored record
          || null;
    if (!t) {
        const e = new Error(
            'PingOne MCP requires a delegated PKCE token. Sign in via '
            + '/api/mcp/inspector/pingone-admin (routes/mcpPingOneAdminAuth.js) and pass '
            + 'req.session (or the access token) to this call.',
        );
        e.code = 'pingone_mcp_auth_required';
        throw e;
    }
    return t;
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

async function _send(method, params, auth) {
    const id = ++_msgId;
    const token = _delegatedToken(auth);
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
        if (!status) {
            // Transport failure (timeout / connection refused): normalize to a
            // stable UPSTREAM_TIMEOUT/UNREACHABLE + httpStatus instead of leaking
            // the raw axios message.
            throw normalizeAxiosError(err, { label: 'PingOne MCP HTTP request', timeoutMs: TIMEOUT_MS });
        }
        const body = err.response?.data;
        let msg = `PingOne MCP HTTP ${status}${body ? `: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}` : ''}`;
        // A bare "401 Invalid authentication" sent three separate investigations
        // after roles, app type and scopes, all of which were already correct.
        // Say which of the two 401s this is, because they need opposite actions.
        if (status === 401) msg += ` — ${_authDiagnosis(token)}`;
        const e = new Error(msg);
        e.code = 'pingone_mcp_http_error';
        e.status = status;
        e.httpStatus = status;
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
async function listTools(auth) {
    if (_toolsCache) return _toolsCache;
    const result = await _send('tools/list', {}, auth);
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
async function callTool(tool, params, auth, _userSub, _correlationId) {
    // The third arg was previously accepted and IGNORED (worker auth). It is now
    // the delegated PKCE token (or the session carrying it) and is required.
    return _send('tools/call', { name: tool, arguments: params || {} }, auth);
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
 * Decoded header+claims of the DELEGATED token used to authenticate to the
 * hosted server, for the token-chain visualization. The raw token never leaves
 * this module — only its decoded (and downstream-sanitized) claims. Returns
 * null on failure so the caller renders a degraded card instead of throwing.
 *
 * Name kept for call-site compatibility; it has never been a worker token since
 * the PKCE cutover (2026-08-30).
 * @param {object|string} auth - req.session, the stored token record, or a raw token
 * @returns {Promise<{header:object,claims:object}|null>}
 */
async function getWorkerTokenDecoded(auth) {
    try {
        return _decodeJwt(_delegatedToken(auth));
    } catch (err) {
        console.warn('[mcpPingOneHttpAdapter] delegated-token decode failed: %s', err.message);
        return null;
    }
}

// `_resetToolsCache` is exported for tests only.
function _resetToolsCache() {
    _toolsCache = null;
}

module.exports = { listTools, getCachedToolNames, callTool, getWorkerTokenDecoded, getMcpUrl: _mcpUrl, extractJsonRpc: _extractJsonRpc, _resetToolsCache };
