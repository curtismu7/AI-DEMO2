'use strict';
/**
 * pathInfo.regression.test.js
 * Regression tests for GET /api/path/apikey-info.
 *
 * Test 1: unauthenticated → 401
 * Test 2: authenticated → 200 + masked api-key, no raw JWT, correct shape
 *
 * Per CLAUDE.md two-tier test pattern: mock everything external.
 */

const express = require('express');
const request = require('supertest');

// ─── Mock configStore ─────────────────────────────────────────────────────────
const mockGetEffective = jest.fn();
jest.mock('../../services/configStore', () => ({
  getEffective: mockGetEffective,
}));

// ─── App builder ──────────────────────────────────────────────────────────────

function buildApp(sessionData) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = sessionData || {};
    next();
  });
  const router = require('../../routes/pathInfo');
  app.use('/api/path', router);
  return app;
}

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pathInfo GET /apikey-info — regression tests', () => {

  beforeEach(() => {
    mockGetEffective.mockClear();
  });

  // Test 1: unauthenticated (no session) → 401
  it('Test 1: GET /api/path/apikey-info with no session → 401', async () => {
    const app = buildApp({});
    const res = await request(app).get('/api/path/apikey-info');
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('apiKeyMaskedLast4');
  });

  // Test 2: authenticated → 200 + correct shape, no raw JWT, apiKeyMaskedLast4 = last 4 of key
  it('Test 2: GET /api/path/apikey-info with valid session → 200 + masked key + correct shape', async () => {
    mockGetEffective.mockImplementation((key) => {
      if (key === 'demo_apikey_backend_service_key') return 'my-super-secret-key-9999';
      return '';
    });

    const app = buildApp({ oauthTokens: { accessToken: 'some-access-token' } });
    const res = await request(app).get('/api/path/apikey-info');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('credentialPath', 'api_key');
    expect(res.body).toHaveProperty('badge', 'API-KEY PATH');
    expect(res.body).toHaveProperty('color', 'amber');
    // Last 4 chars of 'my-super-secret-key-9999' is '9999'
    expect(res.body).toHaveProperty('apiKeyMaskedLast4', '9999');
    expect(res.body).toHaveProperty('returnTo', '/dashboard');
    expect(res.body).toHaveProperty('returnLabel', 'Back to Dashboard');
    expect(res.body).toHaveProperty('message');

    // No raw JWT in response body (scrubRawJwts defense-in-depth)
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toMatch(JWT_RE);
  });
});
