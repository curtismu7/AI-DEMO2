'use strict';

/**
 * GET /api/aam/probe — surfaces an AAM decision to the token chain.
 *
 * /aam is called directly by clients, so nothing in the BFF normally receives
 * the gateway's X-Gw-Audit-Trail header. Without this route the chain stays
 * empty no matter how good the trail is; the probe is what makes a gw-aam event
 * possible.
 *
 * The gateway stamps the trail on BOTH outcomes — the 403 deny as well as the
 * allowed 200 — so the route must read the trail before reacting to status.
 * A deny is the interesting case in a demo; treating it as an error would throw
 * away exactly the decision worth showing.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/configStore', () => ({ get: jest.fn(), getEffective: jest.fn() }));
jest.mock('axios', () => ({ get: jest.fn() }));

const configStore = require('../services/configStore');
const axios = require('axios');
const aamProbe = require('../routes/aamProbe');

function buildApp() {
  const app = express();
  app.use('/api/aam', aamProbe);
  return app;
}

/** A gateway response carrying the aam section the Groovy filters stamp. */
function gwResponse(status, aam) {
  return {
    status,
    headers: aam ? { 'x-gw-audit-trail': JSON.stringify({ aam }) } : {},
    data: {},
  };
}

const DENY_AAM = {
  decision: 'DENY',
  backend: 'mock',
  serviceUri: 'http://authz-server:9001/sideband/request',
  elapsedMs: 8,
  request: { method: 'GET', headers: [{ Authorization: '<redacted>' }] },
  response: { response: { response_code: '403', response_status: 'Forbidden' } },
};

const PERMIT_AAM = { ...DENY_AAM, decision: 'PERMIT', response: {} };

describe('GET /api/aam/probe', () => {
  beforeEach(() => {
    configStore.getEffective.mockReset();
    axios.get.mockReset();
    configStore.getEffective.mockImplementation((k) => (k === 'ff_aam' ? 'true' : 'false'));
  });

  test('returns the decision and both JSON bodies on a DENY', async () => {
    axios.get.mockResolvedValue(gwResponse(403, DENY_AAM));
    const res = await request(buildApp()).get('/api/aam/probe');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.decision).toBe('DENY');
    expect(res.body.backend).toBe('mock');
    expect(res.body.request).toBeTruthy();
    expect(res.body.response).toBeTruthy();
  });

  test('a gateway 403 is reported, not treated as a failure', async () => {
    // The deny IS the demo. Surfacing it as ok:false would hide the decision.
    axios.get.mockResolvedValue(gwResponse(403, DENY_AAM));
    const res = await request(buildApp()).get('/api/aam/probe');
    expect(res.body.ok).toBe(true);
    expect(res.body.httpStatus).toBe(403);
  });

  test('reports a PERMIT', async () => {
    axios.get.mockResolvedValue(gwResponse(200, PERMIT_AAM));
    const res = await request(buildApp()).get('/api/aam/probe');
    expect(res.body.decision).toBe('PERMIT');
    expect(res.body.httpStatus).toBe(200);
  });

  test('reports disabled without calling the gateway when ff_aam is off', async () => {
    configStore.getEffective.mockImplementation((k) => (k === 'ff_aam' ? 'false' : 'false'));
    const res = await request(buildApp()).get('/api/aam/probe');
    expect(res.status).toBe(200);
    expect(res.body.disabled).toBe(true);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a response with no trail yields null decision rather than throwing', async () => {
    axios.get.mockResolvedValue(gwResponse(404, null));
    const res = await request(buildApp()).get('/api/aam/probe');
    expect(res.status).toBe(200);
    expect(res.body.decision).toBeNull();
  });

  test('a malformed trail header yields null decision rather than throwing', async () => {
    axios.get.mockResolvedValue({ status: 200, headers: { 'x-gw-audit-trail': '{not json' }, data: {} });
    const res = await request(buildApp()).get('/api/aam/probe');
    expect(res.status).toBe(200);
    expect(res.body.decision).toBeNull();
  });

  test('an unreachable gateway is reported, not thrown', async () => {
    axios.get.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await request(buildApp()).get('/api/aam/probe');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/ECONNREFUSED/);
  });

  test('forwards the simulated flag so the gateway can select the mock backend', async () => {
    configStore.getEffective.mockImplementation((k) => {
      if (k === 'ff_aam') return 'true';
      if (k === 'ff_authorize_simulated') return 'true';
      return 'false';
    });
    axios.get.mockResolvedValue(gwResponse(403, DENY_AAM));
    await request(buildApp()).get('/api/aam/probe');
    const opts = axios.get.mock.calls[0][1];
    expect(opts.headers['X-Authz-Simulated']).toBe('true');
    // The gateway trusts that header only alongside the internal secret.
    expect(opts.headers).toHaveProperty('X-BFF-Internal');
  });
});
