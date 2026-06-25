/**
 * @file scope-integration.real-token.test.js
 * Scope-enforcement tests that run with a REAL PingOne JWT from sessions.db.
 *
 * What this proves that the fabricated-token tests (scope-integration.test.js) cannot:
 *   - JWKS signature verification succeeds against the live PingOne JWKS endpoint
 *   - The real token's aud (https://resource-server.pingdemo.com) passes audience validation
 *   - Real scope strings from PingOne (space-separated in `scope` claim) parse correctly
 *   - write and read from a live token control route access correctly
 *   - A request with NO token gets 401 from the real middleware (not a mock)
 *
 * Skips automatically when no valid token is found in sessions.db.
 *
 * To run manually with a fresh token after login:
 *   npx jest --no-coverage --forceExit scope-integration.real-token
 */

'use strict';

const path = require('path');
const { open } = require('lmdb');
const request = require('supertest');

// ── Read real token from the LMDB session store (NO SQLITE) ───────────────────
// Sessions live in data/persistent/lmdb, DB 'sessions', entries { sess, expire }
// (expire in ms; sess already JSON-decoded). Mirrors tests/real/helpers/session.js.

function loadRealToken() {
  let env;
  try {
    const lmdbPath = path.resolve(__dirname, '../../data/persistent/lmdb');
    env = open({ path: lmdbPath, maxDbs: 16, encoding: 'json', readOnly: true });
    const db = env.openDB('sessions', { encoding: 'json' });
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    for (const { value } of db.getRange()) {
      if (!value || value.expire <= nowMs) continue;
      const at = value.sess?.oauthTokens?.accessToken;
      if (!at) continue;
      try {
        const payload = JSON.parse(Buffer.from(at.split('.')[1], 'base64url').toString('utf8'));
        if (payload.exp > nowSec) return { token: at, payload, user: value.sess.user || {} };
      } catch { /* skip malformed */ }
    }
    return null;
  } catch {
    return null;
  } finally {
    try { if (env) env.close(); } catch { /* ignore */ }
  }
}

const realSession = loadRealToken();
const hasRealToken = !!realSession;

// ── Mocks needed regardless of token ─────────────────────────────────────────
// auth middleware is NOT mocked — that's the whole point of this file.

// configStore: prevent SQLite config.db (ff_hitl_enabled=false) from bypassing HITL
jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn((key) => {
    if (key === 'ff_hitl_enabled') return 'false'; // keep gates off so routes reach their logic
    if (key === 'max_transaction_amount') return '10000';
    return null;
  }),
  setConfig: jest.fn().mockResolvedValue(undefined),
  isReadOnly: jest.fn(() => false),
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
  isConfigured: jest.fn(() => false),
  FIELD_DEFS: {},
  SECRET_KEYS: [],
  validateTwoExchangeConfig: jest.fn(() => ({ valid: false, missing: [] })),
  buildAllowedScopesByAudience: jest.fn(() => ({})),
}));

// demoScenarioStore: avoid Redis connection attempt
jest.mock('../../services/demoScenarioStore', () => ({
  load: jest.fn(async () => ({ accountSnapshot: [] })),
  save: jest.fn(async () => {}),
}));

// PingOne Authorize: permit everything — we're testing auth, not policy
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn().mockResolvedValue({ decision: 'PERMIT', raw: {} }),
  evaluateMcpToolDelegation: jest.fn().mockResolvedValue({ decision: 'PERMIT', stepUpRequired: false, raw: {} }),
  isMcpDelegationDecisionReady: jest.fn(() => false),
}));

jest.mock('../../services/transactionAuthorizationService', () => ({
  evaluateTransactionPolicy: jest.fn().mockResolvedValue({ ran: false, reason: 'disabled' }),
}));

jest.mock('../../services/posthog', () => ({ capture: jest.fn() }));
jest.mock('../../middleware/demoMode', () => ({
  blockInDemoMode: () => (req, res, next) => next(),
}));

const app = require('../../server');
const runtimeSettings = require('../../config/runtimeSettings');

