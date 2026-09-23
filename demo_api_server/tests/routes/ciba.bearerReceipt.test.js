'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { sub: 'user-1', id: 'user-1', email: 'user@example.test' };
    next();
  },
}));
jest.mock('../../services/cibaService', () => ({
  isEnabled: () => true,
  initiateBackchannelAuth: jest.fn().mockRejectedValue(new Error('use simulated fallback')),
}));
jest.mock('../../services/cibaSimulatedService', () => ({
  initiateSimulated: jest.fn(() => ({ auth_req_id: 'req-1', expires_in: 60, interval: 5 })),
  isSimulatedApproved: () => true,
}));
jest.mock('../../services/delegationService', () => ({ findActiveByDelegate: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: () => 'fallback_simulated' }));
jest.mock('../../services/hitlServiceClient', () => ({
  respondToChallenge: jest.fn(),
}));
jest.mock('../../services/cibaTransactionReceipt', () => ({
  record: jest.fn(),
}));
jest.mock('../../services/tokenChainService', () => ({
  trackTokenEvent: jest.fn().mockResolvedValue(undefined),
}));

const cibaTransactionReceipt = require('../../services/cibaTransactionReceipt');
const cibaRoutes = require('../../routes/ciba');

function appFor(session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = session;
    req.sessionID = 'session-1';
    next();
  });
  app.use('/api/auth/ciba', cibaRoutes);
  return app;
}

describe('CIBA approved transaction receipt', () => {
  beforeEach(() => jest.clearAllMocks());

  test('records a tool and amount receipt for an approved transaction without a canonical HITL challenge', async () => {
    const session = { cibaRequests: {}, save: (cb) => cb(null) };
    const app = appFor(session);
    const initiated = await request(app).post('/api/auth/ciba/initiate').send({
      amount: 150,
      transaction_type: 'transfer',
    });
    expect(initiated.status).toBe(200);

    const res = await request(app).get('/api/auth/ciba/poll/req-1');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(cibaTransactionReceipt.record).toHaveBeenCalledWith('user-1', 'create_transfer', 150);
  });

  test('does not record a bearer receipt without a transaction tool', async () => {
    const session = { cibaRequests: {}, save: (cb) => cb(null) };
    const app = appFor(session);
    await request(app).post('/api/auth/ciba/initiate').send({ amount: 150 });
    const res = await request(app).get('/api/auth/ciba/poll/req-1');

    expect(res.status).toBe(200);
    expect(cibaTransactionReceipt.record).not.toHaveBeenCalled();
  });
});
