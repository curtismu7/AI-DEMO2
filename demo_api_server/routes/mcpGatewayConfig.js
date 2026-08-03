'use strict';
/**
 * GET /api/admin/mcp-gateway/config
 *
 * Returns mock gateway status, current configuration summary, and the
 * generated PingGateway 2025.11.1 mcp.json route file for real deployments.
 *
 * Auth is enforced by authenticateToken middleware in server.js.
 */
const express = require('express');
const http = require('http');
const https = require('https');
const configStore = require('../services/configStore');
const router = express.Router();

// ---------------------------------------------------------------------------
// Health probe to the mock gateway
// ---------------------------------------------------------------------------
function probeGatewayHealth(gatewayUrl) {
    return new Promise((resolve) => {
        const url = new URL(gatewayUrl.replace(/\/$/, '') + '/health');
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;
        const opts = {
            hostname: url.hostname,
            port: parseInt(url.port || (isHttps ? '443' : '80'), 10),
            path: url.pathname,
            method: 'GET',
            timeout: 3000,
            // Relax TLS only outside production (self-signed mkcert on loopback);
            // production validates certs. Matches the CR-04/BL-04 pattern.
            ...(isHttps && process.env.NODE_ENV !== 'production' ? { rejectUnauthorized: false } : {}),
        };
        const req = transport.request(opts, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve({ running: res.statusCode === 200, response: JSON.parse(data) }); }
                catch { resolve({ running: res.statusCode === 200, response: null }); }
            });
        });
        req.on('error', () => resolve({ running: false, response: null }));
        req.on('timeout', () => { req.destroy(); resolve({ running: false, response: null }); });
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Live config read from the running Demo Agent Gateway.
//
// Reads the gateway's ACTUAL in-memory config from GET /admin/config — the
// safe-view projection (no secrets) the gateway exposes. This is the real
// loaded routing config (mcpOlbWsUrl, devBypass, etc.), not the locally
// generated mirror. Gated behind the shared internal secret (BL-01), so we
// send the same x-internal-gateway-secret header the BFF uses elsewhere.
//
// Returns { ok, config } on success, or { ok: false, error } when the gateway
// is unreachable, the secret is missing/wrong (401), or — for a real
// PingGateway, which has no /admin/config — not found (404). Never throws.
// ---------------------------------------------------------------------------
function fetchGatewayLiveConfig(gatewayUrl) {
    return new Promise((resolve) => {
        const secret = process.env.BFF_INTERNAL_SECRET || '';
        if (!secret) {
            resolve({ ok: false, error: 'BFF_INTERNAL_SECRET not set — cannot read live gateway config' });
            return;
        }
        const url = new URL(gatewayUrl.replace(/\/$/, '') + '/admin/config');
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;
        const opts = {
            hostname: url.hostname,
            port: parseInt(url.port || (isHttps ? '443' : '80'), 10),
            path: url.pathname,
            method: 'GET',
            timeout: 3000,
            headers: { 'x-internal-gateway-secret': secret },
            ...(isHttps && process.env.NODE_ENV !== 'production' ? { rejectUnauthorized: false } : {}),
        };
        const req = transport.request(opts, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    resolve({ ok: false, error: `gateway returned HTTP ${res.statusCode}` });
                    return;
                }
                try { resolve({ ok: true, config: JSON.parse(data) }); }
                catch { resolve({ ok: false, error: 'gateway returned non-JSON config' }); }
            });
        });
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'live config read timed out' }); });
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Push dynamic config updates to the Demo Agent Gateway POST /admin/config.
// Always sends x-internal-gateway-secret (BL-01). Never throws.
// ---------------------------------------------------------------------------
function pushGatewayAdminConfig(gatewayUrl, updates) {
    return new Promise((resolve) => {
        const secret = process.env.BFF_INTERNAL_SECRET || '';
        if (!secret) {
            resolve({ ok: false, error: 'BFF_INTERNAL_SECRET not set — cannot push gateway config' });
            return;
        }
        if (!updates || Object.keys(updates).length === 0) {
            resolve({ ok: false, error: 'No fields to push' });
            return;
        }
        const url = new URL(gatewayUrl.replace(/\/$/, '') + '/admin/config');
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;
        const body = JSON.stringify(updates);
        const opts = {
            hostname: url.hostname,
            port: parseInt(url.port || (isHttps ? '443' : '80'), 10),
            path: url.pathname,
            method: 'POST',
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'x-internal-gateway-secret': secret,
            },
            ...(isHttps && process.env.NODE_ENV !== 'production' ? { rejectUnauthorized: false } : {}),
        };
        const req = transport.request(opts, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    let detail = data;
                    try { detail = JSON.parse(data); } catch { /* raw */ }
                    resolve({ ok: false, error: `gateway returned HTTP ${res.statusCode}`, detail });
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    resolve({ ok: true, config: parsed.config || parsed });
                } catch {
                    resolve({ ok: false, error: 'gateway returned non-JSON response' });
                }
            });
        });
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'gateway config push timed out' }); });
        req.write(body);
        req.end();
    });
}

