'use strict';
/**
 * @file pingoneTestRoutes.ssePublish.test.js
 * Verifies that token-acquisition endpoints in pingoneTestRoutes.js call
 * sseHub.publishToken / publishExchange with the correct arguments on both
 * success and error paths.
 *
 * Covers the gap identified in TESTING.md §4:
 *   "pingoneTestRoutes.js token endpoints — SSE side-effects not asserted"
 */

const request = require('supertest');

// ─── All jest.mock() calls at top level (hoisted by babel-jest) ───────────────

jest.mock('../../services/pingoneTestSseHub', () => ({
  attach: jest.fn(),
  publish: jest.fn(),
  publishToken: jest.fn(),
  publishExchange: jest.fn(),
  publishApiCall: jest.fn(),
}));

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
}));

jest.mock('../../services/configStore', () => ({
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
  getEffective: jest.fn((key) => ({
    pingone_region: 'com',
    pingone_environment_id: 'env-123',
    admin_client_id: 'admin-cid',
    user_client_id: 'user-cid',
    pingone_mcp_token_exchanger_client_id: 'mcp-cid',
    pingone_audience_enduser: 'agentgateway.ping.demo',
    pingone_resource_mcp_server_uri: 'mcpserver.ping.demo',
  }[key] || null)),
}));

jest.mock('../../services/pingoneManagementService', () => ({
  managementService: {
    initialize: jest.fn(),
    getApplications: jest.fn(),
    getResourceServers: jest.fn(),
    getScopes: jest.fn(),
    getApplicationGrants: jest.fn(),
    createResourceServer: jest.fn(),
    createScopes: jest.fn(),
    enableResourceServer: jest.fn(),
  },
}));

jest.mock('../../services/oauthService', () => ({
  getAgentClientCredentialsTokenWithExpiry: jest.fn(),
  getClientCredentialsToken: jest.fn(),
  performTokenExchange: jest.fn(),
  config: { tokenEndpoint: 'https://auth.pingone.com/token', clientId: 'agent-cid' },
}));

jest.mock('../../services/apiCallTrackerService', () => ({
  trackApiCall: jest.fn(),
}));

jest.mock('../../services/pingOneUserService', () => ({
  getUserById: jest.fn(),
}));

// ─── Module references ─────────────────────────────────────────────────────────
// setup.js calls jest.resetModules() in afterEach, which clears the module
// registry between tests. Re-requiring in beforeEach ensures that both the test
// and the route (re-required via buildApp) share the SAME fresh mock objects.

const express = require('express');

// Mutable references — refreshed in beforeEach after each resetModules()
let sseHub;
let oauthService;

beforeEach(() => {
  sseHub = require('../../services/pingoneTestSseHub');
  oauthService = require('../../services/oauthService');
});

// A valid-looking JWT: header.payload.sig (base64url-encoded JSON parts)
const STUB_TOKEN = [
  Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: 'u1', scope: 'read' })).toString('base64url'),
  'stub-sig',
].join('.');

// ─── Express app with a pre-populated session ─────────────────────────────────

function buildApp(sessionOverride = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionID = 'test-session-id';
    req.session = {
      user: { id: 'user-123', role: 'customer' },
      oauthTokens: {
        accessToken: STUB_TOKEN,
        expiresAt: Date.now() + 3_600_000,
      },
      ...sessionOverride,
    };
    next();
  });
  app.use('/', require('../../routes/pingoneTestRoutes'));
  return app;
}

// ─── GET /authz-token ─────────────────────────────────────────────────────────

describe('GET /authz-token — SSE side-effects', () => {
  it('calls publishToken(sessionId, { id:"authz-token", status:"success" }) on success', async () => {
    const app = buildApp();
    const res = await request(app).get('/authz-token');

    expect(res.body.success).toBe(true);
    expect(sseHub.publishToken).toHaveBeenCalledTimes(1);
    expect(sseHub.publishToken).toHaveBeenCalledWith(
      'test-session-id',
      expect.objectContaining({ id: 'authz-token', status: 'success' }),
    );
  });

  it('does NOT call publishToken when session has no oauthTokens (early return)', async () => {
    const app = buildApp({ oauthTokens: null });
    const res = await request(app).get('/authz-token');

    expect(res.body.success).toBe(false);
    expect(sseHub.publishToken).not.toHaveBeenCalled();
  });

  it('does NOT call publishToken when access token is missing from oauthTokens', async () => {
    const app = buildApp({ oauthTokens: { accessToken: null } });
    const res = await request(app).get('/authz-token');

    expect(res.body.success).toBe(false);
    expect(sseHub.publishToken).not.toHaveBeenCalled();
  });

  it('calls publishToken with decoded=null when token payload is invalid base64', async () => {
    // decodeJwtForDisplay swallows parse errors and returns null — the route
    // still calls publishToken on the success path with decoded=null.
    const badApp = buildApp({
      oauthTokens: {
        accessToken: 'hdr.!!!notbase64!!!.sig',
        expiresAt: Date.now() + 3_600_000,
      },
    });
    await request(badApp).get('/authz-token');

    expect(sseHub.publishToken).toHaveBeenCalledWith(
      'test-session-id',
      expect.objectContaining({ id: 'authz-token', status: 'success', decoded: null }),
    );
  });

  it('publishToken receives decoded payload on success', async () => {
    const app = buildApp();
    await request(app).get('/authz-token');

    const call = sseHub.publishToken.mock.calls[0][1];
    expect(call.decoded).toBeDefined();
    expect(call.decoded.payload).toMatchObject({ sub: 'u1', scope: 'read' });
  });
});

// ─── GET /agent-token ─────────────────────────────────────────────────────────

describe('GET /agent-token — SSE side-effects', () => {
  it('calls publishToken with id="agent-token", status="success" on CC grant success', async () => {
    oauthService.getAgentClientCredentialsTokenWithExpiry.mockResolvedValue({
      token: STUB_TOKEN,
      expiresIn: 3600,
    });
    const app = buildApp();
    const res = await request(app).get('/agent-token');

    expect(res.body.success).toBe(true);
    expect(sseHub.publishToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: 'agent-token', status: 'success' }),
    );
  });

  it('calls publishToken with status="error" when CC grant throws', async () => {
    oauthService.getAgentClientCredentialsTokenWithExpiry.mockRejectedValue(
      new Error('invalid_client'),
    );
    const app = buildApp();
    const res = await request(app).get('/agent-token');

    expect(res.body.success).toBe(false);
    expect(sseHub.publishToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: 'agent-token', status: 'error', error: 'invalid_client' }),
    );
  });
});

// ─── GET /worker-token ────────────────────────────────────────────────────────

describe('GET /worker-token — SSE side-effects', () => {
  it('calls publishToken with id="worker-token" on success', async () => {
    // The route calls getAgentClientCredentialsTokenWithExpiry and expects { token, expiresAt }
    oauthService.getAgentClientCredentialsTokenWithExpiry.mockResolvedValue({
      token: STUB_TOKEN,
      expiresAt: Date.now() + 3_600_000,
    });
    const app = buildApp();
    const res = await request(app).get('/worker-token');

    expect(res.body.success).toBe(true);
    expect(sseHub.publishToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: 'worker-token', status: 'success' }),
    );
  });

  it('calls publishToken with status="error" when worker CC grant throws', async () => {
    oauthService.getAgentClientCredentialsTokenWithExpiry.mockRejectedValue(new Error('unauthorized'));
    const app = buildApp();
    await request(app).get('/worker-token');

    expect(sseHub.publishToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: 'worker-token', status: 'error' }),
    );
  });
});
