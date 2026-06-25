/**
 * @file runtime-settings-api.test.js
 * @description Regression tests for the admin runtime settings API.
 *
 * Endpoints under test:
 *   GET  /api/admin/settings  — returns current settings + change history
 *   PUT  /api/admin/settings  — updates one or more settings at runtime
 *
 * Security requirements:
 *   - Both routes require admin:read scope (or admin role)
 *   - Non-admin requests should receive 403
 *   - Unknown keys in PUT body are silently ignored
 *   - Numeric fields are type-coerced and validated
 *
 * Functional requirements:
 *   - Changes take effect immediately (no restart)
 *   - Change history is maintained (up to 50 entries)
 *   - GET always reflects the latest values
 */

const request = require('supertest');

// ─── Mock auth ────────────────────────────────────────────────────────────────
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) {
      return res.status(401).json({ error: 'authentication_required', error_description: 'Access token is required' });
    }
    try {
      req.user = JSON.parse(h);
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  },
  requireScopes: (requiredScopes) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required', error_description: 'Access token is required' });
    if (req.user.role === 'admin') return next();
    const userScopes = req.user.scopes || [];
    const arr = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
    const ok = arr.some((s) => userScopes.includes(s)) || userScopes.includes('admin:read');
    if (!ok) return res.status(403).json({ error: 'insufficient_scope' });
    return next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required', error_description: 'Access token is required' });
    if (req.user.role === 'admin') return next();
    return res.status(403).json({ error: 'insufficient_scope', error_description: 'Admin role required' });
  },
  hasRequiredScopes: (userScopes, required) => required.some((s) => userScopes.includes(s)),
  parseTokenScopes: () => [],
  requireAIAgent: (_req, _res, next) => next(),
  requireOwnershipOrAdmin: (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required' });
    if (req.user.role === 'admin') return next();
    const paramId = req.params.userId || req.params.id;
    if (paramId && req.user.id !== paramId) return res.status(403).json({ error: 'insufficient_scope' });
    return next();
  },
  requireNotAdmin: (_req, _res, next) => next(),
    requireSession: (req, res, next) => next(),
  hashPassword: (p) => p,
}));

jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn().mockResolvedValue({ decision: 'PERMIT', raw: {} }),
  evaluateMcpToolDelegation: jest.fn().mockResolvedValue({ decision: 'PERMIT', stepUpRequired: false, raw: {} }),
  isMcpDelegationDecisionReady: jest.fn(() => false),
}));

const app = require('../../server');
const runtimeSettings = require('../../config/runtimeSettings');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const adminUser = () =>
  JSON.stringify({
    id: 'admin-id',
    username: 'admin',
    email: 'admin@bank.com',
    role: 'admin',
    scopes: ['admin:read'],
    acr: 'Multi_factor',
  });

const customerUser = () =>
  JSON.stringify({
    id: 'customer-id',
    username: 'customer',
    email: 'c@bank.com',
    role: 'user',
    scopes: ['read'],
    acr: null,
  });

