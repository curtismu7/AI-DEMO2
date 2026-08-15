'use strict';
/**
 * mcpGatewayClient.js — HTTP client for the banking-mcp-gateway.
 *
 * Routes tool calls through the MCP gateway instead of directly to the MCP
 * server. The gateway owns RFC 9728 protected-resource metadata, runs
 * PingOne Authorize policy evaluation, and performs the final RFC 8693
 * token exchange to the upstream MCP server — the BFF-issued token is the
 * bearer here and must already be scoped to the gateway audience.
 *
 * Source of Truth for gateway URL:
 *   configStore key: mcp_gateway_http_url  (persisted to SQLite, survives restarts)
 *   Env var fallback: MCP_GATEWAY_HTTP_URL
 *   Default: https://api.ping.demo:3005
 *
 * TLS validation:
 *   Default: ENABLED (rejectUnauthorized: true). Set MCP_GATEWAY_REJECT_UNAUTHORIZED=0
 *   to opt out for local dev (mkcert self-signed). This flag is forbidden in production.
 *
 * Other env vars:
 *   MCP_GATEWAY_TIMEOUT_MS — per-request timeout in ms (default: 30000)
 */

const crypto = require('node:crypto');
const axios = require('axios');
const https = require('node:https');
const configStore = require('./configStore');
const { decodeJwt } = require('../utils/tokenUtils');
const nrSegments = require('./nrSegments');

// TLS cert validation is ON by default. Opt out only for local dev.
// Refusing opt-out in production prevents MITM exfil of bearer tokens.
const _allowInsecureTls = process.env.MCP_GATEWAY_REJECT_UNAUTHORIZED === '0';
if (_allowInsecureTls && process.env.NODE_ENV === 'production') {
    // Hard-fail: insecure TLS in production would expose MCP bearer tokens.
    console.error('[FATAL] MCP_GATEWAY_REJECT_UNAUTHORIZED=0 is not permitted in production.');
    process.exit(1);
}
const _httpsAgent = new https.Agent({ rejectUnauthorized: !_allowInsecureTls });

const DEFAULT_TIMEOUT_MS    = 30_000;
// Keep in sync with demo_mcp_gateway and demo_mcp_server package.json#mcpVersion.
const MCP_PROTOCOL_VERSION  = '2025-11-25';
// PingGateway (IG) ships an older MCP SDK that validates against this exact
// version and 400s on anything else. Exported so gateway.real_path pins the
// same value rather than keeping a second copy that can drift from the client
// it is supposed to be imitating.
const IG_MCP_PROTOCOL_VERSION = '2025-06-18';

// api-key-disposition tools: PingGateway (IG) singles these out onto a dedicated
// /mcp/apikey path so its route (00-mcp-apikey.json) hands them to the vault-key
// credential-mediation handler instead of the OLB token-exchange path. Only
// applied when the gateway base IS PingGateway (base === pgUrl below). Keep in
// sync with demo_mcp_gateway/src/router.ts APIKEY_TOOLS and the IG handler's
// ROUTE_FOR_TOOL map (apikey-dispatch.groovy).
const APIKEY_TOOLS = new Set([
    'show_mortgage',
    'show_large_purchase',
    'show_health_record',
    'show_gear_order',
    'show_gear_warranty',
    'show_expense_report',
    'show_permit',
    'show_enrollment',
    'show_work_order',
    'show_investment',
]);

// Path B (dual_token) and Path C (bankingdata) are implemented on the Node
// gateway only. PingGateway has no dualtoken/bankingdata routes yet — when
// ff_mcp_gateway_pinggateway is ON, still send these tools to the Node gateway
// so they do not fall through to the OLB exchange path ("Unknown tool").
const DUALTOKEN_TOOLS = new Set([
    'user_profile_card',
]);
const BANKINGDATA_TOOLS = new Set([
    'demo_show_accounts',
    'demo_show_transactions',
]);

// weather-mcp showcase: fronted by PingGateway's 00-mcp-weather.json (a
// third-party weather MCP server, scoped to Texas by tx-weather-scope.groovy)
// via the dedicated /mcp/weather route when the base IS PingGateway. The Node
// mock gateway (demo_mcp_gateway) mirrors the same Texas-only geofence
// (src/scopePolicies.ts checkWeatherScope) and takes this tool over its
// single /mcp endpoint (routeTool() -> 'weather') — no dedicated path needed.
const WEATHER_TOOLS = new Set([
    'get_weather',
]);

// brave-mcp showcase: fronted by PingGateway's 00-mcp-brave.json (a
// hand-written MCP server that calls the real Brave Search News API, gated
// by tx-brave-scope.groovy's crypto-term content blocklist) via the
// dedicated /mcp/brave route when the base IS PingGateway. The Node mock
// gateway mirrors the same blocklist (src/scopePolicies.ts checkBraveScope)
// and takes this tool over its single /mcp endpoint (routeTool() -> 'brave').
const BRAVE_TOOLS = new Set([
    'brave_news_search',
]);

/**
 * Call an MCP tool via the gateway HTTP endpoint.
 *
 * @param {string} gatewayUrl   Base URL of the gateway (no trailing slash)
 * @param {string} bearerToken  Access token scoped to the gateway audience (MCP_GW_RESOURCE_URI)
 * @param {string} tool         MCP tool name (e.g. "get_accounts")
 * @param {object} params       Tool arguments
 * @param {object} [opts]
 * @param {string} [opts.correlationId]  Forwarded as JSON-RPC id for tracing
 * @param {string} [opts.sessionId]      Forwarded as mcp-session-id header if present
 * @param {boolean} [opts.omitActorBridge] Demo-only (UC16): skip the X-Act-Client-Id /
 *   X-May-Act-Sub bridge so the call presents NO delegation evidence at all
 * @returns {Promise<any>}  The JSON-RPC result value
 *
 * @throws {Error} with `.code` and `.httpStatus` for 401/403/5xx
 */
