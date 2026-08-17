'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 'u1', username: 'testuser', role: 'customer' }; next(); },
  requireScopes: jest.fn(() => (req, res, next) => next()),
  requireNotAdmin: jest.fn(() => (req, res, next) => next()),
}));
jest.mock('../../middleware/demoMode', () => ({
  blockInDemoMode: jest.fn(() => (req, res, next) => next()),
}));
jest.mock('../../services/transactionConsentChallenge', () => ({
  confirmChallenge: jest.fn(),
  confirmChallengeViaDaVinci: jest.fn(),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));

const txConsent = require('../../services/transactionConsentChallenge');
const configStore = require('../../services/configStore');
const transactionsRoutes = require('../../routes/transactions');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { save: jest.fn((cb) => cb(null)) };
    next();
  });
  app.use('/api/transactions', transactionsRoutes);
  return app;
}

describe('POST /consent-challenge/:id/confirm — DaVinci flag routing', () => {
  beforeEach(() => {
    txConsent.confirmChallenge.mockReset().mockResolvedValue({ ok: true, challengeId: 'c1' });
    txConsent.confirmChallengeViaDaVinci.mockReset().mockResolvedValue({ ok: true, challengeId: 'c1', viaDaVinci: true });
    configStore.getEffective.mockReset();
  });

  test('flag OFF (default): calls confirmChallenge, never confirmChallengeViaDaVinci', async () => {
    configStore.getEffective.mockReturnValue(undefined);
    await request(buildApp()).post('/api/transactions/consent-challenge/c1/confirm').send({});
    expect(txConsent.confirmChallenge).toHaveBeenCalled();
    expect(txConsent.confirmChallengeViaDaVinci).not.toHaveBeenCalled();
  });

  test('flag ON: calls confirmChallengeViaDaVinci, never confirmChallenge', async () => {
    configStore.getEffective.mockImplementation((k) => (k === 'ff_davinci_orchestration' ? 'true' : undefined));
    await request(buildApp()).post('/api/transactions/consent-challenge/c1/confirm').send({});
    expect(txConsent.confirmChallengeViaDaVinci).toHaveBeenCalled();
    expect(txConsent.confirmChallenge).not.toHaveBeenCalled();
  });
});
