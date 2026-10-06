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
  initiateBackchannelAuth: jest.fn().mockResolvedValue({ auth_req_id: 'req-1', expires_in: 60, interval: 5 }),
}));
jest.mock('../../services/cibaSimulatedService', () => ({
  initiateSimulated: jest.fn(),
  isLocalSimulationEnabled: () => false,
}));
jest.mock('../../services/delegationService', () => ({ findActiveByDelegate: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: () => 'deny' }));
jest.mock('../../services/hitlServiceClient', () => ({
  getChallengeStatus: jest.fn(),
  respondToChallenge: jest.fn(),
}));
jest.mock('../../data/store', () => ({ getAccountById: (id) => ({ id, userId: 'user-1' }) }));
jest.mock('../../services/tokenChainService', () => ({ trackTokenEvent: jest.fn() }));

const hitlServiceClient = require('../../services/hitlServiceClient');
const cibaService = require('../../services/cibaService');
const cibaRoutes = require('../../routes/ciba');

function appFor() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { cibaRequests: {}, save: (cb) => cb(null) };
    next();
  });
  app.use('/api/auth/ciba', cibaRoutes);
  return app;
}

const challenge = (over = {}) => ({
  status: 'pending', userId: 'user-1', tool: 'extend_rental', context: { amount: 600 }, ...over,
});

describe('CIBA initiate for a vertical (non-banking) HITL tool', () => {
  beforeEach(() => jest.clearAllMocks());

  test('extend_rental challenge with no banking transaction_type initiates', async () => {
    hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge());
    const res = await request(appFor()).post('/api/auth/ciba/initiate')
      .send({ hitl_challenge_id: 'c1', binding_message: 'Approve your banking transaction' });
    expect(res.status).toBe(200);
  });

  test('a mismatched supplied amount is still rejected, with a readable message', async () => {
    hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge());
    const res = await request(appFor()).post('/api/auth/ciba/initiate')
      .send({ hitl_challenge_id: 'c1', amount: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_hitl_challenge');
    expect(res.body.message).toMatch(/approval/i);
  });

  test('banking transfer still requires tool match', async () => {
    hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge({ context: { amount: 600, fromAccountId: 'a', toAccountId: 'b' } }));
    const res = await request(appFor()).post('/api/auth/ciba/initiate').send({
      hitl_challenge_id: 'c1', transaction_type: 'transfer', amount: 600, from_account_id: 'a', to_account_id: 'b',
    });
    expect(res.status).toBe(400);
  });

  test('upstream PingOne error_description is surfaced', async () => {
    cibaService.initiateBackchannelAuth.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 400'), {
        response: { data: { error: 'invalid_request', error_description: 'login_hint not found' } },
      }));
    const res = await request(appFor()).post('/api/auth/ciba/initiate').send({});
    expect(res.status).toBe(502);
    expect(res.body.message).toBe('login_hint not found');
  });
});