async function callToolViaGateway(gatewayUrl, bearerToken, tool, params = {}, opts = {}) {
    let base = (gatewayUrl || getMcpGatewayHttpUrl()).replace(/\/$/, '');
    // PingGateway (IG) base — when the gateway IS IG, api-key-disposition tools go
    // to the dedicated /mcp/apikey route (vault-key credential mediation); every
    // other tool (and the Node gateway) uses /mcp.
    const pgUrl = (process.env.MCP_PINGGATEWAY_URL || configStore.getEffective('mcp_pinggateway_url') || '').replace(/\/$/, '');
    // Path B/C are Node-gateway-only: if the caller resolved PingGateway as the
    // default base but the tool is dual_token or bankingdata, force Node URL.
    if ((DUALTOKEN_TOOLS.has(tool) || BANKINGDATA_TOOLS.has(tool)) && pgUrl && base === pgUrl) {
        const nodeUrl = (process.env.MCP_GATEWAY_HTTP_URL || configStore.getEffective('mcp_gateway_http_url') || '').replace(/\/$/, '');
        if (nodeUrl) base = nodeUrl;
    }
    // A2A nested-act tokens are audienced to the DEDICATED A2A gateway resource
    // (a2a_gateway_audience / A2A_GATEWAY_AUDIENCE), which only the Node Demo
    // Agent Gateway accepts (comma-list MCP_GW_RESOURCE_URI). PingGateway (IG)
    // introspects against its own resource URI and its McpProtectionFilter also
    // requires scope gateway:mcp:invoke, so an A2A specialist call routed there
    // always fails (401 wrong aud / 403 insufficient_scope). Pin A2A-audienced
    // bearers to the Node gateway, same Node-only routing as Path B/C above and
    // the RAR sims (#603). mcp_demo_gateway_url, not MCP_GATEWAY_HTTP_URL — the
    // latter is baked per-container and may point at IG (#375).
    if (pgUrl && base === pgUrl) {
        const a2aAud = process.env.A2A_GATEWAY_AUDIENCE
            || configStore.getEffective('a2a_gateway_audience') || '';
        if (a2aAud) {
            const claims = decodeJwt(bearerToken)?.claims;
            const audList = Array.isArray(claims?.aud) ? claims.aud.map(String)
                : (claims?.aud != null ? [String(claims.aud)] : []);
            if (audList.includes(a2aAud)) {
                const nodeUrl = (process.env.MCP_DEMO_GATEWAY_URL
                    || configStore.getEffective('mcp_demo_gateway_url') || '').replace(/\/$/, '');
                if (nodeUrl) base = nodeUrl;
            }
        }
    }
    const isIgBase = !!pgUrl && base === pgUrl;
    const url  = isIgBase && APIKEY_TOOLS.has(tool) ? `${base}/mcp/apikey`
               : isIgBase && WEATHER_TOOLS.has(tool) ? `${base}/mcp/weather`
               : isIgBase && BRAVE_TOOLS.has(tool) ? `${base}/mcp/brave`
               : `${base}/mcp`;

    const body = {
        jsonrpc: '2.0',
        id:      opts.correlationId || crypto.randomUUID(),
        method:  'tools/call',
        params:  { name: tool, arguments: params },
    };

    // UC18 on PingOne Agent Gateway (IG): arm uc18-rate-limit.groovy via trusted header
    // (Demo Agent Gateway enforces limits in-process instead).
    const { shouldStampIgRateLimitHeader } = require('./mcpGatewayRateLimit');

    // PingGateway (IG) ships with an older MCP SDK that validates against
    // 2025-06-18; the Node gateway and MCP server use the current 2025-11-25.
    const mcpVersion = isIgBase ? IG_MCP_PROTOCOL_VERSION : MCP_PROTOCOL_VERSION;
    const headers = {
        'Authorization':        `Bearer ${bearerToken}`,
        'Content-Type':         'application/json',
        'Accept':               'application/json, text/event-stream',
        'MCP-Protocol-Version': mcpVersion,
    };
    // Correlation: send the id as a standard HTTP header in addition to the
    // JSON-RPC `id` below, so the gateway (extractCorrelationId reads headers
    // first) and any HTTP-aware hop log the SAME id end-to-end — letting one
    // request be reconstructed across BFF, gateway, and MCP server.
    if (body.id) {
        headers['X-Correlation-ID'] = String(body.id);
    }
    if (opts.sessionId) {
        headers['mcp-session-id'] = opts.sessionId;
    }
    if (opts.tratContextHeader) {
        headers['X-TraT-Context'] = opts.tratContextHeader;
    }
    if (opts.intentToken) {
        headers['X-Intent-Token'] = opts.intentToken;
    }
    // Vertical: pass the active vertical to the gateway so PingOne Authorize
    // can use it in policy decisions (parity with the WS path which sends it
    // on the upgrade request). Sourced from configStore — never user-controlled.
    try {
      const activeVertical = (opts && opts.vertical) || configStore.getEffective('active_vertical');
      if (activeVertical) {
        headers['X-Active-Vertical'] = activeVertical;
      }
    } catch (_) { /* best-effort */ }
    // Use case: the business context the call was initiated under. The gateway
    // forwards it to PingOne Authorize as UseCaseId so policy can gate on intent
    // rather than only on amount — UC22's CIBA approval is amount-INDEPENDENT by
    // design ($150), so with the BFF no longer pre-flighting, this header is the
    // only way the PDP can see that a decoupled approval was intended.
    // Additive only: policy uses it to REQUIRE a gate, never to waive one, so a
    // caller that omits it cannot weaken a decision.
    if (opts && opts.useCaseId) {
        headers['X-Use-Case-Id'] = String(opts.useCaseId);
    }
    // Tier (groupToTier) — pre-resolved here because neither gateway can map a
    // PingOne group array to a tier locally (no set-membership operator in either
    // P1AZ's DSL or the gateways' own runtimes). Additive: gateways use this only
    // to DENY, never to widen a decision a token's own scopes wouldn't otherwise earn.
    if (opts && Array.isArray(opts.userGroups)) {
        try {
            const groupPolicy = require('./groupPolicy');
            const verticalForTier = (opts && opts.vertical) || configStore.getEffective('active_vertical') || 'banking';
            const tier = groupPolicy.resolveUserTier(opts.userGroups, verticalForTier);
            const tierDefs = groupPolicy.getTierDefinitions(verticalForTier);
            const tierDef = tierDefs[tier];
            headers['X-User-Tier'] = tier;
            if (tierDef) {
                if (typeof tierDef.maxAmountUsd === 'number') {
                    headers['X-Tier-Max-Amount-Usd'] = String(tierDef.maxAmountUsd);
                }
                if (Array.isArray(tierDef.restrictedTools) && tierDef.restrictedTools.length) {
                    headers['X-Tier-Restricted-Tools'] = tierDef.restrictedTools.join(',');
                }
            }
        } catch (_) { /* best-effort */ }
    }
    // DPoP (RFC 9449): sign a fresh per-hop proof bound to this request URL + access
    // token when the session has a DPoP key (ff_dpop). The htu path must match what
    // the gateway sees (/mcp). Best-effort — never block the call on proof failure.
    if (opts.dpopKey && opts.dpopKey.privatePem) {
        try {
            const { signDpopProof, accessTokenHash } = require('./dpopKeyService');
            headers['DPoP'] = signDpopProof({
                privatePem: opts.dpopKey.privatePem,
                publicJwk: opts.dpopKey.publicJwk,
                htu: url,
                htm: 'POST',
                ath: accessTokenHash(bearerToken),
            });
        } catch (_) { /* best-effort */ }
    }
    // Web Bot Auth (RFC 9421, draft-meunier profile): sign @authority +
    // signature-agent with the BFF's stable Ed25519 agent key. The gateway
    // resolves the public key from Signature-Agent's
    // /.well-known/http-message-signatures-directory (served by this BFF).
    // Signature-Agent must be an origin the GATEWAY can reach — override via
    // WBA_SIGNATURE_AGENT_URL in docker/k8s. Best-effort: never block the call.
    try {
        const { signWebBotAuthHeaders } = require('./dpopKeyService');
        const agentOrigin = new URL(
            process.env.WBA_SIGNATURE_AGENT_URL
            || process.env.BFF_BASE_URL
            || 'http://localhost:3001'
        ).origin;
        Object.assign(headers, signWebBotAuthHeaders({
            authority: new URL(url).host,
            signatureAgent: agentOrigin,
        }));
    } catch (_) { /* best-effort */ }
    // Bridge the actor delegation (X-Act-Client-Id / X-May-Act-Sub) so the gateway's
    // Authorize decision can enforce the actor chain on the HTTP transport (PingOne
    // can't emit `act` on exchanged tokens). Shared with the WS client.
    //
    // UC16 (impersonation-no-act) is the one caller that must NOT get this: the bridge
    // supplies a valid, allowlisted ActClientId even when the token carries no `act`,
    // so the impersonation attempt was silently upgraded into a well-formed delegated
    // call and PERMITted. Skipping it is what lets an act-less call reach Authorize with
    // an empty actor and be denied by HasValidActorChain.
    if (!opts.omitActorBridge) {
        Object.assign(headers, require('./mcpActorBridge').buildActorBridgeHeaders());
    }

    // Security Showcase — confused-deputy demo. When the caller passes a rogue,
    // non-allowlisted actor client_id, override the bridged X-Act-Client-Id so the
    // gateway forwards it to PingOne Authorize, whose HasValidActorChain condition
    // returns a real DENY (mcp-invalid-actor). Demo-only: this value originates from
    // an authenticated session's explicit attack chip, never from normal tool calls.
    //
    // X-Demo-Force-Actor: the mcpgateway resource now stamps a native `act` claim on
    // this hop (docs/ACT_CLAIM_VERIFICATION.md, 2026-06-19 SPEL rollout), and both the
    // Node gateway and PingGateway prefer that native claim over any header — so the
    // override above was silently shadowed. This flag tells them to prefer the header
    // for THIS request only; gated by the same x-internal-gateway-secret trust check as
    // X-Act-Client-Id itself, so an external caller can't set it, and real traffic never
    // sends it — native act still wins for every normal call.
    if (opts.testActClientId) {
        headers['X-Act-Client-Id'] = String(opts.testActClientId);
        headers['X-Demo-Force-Actor'] = 'true';
        console.log('[GW→PingGateway] CONFUSED-DEPUTY DEMO: overriding X-Act-Client-Id with rogue actor=%s (forcing over native act)', opts.testActClientId);
    }

    // When routing through PingGateway (IG), tell it which authorize backend to use,
    // mirroring the inverse of the BFF's ff_authorize_real (live-switchable mock demo_authz_server
    // vs real PingOne Authorize). PingGateway's Groovy decision filter reads this header
    // per-request; the Node gateway never sees it (header added only on the PG path), so
    // the Node-gateway request shape is unchanged.
    if (configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true') {
        // Prove this is the trusted BFF caller so PingGateway's decision filter honors
        // the delegation signals below (X-Authz-Simulated) and the bridged actor
        // (X-Act-Client-Id / X-May-Act-Sub added above). Without a valid secret the IG
        // groovy forces the REAL authorize backend and drops the bridged actor, so a
        // caller reaching the IG host port directly can't forge either. Same shared
        // secret + header the Node gateway checks (checkInternalSecret).
        const gwSecret = configStore.getEffective('bff_internal_secret') || process.env.BFF_INTERNAL_SECRET || '';
        if (gwSecret) headers['x-internal-gateway-secret'] = gwSecret;
        const simulated = configStore.getEffective('ff_authorize_real') !== 'true';
        headers['X-Authz-Simulated'] = simulated ? 'true' : 'false';
        if (shouldStampIgRateLimitHeader()) {
            headers['X-UC18-Rate-Limit'] = 'true';
        }
        // Per-request token-validation mode for the gateway: 'jwks' selects route
        // 00-mcp-olb-jwks.json (local JWT validation, no introspection round-trip);
        // 'introspect' (default) falls through to route 01-mcp-olb.json unchanged.
        const jwksMode = configStore.getEffective('ff_mcp_gateway_jwks') === 'true';
        headers['X-Token-Validation'] = jwksMode ? 'jwks' : 'introspect';
    }

    const rawTimeout = parseInt(
        configStore.getEffective('mcp_gateway_timeout_ms') || process.env.MCP_GATEWAY_TIMEOUT_MS || '',
        10
    );
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;

    console.log('[GW→PingGateway] REQUEST: url=%s method=POST', url);
    console.log('[GW→PingGateway] HEADERS: %j', Object.fromEntries(
        Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'authorization')
    ));
    // Tool-call/response payloads can contain banking records — log them only when
    // explicitly opted in (MCP_GATEWAY_LOG_BODIES=true), not by default.
    if (process.env.MCP_GATEWAY_LOG_BODIES === 'true') {
        console.log('[GW→PingGateway] BODY: %j', body);
    }

    let response;
    try {
        response = await nrSegments.mcpToolCall(() =>
            axios.post(url, body, {
                headers,
                timeout: timeoutMs,
                // Handle error status codes ourselves so we can emit structured errors
                validateStatus: () => true,
                httpsAgent: _httpsAgent,
            })
        );
    } catch (axErr) {
        console.error(
            '[mcpGatewayClient] axios error: code=%s message=%s url=%s',
            axErr.code, axErr.message, axErr.config?.url
        );
        // Normalize transport failures (timeout / connection refused) into stable
        // GATEWAY_* codes + HTTP statuses so callers get a consistent shape instead
        // of a raw axios ECONNABORTED/ECONNREFUSED.
        throw _normalizeGatewayNetworkError(axErr, timeoutMs);
    }

    const status = response.status;
    console.log('[GW→PingGateway] RESPONSE: status=%d', status);
    console.log('[GW→PingGateway] RESPONSE HEADERS: %j', response.headers);
    if (process.env.MCP_GATEWAY_LOG_BODIES === 'true') {
        console.log('[GW→PingGateway] RESPONSE BODY: %j', response.data);
    } else {
        console.log('[GW→PingGateway] RESPONSE BODY: <redacted; set MCP_GATEWAY_LOG_BODIES=true to log payloads>');
    }

    if (status === 401) {
        const body401 = response.data || {};
        const gatewayError = body401.error || 'gateway_auth_failed';
        const gatewayMessage =
            body401.message ||
            body401.error_description ||
            'token may be missing or expired';
        // Classify WHY the bearer was rejected so the surfaced message is accurate
        // and actionable. Decode the rejected token's claims (NOT the raw token;
        // tokenUtils.decodeJwt never throws / never logs the token) and compare its
        // audience to the gateway audience the token MUST carry.
        const claims = decodeJwt(bearerToken)?.claims;
        const nowSec = Math.floor(Date.now() / 1000);
        const tokenAud = !claims ? []
            : (Array.isArray(claims.aud) ? claims.aud.map(String)
                : (claims.aud != null ? [String(claims.aud)] : []));
        const expired = !!(claims && typeof claims.exp === 'number' && claims.exp < nowSec);
        // The gateway-scoped audience the BFF-minted token must carry. Use the
        // SAME per-mode resolver the token was minted with — otherwise on the
        // PingGateway (IG) path the token's aud (the pinggateway resource) is
        // compared against the Node-gateway aud, so every IG rejection is
        // mislabeled "wrong audience", masking the real cause. Falls back to the
        // old chain for the Node-gateway path / if resolution is unavailable.
        const expectedAud =
            require('./mcpToolAuthorizationService').resolveExpectedMcpResourceUri() ||
            process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI ||
            configStore.getEffective('pingone_resource_mcp_gateway_uri') ||
            configStore.getEffective('mcp_gw_resource_uri') ||
            null;
        // Wrong audience: token decoded fine but its aud doesn't include the gateway's.
        // This is a CONFIG drift (e.g. MCP_SERVER_RESOURCE_URI set to the MCP-server aud
        // instead of the gateway aud) — a fresh login mints the SAME wrong aud, so
        // re-auth does NOT help. Must be distinguished from a genuinely expired token.
        const audMismatch = !!(expectedAud && tokenAud.length > 0 && !tokenAud.includes(expectedAud));

        let cause, code, message, needsLogin, httpStatus = 401;
        if (audMismatch) {
            cause = 'wrong_audience';
            code = 'GATEWAY_AUDIENCE_MISMATCH';
            needsLogin = false;
            if (opts.simulatedAttack) {
                // An attack sim presents a deliberately wrong-audience token — the
                // mismatch IS the expected result. Framing it as config drift sends
                // the operator off to "fix" a config that is already correct.
                message =
                    `Audience binding rejected the token as expected: aud is [${tokenAud.join(', ')}] but the ` +
                    `gateway requires "${expectedAud}". No configuration change is needed — this is the ` +
                    `simulated attack being blocked.`;
            } else {
                // Name the setting that actually drives the expected audience in the
                // ACTIVE mode. Hardcoding MCP_SERVER_RESOURCE_URI was wrong on the
                // PingGateway path, where the audience comes from the pinggateway
                // resource URI instead.
                const svc = require('./mcpToolAuthorizationService');
                const setting = typeof svc.resolveExpectedMcpResourceSetting === 'function'
                    ? svc.resolveExpectedMcpResourceSetting()
                    : null;
                const fixHint = setting
                    ? `Fix: set ${setting.envVar || setting.settingKey}="${expectedAud}" in the BFF config ` +
                      `(${setting.envVar ? 'demo_api_server/.env or ' : ''}the /config admin page, ` +
                      `${setting.mode} mode) to match scope-topology.json, then restart.`
                    : `Fix: point the BFF's MCP resource URI for the active gateway mode at "${expectedAud}" ` +
                      `to match scope-topology.json, then restart.`;
                message =
                    `Wrong audience: the access token's aud is [${tokenAud.join(', ')}] but the gateway requires ` +
                    `"${expectedAud}". This is a configuration drift, not an expired token — signing in again will ` +
                    `NOT fix it. ${fixHint}`;
            }
        } else if (expired) {
            cause = 'expired';
            code = 'TOKEN_INACTIVE';
            needsLogin = true;
            message = 'Your session token has expired — please sign in again.';
        } else if (!claims) {
            // Token could not even be decoded — genuinely malformed/absent. Re-auth may help.
            cause = 'invalid';
            code = 'TOKEN_INACTIVE';
            needsLogin = true;
            message = `Your session token was rejected (${gatewayMessage}) — please sign in again.`;
        } else if (gatewayError === 'login_required' || body401.login_required === true) {
            // Gateway explicitly demands re-authentication — honour it even for a
            // decodable token.
            cause = 'login_required';
            code = 'TOKEN_INACTIVE';
            needsLogin = true;
            message = `Your session token was rejected (${gatewayMessage}) — please sign in again.`;
        } else {
            // Token decoded fine, carries the correct gateway audience, and is NOT
            // expired — yet the gateway/MCP server rejected it (e.g. the MCP server
            // could not verify the signature against PingOne's JWKS, or an upstream
            // is misconfigured). This is a DOWNSTREAM/server-side problem: a fresh
            // login mints the SAME token the server still cannot accept, so re-auth
            // does NOT help and we must NOT destroy the user's (still-valid) session.
            cause = 'downstream_rejected';
            code = 'GATEWAY_TOKEN_REJECTED';
            needsLogin = false;
            httpStatus = 502; // upstream rejected our token; not a user-session 401
            message =
                `The MCP gateway rejected the agent's access token (${gatewayMessage}). Your sign-in is ` +
                `still valid — this is a server-side token-validation problem, not an expired session. ` +
                `Retry shortly; if it persists, check the MCP server's JWKS configuration (PINGONE_JWKS_URI).`;
        }

        console.warn(
            '[mcpGatewayClient] 401 cause=%s | gateway: error=%s message=%s | token: aud=%s expectedGatewayAud=%s expired=%s exp=%s sub=%s scope=%s%s',
            cause,
            gatewayError,
            gatewayMessage,
            claims ? JSON.stringify(claims.aud) : '(undecodable)',
            expectedAud ?? '(unknown)',
            expired,
            (claims && typeof claims.exp === 'number') ? new Date(claims.exp * 1000).toISOString() : '(none)',
            claims?.sub ?? '(?)',
            claims ? (claims.scope || claims.scp || '(none)') : '(?)',
            audMismatch ? ` | FIX: set MCP_SERVER_RESOURCE_URI=${expectedAud} and restart` : '',
        );

        throw Object.assign(
            new Error(message),
            {
                code,
                httpStatus,
                gatewayErrorCode: gatewayError,
                gatewayMessage,
                login_required: needsLogin,
                cause,
                tokenAud,
                expectedAud,
                // The gateway sets X-Gw-Audit-Trail on 401s too (introspection +
                // P1AZ decision made BEFORE its onward exchange failed) — keep it
                // so the token chain can show the PERMIT even on this error path.
                gwAuditTrail: _parseGwAuditTrail(response),
            },
        );
    }

    if (status === 429) {
        const body429 = response.data || {};
        const retryAfterMs = body429.retryAfterMs
            || (parseInt(response.headers?.['retry-after'], 10) || 0) * 1000
            || 0;
        throw Object.assign(
            new Error(body429.message || 'Tool call rate limit exceeded'),
            {
                code: 'rate_limited',
                httpStatus: 429,
                gatewayErrorCode: body429.error || 'rate_limited',
                gatewayMessage: body429.message || '',
                retryAfterMs,
                rateLimitLayer: body429.rateLimitLayer || (isIgBase ? 'ig' : 'gateway'),
            },
        );
    }

    // 428 Precondition Required — the PDP asked for a human, the gateway minted a
    // challenge. Both gateways now answer 428 for this (PingGateway's
    // p1az-decision.groovy and the Node gateway's authorizeMcpRequest); the 403
    // branch below still recognises the same body for a gateway that has not been
    // redeployed yet. A rejected receipt stays 403 there — it is terminal, and
    // re-opening the consent modal on it would loop.
    if (status === 428) {
        const body428 = response.data || {};

        // Two different preconditions arrive as 428 and they drive different UI:
        // step-up needs MFA (no challenge, no human), consent needs a human at the
        // dashboard. Distinguish by the gateway's error code, not by presence of a
        // challengeId — a HITL service outage yields hitl_required with a null id,
        // and treating that as step-up would prompt for the wrong thing.
        if (body428.error === 'step_up_required') {
            console.warn('[mcpGatewayClient] 428 step-up required: tool=%s', body428.tool || '(?)');
            throw Object.assign(
                new Error(body428.message || 'Step-up authentication required'),
                {
                    code: 'mcp_tool_error',
                    httpStatus: 428,
                    gatewayErrorCode: 'step_up_required',
                    stepUp: true,
                    gwAuditTrail: _parseGwAuditTrail(response),
                },
            );
        }

        console.warn(
            '[mcpGatewayClient] 428 HITL required: tool=%s challengeId=%s',
            body428.tool || '(?)',
            body428.challengeId || '(none)',
        );
        throw Object.assign(
            new Error(body428.message || 'Human approval required'),
            {
                code: 'mcp_tool_error',
                httpStatus: 428,
                gatewayErrorCode: body428.error || 'hitl_required',
                hitl: true,
                rpcData: {
                    hitl: true,
                    challengeId: body428.challengeId || null,
                    challenge_type: body428.challenge_type || 'consent',
                    instructions: body428.message || body428.instructions,
                },
                gwAuditTrail: _parseGwAuditTrail(response),
            },
        );
    }

    if (status === 403) {
        // Log only structured error fields — not the full body which may echo
        // parts of the Authorization header in some gateway implementations.
        const body403 = response.data || {};

        // HITL obligation on the HTTP path: the gateway returns 403 with
        // { error:'hitl_required', hitl:true, challengeId, challenge_type, ... }
        // (it created a HITL challenge). Tag the thrown error with .hitl/.rpcData
        // so mcpToolRegistry translates it into a hitl_required result + challengeId
        // (same envelope the WS -32002 path produces) rather than a generic denial.
        // Note: `hitl_receipt_rejected` is deliberately NOT treated as a modal
        // trigger — re-opening the consent modal on a rejected receipt would loop.
        // It falls through to the generic denial below (a terminal error message).
        if (body403.error === 'hitl_required' || (body403.hitl === true && body403.error !== 'hitl_receipt_rejected')) {
            console.warn('[mcpGatewayClient] 403 HITL required: tool=%s challengeId=%s', body403.tool || '(?)', body403.challengeId || '(none)');
            throw Object.assign(
                new Error(body403.message || 'Human approval required'),
                {
                    code: 'mcp_tool_error',
                    httpStatus: 403,
                    gatewayErrorCode: body403.error || 'hitl_required',
                    hitl: true,
                    rpcData: {
                        hitl: true,
                        challengeId: body403.challengeId || null,
                        challenge_type: body403.challenge_type || 'consent',
                        instructions: body403.message || body403.instructions,
                    },
                },
            );
        }

        const denyFields = _extractGatewayDenyFields(body403);
        const denyMessage = denyFields.message || 'Gateway policy denied the tool call';
        const denyCode = /weather scope|weather capability/i.test(denyMessage)
            ? 'weather_scope_denied'
            : denyFields.errorCode;
        console.warn(
            '[mcpGatewayClient] 403 policy denied: error=%s message=%s',
            denyCode,
            denyMessage || '(no message)'
        );
        throw Object.assign(
            new Error(denyMessage),
            {
                code: 'gateway_policy_denied',
                httpStatus: 403,
                gatewayErrorCode: denyCode,
                gatewayMessage: denyMessage,
                // Preserve P1AZ audit trail when present; weather ScriptableFilter
                // denials often omit the header — synthesize filter evidence so
                // TraceRail still shows the Agent Gateway hop (UC30/UC31).
                gwAuditTrail: _trailWithWeatherFallback(
                    _parseGwAuditTrail(response),
                    denyMessage,
                    tool,
                ),
            },
        );
    }

    // Redirects from a misconfigured gateway (e.g. 302 → login page) are not
    // transparent here — surface them as explicit errors rather than falling
    // through to JSON parsing an HTML body.
    if (status >= 300 && status < 400) {
        throw Object.assign(
            new Error(`Gateway returned unexpected redirect (HTTP ${status})`),
            { code: 'gateway_redirect_error', httpStatus: status },
        );
    }

    if (status >= 500) {
        const body5xx = response.data || {};
        // A gateway self-diagnosed misconfiguration (introspection unavailable,
        // PingOne user-lookup unreachable) carries its own clear message —
        // surface it verbatim instead of the generic "upstream error" text so
        // it doesn't read as an ordinary transient failure.
        if (body5xx.error === 'gateway_misconfigured') {
            throw Object.assign(
                new Error(body5xx.message || 'The security gateway is misconfigured'),
                { code: 'gateway_misconfigured', httpStatus: status, gatewayErrorCode: body5xx.error, gatewayMessage: body5xx.message || '' },
            );
        }
        throw Object.assign(
            new Error(`Gateway upstream error (HTTP ${status})`),
            {
                code: 'gateway_upstream_error',
                httpStatus: status,
                // Preserve the gateway's audit trail (e.g. backend.exchanged=false
                // when the RFC 8693 exchange to the backend failed) so the token
                // chain can show the denial instead of dropping it as an opaque
                // 502 — same pattern as the 401/403 branches above.
                gwAuditTrail: _parseGwAuditTrail(response),
            },
        );
    }

    if (status >= 400) {
        // Surface the gateway/MCP server's own reason (e.g. "missing required
        // parameter account_id") instead of a bare status code — same defensive
        // shape-sniffing as the 403 and JSON-RPC-error branches above.
        const body4xx = response.data || {};
        const rpcErr4xx = body4xx.error;
        const gatewayMessage =
            (typeof rpcErr4xx === 'object' && rpcErr4xx?.message)
            || body4xx.message
            || (typeof rpcErr4xx === 'string' ? rpcErr4xx : null)
            || '';
        throw Object.assign(
            new Error(gatewayMessage || `Gateway returned HTTP ${status}`),
            { code: 'gateway_client_error', httpStatus: status, gatewayMessage },
        );
    }

    // Extract audit trail header if present (set by gateway on all responses)
    const gwAuditTrail = _parseGwAuditTrail(response);
    if (gwAuditTrail) {
        console.log('[GW→PingGateway] AUDIT TRAIL: %j', gwAuditTrail);
    } else {
        console.log('[GW→PingGateway] No X-Gw-Audit-Trail header on response');
    }

    // JSON-RPC error envelope in a 200 response (e.g. gateway api_key dispatch
    // failed to reach the backend). Surface as a structured error so callers
    // get a meaningful message rather than an opaque { error: {...} } object.
    if (response.data?.error != null && response.data?.result === undefined) {
        const rpcErr = response.data.error;
        const msg = (typeof rpcErr === 'object' ? rpcErr.message : String(rpcErr)) || 'MCP tool call failed';
        // Preserve the JSON-RPC error `data` block so HITL signals survive. The
        // gateway returns code -32002 with data { hitl:true, challengeId,
        // challenge_type, ... } when PingAuthorize requires human approval;
        // callers (mcpToolRegistry) translate that into a hitl_required result
        // rather than treating it as an opaque tool failure.
        const rpcData = (typeof rpcErr === 'object' && rpcErr.data) ? rpcErr.data : undefined;
        const isWeatherScope = /Agent Gateway:.*weather|weather scope restricted|weather capability disabled/i.test(msg);
        throw Object.assign(
            new Error(msg),
            {
                code: isWeatherScope ? 'gateway_policy_denied' : 'mcp_tool_error',
                httpStatus: isWeatherScope ? 403 : 200,
                rpcCode: typeof rpcErr === 'object' ? rpcErr.code : undefined,
                rpcData,
                hitl: !!(rpcData && rpcData.hitl),
                gatewayMessage: msg,
                gatewayErrorCode: isWeatherScope ? 'weather_scope_denied' : undefined,
                gwAuditTrail: _trailWithWeatherFallback(gwAuditTrail, msg, tool),
            },
        );
    }

    // JSON-RPC responses: prefer .result, fall through to full body for
    // non-standard / direct responses from the upstream MCP server.
    const result = response.data?.result ?? response.data;

    // Weather showcase (/mcp/weather): IG often returns 200 without
    // X-Gw-Audit-Trail — still attach filter-chain + mcpAudit so TraceRail
    // shows the Agent Gateway hop on PERMIT (UC30), not only on DENY (UC31).
    let trailOut = gwAuditTrail;
    if (isIgBase && WEATHER_TOOLS.has(tool)) {
        const permit = _syntheticWeatherPermitTrail(tool);
        trailOut = trailOut
            ? {
                ...permit,
                ...trailOut,
                lastFilter: trailOut.lastFilter || permit.lastFilter,
                filterChain: trailOut.filterChain || permit.filterChain,
                policy: trailOut.policy || permit.policy,
                mcpAudit: trailOut.mcpAudit || permit.mcpAudit,
            }
            : permit;
    }

    return { result, gwAuditTrail: trailOut };
}

