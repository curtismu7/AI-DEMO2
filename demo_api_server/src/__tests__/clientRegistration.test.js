/**
 * Tests for Client Registration Routes (CIMD)
 *
 * Covers:
 *   POST /api/clients/register  — validation, success, PingOne errors
 *   GET  /api/clients           — list applications
 *   wellKnownHandler            — GET /.well-known/oauth-client/:clientId
 */

'use strict';

const request = require('supertest');
const express = require('express');

// ── Mock auth middleware before any require() of the route ────────────────────
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, _res, next) => {
    const header = req.headers['x-test-user'];
    if (!header) return _res.status(401).json({ error: 'authentication_required' });
    try { req.user = JSON.parse(header); return next(); }
    catch { return _res.status(401).json({ error: 'invalid_token' }); }
  },
  requireScopes: (requiredScopes) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required' });
    if (req.user.role === 'admin') return next();
    const userScopes = req.user.scopes || [];
    const arr = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
    const ok = arr.some((s) => userScopes.includes(s)) || userScopes.includes('admin:read');
    if (!ok) return res.status(403).json({ error: 'insufficient_scope' });
    return next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required' });
    if (req.user.role === 'admin') return next();
    return res.status(403).json({ error: 'insufficient_scope', required_access: 'admin role or admin:read scope' });
  },
  hasRequiredScopes: () => true,
    requireSession: (req, res, next) => next(),
  parseTokenScopes: () => [],
}));

