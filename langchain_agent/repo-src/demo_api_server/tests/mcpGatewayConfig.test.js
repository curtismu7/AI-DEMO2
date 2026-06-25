'use strict';
/**
 * Tests for GET/POST /api/admin/mcp-gateway/config (Phase 264-01)
 *
 * Verifies:
 * - GET returns derived fields: pingOneEnvUrl, introspectEndpoint, mcpScope, etc.
 * - POST allowlist includes new keys: mcp_gw_client_id, mcp_gw_public_url, mcp_scope
 * - POST calls configStore.setRaw() for those keys
 * - POST rejects bodies with no valid keys (400)
 *
 * Strategy: mock configStore; spy on http.request and route gateway-port calls
 * (3005) to fake responses while forwarding all other calls (e.g. supertest's
 * loopback requests) to the real http.request implementation.
 */

const express = require('express');
const supertest = require('supertest');
const http = require('http');

// ── Mock configStore ────────────────────────────────────────────────────────
jest.mock('../services/configStore', () => ({
    getEffective: jest.fn((key) => {
        const values = {
            pingone_environment_id: 'env-abc',
            pingone_region: 'com',
            mcp_scope: 'mcp:invoke',
            mcp_gw_client_id: 'stored-client-id',
            mcp_gw_public_url: 'https://ig.example.com:8443',
            mcp_server_url: 'http://localhost:8000',
            pingone_resource_mcp_gateway_uri: '',
        };
        return values[key] || null;
    }),
    get: jest.fn((key) => {
        if (key === 'mcp_use_pingone_server') return 'false';
        return null;
    }),
    setRaw: jest.fn().mockResolvedValue(undefined),
    setConfig: jest.fn().mockResolvedValue(undefined),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
const { EventEmitter } = require('events');
const _realHttpRequest = http.request.bind(http);

/**
 * Returns true if the options object targets the mock gateway port (3005) or
 * the gateway push path (/admin/config). These are the calls we want to
 * intercept — all other calls (supertest loopback) use the real implementation.
 */
function isGatewayCall(opts) {
    const port = parseInt(opts.port || opts.defaultPort || 80, 10);
    return port === 3005 || (opts.path && opts.path.startsWith('/admin/config'));
}

/**
 * Stub http.request so gateway calls resolve immediately with an error
 * (simulates unreachable gateway). Supertest's own loopback calls pass through.
 */
function stubHttpRequestError() {
    return jest.spyOn(http, 'request').mockImplementation(function (opts, cb) {
        if (!isGatewayCall(opts)) {
            return _realHttpRequest(opts, cb);
        }
        const req = new EventEmitter();
        req.setNoDelay = jest.fn();
        req.destroy = jest.fn();
        req.write = jest.fn();
        req.end = jest.fn(() => {
            setImmediate(() => req.emit('error', new Error('mocked: no gateway')));
        });
        return req;
    });
}

/**
 * Stub http.request so gateway push calls return 200. Supertest loopback passes through.
 */
function stubHttpRequestSuccess() {
    return jest.spyOn(http, 'request').mockImplementation(function (opts, cb) {
        if (!isGatewayCall(opts)) {
            return _realHttpRequest(opts, cb);
        }
        const res = new EventEmitter();
        res.statusCode = 200;
        const req = new EventEmitter();
        req.setNoDelay = jest.fn();
        req.destroy = jest.fn();
        req.write = jest.fn();
        req.end = jest.fn(() => {
            if (cb) {
                setImmediate(() => {
                    cb(res);
                    setImmediate(() => {
                        res.emit('data', JSON.stringify({ config: {} }));
                        res.emit('end');
                    });
                });
            }
        });
        return req;
    });
}

function buildApp() {
    const router = require('../routes/mcpGatewayConfig');
    const app = express();
    app.use(express.json());
    app.use('/', router);
    return app;
}

// ── GET /config tests ────────────────────────────────────────────────────────

describe('GET /config — derived fields', () => {
    let httpSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.PINGONE_ENVIRONMENT_ID;
        delete process.env.PINGONE_REGION;
        delete process.env.MCP_GW_CLIENT_ID;
        delete process.env.MCP_GW_RESOURCE_URI;
        delete process.env.MCP_GATEWAY_HTTP_URL;
        httpSpy = stubHttpRequestError();
    });

    afterEach(() => {
        httpSpy.mockRestore();
        delete process.env.PINGONE_ENVIRONMENT_ID;
        delete process.env.PINGONE_REGION;
        delete process.env.MCP_GW_CLIENT_ID;
        delete process.env.MCP_GW_RESOURCE_URI;
        delete process.env.MCP_GATEWAY_HTTP_URL;
    });

    test('returns pingOneEnvUrl derived from envId and region', async () => {
        const app = buildApp();
        const res = await supertest(app).get('/config');
        expect(res.status).toBe(200);
        expect(res.body.config.pingOneEnvUrl).toBe('https://auth.pingone.com/env-abc');
    });

    test('returns introspectEndpoint as pingOneEnvUrl + /as/introspect', async () => {
        const app = buildApp();
        const res = await supertest(app).get('/config');
        expect(res.status).toBe(200);
        expect(res.body.config.introspectEndpoint).toBe('https://auth.pingone.com/env-abc/as/introspect');
    });

    test('returns mcpScope from configStore (not hardcoded "test")', async () => {
        const app = buildApp();
        const res = await supertest(app).get('/config');
        expect(res.status).toBe(200);
        expect(res.body.config.mcpScope).toBe('mcp:invoke');
    });

    test('mcpScope defaults to "banking:mcp:invoke" when configStore has no value', async () => {
        const configStore = require('../services/configStore');
        configStore.getEffective.mockImplementation((key) => {
            if (key === 'pingone_environment_id') return 'env-abc';
            if (key === 'pingone_region') return 'com';
            // mcp_scope intentionally not set
            return null;
        });

        const app = buildApp();
        const res = await supertest(app).get('/config');
        expect(res.status).toBe(200);
        expect(res.body.config.mcpScope).toBe('mcp:invoke');
    });

    test('config has keys: pingOneResourceId, gatewayPublicUrl, upstreamMcpUrl', async () => {
        const app = buildApp();
        const res = await supertest(app).get('/config');
        expect(res.status).toBe(200);
        expect(res.body.config).toHaveProperty('pingOneResourceId');
        expect(res.body.config).toHaveProperty('gatewayPublicUrl');
        expect(res.body.config).toHaveProperty('upstreamMcpUrl');
    });

    test('pingOneResourceId reads from configStore when MCP_GW_CLIENT_ID env not set', async () => {
        const app = buildApp();
        const res = await supertest(app).get('/config');
        expect(res.status).toBe(200);
        // configStore mock returns 'stored-client-id' for mcp_gw_client_id
        expect(res.body.config.pingOneResourceId).toBe('stored-client-id');
    });
});

// ── POST /config tests ───────────────────────────────────────────────────────

describe('POST /config — allowlist', () => {
    let httpSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.MCP_GATEWAY_HTTP_URL;
        httpSpy = stubHttpRequestError();
    });

    afterEach(() => {
        httpSpy.mockRestore();
    });

    test('POST rejects body with only unknown keys → 400', async () => {
        const app = buildApp();
        const res = await supertest(app)
            .post('/config')
            .send({ random_unknown_field: 'value' });
        expect(res.status).toBe(400);
    });

    test('POST rejects empty body → 400', async () => {
        const app = buildApp();
        const res = await supertest(app).post('/config').send({});
        expect(res.status).toBe(400);
    });

    test('POST with new keys (mcp_scope) does not return 400', async () => {
        const app = buildApp();
        const res = await supertest(app)
            .post('/config')
            .send({ mcp_scope: 'mcp:invoke' });
        // Gateway is unreachable → 502, but NOT 400 (key is in allowlist)
        expect(res.status).not.toBe(400);
    });

    test('POST with mcp_gw_client_id does not return 400', async () => {
        const app = buildApp();
        const res = await supertest(app)
            .post('/config')
            .send({ mcp_gw_client_id: 'test-client' });
        expect(res.status).not.toBe(400);
    });

    test('POST with mcp_gw_public_url does not return 400', async () => {
        const app = buildApp();
        const res = await supertest(app)
            .post('/config')
            .send({ mcp_gw_public_url: 'https://ig.example.com:8443' });
        expect(res.status).not.toBe(400);
    });
});