/**
 * Resolve the configured gateway base URL.
 * Env-first: MCP_GATEWAY_HTTP_URL wins, then configStore key
 * 'mcp_gateway_http_url' (persisted to LMDB). This matches the env-first
 * useGateway resolution in server.js and the configStore "env vars always take
 * priority" doctrine. Critically, it also avoids a startup race: getEffective
 * returns the committed default ('https://api.ping.demo:3005' → 127.0.0.1 inside
 * a pod) until the env→LMDB seeding finishes, so the first tool calls after a
 * cold start would otherwise fail with ECONNREFUSED on :3005.
 * Throws if neither is set — an unconfigured gateway must fail explicitly,
 * not silently use a stale default that produces a confusing connection error.
 */
/**
 * Parse the gateway's X-Gw-Audit-Trail header (decision, decisionId, engine,
 * attributes). Returns null when absent or unparseable. The gateway sets this
 * header on ALL responses including 403 denials, so it must be read before any
 * status-based throw if the P1AZ decision is to survive into the token chain.
 */
function _parseGwAuditTrail(response) {
    const h = response && response.headers && response.headers['x-gw-audit-trail'];
    if (!h) return null;
    try {
        return JSON.parse(h);
    } catch (err) {
        console.warn('[mcpGatewayClient] Could not parse X-Gw-Audit-Trail header:', err.message);
        return null;
    }
}