// ── Mock PingOne client service ───────────────────────────────────────────────
jest.mock('../../services/pingOneClientService', () => ({
  createApplication: jest.fn(),
  listApplications: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const pingOneClientService = require('../../services/pingOneClientService');
const { PINGONE_OIDC_DEFAULT_SCOPES_SPACE } = require('../../config/scopes');
const { authenticateToken } = require('../../middleware/auth');
const { router: clientRegistrationRouter, wellKnownHandler } = require('../../routes/clientRegistration');

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  // Auth only on admin routes (well-known is public)
  app.use('/api/clients', authenticateToken, clientRegistrationRouter);
  app.get('/.well-known/oauth-client/:clientId', wellKnownHandler);
  return app;
}

const ADMIN_HEADER = JSON.stringify({ id: 'admin-1', role: 'admin', scopes: ['admin:read'] });
const USER_HEADER  = JSON.stringify({ id: 'user-1',  role: 'customer', scopes: ['read'] });

const VALID_BODY = {
  client_name:                 'Test Banking App',
  client_description:          'A test OAuth client',
  application_type:            'web',
  grant_types:                 ['authorization_code'],
  response_types:              ['code'],
  redirect_uris:               ['https://app.example.com/callback'],
  post_logout_redirect_uris:   ['https://app.example.com/logout'],
  token_endpoint_auth_method:  'client_secret_basic',
  scope:                       'openid profile email',
  contacts:                    ['dev@example.com'],
};

const MOCK_PINGONE_APP = {
  id:           'pp-app-uuid-1234',
  name:         'Test Banking App',
  type:         'WEB_APP',
  clientSecret: 'super-secret-value',
  environment:  { id: 'env-uuid-5678' },
};

// ── POST /api/clients/register ────────────────────────────────────────────────

describe('POST /api/clients/register', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    pingOneClientService.createApplication.mockResolvedValue(MOCK_PINGONE_APP);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/clients/register')
      .send(VALID_BODY)
      .expect(401);
    expect(res.body.error).toBe('authentication_required');
  });

  it('returns 403 for non-admin users', async () => {
    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', USER_HEADER)
      .send(VALID_BODY)
      .expect(403);
    expect(res.body.error).toBe('insufficient_scope');
  });

  it('returns 400 when client_name is missing', async () => {
    const body = { ...VALID_BODY };
    delete body.client_name;
    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(body)
      .expect(400);
    expect(res.body.error).toBe('client_name is required');
  });

  it('returns 400 when client_name is empty string', async () => {
    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send({ ...VALID_BODY, client_name: '   ' })
      .expect(400);
    expect(res.body.error).toBe('client_name is required');
  });

  it('returns 400 when client_name exceeds 150 characters', async () => {
    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send({ ...VALID_BODY, client_name: 'A'.repeat(151) })
      .expect(400);
    expect(res.body.error).toBe('client_name must be 150 characters or fewer');
  });

  it('returns 400 for non-HTTPS redirect_uri (not localhost)', async () => {
    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send({ ...VALID_BODY, redirect_uris: ['http://app.example.com/callback'] })
      .expect(400);
    expect(res.body.error).toMatch(/redirect_uri must use HTTPS/);
  });

  it('returns 400 for malformed redirect_uri', async () => {
    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send({ ...VALID_BODY, redirect_uris: ['not-a-url'] })
      .expect(400);
    expect(res.body.error).toMatch(/Invalid redirect_uri/);
  });

  it('allows http localhost redirect_uri', async () => {
    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send({ ...VALID_BODY, redirect_uris: ['http://localhost:3000/callback'] })
      .expect(201);
    expect(res.body.pingone_client_id).toBe(MOCK_PINGONE_APP.id);
  });

  it('returns 201 with correct response shape on success', async () => {
    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(VALID_BODY)
      .expect(201);

    expect(res.body.pingone_client_id).toBe(MOCK_PINGONE_APP.id);
    expect(res.body.client_secret).toBe(MOCK_PINGONE_APP.clientSecret);
    expect(res.body.cimd_url).toMatch(/\/.well-known\/oauth-client\/pp-app-uuid-1234$/);
    expect(res.body.cimd_document).toBeDefined();
    expect(res.body.cimd_document.client_id).toBe(res.body.cimd_url);
    expect(res.body.registered_at).toBeDefined();
    expect(new Date(res.body.registered_at).getTime()).not.toBeNaN();
  });

  it('cimd_document has expected CIMD fields', async () => {
    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(VALID_BODY)
      .expect(201);

    const doc = res.body.cimd_document;
    expect(doc.client_name).toBe('Test Banking App');
    expect(doc.application_type).toBe('web');
    expect(doc.grant_types).toEqual(['authorization_code']);
    expect(doc.redirect_uris).toEqual(['https://app.example.com/callback']);
    expect(doc.token_endpoint_auth_method).toBe('client_secret_basic');
    expect(doc.scope).toBe('openid profile email');
    // client_secret must never appear in the CIMD document
    expect(doc.client_secret).toBeUndefined();
  });

  it('cimd_document does not expose client_secret', async () => {
    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(VALID_BODY)
      .expect(201);

    expect(res.body.cimd_document).not.toHaveProperty('client_secret');
  });

  it('uses sensible defaults when optional fields are omitted', async () => {
    const minimalBody = { client_name: 'Minimal App' };
    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(minimalBody)
      .expect(201);

    const doc = res.body.cimd_document;
    expect(doc.application_type).toBe('web');
    expect(doc.token_endpoint_auth_method).toBe('client_secret_basic');
    expect(doc.scope).toBe(PINGONE_OIDC_DEFAULT_SCOPES_SPACE);
    expect(Array.isArray(doc.grant_types)).toBe(true);
  });

  it('calls pingOneClientService.createApplication with correct metadata', async () => {
    await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(VALID_BODY)
      .expect(201);

    expect(pingOneClientService.createApplication).toHaveBeenCalledTimes(1);
    const [meta] = pingOneClientService.createApplication.mock.calls[0];
    expect(meta.client_name).toBe('Test Banking App');
    expect(meta.redirect_uris).toEqual(['https://app.example.com/callback']);
  });

  it('propagates PingOne 4xx error to caller', async () => {
    const pingOneError = Object.assign(new Error('conflict'), {
      response: { status: 409, data: { message: 'App already exists' } },
    });
    pingOneClientService.createApplication.mockRejectedValue(pingOneError);

    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(VALID_BODY)
      .expect(409);

    expect(res.body.error).toBe('registration_failed');
  });

  it('returns 500 on unexpected PingOne error', async () => {
    pingOneClientService.createApplication.mockRejectedValue(new Error('Network timeout'));

    const res = await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(VALID_BODY)
      .expect(500);

    expect(res.body.error).toBe('registration_failed');
  });
});

