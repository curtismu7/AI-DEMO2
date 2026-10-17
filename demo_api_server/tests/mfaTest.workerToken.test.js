'use strict';
/**
 * The MFA test page's worker-token status must reflect the PingOne worker token the
 * MFA calls actually use — never the provider-dependent agent login, which under a
 * PingFederate provider posts PingOne credentials to PF's token endpoint and fails.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/mfaService', () => ({ getWorkerToken: jest.fn(async () => 'p1-worker-token') }));
jest.mock('../middleware/auth', () => ({ authenticateToken: (req, _res, next) => next() }));
jest.mock('../services/oauthService', () => ({ getAgentClientCredentialsTokenWithExpiry: jest.fn(async () => { throw new Error('Agent client credentials failed: Invalid client or client credentials.'); }) }));
jest.mock('../services/apiCallTrackerService', () => ({ trackApiCall: jest.fn() }));
jest.mock('../services/configStore', () => ({ ensureInitialized: jest.fn(async () => {}), getEffective: jest.fn() }));

const mfaService = require('../services/mfaService');
const oauthService = require('../services/oauthService');
const router = require('../routes/mfaTest');

const app = express();
app.use((req, _res, next) => { req.session = {}; next(); });
app.use('/api/mfa/test', router);

test('worker-token status uses the PingOne MFA worker token, not the agent login', async () => {
  const res = await request(app).get('/api/mfa/test/worker-token').expect(200);
  expect(res.body.success).toBe(true);
  expect(mfaService.getWorkerToken).toHaveBeenCalled();
  expect(oauthService.getAgentClientCredentialsTokenWithExpiry).not.toHaveBeenCalled();
});