/**
 * Normalize gateway deny bodies: flat `{error,message}` OR JSON-RPC
 * `{error:{code,message}}` (tx-weather-scope.groovy returns the latter).
 * @param {object} body
 * @returns {{ message: string, errorCode: string }}
 */
function _extractGatewayDenyFields(body) {
    const b = body && typeof body === 'object' ? body : {};
    const rpc = b.error;
    if (rpc && typeof rpc === 'object') {
        return {
            message: String(rpc.message || b.message || ''),
            errorCode: rpc.code != null ? `jsonrpc_${rpc.code}` : 'forbidden',
        };
    }
    return {
        message: String(b.message || (typeof rpc === 'string' ? rpc : '') || ''),
        errorCode: (typeof rpc === 'string' && rpc) ? rpc : 'forbidden',
    };
}

/**
 * When PingGateway's weather ScriptableFilter denies without X-Gw-Audit-Trail,
 * synthesize a trail so TraceRail still lights the gateway step (filter chain
 * is the teaching point for UC30/UC31).
 * @param {string} message
 * @param {string} [tool]
 * @returns {object|null}
 */
function _weatherFilterChain() {
    return ['McpAudit', 'StripWeatherPrefix', 'rsFilter', 'McpProtocol', 'TxWeatherScope'];
}