// ── GET /api/clients ──────────────────────────────────────────────────────────

describe('GET /api/clients', () => {
  let app;
  const MOCK_APPS = [
    { id: 'app-1', name: 'App One' },
    { id: 'app-2', name: 'App Two' },
  ];

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    pingOneClientService.listApplications.mockResolvedValue(MOCK_APPS);
  });

  it('returns 401 when not authenticated', async () => {
    await request(app).get('/api/clients').expect(401);
  });

  it('returns 403 for non-admin users', async () => {
    await request(app)
      .get('/api/clients')
      .set('x-test-user', USER_HEADER)
      .expect(403);
  });

  it('returns application list for admin', async () => {
    const res = await request(app)
      .get('/api/clients')
      .set('x-test-user', ADMIN_HEADER)
      .expect(200);

    expect(res.body.applications).toEqual(MOCK_APPS);
  });

  it('returns 500 when PingOne list fails', async () => {
    pingOneClientService.listApplications.mockRejectedValue(new Error('server error'));

    const res = await request(app)
      .get('/api/clients')
      .set('x-test-user', ADMIN_HEADER)
      .expect(500);

    expect(res.body.error).toBe('list_failed');
  });
});

// ── GET /.well-known/oauth-client/:clientId (wellKnownHandler) ────────────────

describe('GET /.well-known/oauth-client/:clientId', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    pingOneClientService.createApplication.mockResolvedValue(MOCK_PINGONE_APP);
  });

  it('returns 404 for an unknown client ID', async () => {
    const res = await request(app)
      .get('/.well-known/oauth-client/unknown-id')
      .expect(404);

    expect(res.body.error).toBe('client_not_found');
  });

  it('returns 200 + CIMD document for a registered client', async () => {
    // First register the client to populate cimdStore
    await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(VALID_BODY);

    const res = await request(app)
      .get(`/.well-known/oauth-client/${MOCK_PINGONE_APP.id}`)
      .expect(200);

    expect(res.body.client_id).toMatch(/\.well-known\/oauth-client\//);
    expect(res.body.client_name).toBe('Test Banking App');
    expect(res.body.grant_types).toEqual(['authorization_code']);
  });

  it('sets Cache-Control: public, max-age=3600', async () => {
    // Register first
    await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(VALID_BODY);

    const res = await request(app)
      .get(`/.well-known/oauth-client/${MOCK_PINGONE_APP.id}`)
      .expect(200);

    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('sets Content-Type: application/json', async () => {
    await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(VALID_BODY);

    const res = await request(app)
      .get(`/.well-known/oauth-client/${MOCK_PINGONE_APP.id}`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('CIMD document does not contain client_secret', async () => {
    await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(VALID_BODY);

    const res = await request(app)
      .get(`/.well-known/oauth-client/${MOCK_PINGONE_APP.id}`)
      .expect(200);

    expect(res.body).not.toHaveProperty('client_secret');
  });

  it('is publicly accessible without auth headers', async () => {
    // Register with admin, then fetch without any auth
    await request(app)
      .post('/api/clients/register')
      .set('x-test-user', ADMIN_HEADER)
      .send(VALID_BODY);

    // No auth header — should still succeed (public endpoint)
    await request(app)
      .get(`/.well-known/oauth-client/${MOCK_PINGONE_APP.id}`)
      .expect(200);
  });
});
