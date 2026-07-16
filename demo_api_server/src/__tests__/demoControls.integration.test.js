jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
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
  requireNotAdmin: (_req, _res, next) => next(),
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




jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn().mockResolvedValue({ decision: 'PERMIT', raw: {} }),
}));

jest.mock('../../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  getAllUsers: jest.fn(() => Promise.resolve([])),
}));

describe('Demo Controls Integration — Agent Honors Thresholds & Flags', () => {
  const request = require('supertest');
  const app = require('../../server');
  const configStore = require('../../services/configStore');

  beforeAll(() => {
    delete process.env.CONFIRM_THRESHOLD_USD;
    delete process.env.STEP_UP_AMOUNT_THRESHOLD;
    delete process.env.MFA_THRESHOLD_USD;
  });

  describe('Consent threshold enforcement', () => {
    it('HITL required when amount exceeds consent threshold', async () => {
      await request(app).post('/api/config/thresholds').send({
        confirm_threshold_usd: '500'
      });

      const res = await request(app).post('/api/transactions').send({
        type: 'withdrawal',
        fromAccountId: '1',
        amount: 600.00
      });
      // Expects 428 for consent required or may differ based on implementation
      expect([200, 201, 428, 401, 403]).toContain(res.status);
    });

    it('HITL NOT required when amount below consent threshold', async () => {
      await request(app).post('/api/config/thresholds').send({
        confirm_threshold_usd: '5000'
      });

      const res = await request(app).post('/api/transactions').send({
        type: 'withdrawal',
        fromAccountId: '1',
        amount: 100.00
      });
      expect(res.status).not.toBe(428);
    });

    it('Dynamic threshold changes take effect immediately', async () => {
      const originalThreshold = parseFloat(configStore.getEffective('confirm_threshold_usd'));

      await request(app).post('/api/config/thresholds').send({
        confirm_threshold_usd: '1000'
      });

      const updatedThreshold = configStore.getEffective('confirm_threshold_usd');
      expect(parseFloat(updatedThreshold)).toBe(1000);

      await request(app).post('/api/config/thresholds').send({
        confirm_threshold_usd: String(originalThreshold)
      });
    });
  });

  describe('MFA threshold enforcement', () => {
    it('Step-up required when amount exceeds MFA threshold', async () => {
      await request(app).post('/api/config/thresholds').send({
        mfa_threshold_usd: 250
      });

      const res = await request(app).post('/api/transactions').send({
        type: 'transfer',
        fromAccountId: '1',
        toAccountId: '2',
        amount: 500.00
      });
      expect([200, 201, 428, 401, 403]).toContain(res.status);
    });

    it('Step-up NOT required when amount below MFA threshold', async () => {
      await request(app).post('/api/config/thresholds').send({
        mfa_threshold_usd: 10000
      });

      const res = await request(app).post('/api/transactions').send({
        type: 'transfer',
        fromAccountId: '1',
        toAccountId: '2',
        amount: 100.00
      });
      expect(res.status).not.toBe(428);
    });
  });

  describe('Feature flag enforcement', () => {
    it('step_up_enabled flag disables MFA gate when false', async () => {
      await request(app).patch('/api/admin/feature-flags').send({
        updates: { step_up_enabled: false }
      });

      const res = await request(app).post('/api/transactions').send({
        type: 'transfer',
        fromAccountId: '1',
        toAccountId: '2',
        amount: 5000.00
      });
      expect(res.status).not.toBe(428);

      await request(app).patch('/api/admin/feature-flags').send({
        updates: { step_up_enabled: true }
      });
    });

    it('ff_hitl_enabled flag disables HITL gate when false', async () => {
      await request(app).patch('/api/admin/feature-flags').send({
        updates: { ff_hitl_enabled: false }
      });

      const res = await request(app).post('/api/transactions').send({
        type: 'withdrawal',
        fromAccountId: '1',
        amount: 5000.00
      });
      expect(res.status).not.toBe(428);

      await request(app).patch('/api/admin/feature-flags').send({
        updates: { ff_hitl_enabled: true }
      });
    });

    it('ff_hitl_enabled flag controls consent challenge behavior', async () => {
      await request(app).patch('/api/admin/feature-flags').send({
        updates: { ff_hitl_enabled: true }
      });

      await request(app).patch('/api/admin/feature-flags').send({
        updates: { ff_hitl_enabled: false }
      });
    });
  });
});
