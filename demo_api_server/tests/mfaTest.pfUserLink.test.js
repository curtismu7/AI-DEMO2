'use strict';
/**
 * The MFA test page's routes act on the signed-in user's PingOne account. A
 * PingFederate session's subject is a PF username, so it must be mapped to the
 * PingOne account with the same username — never sent to PingOne as an id.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/mfaService', () => ({ listMfaDevices: jest.fn(async () => ({ devices: [] })) }));
jest.mock('../middleware/auth', () => ({ authenticateToken: (req, _res, next) => next() }));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/apiCallTrackerService', () => ({ trackApiCall: jest.fn() }));
jest.mock('../services/pingOneUserLookupService', () => ({ fetchPingOneUserByUsername: jest.fn() }));

const mfaService = require('../services/mfaService');
const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');
const router = require('../routes/mfaTest');

let sessionUser;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.session = { user: sessionUser, oauthTokens: { accessToken: 'tok' }, save: (cb) => cb && cb() };
  next();
});
app.use('/api/mfa/test', router);

beforeEach(() => jest.clearAllMocks());

test('a PingOne session lists devices for its own subject', async () => {
  sessionUser = { oauthProvider: 'pingone', oauthId: 'p1-uuid', username: 'demoUser' };
  await request(app).get('/api/mfa/test/integration/devices').expect(200);
  expect(mfaService.listMfaDevices).toHaveBeenCalledWith('p1-uuid');
  expect(fetchPingOneUserByUsername).not.toHaveBeenCalled();
});

test('a PingFederate session lists devices for the linked PingOne account', async () => {
  sessionUser = { oauthProvider: 'pingfederate', oauthId: 'demouser', username: 'demouser' };
  fetchPingOneUserByUsername.mockResolvedValue({ user: { id: 'p1-uuid' }, error: null });
  await request(app).get('/api/mfa/test/integration/devices').expect(200);
  expect(mfaService.listMfaDevices).toHaveBeenCalledWith('p1-uuid');
});

test('a PingFederate user with no PingOne account is refused, never sent as the PF subject', async () => {
  sessionUser = { oauthProvider: 'pingfederate', oauthId: 'pf-only', username: 'pf-only' };
  fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'not_found' });
  const res = await request(app).get('/api/mfa/test/integration/devices').expect(409);
  expect(res.body.error).toMatch(/no matching PingOne user/);
  expect(mfaService.listMfaDevices).not.toHaveBeenCalled();
});