function _syntheticWeatherScopeTrail(message, tool) {
    if (!message || !/Agent Gateway:.*weather|weather scope restricted|weather capability disabled/i.test(message)) {
        return null;
    }
    return {
        denyingFilter: 'tx-weather-scope.groovy',
        lastFilter: 'TxWeatherScope',
        filterChain: _weatherFilterChain(),
        policy: {
            passed: false,
            name: 'ff_weather_mcp_allowed_state',
            route: '/mcp/weather',
        },
        mcpAudit: {
            eventName: 'PING-GATEWAY-WEATHER-SCOPE',
            who: {},
            what: { tool: tool || 'get_weather', mcpMethod: 'tools/call' },
            when: { at: new Date().toISOString() },
            where: { route: '/mcp/weather', filter: 'tx-weather-scope.groovy' },
            how: {
                decision: 'DENY',
                result: 'blocked',
                backend: 'weather-mcp',
                policy: 'ff_weather_mcp_allowed_state',
            },
        },
    };
}

/** Permit path through /mcp/weather when IG omits X-Gw-Audit-Trail. */
function _syntheticWeatherPermitTrail(tool) {
    return {
        lastFilter: 'TxWeatherScope',
        filterChain: _weatherFilterChain(),
        policy: {
            passed: true,
            name: 'ff_weather_mcp_allowed_state',
            route: '/mcp/weather',
        },
        mcpAudit: {
            eventName: 'PING-GATEWAY-WEATHER-SCOPE',
            who: {},
            what: { tool: tool || 'get_weather', mcpMethod: 'tools/call' },
            when: { at: new Date().toISOString() },
            where: { route: '/mcp/weather', filter: 'tx-weather-scope.groovy' },
            how: {
                decision: 'PERMIT',
                result: 'forwarded',
                backend: 'weather-mcp',
                policy: 'ff_weather_mcp_allowed_state',
            },
        },
    };
}

