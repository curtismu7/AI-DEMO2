jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  requireNotAdmin: (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    if (!req.session) req.session = {};
    if (!req.session.user) {
      req.session.user = { id: 'test-user', role: 'admin', username: 'testadmin' };
    }
    req.user = req.session.user;
    next();
  },
  requireSession: (req, res, next) => {
    if (!req.session) req.session = {};
    if (!req.session.user) {
      req.session.user = { id: 'test-user', role: 'admin', username: 'testadmin' };
      req.user = req.session.user;
    }
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.session) req.session = {};
    if (!req.session.user) {
      req.session.user = { id: 'test-user', role: 'admin', username: 'testadmin' };
    }
    if (req.session.user?.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  },
  requireOwnershipOrAdmin: (req, res, next) => next(),
  requireEndUser: (req, res, next) => next(),
  requireAIAgent: (req, res, next) => next(),
  requireDelegation: (req, res, next) => next(),
  requireScopes: () => (req, res, next) => {
    if (!req.session) req.session = {};
    if (!req.session.user) {
      req.session.user = { id: 'test-user', role: 'admin', username: 'testadmin' };
    }
    next();
  },
  verifyPassword: jest.fn(() => true),
  hashPassword: jest.fn((pwd) => pwd),
  determineClientType: jest.fn(() => 'enduser'),
  determineUserTypeFromToken: jest.fn(() => 'customer'),
  parseTokenScopes: jest.fn(() => []),
  hasRequiredScopes: jest.fn(() => true),
}));

jest.mock('express-session', () => {
  return () => (req, res, next) => {
    if (!req.session) {
      req.session = {
        user: { id: 'test-user', role: 'admin', username: 'testadmin' },
        oauthType: 'admin'
      };
    }
    next();
  };
});

jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn().mockResolvedValue({ decision: 'PERMIT', raw: {} }),
}));

jest.mock('../../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  getAllUsers: jest.fn(() => Promise.resolve([])),
}));