// UC18 demo defaults — low enough to trigger 429 in a 5-call burst.
const UC18_DEMO_RATE_LIMIT = {
    rateLimitEnabled: true,
    rateLimitMaxRequests: 3,
    rateLimitWindowMs: 10000,
};

// ---------------------------------------------------------------------------
// Generate a real PingGateway 2025.11.1 mcp.json route configuration.
//
// Schema matches the official PingGateway MCP TOI (Feb 2026) and public docs:
//   https://docs.pingidentity.com/pinggateway/2025.11/mcp/index.html
//
// Filter pipeline (in order):
//   McpAuditFilter -> UriPathRewriteFilter -> McpProtectionFilter ->
//   McpValidationFilter -> ReverseProxyHandler
// ---------------------------------------------------------------------------
function buildPingGatewayMcpJson(cfg) {
    const pingOneEnvUrl  = cfg.pingOneEnvUrl;      // https://auth.pingone.com/\<envId\>
    const pingOneResId   = cfg.pingOneResourceId;  // PingOne resource client_id (for introspect)
    const gatewayPublic  = cfg.gatewayPublicUrl;   // https://ig.example.com:8443
    const mcpServerUrl   = cfg.upstreamMcpUrl;     // http://localhost:8000
    const mcpScope       = cfg.mcpScope || 'test';

    return {
        name: 'mcp',
        condition: '${find(request.uri.path, \'^/mcp\')}',
        properties: {
            pingOneEnvID:      pingOneEnvUrl,
            pingOneResourceID: pingOneResId,
            gatewayUrl:        gatewayPublic,
            mcpServerUrl:      mcpServerUrl,
        },
        baseURI: '&{mcpServerUrl}',
        heap: [
            {
                name: 'SystemAndEnvSecretStore-1',
                type: 'SystemAndEnvSecretStore',
            },
            {
                name: 'AuditService',
                type: 'AuditService',
                config: {
                    eventHandlers: [{
                        class: 'org.forgerock.audit.handlers.json.JsonAuditEventHandler',
                        config: {
                            name: 'json',
                            logDirectory: '&{ig.instance.dir}/audit',
                            topics: ['access', 'mcp'],
                        },
                    }],
                },
            },
            {
                // Introspects bearer tokens against PingOne /as/introspect.
                // Requires RESOURCE_SECRET_ID env var set to base64 of the
                // PingOne resource client secret (no trailing newline):
                //   printf '%s' "<secret>" | base64
                name: 'rsFilter',
                type: 'OAuth2ResourceServerFilter',
                config: {
                    requireHttps: false,
                    scopes: [mcpScope],
                    accessTokenResolver: {
                        type: 'TokenIntrospectionAccessTokenResolver',
                        config: {
                            endpoint: '&{pingOneEnvID}/as/introspect',
                            providerHandler: {
                                type: 'Chain',
                                config: {
                                    filters: [{
                                        type: 'HttpBasicAuthenticationClientFilter',
                                        config: {
                                            username: '&{pingOneResourceID}',
                                            passwordSecretId: 'resource.secret.id',
                                            secretsProvider: 'SystemAndEnvSecretStore-1',
                                        },
                                    }],
                                    handler: 'ForgeRockClientHandler',
                                },
                            },
                        },
                    },
                },
            },
        ],
        handler: {
            type: 'Chain',
            config: {
                filters: [
                    {
                        type: 'McpAuditFilter',
                        config: { auditService: 'AuditService' },
                    },
                    {
                        // Strip /mcp prefix — MCP server expects requests at /
                        type: 'UriPathRewriteFilter',
                        config: { mappings: { '/mcp': '/' } },
                    },
                    {
                        // Serves /.well-known/oauth-protected-resource (RFC 9728).
                        // Validates token aud against resourceId, adds resource_metadata
                        // to WWW-Authenticate on 401.
                        type: 'McpProtectionFilter',
                        config: {
                            resourceId: '&{gatewayUrl}/mcp',
                            authorizationServerUri: '&{pingOneEnvID}/as',
                            resourceServerFilter: 'rsFilter',
                            supportedScopes: [mcpScope],
                            resourceIdPointer: '/aud/0',
                        },
                    },
                    {
                        // Validates Origin, Accept header, and JSON-RPC 2.0 envelope.
                        // Populates ${contexts.mcp} with protocol version + session id.
                        type: 'McpValidationFilter',
                        config: { acceptedOrigins: '.*' },
                    },
                ],
                handler: {
                    type: 'ReverseProxyHandler',
                    config: { soTimeout: '20 seconds' },
                },
            },
        },
    };
}