/**
 * Merge real X-Gw-Audit-Trail with a synthetic weather-scope trail when needed.
 * @param {object|null} parsed
 * @param {string} message
 * @param {string} [tool]
 */
function _trailWithWeatherFallback(parsed, message, tool) {
    const synth = _syntheticWeatherScopeTrail(message, tool);
    if (!synth) return parsed;
    if (!parsed) return synth;
    return {
        ...parsed,
        denyingFilter: parsed.denyingFilter || synth.denyingFilter,
        lastFilter: parsed.lastFilter || synth.lastFilter,
        filterChain: parsed.filterChain || synth.filterChain,
        policy: parsed.policy || synth.policy,
        mcpAudit: parsed.mcpAudit || synth.mcpAudit,
    };
}

/**
 * Resolve which MCP gateway transport is active (demo/PingGateway vs AgentCore).
 * @returns {{ kind: 'agentcore'|'demo', url: string }}
 */
function resolveMcpGatewayTransport() {
    return require('./mcpGatewayTransport').resolveMcpGatewayTransport();
}

/**
 * Route MCP tools/call through the effective gateway (AgentCore or demo/PingGateway).
 */
async function callToolViaResolvedGateway(gatewayUrl, bearerToken, tool, params = {}, opts = {}) {
    return require('./mcpGatewayTransport').callToolViaResolvedGateway(
        gatewayUrl, bearerToken, tool, params, opts,
    );
}