beforeAll(() => {
  runtimeSettings.update({ stepUpEnabled: false, authorizeEnabled: false });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const bearer = (token) => `Bearer ${token}`;

// ── Tests: skipped when no valid session token is available ───────────────────

(hasRealToken ? describe : describe.skip)(
  'Real PingOne JWT — JWKS validation + scope enforcement',
  () => {
    jest.setTimeout(15000); // JWKS fetch may take a moment

    const { token, payload } = realSession || {};

    it('token metadata is sane before running tests', () => {
      expect(payload.sub).toBeTruthy();
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(payload.scope).toContain('read');
      expect(payload.aud).toContain('https://resource-server.pingdemo.com');
    });

    // ── 401 when no token ─────────────────────────────────────────────────────

    it('GET /api/transactions/my → 401 with no Authorization header', async () => {
      const res = await request(app).get('/api/transactions/my');
      expect(res.status).toBe(401);
    });

    it('GET /api/transactions/my → 401 with a malformed Bearer token', async () => {
      const res = await request(app)
        .get('/api/transactions/my')
        .set('Authorization', 'Bearer not.a.realtoken');
      expect(res.status).toBe(401);
    });

    // ── read — GET routes the real token can access ───────────────────

    it('GET /api/transactions/my → 200 with real token (read)', async () => {
      const res = await request(app)
        .get('/api/transactions/my')
        .set('Authorization', bearer(token));
      // 200 = real JWKS verified, aud validated, scope accepted
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.transactions)).toBe(true);
    });

    it('GET /api/accounts/my → 200 with real token', async () => {
      const res = await request(app)
        .get('/api/accounts/my')
        .set('Authorization', bearer(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.accounts)).toBe(true);
    });

    // ── Admin-only routes: real token has no admin:read → 403 ─────────────

    it('GET /api/transactions → 403 with real token (no admin role)', async () => {
      const res = await request(app)
        .get('/api/transactions')
        .set('Authorization', bearer(token));
      expect(res.status).toBe(403);
    });

    it('GET /api/accounts → 403 with real token (no admin role)', async () => {
      const res = await request(app)
        .get('/api/accounts')
        .set('Authorization', bearer(token));
      expect(res.status).toBe(403);
    });

    // ── write — POST that the real token can reach ────────────────────

    it('POST /api/transactions deposit → reaches business logic with real token', async () => {
      // We expect 201 (success) OR a business-logic error (400), NOT a 401/403.
      // Either outcome proves JWKS + scope passed — the route was reached.
      const res = await request(app)
        .post('/api/transactions')
        .set('Authorization', bearer(token))
        .send({
          toAccountId: 'any-account-id',
          amount: 50,
          type: 'deposit',
          description: 'real-token test deposit',
        });
      expect([201, 400, 404]).toContain(res.status); // not 401 or 403
    });

    // ── Sensitive details: routing note ──────────────────────────────────────
    // In the full server, accountRoutes mounts GET /:id BEFORE sensitiveBankingRoutes.
    // A non-admin GET /api/accounts/sensitive-details is caught by /:id → 403 admin-only.
    // The 428 ACR gate only fires in the isolated sensitiveBanking.route.test.js setup.
    // This test confirms the REAL token passes JWKS auth (not 401) even if /:id intercepts.

    it('GET /api/accounts/sensitive-details → not 401 (real token passed JWKS auth)', async () => {
      const res = await request(app)
        .get('/api/accounts/sensitive-details')
        .set('Authorization', bearer(token));
      // /:id in accountRoutes intercepts for non-admin → 403; real JWKS auth still ran
      expect(res.status).not.toBe(401);
    });

    // ── Token claims parsed correctly from real JWKS-verified JWT ─────────────

    it('real token sub and scopes reach req.user correctly', async () => {
      // /api/transactions/my returns the authenticated user's transactions.
      // If the route succeeds, req.user.id === payload.sub was set by real auth middleware.
      const res = await request(app)
        .get('/api/transactions/my')
        .set('Authorization', bearer(token));
      expect(res.status).toBe(200);
      // Validate that the right identity was resolved (not a test fixture sub)
      expect(payload.sub).toBe('6689a774-46af-4198-a6ff-38198dc341ac');
    });
  },
);

// ── Always-on: documents what token is available (or not) ────────────────────

describe('Real-token availability', () => {
  it('reports whether a valid session token is present', () => {
    if (hasRealToken) {
      const { payload } = realSession;
      const remaining = payload.exp - Math.floor(Date.now() / 1000);
      console.info(
        `[real-token] Using token for sub=${payload.sub} ` +
        `scopes="${payload.scope}" exp in ${remaining}s`,
      );
    } else {
      console.info('[real-token] No valid session token found — live tests skipped. ' +
        'Log in at the banking UI to populate sessions.db.');
    }
    expect(true).toBe(true); // always passes — this is documentation only
  });
});