// ── POST /config — setRaw persistence ────────────────────────────────────────

describe('POST /config — setRaw persistence', () => {
    let httpSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.MCP_GATEWAY_HTTP_URL;
    });

    afterEach(() => {
        if (httpSpy) httpSpy.mockRestore();
    });

    test('calls configStore.setRaw with new keys when gateway push succeeds', async () => {
        httpSpy = stubHttpRequestSuccess();

        const configStore = require('../services/configStore');
        const app = buildApp();

        const res = await supertest(app)
            .post('/config')
            .send({
                mcp_gw_client_id: 'test-client',
                mcp_gw_public_url: 'https://ig.example.com:8443',
                mcp_scope: 'mcp:invoke',
            });

        expect(res.status).toBe(200);
        expect(configStore.setRaw).toHaveBeenCalledWith(
            expect.objectContaining({
                mcp_gw_client_id: 'test-client',
                mcp_gw_public_url: 'https://ig.example.com:8443',
                mcp_scope: 'mcp:invoke',
            })
        );
    });

    test('does not call setRaw when gateway push fails (502)', async () => {
        httpSpy = stubHttpRequestError();

        const configStore = require('../services/configStore');
        const app = buildApp();

        await supertest(app)
            .post('/config')
            .send({ mcp_gw_client_id: 'test-client' });

        expect(configStore.setRaw).not.toHaveBeenCalled();
    });
});
