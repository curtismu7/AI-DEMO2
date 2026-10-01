'use strict';
/**
 * MFA is PingOne's. A PingFederate session's subject is a PingFederate
 * username, not a PingOne user id, so the MFA routes act on the PingOne account
 * with the same username — or refuse, never falling back to the PF subject.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/mfaService', () => ({ listMfaDevices: jest.fn(async () => ({ devices: [] })) }));
jest.mock('../middleware/auth', () => ({ authenticateToken: (req, _res, next) => next() }));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/posthog', () => ({ capture: jest.fn() }));
jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../services/pingOneUserLookupService', () => ({ fetchPingOneUserByUsername: jest.fn() }));

const mfaService = require('../services/mfaService');
const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');
const router = require('../routes/mfa');

let sessionUser;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.session = { user: sessionUser, save: (cb) => cb && cb() };
  next();
});
app.use('/api/auth/mfa', router);

beforeEach(() => jest.clearAllMocks());

test('a PingOne session uses its own subject and looks nothing up', async () => {
  sessionUser = { oauthProvider: 'pingone', oauthId: 'p1-uuid', username: 'demoUser' };
  await request(app).get('/api/auth/mfa/devices').expect(200);
  expect(mfaService.listMfaDevices).toHaveBeenCalledWith('p1-uuid');
  expect(fetchPingOneUserByUsername).not.toHaveBeenCalled();
});

test('a PingFederate session acts on the PingOne account with the same username, looked up once', async () => {
  sessionUser = { oauthProvider: 'pingfederate', oauthId: 'demouser', username: 'demouser' };
  fetchPingOneUserByUsername.mockResolvedValue({ user: { id: 'p1-uuid', username: 'demoUser' }, error: null });
  await request(app).get('/api/auth/mfa/devices').expect(200);
  await request(app).get('/api/auth/mfa/devices').expect(200);
  expect(fetchPingOneUserByUsername).toHaveBeenCalledTimes(1);
  expect(fetchPingOneUserByUsername).toHaveBeenCalledWith('demouser');
  expect(mfaService.listMfaDevices).toHaveBeenNthCalledWith(1, 'p1-uuid');
  expect(mfaService.listMfaDevices).toHaveBeenNthCalledWith(2, 'p1-uuid');
});

test('a PingFederate user with no PingOne account is refused, not challenged as the PF subject', async () => {
  sessionUser = { oauthProvider: 'pingfederate', oauthId: 'pf-only', username: 'pf-only' };
  fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'not_found' });
  const res = await request(app).get('/api/auth/mfa/devices').expect(409);
  expect(res.body.message).toMatch(/No PingOne account matches the PingFederate user "pf-only"/);
  expect(mfaService.listMfaDevices).not.toHaveBeenCalled();
});
