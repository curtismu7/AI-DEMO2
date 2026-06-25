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
  requireNotAdmin: (_req, _res, next) => next(),
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

describe('Thresholds Route', () => {
  const request = require('supertest');
  const app = require('../../server');
  const runtimeSettings = require('../../config/runtimeSettings');
  const configStore = require('../../services/configStore');

  // Remove threshold env vars so database values take precedence
  beforeAll(() => {
    delete process.env.CONFIRM_THRESHOLD_USD;
    delete process.env.STEP_UP_AMOUNT_THRESHOLD;
    delete process.env.MFA_THRESHOLD_USD;
  });

  describe('GET /api/config/thresholds', () => {
    it('returns current thresholds', async () => {
      const res = await request(app).get('/api/config/thresholds');
      expect(res.status).toBe(200);
      expect(res.body.confirm_threshold_usd).toBeDefined();
      expect(res.body.mfa_threshold_usd).toBeDefined();
    });

    it('returns thresholds as strings', async () => {
      const res = await request(app).get('/api/config/thresholds');
      expect(typeof res.body.confirm_threshold_usd).toBe('string');
      expect(typeof res.body.mfa_threshold_usd).toBe('string');
    });
  });

  describe('POST /api/config/thresholds', () => {
    it('updates confirm_threshold_usd', async () => {
      const newValue = '9999';
      const postRes = await request(app).post('/api/config/thresholds').send({
        confirm_threshold_usd: newValue
      });
      expect(postRes.status).toBe(200);
      expect(postRes.body.confirm_threshold_usd).toBe(newValue);

      const getRes = await request(app).get('/api/config/thresholds');
      expect(getRes.body.confirm_threshold_usd).toBe(newValue);

      await request(app).post('/api/config/thresholds').send({
        confirm_threshold_usd: '500'
      });
    });

    it('updates mfa_threshold_usd and syncs to runtimeSettings', async () => {
      const newValue = 1500;
      const postRes = await request(app).post('/api/config/thresholds').send({
        mfa_threshold_usd: newValue
      });
      expect(postRes.status).toBe(200);

      const rtThreshold = runtimeSettings.get('stepUpAmountThreshold');
      expect(rtThreshold).toBe(newValue);

      await request(app).post('/api/config/thresholds').send({
        mfa_threshold_usd: 500
      });
    });

    it('updates both thresholds at once', async () => {
      const postRes = await request(app).post('/api/config/thresholds').send({
        confirm_threshold_usd: '750',
        mfa_threshold_usd: 1000
      });
      expect(postRes.status).toBe(200);
      expect(postRes.body.confirm_threshold_usd).toBe('750');
      expect(postRes.body.mfa_threshold_usd).toBe('1000');

      await request(app).post('/api/config/thresholds').send({
        confirm_threshold_usd: '500',
        mfa_threshold_usd: 500
      });
    });

    it('rejects non-numeric threshold values', async () => {
      const res = await request(app).post('/api/config/thresholds').send({
        mfa_threshold_usd: 'not-a-number'
      });
      expect(res.status).toBe(400);
    });

    it('rejects negative thresholds', async () => {
      const res = await request(app).post('/api/config/thresholds').send({
        mfa_threshold_usd: -100
      });
      expect(res.status).toBe(400);
    });
  });
});
