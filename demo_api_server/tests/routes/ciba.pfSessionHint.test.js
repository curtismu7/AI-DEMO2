'use strict';

// A PingFederate session's subject is a PF username. CIBA runs on PingOne, so the
// default login hint — and the subject the approval is checked against — must be
// the linked PingOne user id, or every approval fails as "a different account".

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { sub: 'demouser', id: 'demouser' }; next(); },
}));
jest.mock('../../services/cibaService', () => ({
  isEnabled: () => true,
  initiateBackchannelAuth: jest.fn().mockResolvedValue({ auth_req_id: 'req-1', expires_in: 60, interval: 5 }),
  pollForTokens: jest.fn().mockResolvedValue({ id_token: 'idt', access_token: 'at' }),
  validateCibaIdToken: jest.fn().mockResolvedValue({ sub: 'p1-uuid' }),
}));
jest.mock('../../services/cibaSimulatedService', () => ({ initiateSimulated: jest.fn(), isLocalSimulationEnabled: () => false }));
jest.mock('../../services/delegationService', () => ({ findActiveByDelegate: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: () => 'deny' }));
jest.mock('../../services/tokenChainService', () => ({ trackTokenEvent: jest.fn() }));
jest.mock('../../services/pingOneUserLookupService', () => ({
  fetchPingOneUserByUsername: jest.fn().mockResolvedValue({ user: { id: 'p1-uuid' }, error: null }),
}));

const cibaService = require('../../services/cibaService');
const cibaRoutes = require('../../routes/ciba');

const session = { oauthProvider: 'pingfederate', user: { oauthProvider: 'pingfederate', oauthId: 'demouser', username: 'demouser' }, cibaRequests: {}, save: (cb) => cb(null) };
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.session = session; req.sessionID = 's1'; next(); });
app.use('/api/auth/ciba', cibaRoutes);

test('PF session: initiate sends the linked PingOne id, and the poll checks the approval against it', async () => {
  await request(app).post('/api/auth/ciba/initiate').send({ binding_message: 'Approve', channel: 'email' }).expect(200);
  expect(cibaService.initiateBackchannelAuth.mock.calls[0][0]).toBe('p1-uuid');
  await request(app).get('/api/auth/ciba/poll/req-1');
  expect(cibaService.validateCibaIdToken).toHaveBeenCalled();
  expect(cibaService.validateCibaIdToken.mock.calls[0][1]).toBe('p1-uuid');
});