function getMcpGatewayHttpUrl() {
    // ff_mcp_gateway_pinggateway: a runtime user choice (via /config) to route MCP
    // traffic through PingGateway (IG) instead of the Node gateway. When ON and a
    // PingGateway URL is resolvable, it wins over the Node-gateway URL — this is the
    // single chokepoint every tool-call path uses, so the flag actually re-routes the
    // request (not just the token audience resolved in agentMcpTokenService).
    if (configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true') {
        const pgUrl = process.env.MCP_PINGGATEWAY_URL || configStore.getEffective('mcp_pinggateway_url');
        if (pgUrl) {
            return pgUrl.replace(/\/$/, '');
        }
        // No PingGateway URL configured — fall through to the Node gateway below.
    }
    // Resolve the demo/Node gateway from its own key first (mcp_demo_gateway_url /
    // MCP_DEMO_GATEWAY_URL) — MCP_GATEWAY_HTTP_URL is baked per-container in
    // docker-compose.yml to whichever gateway the container was started against
    // (often PingGateway's address), so trusting it here silently defeats the flag
    // flip above: toggling ff_mcp_gateway_pinggateway to false would resolve right
    // back to the same PingGateway URL via this "fallback" (issue #375).
    const url = process.env.MCP_DEMO_GATEWAY_URL
        || configStore.getEffective('mcp_demo_gateway_url')
        || process.env.MCP_GATEWAY_HTTP_URL
        || configStore.getEffective('mcp_gateway_http_url');
    if (!url) {
        throw new Error(
            'MCP gateway URL not configured. ' +
            'Set mcp_demo_gateway_url via /config or set MCP_DEMO_GATEWAY_URL in .env.'
        );
    }
    return url.replace(/\/$/, '');
}

