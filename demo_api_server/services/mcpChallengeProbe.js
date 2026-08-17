'use strict';

/**
 * MCP 401 challenge probe — the discovery half of the MCP authorization dance.
 *
 * The BFF holds its agent token before it ever speaks to the gateway, so the
 * real client would never walk the spec's discovery handshake: it just presents
 * the bearer and gets an answer in one round trip. That made the token chain and
 * the topology diagram show a single MCP call, which is accurate but hides the
 * mechanism the demo exists to teach — that the MCP endpoint is an OAuth 2.1
 * protected resource that CHALLENGES an anonymous caller and advertises its own
 * authorization server (RFC 9728) in that challenge.
 *
 * So we walk it for real, first, on purpose:
 *
 *   1. POST the JSON-RPC method to <gateway>/mcp with NO Authorization header
 *      -> 401 + `WWW-Authenticate: Bearer realm=..., resource_metadata=...`
 *   2. GET the advertised resource_metadata URL
 *      -> the RFC 9728 document naming the authorization server and scopes
 *   3. (the caller then makes its normal authenticated call)
 *
 * Both legs are live HTTP against the running gateway — the 401, the header and
 * the metadata body in the token chain are what the gateway actually returned,
 * never a rendering of what it would have returned. Every failure here is
 * swallowed: the probe is evidence-gathering for the UI, so a gateway that is
 * unreachable, unconfigured, or answering something other than 401 must never
 * take down the authenticated call that follows.
 */

const axios = require('axios');
const https = require('https');

// Mirrors mcpGatewayClient's TLS posture so a self-signed local gateway that the
// real call reaches is not rejected by the probe alone.
const _allowInsecureTls = process.env.MCP_GATEWAY_REJECT_UNAUTHORIZED === '0';
const _httpsAgent = new https.Agent({ rejectUnauthorized: !_allowInsecureTls });

// Deliberately short: this runs before every discovery and every tool call, and
// nothing downstream depends on its result. A slow gateway should cost the run a
// couple of seconds at most, not the full gateway timeout.
const PROBE_TIMEOUT_MS = Number(process.env.MCP_CHALLENGE_PROBE_TIMEOUT_MS) || 2500;

/**
 * Parse an RFC 6750 §3 `WWW-Authenticate` value into its scheme + auth-params.
 * Returns null for a missing/blank header. Pure — exported for unit testing.
 *
 * @param {string} raw
 * @returns {{scheme: string, raw: string, [param: string]: string} | null}
 */
function parseWwwAuthenticate(raw) {
    if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
    const scheme = raw.trim().split(/\s+/)[0] || '';
    const params = {};
    const re = /([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(raw)) !== null) params[m[1].toLowerCase()] = m[2];
    return { scheme, ...params, raw };
}

/**
 * Record onto the request AND into `sink`. Two consumers, two delivery routes:
 * the agent-run path reads req.tokenEvents, while the tool-call pipeline owns
 * its own array that it publishes to SSE — an event that only landed on the
 * request would never reach the second one.
 */
function record(sink, req, type, payload) {
    const event = { type, timestamp: new Date().toISOString(), ...payload };
    sink.push(event);
    if (req && typeof req.recordTokenEvent === 'function') {
        try {
            req.recordTokenEvent(type, payload);
        } catch (err) {
            console.warn('[mcpChallengeProbe] recordTokenEvent failed:', err.message);
        }
    }
    return event;
}

/**
 * Leg 2 — fetch the RFC 9728 protected-resource metadata the challenge pointed at.
 * Records `mcp_resource_metadata` on success, `mcp_resource_metadata_error`
 * otherwise. Never throws.
 */