// ---------------------------------------------------------------------------
// admin.json snippet — merge into PingGateway admin.json.
// streamingEnabled: true is required for MCP SSE transport.
// ---------------------------------------------------------------------------
function buildAdminJsonSnippet() {
    return {
        _comment: 'Merge into PingGateway admin.json — streamingEnabled required for MCP SSE transport',
        adminConnector: { host: 'localhost', port: 8085 },
        connectors: [
            { port: 8080 },
            { port: 8443, tls: 'ServerTlsOptions-1' },
        ],
        streamingEnabled: true,
    };
}

// ---------------------------------------------------------------------------
// GET /api/admin/mcp-gateway/config
// ---------------------------------------------------------------------------
router.get('/config', async (req, res) => {
  try {
    const defaultGatewayUrl = `http://localhost:3005`;
    const gatewayUrl     = process.env.MCP_GATEWAY_HTTP_URL || defaultGatewayUrl;
    const gatewayEnabled = !!process.env.MCP_GATEWAY_HTTP_URL;
    const devBypass      = process.env.MCP_GW_DEV_BYPASS === 'true';

    // Demo Agent Gateway URL (Node :3005) — Env-tab vars live here. Do NOT use
    // MCP_GATEWAY_HTTP_URL for that probe: when PingGateway mode is ON that
    // env points at IG, which has no /admin/config (404) and no MCP_GW_* secrets.
    const demoGatewayUrl = (
      process.env.MCP_DEMO_GATEWAY_URL
      || configStore.getEffective('mcp_demo_gateway_url')
      || 'http://mcp-gateway:3005'
    ).replace(/\/$/, '');

    const [
      { running, response: healthResponse },
      liveConfig,
      demoHealth,
      demoLiveConfig,
    ] = await Promise.all([
      probeGatewayHealth(gatewayUrl),
      fetchGatewayLiveConfig(gatewayUrl),
      probeGatewayHealth(demoGatewayUrl),
      fetchGatewayLiveConfig(demoGatewayUrl),
    ]);

    const envId  = configStore.getEffective('pingone_environment_id') || '<PingOne Environment ID>';
    const region = configStore.getEffective('pingone_region') || 'com';

    const cfg = {
        // Mock gateway fields
        gatewayResourceUri:    process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI || configStore.getEffective('pingone_resource_mcp_gateway_uri') || '',
        upstreamMcpUrl:        process.env.MCP_OLB_WS_URL           || configStore.getEffective('mcp_server_url') || 'http://localhost:8000',
        mcpOlbResourceUri:     process.env.MCP_OLB_RESOURCE_URI    || '',
        mcpResourceServerWsUrl:        process.env.MCP_RESOURCE_SERVER_WS_URL        || '',
        mcpResourceServerResourceUri:  process.env.MCP_RESOURCE_SERVER_RESOURCE_URI  || '',
        hitlServiceUrl:        process.env.HITL_SERVICE_URL         || '',
        pingAuthorizeEndpoint: process.env.PINGAUTHORIZE_ENDPOINT   || '',
        pingAuthorizeWorkerId: process.env.PINGAUTHORIZE_WORKER_ID  || '',

        // Real PingGateway 2025.11.1 mcp.json fields
        pingOneEnvUrl:    `https://auth.pingone.${region}/${envId}`,
        pingOneResourceId: process.env.MCP_GW_CLIENT_ID             || configStore.getEffective('mcp_gw_client_id') || '<PingOne test resource ID>',
        gatewayPublicUrl:  process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI
            ? process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI.replace(/\/mcp$/, '')
            : configStore.getEffective('mcp_gw_public_url') || 'https://ig.example.com:8443',
        mcpScope: configStore.getEffective('mcp_scope') || 'mcp:invoke',
    };
    cfg.introspectEndpoint = `${cfg.pingOneEnvUrl}/as/introspect`;

    // Env tab is labeled "Required (gateway service)" — those vars live on the
    // Demo Agent Gateway (demo_mcp_gateway/.env + compose), not necessarily on
    // this BFF process. Checking only process.env produced false "NOT SET"
    // rows while the gateway was healthy. Resolve presence from BFF env,
    // configStore aliases, Demo GW live GET /admin/config, and (for
    // boot-required secrets) Demo GW /health — loadConfig() refuses to start
    // without them.
    const live = liveConfig.ok ? liveConfig.config : null;
    const demoLive = demoLiveConfig.ok ? demoLiveConfig.config : null;
    const gatewayServiceUp = !!demoHealth.running;
    const derivedTokenEndpoint = (() => {
      if (process.env.PINGONE_TOKEN_ENDPOINT) return process.env.PINGONE_TOKEN_ENDPOINT;
      if (envId && !String(envId).includes('<')) {
        return `https://auth.pingone.${region}/${envId}/as/token`;
      }
      return '';
    })();
    const maskSet = (...vals) => (
      vals.some((v) => v != null && String(v).trim() !== '') ? '••••' : 'NOT SET'
    );

    res.json({
        mcpMode: configStore.get('mcp_use_pingone_server') === 'true' ? 'pingone' : 'custom',
        mock: {
            enabled: gatewayEnabled,
            running,
            devBypass,
            url: gatewayUrl,
            health: healthResponse,
            // Live config read from the gateway's GET /admin/config (the real
            // loaded routing config, not the generated mirror). null when the
            // gateway is unreachable or doesn't expose /admin/config.
            liveConfig: live,
            liveConfigError: liveConfig.ok ? null : liveConfig.error,
        },
        config: cfg,
        envVars: {
            required: {
                PINGONE_RESOURCE_MCP_GATEWAY_URI: maskSet(
                    process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI,
                    demoLive?.gatewayResourceUri,
                    configStore.getEffective('pingone_resource_mcp_gateway_uri'),
                    configStore.getEffective('mcp_gw_resource_uri'),
                ),
                MCP_GW_CLIENT_ID: maskSet(
                    process.env.MCP_GW_CLIENT_ID,
                    configStore.getEffective('mcp_gw_client_id'),
                    gatewayServiceUp ? 'gateway-up' : '',
                ),
                MCP_GW_CLIENT_SECRET: maskSet(
                    process.env.MCP_GW_CLIENT_SECRET,
                    configStore.getEffective('mcp_gw_client_secret'),
                    gatewayServiceUp ? 'gateway-up' : '',
                ),
                PINGONE_TOKEN_ENDPOINT: maskSet(
                    process.env.PINGONE_TOKEN_ENDPOINT,
                    derivedTokenEndpoint,
                    gatewayServiceUp ? 'gateway-up' : '',
                ),
                MCP_OLB_RESOURCE_URI: maskSet(
                    process.env.MCP_OLB_RESOURCE_URI,
                    demoLive?.mcpOlbResourceUri,
                    configStore.getEffective('mcp_resource_uri'),
                    configStore.getEffective('pingone_resource_mcp_server_uri'),
                ),
                MCP_RESOURCE_SERVER_RESOURCE_URI: maskSet(
                    process.env.MCP_RESOURCE_SERVER_RESOURCE_URI,
                    demoLive?.mcpResourceServerResourceUri,
                ),
            },
            optional: {
                MCP_GATEWAY_HTTP_URL:    process.env.MCP_GATEWAY_HTTP_URL    || '(not set — gateway routing disabled)',
                MCP_GW_DEV_BYPASS:       process.env.MCP_GW_DEV_BYPASS       || 'false',
                PINGAUTHORIZE_ENDPOINT:  process.env.PINGAUTHORIZE_ENDPOINT   || '(not set — permit-all)',
                PINGAUTHORIZE_WORKER_ID: process.env.PINGAUTHORIZE_WORKER_ID  || '(not set)',
                RESOURCE_SECRET_ID:      process.env.RESOURCE_SECRET_ID       ? '••••' : '(not set — required for real PingGateway)',
            },
        },
        // Drop into $HOME/.openig/config/routes/mcp.json
        pingGatewayJson: buildPingGatewayMcpJson(cfg),
        // Merge into PingGateway admin.json (streamingEnabled required for SSE)
        pingGatewayAdminJson: buildAdminJsonSnippet(),
    });
  } catch (err) {
    console.error('[mcpGatewayConfig] GET /config error:', err.message);
    res.status(500).json({ error: 'gateway_config_error', message: err.message });
  }
});


