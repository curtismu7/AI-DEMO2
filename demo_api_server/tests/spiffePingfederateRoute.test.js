'use strict';

/**
 * POST /api/demo/spiffe/pingfederate/exchange — the route must fail closed
 * (503, structured error) when the feature flag is off, and must never
 * require auth bypass: it rides the same public demo surface as /svid.
 */
const request = require('supertest');
const express = require('express');
const configStore = require('../services/configStore');

jest.mock('../services/spiffePingfederateService', () => ({
  exchangeWithPingFederate: jest.fn(),
}));

const spiffeDemo = require('../routes/spiffeDemo');

function buildApp() {
  const app = express();
  app.use('/api/demo/spiffe', spiffeDemo);
  return app;
}

beforeEach(() => {
  const real = configStore.getEffective.bind(configStore);
  jest.spyOn(configStore, 'getEffective').mockImplementation(
    (key) => (key === 'ff_spiffe_pf_exchange' ? 'false' : real(key)),
  );
});

afterEach(() => jest.restoreAllMocks());

it('maps isConfigError service failures to a structured 503', async () => {
  const svc = require('../services/spiffePingfederateService');
  const err = new Error('disabled (ff_spiffe_pf_exchange)');
  err.code = 'SPIFFE_PF_EXCHANGE_DISABLED';
  err.httpStatus = 503;
  err.isConfigError = true;
  svc.exchangeWithPingFederate.mockRejectedValueOnce(err);
  const res = await request(buildApp())
    .post('/api/demo/spiffe/pingfederate/exchange')
    .send({});
  expect(res.status).toBe(503);
  expect(res.body.error).toBe('spiffe_pf_unavailable');
  expect(res.body.error_description).toMatch(/ff_spiffe_pf_exchange/);
});

it('returns the SPIFFE id and token on success when the flag is on', async () => {
  const real = configStore.getEffective.bind(configStore);
  jest.spyOn(configStore, 'getEffective').mockImplementation(
    (key) => (key === 'ff_spiffe_pf_exchange' ? 'true' : real(key)),
  );
  const svc = require('../services/spiffePingfederateService');
  svc.exchangeWithPingFederate.mockResolvedValueOnce({
    accessToken: 'tok', spiffeId: 'spiffe://bxfinance.demo/bff',
    actorSpiffeId: 'spiffe://bxfinance.demo/bff', issuer: 'https://local.ping-devops.com:8443',
  });
  const res = await request(buildApp())
    .post('/api/demo/spiffe/pingfederate/exchange')
    .send({});
  expect(res.status).toBe(200);
  expect(res.body.spiffe_id).toBe('spiffe://bxfinance.demo/bff');
  expect(res.body.access_token).toBe('tok');
});

it('maps service failures to 502 with the upstream reason', async () => {
  const real = configStore.getEffective.bind(configStore);
  jest.spyOn(configStore, 'getEffective').mockImplementation(
    (key) => (key === 'ff_spiffe_pf_exchange' ? 'true' : real(key)),
  );
  const svc = require('../services/spiffePingfederateService');
  svc.exchangeWithPingFederate.mockRejectedValueOnce(new Error('upstream says no'));
  const res = await request(buildApp())
    .post('/api/demo/spiffe/pingfederate/exchange')
    .send({});
  expect(res.status).toBe(502);
  expect(res.body.error).toBe('spiffe_pf_exchange_failed');
});