// Non-throwing variant: null when no gateway URL is configured, the normalized
// URL otherwise. For callers that want to probe configuration without a
// try/catch around getMcpGatewayHttpUrl().
function tryGetMcpGatewayHttpUrl() {
    try {
        return getMcpGatewayHttpUrl();
    } catch (_) {
        return null;
    }
}

// Map a raw axios transport error to a stable gateway error with a code +
// httpStatus the API layer can surface. Non-transport errors pass through.
function _normalizeGatewayNetworkError(axErr, timeoutMs) {
    const code = axErr?.code;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
        const e = new Error(`MCP gateway request timed out after ${timeoutMs}ms`);
        e.code = 'GATEWAY_TIMEOUT';
        e.httpStatus = 504;
        e.cause = axErr;
        return e;
    }
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
        const e = new Error(`MCP gateway unreachable (${code})`);
        e.code = 'GATEWAY_UNREACHABLE';
        e.httpStatus = 503;
        e.cause = axErr;
        return e;
    }
    return axErr;
}

module.exports = {
    IG_MCP_PROTOCOL_VERSION,
    callToolViaGateway,
    callToolViaResolvedGateway,
    getMcpGatewayHttpUrl,
    tryGetMcpGatewayHttpUrl,
    _normalizeGatewayNetworkError,
    resolveMcpGatewayTransport,
    // Shared with routes/aamProbe.js: the AAM route stamps the same
    // X-Gw-Audit-Trail header, so it reuses this parser rather than a second one.
    _parseGwAuditTrail,
    // test/helpers — weather JSON-RPC deny → TraceRail gateway evidence
    _extractGatewayDenyFields,
    _syntheticWeatherScopeTrail,
    _trailWithWeatherFallback,
};