async function fetchProtectedResourceMetadata(sink, req, metadataUrl, phase) {
    if (!metadataUrl) return null;
    try {
        const response = await axios.get(metadataUrl, {
            timeout: PROBE_TIMEOUT_MS,
            validateStatus: () => true,
            httpsAgent: _httpsAgent,
        });
        if (response.status !== 200 || !response.data || typeof response.data !== 'object') {
            record(sink, req, 'mcp_resource_metadata_error', {
                phase,
                url: metadataUrl,
                status: response.status,
                reason: 'metadata document not returned',
            });
            return null;
        }
        const doc = response.data;
        record(sink, req, 'mcp_resource_metadata', {
            phase,
            url: metadataUrl,
            resource: doc.resource || null,
            authorizationServers: doc.authorization_servers || [],
            scopesSupported: doc.scopes_supported || [],
            bearerMethodsSupported: doc.bearer_methods_supported || [],
            spec: 'RFC 9728',
            document: doc,
        });
        return doc;
    } catch (err) {
        record(sink, req, 'mcp_resource_metadata_error', {
            phase,
            url: metadataUrl,
            reason: err.code || 'metadata_fetch_failed',
            message: err.message,
        });
        return null;
    }
}

/**
 * Leg 1 — issue the MCP method with no credential and capture the challenge.
 *
 * @param {object} req                 Express request (for recordTokenEvent)
 * @param {object} opts
 * @param {string} opts.method         JSON-RPC method to probe ('tools/list' | 'tools/call')
 * @param {string} [opts.phase]        Label carried on every event; defaults to `method`
 * @param {string} [opts.gatewayUrl]   Override the resolved gateway base URL
 * @param {object} [opts.params]       JSON-RPC params (a tools/call probe names the tool)
 * @returns {Promise<{status: number|null, challenge: object|null, metadata: object|null, events: object[]}>}
 *          Always resolves. `events` is every token event this probe recorded,
 *          for callers that publish their own SSE side channel; `status` is null
 *          when there was no gateway to probe or the request never completed.
 */
async function probeMcpChallenge(req, opts = {}) {
    const { method, params = {}, phase = opts.method } = opts;
    const events = [];
    let base = opts.gatewayUrl;
    if (!base) {
        // Lazy require: mcpGatewayClient pulls in configStore and the token
        // services, and this module is required from inside those call paths.
        const { tryGetMcpGatewayHttpUrl } = require('./mcpGatewayClient');
        base = tryGetMcpGatewayHttpUrl();
    }
    if (!base) {
        record(events, req, 'mcp_challenge_skipped', {
            phase,
            reason: 'no_gateway_configured',
        });
        return { status: null, challenge: null, metadata: null, events };
    }

    const url = `${String(base).replace(/\/+$/, '')}/mcp`;
    try {
        const response = await axios.post(
            url,
            { jsonrpc: '2.0', id: 'challenge-probe', method, params },
            {
                // No Authorization header — that omission IS the probe.
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                timeout: PROBE_TIMEOUT_MS,
                validateStatus: () => true,
                httpsAgent: _httpsAgent,
            },
        );

        const wwwAuth = response.headers?.['www-authenticate'] || null;
        const challenge = parseWwwAuthenticate(wwwAuth);
        record(events, req, 'mcp_challenge', {
            phase,
            method,
            url,
            status: response.status,
            // A gateway that answers an anonymous call with anything but 401 is
            // itself the finding — surface it rather than asserting the happy path.
            challenged: response.status === 401,
            wwwAuthenticate: wwwAuth,
            realm: challenge?.realm || null,
            error: challenge?.error || null,
            scope: challenge?.scope || null,
            resourceMetadataUrl: challenge?.resource_metadata || null,
            responseBody: response.data ?? null,
            spec: 'RFC 6750 §3 · MCP Authorization',
        });

        const metadata = challenge?.resource_metadata
            ? await fetchProtectedResourceMetadata(events, req, challenge.resource_metadata, phase)
            : null;

        return { status: response.status, challenge, metadata, events };
    } catch (err) {
        record(events, req, 'mcp_challenge_error', {
            phase,
            method,
            url,
            reason: err.code || 'challenge_probe_failed',
            message: err.message,
        });
        return { status: null, challenge: null, metadata: null, events };
    }
}

module.exports = {
    probeMcpChallenge,
    parseWwwAuthenticate,
    PROBE_TIMEOUT_MS,
};
