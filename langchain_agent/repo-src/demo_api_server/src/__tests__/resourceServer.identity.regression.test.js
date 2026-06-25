'use strict';
/**
 * resourceServer.identity.regression.test.js
 * Regression tests for POST /api/resource-server/identity and GET /identity.
 *
 * Covers: auth gating, claims-only response, no raw JWT, idTokenSource,
 *         session fallback, subject-mismatch integrity check, body-over-session preference.
 *
 * Per CLAUDE.md two-tier test pattern: mock everything external.
 */

const express = require('express');
const request = require('supertest');

// ─── Mock authenticateToken ───────────────────────────────────────────────────
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'authentication_required' });
    }
    const token = auth.slice(7);
    if (token === 'invalid-token') {
      return res.status(401).json({ error: 'invalid_token' });
    }
    // Valid mock bearer — set req.user.sub from token suffix (e.g. "bearer-user-1" → sub="user-1")
    req.user = { sub: token.replace('bearer-', '') };
    return next();
  },
  requireScopes: () => (req, res, next) => next(),
}));

// ─── Mock appEventService ─────────────────────────────────────────────────────
const mockLogEvent = jest.fn();
jest.mock('../../services/appEventService', () => ({
  logEvent: mockLogEvent,
  EVENT_CATEGORIES: { AUTHORIZE: 'authorize', HITL: 'hitl', THRESHOLD: 'threshold' },
}));

// ─── Mock bankingDb (not used by /identity but must not throw on require) ─────
jest.mock('../../services/bankingDb', () => ({
  getAccountsByUserId:     jest.fn().mockReturnValue([]),
  getTransactionsByUserId: jest.fn().mockReturnValue([]),
  initBankingDb:           jest.fn(),
}));

// ─── Mock data/store (required by resourceServer.js summary route) ────────────
jest.mock('../../data/store', () => ({
  getAccountsByUserId:     jest.fn().mockReturnValue([]),
  getTransactionsByUserId: jest.fn().mockReturnValue([]),
}));

// ─── Mock configStore ─────────────────────────────────────────────────────────
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn().mockReturnValue(''),
}));