describe('Feature Flags Route', () => {
  const request = require('supertest');
  const app = require('../../server');

  describe('GET /api/admin/feature-flags', () => {
    it('returns all flags with current values', async () => {
      const res = await request(app).get('/api/admin/feature-flags');
      expect(res.status).toBe(200);
      expect(res.body.flags).toBeDefined();
      expect(Array.isArray(res.body.flags)).toBe(true);
      expect(res.body.flags.length).toBeGreaterThan(0);

      const flagIds = res.body.flags.map(f => f.id);
      expect(flagIds).toContain('ff_hitl_enabled');
      expect(flagIds).toContain('step_up_enabled');
    });

    it('returns flag metadata (id, label, value, category)', async () => {
      const res = await request(app).get('/api/admin/feature-flags');
      const flag = res.body.flags[0];
      expect(flag.id).toBeDefined();
      expect(typeof flag.value).toBe('boolean');
      expect(flag.category).toBeDefined();
    });

    it('registers ff_admin_skin_ping2026 with default true', async () => {
      const res = await request(app).get('/api/admin/feature-flags');
      const flag = res.body.flags.find(f => f.id === 'ff_admin_skin_ping2026');
      expect(flag).toBeDefined();
      expect(flag.type).toBe('boolean');
      expect(flag.defaultValue).toBe(true);
      expect(flag.category).toBe('UI / Dashboard');
    });

    it('registers ff_customer_skin_ping2026 with default false', async () => {
      const res = await request(app).get('/api/admin/feature-flags');
      const flag = res.body.flags.find(f => f.id === 'ff_customer_skin_ping2026');
      expect(flag).toBeDefined();
      expect(flag.type).toBe('boolean');
      expect(flag.defaultValue).toBe(false);
      expect(flag.value).toBe(false);
      expect(flag.category).toBe('UI / Dashboard');
      expect(flag.name).toBe('Customer UI — New Ping2026 Skin');
    });

    it('registers ff_sidebar_customization with default true', async () => {
      const res = await request(app).get('/api/admin/feature-flags');
      const flag = res.body.flags.find(f => f.id === 'ff_sidebar_customization');
      expect(flag).toBeDefined();
      expect(flag.type).toBe('boolean');
      expect(flag.defaultValue).toBe(true);
      expect(flag.value).toBe(true);
      expect(flag.category).toBe('UI / Dashboard');
    });
  });

  describe('PATCH /api/admin/feature-flags', () => {
    it('updates a single flag and persists', async () => {
      // Get current value
      const getRes = await request(app).get('/api/admin/feature-flags');
      const currentFlag = getRes.body.flags.find(f => f.id === 'ff_hitl_enabled');
      const originalValue = currentFlag.value;

      // Toggle it
      const newValue = !originalValue;
      const patchRes = await request(app).patch('/api/admin/feature-flags').send({
        updates: { ff_hitl_enabled: newValue }
      });
      expect(patchRes.status).toBe(200);

      // Verify returned value
      const updatedFlag = patchRes.body.flags.find(f => f.id === 'ff_hitl_enabled');
      expect(updatedFlag.value).toBe(newValue);

      // Verify persistence via GET
      const verifyRes = await request(app).get('/api/admin/feature-flags');
      const persistedFlag = verifyRes.body.flags.find(f => f.id === 'ff_hitl_enabled');
      expect(persistedFlag.value).toBe(newValue);

      // Restore original
      await request(app).patch('/api/admin/feature-flags').send({
        updates: { ff_hitl_enabled: originalValue }
      });
    });

    it('updates multiple flags at once', async () => {
      const patchRes = await request(app).patch('/api/admin/feature-flags').send({
        updates: {
          ff_inject_scopes: true,
          ff_hitl_enabled: false,
          step_up_enabled: true
        }
      });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.flags.find(f => f.id === 'ff_inject_scopes').value).toBe(true);
      expect(patchRes.body.flags.find(f => f.id === 'ff_hitl_enabled').value).toBe(false);
      expect(patchRes.body.flags.find(f => f.id === 'step_up_enabled').value).toBe(true);
    });

    it('rejects a non-boolean value for a boolean flag', async () => {
      const res = await request(app).patch('/api/admin/feature-flags').send({
        updates: { ff_hitl_enabled: 'invalid-string' }
      });
      expect(res.status).toBe(400);
      // Stored value is unchanged — garbage is never persisted
      const verifyRes = await request(app).get('/api/admin/feature-flags');
      const flag = verifyRes.body.flags.find(f => f.id === 'ff_hitl_enabled');
      expect(typeof flag.value).toBe('boolean');
    });

    it('accepts "true"/"false" string forms for boolean flags', async () => {
      const res = await request(app).patch('/api/admin/feature-flags').send({
        updates: { ff_hitl_enabled: 'true' }
      });
      expect(res.status).toBe(200);
      expect(res.body.flags.find(f => f.id === 'ff_hitl_enabled').value).toBe(true);
      await request(app).patch('/api/admin/feature-flags').send({
        updates: { ff_hitl_enabled: false }
      });
    });

    it('rejects an enum value outside the flag options', async () => {
      const res = await request(app).patch('/api/admin/feature-flags').send({
        updates: { hitl_consent_mfa_mode: 'bogus-mode' }
      });
      expect(res.status).toBe(400);
      expect(res.body.allowed).toContain('onetime');
    });

    it('accepts a valid enum value', async () => {
      const res = await request(app).patch('/api/admin/feature-flags').send({
        updates: { hitl_consent_mfa_mode: 'homegrown' }
      });
      expect(res.status).toBe(200);
      expect(res.body.flags.find(f => f.id === 'hitl_consent_mfa_mode').value).toBe('homegrown');
      await request(app).patch('/api/admin/feature-flags').send({
        updates: { hitl_consent_mfa_mode: 'onetime' }
      });
    });
  });

  // step_up_enabled carries runtimeKey 'stepUpEnabled' — PATCH must mirror the value
  // into runtimeSettings (the live source enforcement reads) and GET must report that
  // live value, so the toggle, the API response, and the enforcement path never disagree.
  describe('runtimeKey live mirror (configStore <-> runtimeSettings)', () => {
    const runtimeSettings = require('../../config/runtimeSettings');

    afterAll(async () => {
      // Restore the registry default so this suite doesn't leak state to others.
      await request(app).patch('/api/admin/feature-flags').send({
        updates: { step_up_enabled: true }
      });
    });

    it('PATCH mirrors a runtimeKey flag into runtimeSettings and GET reports the live value', async () => {
      const off = await request(app).patch('/api/admin/feature-flags').send({
        updates: { step_up_enabled: false }
      });
      expect(off.status).toBe(200);
      expect(off.body.flags.find(f => f.id === 'step_up_enabled').value).toBe(false);
      // The live in-memory value consumers actually read is updated immediately.
      expect(runtimeSettings.get('stepUpEnabled')).toBe(false);
      // GET resolves the flag from the live runtimeSettings value, not the default.
      const getOff = await request(app).get('/api/admin/feature-flags');
      expect(getOff.body.flags.find(f => f.id === 'step_up_enabled').value).toBe(false);

      const on = await request(app).patch('/api/admin/feature-flags').send({
        updates: { step_up_enabled: true }
      });
      expect(on.status).toBe(200);
      expect(runtimeSettings.get('stepUpEnabled')).toBe(true);
      const getOn = await request(app).get('/api/admin/feature-flags');
      expect(getOn.body.flags.find(f => f.id === 'step_up_enabled').value).toBe(true);
    });
  });
});