// ─── Restore settings after each test ────────────────────────────────────────
let originalSettings;
beforeAll(() => { originalSettings = runtimeSettings.getAll(); });
afterEach(() => {
  runtimeSettings.update({
    stepUpAmountThreshold: originalSettings.stepUpAmountThreshold,
    stepUpEnabled: originalSettings.stepUpEnabled,
    stepUpAcrValue: originalSettings.stepUpAcrValue,
    stepUpTransactionTypes: originalSettings.stepUpTransactionTypes,
    authorizeEnabled: originalSettings.authorizeEnabled,
    authorizePolicyId: originalSettings.authorizePolicyId,
  }, 'test-cleanup');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Runtime Settings API — /api/admin/settings', () => {
  // ── GET ───────────────────────────────────────────────────────────────────────
  describe('GET /api/admin/settings', () => {
    it('should return 200 with all settings for an admin user', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .set('x-test-user', adminUser());

      expect(res.status).toBe(200);
      expect(res.body.settings).toBeDefined();
      expect(typeof res.body.settings.stepUpAmountThreshold).toBe('number');
      expect(typeof res.body.settings.stepUpEnabled).toBe('boolean');
      expect(typeof res.body.settings.stepUpAcrValue).toBe('string');
      expect(Array.isArray(res.body.settings.stepUpTransactionTypes)).toBe(true);
      expect(typeof res.body.settings.authorizeEnabled).toBe('boolean');
      expect(typeof res.body.settings.authorizePolicyId).toBe('string');
    });

    it('should include change history', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .set('x-test-user', adminUser());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.history)).toBe(true);
    });

    it('should return 401 for unauthenticated requests', async () => {
      const res = await request(app).get('/api/admin/settings');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .set('x-test-user', customerUser());

      expect(res.status).toBe(403);
    });
  });

  // ── PUT ───────────────────────────────────────────────────────────────────────
  describe('PUT /api/admin/settings', () => {
    it('should update stepUpAmountThreshold and return updated settings', async () => {
      const res = await request(app)
        .put('/api/admin/settings')
        .set('x-test-user', adminUser())
        .send({ stepUpAmountThreshold: 750 });

      expect(res.status).toBe(200);
      expect(res.body.settings.stepUpAmountThreshold).toBe(750);
    });

    it('should update stepUpEnabled toggle', async () => {
      const res = await request(app)
        .put('/api/admin/settings')
        .set('x-test-user', adminUser())
        .send({ stepUpEnabled: false });

      expect(res.status).toBe(200);
      expect(res.body.settings.stepUpEnabled).toBe(false);
    });

    it('should update authorizeEnabled toggle', async () => {
      const res = await request(app)
        .put('/api/admin/settings')
        .set('x-test-user', adminUser())
        .send({ authorizeEnabled: true });

      expect(res.status).toBe(200);
      expect(res.body.settings.authorizeEnabled).toBe(true);
    });

    it('should update authorizePolicyId', async () => {
      const policyId = 'my-pdp-policy-id-123';
      const res = await request(app)
        .put('/api/admin/settings')
        .set('x-test-user', adminUser())
        .send({ authorizePolicyId: policyId });

      expect(res.status).toBe(200);
      expect(res.body.settings.authorizePolicyId).toBe(policyId);
    });

    it('should be immediately visible in a subsequent GET', async () => {
      await request(app)
        .put('/api/admin/settings')
        .set('x-test-user', adminUser())
        .send({ stepUpAmountThreshold: 999 });

      const get = await request(app)
        .get('/api/admin/settings')
        .set('x-test-user', adminUser());

      expect(get.body.settings.stepUpAmountThreshold).toBe(999);
    });

    it('should silently ignore unknown keys', async () => {
      const res = await request(app)
        .put('/api/admin/settings')
        .set('x-test-user', adminUser())
        .send({ unknownKey: 'should-be-ignored', stepUpEnabled: true });

      expect(res.status).toBe(200);
      expect(res.body.settings).not.toHaveProperty('unknownKey');
    });

    it('should return 400 when only unknown keys are provided', async () => {
      const res = await request(app)
        .put('/api/admin/settings')
        .set('x-test-user', adminUser())
        .send({ totallyMadeUp: 'value' });

      expect(res.status).toBe(400);
    });

    it('should return 403 for non-admin users', async () => {
      const res = await request(app)
        .put('/api/admin/settings')
        .set('x-test-user', customerUser())
        .send({ stepUpAmountThreshold: 1 });

      expect(res.status).toBe(403);
    });

    it('should return 401 for unauthenticated requests', async () => {
      const res = await request(app)
        .put('/api/admin/settings')
        .send({ stepUpAmountThreshold: 1 });

      expect(res.status).toBe(401);
    });

    it('should update multiple settings in a single request', async () => {
      const res = await request(app)
        .put('/api/admin/settings')
        .set('x-test-user', adminUser())
        .send({
          stepUpAmountThreshold: 300,
          stepUpEnabled: false,
          stepUpAcrValue: 'StrongAuth',
          authorizeEnabled: true,
          authorizePolicyId: 'policy-abc',
        });

      expect(res.status).toBe(200);
      expect(res.body.settings).toMatchObject({
        stepUpAmountThreshold: 300,
        stepUpEnabled: false,
        stepUpAcrValue: 'StrongAuth',
        authorizeEnabled: true,
        authorizePolicyId: 'policy-abc',
      });
    });
  });

  // ── Change history ────────────────────────────────────────────────────────────
  describe('change history', () => {
    it('should record a history entry after a PUT', async () => {
      const beforeCount = (
        await request(app)
          .get('/api/admin/settings')
          .set('x-test-user', adminUser())
      ).body.history.length;

      await request(app)
        .put('/api/admin/settings')
        .set('x-test-user', adminUser())
        .send({ stepUpAmountThreshold: 111 });

      const after = await request(app)
        .get('/api/admin/settings')
        .set('x-test-user', adminUser());

      expect(after.body.history.length).toBeGreaterThan(beforeCount);
    });

    it('history entries include changedBy, timestamp, and changes diff', async () => {
      await request(app)
        .put('/api/admin/settings')
        .set('x-test-user', adminUser())
        .send({ stepUpAcrValue: 'TestAcr' });

      const get = await request(app)
        .get('/api/admin/settings')
        .set('x-test-user', adminUser());

      const latest = get.body.history[0];
      expect(latest).toHaveProperty('timestamp');
      expect(latest).toHaveProperty('changedBy');
      expect(latest.changes).toHaveProperty('stepUpAcrValue', 'TestAcr');
      expect(latest.previous).toHaveProperty('stepUpAcrValue');
    });
  });
});