// ─── Helpers — build real-ish JWT shapes for testing ─────────────────────────
// These are NOT real PingOne tokens — just base64url-encoded JSON to simulate JWTs.
function makeJwt(claims) {
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.fakesig`;
}

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// ─── Test app setup ───────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());

  // Simulated session middleware
  app.use((req, _res, next) => {
    req.session = req._sessionData || {};
    next();
  });

  const { authenticateToken } = require('../../middleware/auth');
  const router = require('../../routes/resourceServer');
  app.use('/api/resource-server', authenticateToken, router);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resourceServer /identity — regression tests', () => {

  // Test 1: POST /identity with NO Authorization header → 401
  it('Test 1: POST /identity with no Authorization header → 401', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/resource-server/identity').send({});
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('accessTokenClaims');
  });

  // Test 2: POST /identity with invalid bearer → 401
  it('Test 2: POST /identity with invalid bearer → 401', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/resource-server/identity')
      .set('Authorization', 'Bearer invalid-token')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('accessTokenClaims');
  });

  // Test 3 (gateway POST path): POST /identity with valid bearer + JSON-RPC body
  //   whose sub matches req.user.sub → 200 + claims-only, idTokenSource:'wire', no raw JWT
  it('Test 3: POST /identity with valid bearer + wire idToken (matching sub) → 200 claims-only', async () => {
    const sub = 'user-abc';
    const idTokenJwt = makeJwt({ sub, email: 'test@test.com', aud: 'resource-server' });
    const accessJwt  = makeJwt({ sub, aud: 'resource-server', scope: 'read' });

    // Build app with session injected via middleware (session data must be pre-set)
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { oauthTokens: { accessToken: accessJwt, idToken: null } };
      next();
    });
    const { authenticateToken } = require('../../middleware/auth');
    const router = require('../../routes/resourceServer');
    app.use('/api/resource-server', authenticateToken, router);

    const res = await request(app)
      .post('/api/resource-server/identity')
      .set('Authorization', `Bearer bearer-${sub}`)
      .send({ jsonrpc: '2.0', method: 'identity.show', params: { idToken: idTokenJwt } });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('credentialPath', 'dual_token');
    expect(res.body).toHaveProperty('idTokenSource', 'wire');
    expect(res.body).toHaveProperty('accessTokenClaims');
    expect(res.body).toHaveProperty('idTokenClaims');
    // No raw JWT in response body
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toMatch(JWT_RE);
  });

  // Test 3b (SPA GET path): GET /identity with valid bearer + session containing idToken
  //   → 200 with idTokenSource:'session'
  it('Test 3b: GET /identity with valid bearer + session idToken → 200 idTokenSource:session', async () => {
    const sub = 'user-session';
    const idTokenJwt = makeJwt({ sub, email: 'session@test.com', aud: 'resource-server' });
    const accessJwt  = makeJwt({ sub, aud: 'resource-server' });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { oauthTokens: { accessToken: accessJwt, idToken: idTokenJwt } };
      next();
    });
    const { authenticateToken } = require('../../middleware/auth');
    const router = require('../../routes/resourceServer');
    app.use('/api/resource-server', authenticateToken, router);

    const res = await request(app)
      .get('/api/resource-server/identity')
      .set('Authorization', `Bearer bearer-${sub}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('idTokenSource', 'session');
    expect(res.body).toHaveProperty('credentialPath', 'dual_token');
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toMatch(JWT_RE);
  });

  // Test 4: POST /identity with valid bearer + NO body AND session WITHOUT idToken → 412 id_token_missing
  it('Test 4: POST /identity no body, no session idToken → 412 id_token_missing', async () => {
    const sub = 'user-nomissing';
    const accessJwt = makeJwt({ sub, aud: 'resource-server' });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { oauthTokens: { accessToken: accessJwt, idToken: null } };
      next();
    });
    const { authenticateToken } = require('../../middleware/auth');
    const router = require('../../routes/resourceServer');
    app.use('/api/resource-server', authenticateToken, router);

    const res = await request(app)
      .post('/api/resource-server/identity')
      .set('Authorization', `Bearer bearer-${sub}`)
      .send({});
    expect(res.status).toBe(412);
    expect(res.body.error).toBe('id_token_missing');
  });

  // Test 4a: GET /identity with valid bearer + session WITHOUT idToken → 412 id_token_missing
  it('Test 4a: GET /identity no session idToken → 412 id_token_missing', async () => {
    const sub = 'user-get-missing';
    const accessJwt = makeJwt({ sub, aud: 'resource-server' });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { oauthTokens: { accessToken: accessJwt, idToken: null } };
      next();
    });
    const { authenticateToken } = require('../../middleware/auth');
    const router = require('../../routes/resourceServer');
    app.use('/api/resource-server', authenticateToken, router);

    const res = await request(app)
      .get('/api/resource-server/identity')
      .set('Authorization', `Bearer bearer-${sub}`);
    expect(res.status).toBe(412);
    expect(res.body.error).toBe('id_token_missing');
  });

  // Test 4b: POST /identity with valid bearer + NO body BUT session contains idToken
  //   → 200, idTokenSource:'session' (session fallback works on POST too)
  it('Test 4b: POST /identity no body but session has idToken → 200 idTokenSource:session', async () => {
    const sub = 'user-session-post';
    const idTokenJwt = makeJwt({ sub, aud: 'resource-server' });
    const accessJwt  = makeJwt({ sub, aud: 'resource-server' });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { oauthTokens: { accessToken: accessJwt, idToken: idTokenJwt } };
      next();
    });
    const { authenticateToken } = require('../../middleware/auth');
    const router = require('../../routes/resourceServer');
    app.use('/api/resource-server', authenticateToken, router);

    const res = await request(app)
      .post('/api/resource-server/identity')
      .set('Authorization', `Bearer bearer-${sub}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('idTokenSource', 'session');
  });

  // Test 4c: POST /identity with valid bearer + id_token whose sub !== req.user.sub → 412 subject_mismatch
  it('Test 4c: POST /identity id_token sub mismatch → 412 id_token_subject_mismatch', async () => {
    const bearerSub  = 'user-real';
    const idTokenSub = 'user-attacker';
    const idTokenJwt = makeJwt({ sub: idTokenSub, aud: 'resource-server' });
    const accessJwt  = makeJwt({ sub: bearerSub, aud: 'resource-server' });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { oauthTokens: { accessToken: accessJwt, idToken: null } };
      next();
    });
    const { authenticateToken } = require('../../middleware/auth');
    const router = require('../../routes/resourceServer');
    app.use('/api/resource-server', authenticateToken, router);

    const res = await request(app)
      .post('/api/resource-server/identity')
      .set('Authorization', `Bearer bearer-${bearerSub}`)
      .send({ params: { idToken: idTokenJwt } });
    expect(res.status).toBe(412);
    expect(res.body.error).toBe('id_token_subject_mismatch');
  });

  // Test 4d: POST /identity body id_token preferred over session id_token
  it('Test 4d: POST /identity body id_token preferred over session id_token', async () => {
    const sub = 'user-pref';
    const bodyIdToken    = makeJwt({ sub, aud: 'body', note: 'from-body' });
    const sessionIdToken = makeJwt({ sub, aud: 'session', note: 'from-session' });
    const accessJwt      = makeJwt({ sub, aud: 'resource-server' });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { oauthTokens: { accessToken: accessJwt, idToken: sessionIdToken } };
      next();
    });
    const { authenticateToken } = require('../../middleware/auth');
    const router = require('../../routes/resourceServer');
    app.use('/api/resource-server', authenticateToken, router);

    const res = await request(app)
      .post('/api/resource-server/identity')
      .set('Authorization', `Bearer bearer-${sub}`)
      .send({ params: { idToken: bodyIdToken } });

    expect(res.status).toBe(200);
    // Body was preferred → idTokenSource should be 'wire'
    expect(res.body).toHaveProperty('idTokenSource', 'wire');
    // idTokenClaims.aud should be 'body' (from the body token, not 'session')
    expect(res.body.idTokenClaims).toHaveProperty('aud', 'body');
  });
});