// ---------------------------------------------------------------------------
// POST /api/admin/mcp-gateway/config — push config to the running mock gateway
// ---------------------------------------------------------------------------
router.post('/config', async (req, res) => {
    const gatewayUrl = process.env.MCP_GATEWAY_HTTP_URL || 'http://localhost:3005';

    const allowed = [
        'gatewayResourceUri', 'mcpOlbWsUrl', 'mcpResourceServerWsUrl',
        'mcpOlbResourceUri', 'mcpResourceServerResourceUri',
        'pingAuthorizeEndpoint', 'pingAuthorizeWorkerId',
        'hitlServiceUrl', 'devBypass',
        'rateLimitEnabled', 'rateLimitMaxRequests', 'rateLimitWindowMs',
        'mcp_gw_client_id', 'mcp_gw_public_url', 'mcp_scope',
    ];

    const updates = {};
    for (const key of allowed) {
        if (key in (req.body || {})) {
            updates[key] = req.body[key];
        }
    }

    // Strip BFF-only persist keys before pushing to gateway.
    const gatewayUpdates = { ...updates };
    delete gatewayUpdates.mcp_gw_client_id;
    delete gatewayUpdates.mcp_gw_public_url;
    delete gatewayUpdates.mcp_scope;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }

    const persistKeys = ['mcp_gw_client_id', 'mcp_gw_public_url', 'mcp_scope'];
    const toStore = {};
    for (const k of persistKeys) {
        if (k in updates) toStore[k] = updates[k];
    }

    try {
        let gatewayConfig = null;
        if (Object.keys(gatewayUpdates).length === 0) {
            if (Object.keys(toStore).length === 0) {
                return res.status(400).json({ error: 'No valid fields to update' });
            }
            try { await configStore.setRaw(toStore); } catch (e) {
                console.warn('[mcpGatewayConfig] configStore persist failed:', e.message);
            }
            return res.json({ ok: true, pushed: updates, gatewayConfig: null, persistedOnly: true });
        }

        const pushResult = await pushGatewayAdminConfig(gatewayUrl, gatewayUpdates);
        if (!pushResult.ok) {
            return res.status(502).json({ error: 'Could not reach mock gateway', detail: pushResult.error });
        }
        gatewayConfig = pushResult.config;

        if (Object.keys(toStore).length > 0) {
            try { await configStore.setRaw(toStore); } catch (e) {
                console.warn('[mcpGatewayConfig] configStore persist failed:', e.message);
            }
        }

        res.json({ ok: true, pushed: updates, gatewayConfig });
    } catch (err) {
        res.status(502).json({ error: 'Could not reach mock gateway', detail: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/admin/mcp-gateway/active
// Authoritative active-gateway state from configStore.getEffective — the SAME
// source the gateway path and the X-Authz-Simulated header use, so the tester
// banner always matches real gateway behavior (avoids feature-flag resolve drift).
// ---------------------------------------------------------------------------
router.get('/active', (req, res) => {
    const usePing   = configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';
    const simulated = configStore.getEffective('ff_authorize_simulated') === 'true';
    let url = null;
    try { url = require('../services/mcpGatewayClient').getMcpGatewayHttpUrl(); } catch { /* not configured */ }
    res.json({
        usePingGateway: usePing,
        name:           usePing ? 'PingOne Agent Gateway' : 'Demo Agent Gateway',
        simulated,
        authzBackend:   simulated ? 'Simulated (demo_authz_server)' : 'Real PingOne Authorize',
        url,
    });
});

// ---------------------------------------------------------------------------
// POST /api/admin/mcp-gateway/test
// Send a single MCP tool call THROUGH the active gateway (Demo Agent Gateway or
// PingOne Agent Gateway, per ff_mcp_gateway_pinggateway) and return the tool
// result plus the gateway's audit trail — introspection, the authorize DECISION
// (PERMIT / DENY / INDETERMINATE) and reason, and the upstream route. Powers the
// Setup "Gateway Tester" page. Auth enforced by authenticateToken in server.js.
// ---------------------------------------------------------------------------
router.post('/test', express.json(), async (req, res) => {
    const { tool, args } = req.body || {};
    if (!tool || typeof tool !== 'string') {
        return res.status(400).json({ error: 'bad_request', message: 'tool (string) is required' });
    }

    const usePing   = configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';
    const simulated = configStore.getEffective('ff_authorize_simulated') === 'true';
    const gateway = {
        flag:        'ff_mcp_gateway_pinggateway',
        usePingGateway: usePing,
        name:        usePing ? 'PingOne Agent Gateway' : 'Demo Agent Gateway',
        authzBackend: simulated ? 'mock (demo_authz_server)' : 'real (PingOne Authorize)',
        simulated,
    };

    const { callToolViaGateway, getMcpGatewayHttpUrl } = require('../services/mcpGatewayClient');
    const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');

    let url;
    try {
        url = getMcpGatewayHttpUrl();
        gateway.url = url;
    } catch (e) {
        return res.status(500).json({ gateway, error: 'gateway_not_configured', message: e.message });
    }

    const t0 = Date.now();
    let token, tokenEvents = [];
    try {
        ({ token, tokenEvents = [] } = await resolveMcpAccessTokenWithEvents(req, tool));
    } catch (e) {
        return res.status(401).json({ gateway, error: 'token_resolution_failed', message: e.message });
    }
    if (!token) {
        return res.status(401).json({
            gateway, error: 'no_mcp_token',
            message: 'No delegated MCP access token for this session. Sign in as a user with MCP access first.',
        });
    }

    try {
        const { result, gwAuditTrail } = await callToolViaGateway(
            url, token, tool, (args && typeof args === 'object') ? args : {},
            { correlationId: req.correlationId },
        );
        return res.json({
            gateway, ok: true, durationMs: Date.now() - t0,
            result,
            gwAuditTrail: gwAuditTrail || null,
            tokenEvents,
        });
    } catch (e) {
        // callToolViaGateway throws structured errors with .code / .httpStatus /
        // .gatewayErrorCode / .rpcData / .gatewayMessage. Surface them so the tester
        // shows WHY the gateway rejected the call (e.g. an authorize DENY).
        const decision = e.rpcData && e.rpcData.decision
            ? e.rpcData.decision
            : (e.gatewayErrorCode === 'access_denied' ? 'DENY' : null);
        return res.json({
            gateway, ok: false, durationMs: Date.now() - t0,
            error:            e.code || 'gateway_error',
            httpStatus:       e.httpStatus || null,
            gatewayErrorCode: e.gatewayErrorCode || null,
            message:          e.gatewayMessage || e.message,
            retryAfterMs:     e.retryAfterMs || null,
            rateLimited:      e.code === 'rate_limited' || e.httpStatus === 429,
            rateLimitLayer:   e.rateLimitLayer || null,
            decision,
            rpcData:          e.rpcData || null,
            tokenEvents,
        });
    }
});

// ---------------------------------------------------------------------------
// GET /api/admin/mcp-gateway/rate-limit-status
// BFF flag + live gateway rate-limit config for the Gateway Tester UC18 panel.
// ---------------------------------------------------------------------------
router.get('/rate-limit-status', async (req, res) => {
    const bffFlag = configStore.getEffective('ff_mcp_rate_limit') === 'true';
    const usePing = configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';
    const { getBffRateLimitConfig, shouldStampIgRateLimitHeader } = require('../services/mcpGatewayRateLimit');
    const bffCfg = getBffRateLimitConfig();
    const igArmed = shouldStampIgRateLimitHeader();

    let gatewayUrl = null;
    try {
        gatewayUrl = require('../services/mcpGatewayClient').getMcpGatewayHttpUrl();
    } catch (e) {
        return res.json({
            bffFlag,
            usePingGateway: usePing,
            rateLimitLayer: usePing ? (igArmed ? 'ig' : 'off') : 'off',
            bffEnabled: igArmed,
            bffMaxRequests: bffCfg.maxRequests,
            bffWindowMs: bffCfg.windowMs,
            gatewayReachable: false,
            gatewayEnabled: false,
            maxRequests: null,
            windowMs: null,
            aligned: bffFlag && (usePing ? igArmed : false),
            message: e.message,
        });
    }

    const live = await fetchGatewayLiveConfig(gatewayUrl);
    const gw = live.ok ? live.config : null;
    const gatewayEnabled = !!(gw && gw.rateLimitEnabled);
    const maxRequests = gw?.rateLimitMaxRequests ?? null;
    const windowMs = gw?.rateLimitWindowMs ?? null;

    let rateLimitLayer = 'off';
    if (usePing && igArmed) rateLimitLayer = 'ig';
    else if (!usePing && gatewayEnabled) rateLimitLayer = 'gateway';
    else if (!usePing && bffFlag && gatewayEnabled) rateLimitLayer = 'both';

    const aligned = usePing
        ? (bffFlag && igArmed)
        : (bffFlag && gatewayEnabled);

    res.json({
        bffFlag,
        usePingGateway: usePing,
        rateLimitLayer,
        bffEnabled: igArmed,
        bffMaxRequests: bffCfg.maxRequests,
        bffWindowMs: bffCfg.windowMs,
        gatewayReachable: live.ok,
        gatewayEnabled,
        maxRequests,
        windowMs,
        aligned,
        demoDefaults: UC18_DEMO_RATE_LIMIT,
        gatewayError: live.ok ? null : live.error,
    });
});

// ---------------------------------------------------------------------------
// POST /api/admin/mcp-gateway/uc18-demo
// One-click UC18 demo: enable BFF flag + push demo rate limits to Demo Agent Gateway.
// ---------------------------------------------------------------------------
router.post('/uc18-demo', express.json(), async (req, res) => {
    const enable = req.body?.enable !== false;
    const usePing = configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';

    try {
        await configStore.setRaw({ ff_mcp_rate_limit: enable ? 'true' : 'false' });
    } catch (e) {
        return res.status(500).json({ error: 'config_store_failed', message: e.message });
    }

    // PingOne Agent Gateway (IG): BFF stamps X-UC18-Rate-Limit; uc18-rate-limit.groovy enforces.
    if (usePing) {
        const { shouldStampIgRateLimitHeader, getBffRateLimitConfig } = require('../services/mcpGatewayRateLimit');
        const bffCfg = getBffRateLimitConfig();
        return res.json({
            ok: true,
            enabled: enable,
            bffFlag: enable,
            rateLimitLayer: 'ig',
            bffEnabled: shouldStampIgRateLimitHeader(),
            bffMaxRequests: bffCfg.maxRequests,
            bffWindowMs: bffCfg.windowMs,
            aligned: enable && shouldStampIgRateLimitHeader(),
            message: enable
                ? 'PingGateway UC18 filter armed (429 before P1AZ; P1AZ API not called on throttle).'
                : 'PingGateway UC18 filter disarmed.',
        });
    }

    let gatewayUrl;
    try {
        gatewayUrl = require('../services/mcpGatewayClient').getMcpGatewayHttpUrl();
    } catch (e) {
        return res.status(500).json({ error: 'gateway_not_configured', message: e.message });
    }

    const pushUpdates = enable
        ? UC18_DEMO_RATE_LIMIT
        : { rateLimitEnabled: false };

    const pushResult = await pushGatewayAdminConfig(gatewayUrl, pushUpdates);
    if (!pushResult.ok) {
        return res.status(502).json({
            error: 'gateway_push_failed',
            message: pushResult.error,
            detail: pushResult.detail || null,
            bffFlag: enable,
        });
    }

    res.json({
        ok: true,
        enabled: enable,
        bffFlag: enable,
        rateLimitLayer: 'gateway',
        gateway: pushResult.config,
        aligned: enable && !!(pushResult.config && pushResult.config.rateLimitEnabled),
    });
});

// ---------------------------------------------------------------------------
// POST /api/admin/mcp-gateway/demo-presets
// One-click presenter presets for Gateway Tester demos.
// ---------------------------------------------------------------------------
router.post('/demo-presets', express.json(), async (req, res) => {
    const { preset } = req.body || {};

    if (preset === 'uc18-throttle') {
        try {
            await configStore.setRaw({
                ff_mcp_gateway_pinggateway: 'false',
                ff_authorize_simulated: 'true',
                ff_mcp_rate_limit: 'true',
            });
        } catch (e) {
            return res.status(500).json({ error: 'config_store_failed', message: e.message });
        }

        let gatewayUrl;
        try {
            gatewayUrl = require('../services/mcpGatewayClient').getMcpGatewayHttpUrl();
        } catch (e) {
            return res.status(500).json({ error: 'gateway_not_configured', message: e.message });
        }

        const pushResult = await pushGatewayAdminConfig(gatewayUrl, UC18_DEMO_RATE_LIMIT);
        return res.json({
            ok: true,
            preset,
            activeGateway: 'Demo Agent Gateway',
            authorizeBackend: 'Simulated (saves P1AZ API quota on permitted calls)',
            rateLimitLayer: pushResult.ok ? 'gateway' : 'bff',
            pushOk: pushResult.ok,
            pushError: pushResult.ok ? null : pushResult.error,
        });
    }

    if (preset === 'real-policy') {
        try {
            await configStore.setRaw({
                ff_mcp_gateway_pinggateway: 'true',
                // Real PingOne Authorize: this preset is single-call PERMIT/DENY
                // demos (see hint), so quota is not a concern — and a preset named
                // "real-policy" silently flipping the whole demo onto the mock
                // engine is exactly the config drift that broke the live site.
                // The burst presets (uc18-throttle / real-throttle-ig) stay
                // simulated deliberately: they hammer the decision endpoint.
                ff_authorize_simulated: 'false',
                ff_mcp_rate_limit: 'false',
            });
        } catch (e) {
            return res.status(500).json({ error: 'config_store_failed', message: e.message });
        }

        return res.json({
            ok: true,
            preset,
            activeGateway: 'PingOne Agent Gateway',
            authorizeBackend: 'Real PingOne Authorize',
            rateLimitLayer: 'off',
            hint: 'Use single tool calls for PERMIT/DENY demos. Enable UC18 demo mode separately to burst-test PingGateway throttling on IG.',
        });
    }

    if (preset === 'real-throttle-ig') {
        try {
            await configStore.setRaw({
                ff_mcp_gateway_pinggateway: 'true',
                ff_authorize_simulated: 'true',
                ff_mcp_rate_limit: 'true',
            });
        } catch (e) {
            return res.status(500).json({ error: 'config_store_failed', message: e.message });
        }

        const { getBffRateLimitConfig } = require('../services/mcpGatewayRateLimit');
        const bffCfg = getBffRateLimitConfig();
        return res.json({
            ok: true,
            preset,
            activeGateway: 'PingOne Agent Gateway',
            authorizeBackend: 'Simulated (no real P1AZ API calls)',
            rateLimitLayer: 'ig',
            bffMaxRequests: bffCfg.maxRequests,
            bffWindowMs: bffCfg.windowMs,
            hint: 'Burst test returns 429 at PingGateway (uc18-rate-limit.groovy) before P1AZ.',
        });
    }

    return res.status(400).json({
        error: 'unknown_preset',
        validPresets: ['uc18-throttle', 'real-policy', 'real-throttle-ig'],
    });
});

// ---------------------------------------------------------------------------
// POST /api/admin/mcp-gateway/test/burst
// Fire N sequential tool calls through the active gateway for UC18 burst demos.
// ---------------------------------------------------------------------------
router.post('/test/burst', express.json(), async (req, res) => {
    const { tool, args, count } = req.body || {};
    const burstCount = Math.min(Math.max(parseInt(count, 10) || 5, 2), 20);

    if (!tool || typeof tool !== 'string') {
        return res.status(400).json({ error: 'bad_request', message: 'tool (string) is required' });
    }

    const usePing   = configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';
    const simulated = configStore.getEffective('ff_authorize_simulated') === 'true';
    const gateway = {
        flag: 'ff_mcp_gateway_pinggateway',
        usePingGateway: usePing,
        name: usePing ? 'PingOne Agent Gateway' : 'Demo Agent Gateway',
        authzBackend: simulated ? 'mock (demo_authz_server)' : 'real (PingOne Authorize)',
        simulated,
    };

    const { callToolViaGateway, getMcpGatewayHttpUrl } = require('../services/mcpGatewayClient');
    const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');

    let url;
    try {
        url = getMcpGatewayHttpUrl();
        gateway.url = url;
    } catch (e) {
        return res.status(500).json({ gateway, error: 'gateway_not_configured', message: e.message });
    }

    let token;
    try {
        ({ token } = await resolveMcpAccessTokenWithEvents(req, tool));
    } catch (e) {
        return res.status(401).json({ gateway, error: 'token_resolution_failed', message: e.message });
    }
    if (!token) {
        return res.status(401).json({
            gateway,
            error: 'no_mcp_token',
            message: 'No delegated MCP access token for this session.',
        });
    }

    const parsedArgs = (args && typeof args === 'object') ? args : {};
    const results = [];
    const t0 = Date.now();

    for (let i = 0; i < burstCount; i++) {
        const callT0 = Date.now();
        try {
            const { result } = await callToolViaGateway(
                url, token, tool, parsedArgs,
                { correlationId: req.correlationId },
            );
            results.push({
                index: i + 1,
                ok: true,
                httpStatus: 200,
                durationMs: Date.now() - callT0,
                result,
            });
        } catch (e) {
            results.push({
                index: i + 1,
                ok: false,
                httpStatus: e.httpStatus || null,
                error: e.code || 'gateway_error',
                gatewayErrorCode: e.gatewayErrorCode || null,
                message: e.gatewayMessage || e.message,
                retryAfterMs: e.retryAfterMs || null,
                durationMs: Date.now() - callT0,
                rateLimited: e.code === 'rate_limited' || e.httpStatus === 429,
                rateLimitLayer: e.rateLimitLayer || null,
            });
        }
    }

    const rateLimitedCount = results.filter((r) => r.rateLimited).length;
    const successCount = results.filter((r) => r.ok).length;

    return res.json({
        gateway,
        tool,
        count: burstCount,
        durationMs: Date.now() - t0,
        successCount,
        rateLimitedCount,
        results,
        summary: rateLimitedCount > 0
            ? `${successCount} succeeded, ${rateLimitedCount} rate-limited (429)`
            : `${successCount} succeeded, 0 rate-limited`,
    });
});

router.pushGatewayAdminConfig = pushGatewayAdminConfig;
router.fetchGatewayLiveConfig = fetchGatewayLiveConfig;
// Default export stays the router so every existing `require(...)` mount keeps
// working unchanged. probeGatewayHealth is attached as a property so
// checks/gatewayPostureCheck can read the gateway's self-reported authz posture
// without a second copy of the probe — it is read-only (GET /health decides
// nothing) and this is the only place that knows how to reach the gateway.
module.exports = router;
module.exports.probeGatewayHealth = probeGatewayHealth;
